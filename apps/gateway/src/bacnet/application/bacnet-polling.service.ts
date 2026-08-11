import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { NodeBacnetClient, BacnetTarget } from '../infrastructure/node-bacnet.client';
import { GatewayMqttService } from '../../mqtt/gateway-mqtt.service';
import { PollingMetricsService } from '../../observability/polling-metrics.service';
import { computeStartJitterMs } from '../../observability/poll-jitter.util';
import { bacnetDevices } from '../../config/bacnet-devices.config';
import { BACnetDeviceConfig, BACnetObjectConfig } from '../domain/interfaces/bacnet-config.interface';

/**
 * Config de polling recebida do backend via MQTT (tópico .../config).
 * Derivada dos pontos cadastrados no banco — fonte da verdade.
 */
interface GatewayConfigPayload {
  tenantId: string;
  gatewayId: string;
  devices: Array<{
    deviceId: string;
    name: string;
    protocol?: string;
    deviceInstance: number;
    ip: string;
    port: number;
    /** Rota BACnet (device MS/TP atrás de roteador) — null para BACnet/IP direto */
    net?: number | null;
    adr?: number[] | null;
    pollingIntervalMs: number;
    objects: BACnetObjectConfig[];
  }>;
}

/**
 * Ponto de telemetria individual de um ciclo de polling.
 */
interface TelemetryPoint {
  tag: string;
  objectType: number;
  objectInstance: number;
  /** Numérico para a maioria dos objetos; string para CharacterString Value (tipo 40). */
  value: number | string | null;
  unit: string | null;
}

/**
 * Payload publicado no MQTT a cada ciclo de polling.
 *
 * Tópico: bluebee/{tenantId}/gateway/{gatewayId}/telemetry
 */
interface TelemetryPayload {
  timestamp: string;
  deviceId: string;
  points: TelemetryPoint[];
}

/**
 * Métricas acumuladas de um ciclo de polling via RPM (para logging/diagnóstico).
 */
interface RpmCycleStats {
  /** Lotes lidos com sucesso via ReadPropertyMultiple. */
  rpmBatches: number;
  /** Vezes que um lote foi dividido ao meio (provável APDU oversize). */
  splits: number;
  /** Objetos lidos via fallback individual (ReadProperty). */
  fallbackObjects: number;
}

/**
 * BacnetPollingService
 *
 * Inicia um intervalo de polling por dispositivo configurado em bacnetDevices.
 * A cada ciclo, lê todos os objetos sem COV (useCov=false) via ReadPropertySafe
 * e publica um único payload MQTT agrupando todos os pontos lidos com sucesso.
 *
 * Objetos com useCov=true são ignorados aqui — gerenciados pelo BacnetCovService.
 */
@Injectable()
export class BacnetPollingService implements OnModuleInit {
  private readonly logger = new Logger(BacnetPollingService.name);
  private readonly tenantId: string;
  private readonly gatewayId: string;

  /** Polls ativos keyed por `${ip}:${port}` → agendamento + guard de ciclo. */
  private readonly activePolls = new Map<
    string,
    {
      /** Delay de partida (jitter) — pendente até o primeiro ciclo. */
      timeout: ReturnType<typeof setTimeout> | null;
      /** Ciclos periódicos — criado após o jitter de partida. */
      interval: ReturnType<typeof setInterval> | null;
      /** Ciclo em andamento — evita sobrepor ciclos num device lento. */
      busy: boolean;
    }
  >();
  /** Chaves (ip:port) atualmente gerenciadas pela config dinâmica do backend. */
  private dynamicKeys = new Set<string>();
  /**
   * Devices (ip:port) que responderam a leitura individual mas NÃO a
   * ReadPropertyMultiple — passam a ser lidos ponto a ponto para não repetir
   * o timeout de RPM a cada ciclo. Limpo ao (re)aplicar a config do device.
   */
  private readonly rpmUnsupported = new Set<string>();

  /** Habilita/desabilita RPM globalmente (BACNET_RPM_ENABLED=false força leitura individual). */
  private readonly rpmEnabled: boolean;
  /** Máximo de objetos por request RPM — mantém o request dentro do APDU. */
  private readonly rpmBatchSize: number;
  /** Timeout de um request RPM em batch. */
  private readonly RPM_TIMEOUT_MS = 3000;
  /** Timeout de uma leitura individual (fallback / device sem RPM). */
  private readonly READ_TIMEOUT_MS = 1500;

  constructor(
    private readonly bacnetClient: NodeBacnetClient,
    private readonly mqttService: GatewayMqttService,
    private readonly configService: ConfigService,
    private readonly pollingMetrics: PollingMetricsService,
  ) {
    this.tenantId = this.configService.get<string>('TENANT_ID', 'default');
    this.gatewayId = this.configService.get<string>('GATEWAY_ID', 'gw-01');

    this.rpmEnabled =
      this.configService.get<string>('BACNET_RPM_ENABLED', 'true') !== 'false';
    const batchSize = Number(
      this.configService.get<string>('BACNET_RPM_BATCH_SIZE', '20'),
    );
    this.rpmBatchSize =
      Number.isFinite(batchSize) && batchSize > 0 ? Math.floor(batchSize) : 20;
  }

  onModuleInit(): void {
    // Bootstrap com a config estática (fallback até a config dinâmica chegar
    // do backend via MQTT). A config dinâmica, quando chega, substitui o poll
    // do mesmo IP:porta — então não há leitura duplicada.
    for (const device of bacnetDevices) {
      this.applyDeviceConfig(device);
    }

    if (bacnetDevices.length > 0) {
      this.logger.log(
        `Polling bootstrap: ${bacnetDevices.length} dispositivo(s) estático(s) — ` +
          'aguardando config dinâmica do backend',
      );
    } else {
      this.logger.log('Sem config estática — aguardando config dinâmica do backend');
    }
  }

  /**
   * Recebe a config de polling publicada pelo backend (pontos cadastrados no banco).
   * É a fonte da verdade: pontos novos passam a ser lidos automaticamente e
   * devices removidos param de ser poll-eados — sem editar config estática.
   */
  @OnEvent('mqtt.message')
  handleConfigMessage(event: { topic: string; message: Record<string, unknown> }): void {
    if (!event.topic.endsWith('/config')) {
      return;
    }

    const payload = event.message as unknown as GatewayConfigPayload;
    if (!Array.isArray(payload.devices)) {
      this.logger.warn('Config de polling recebida sem array "devices" — ignorada');
      return;
    }

    this.applyGatewayConfig(payload.devices);
  }

  /**
   * Aplica a config dinâmica completa de um gateway: (re)inicia o polling de
   * cada device informado e encerra o polling dos que sumiram da config.
   */
  private applyGatewayConfig(devices: GatewayConfigPayload['devices']): void {
    const newKeys = new Set<string>();

    // Processa apenas blocos BACnet — blocos de outros protocolos (modbus, mqtt)
    // são tratados pelos respectivos serviços. Bloco sem protocolo = legado BACnet.
    const bacnetDevices = devices.filter((d) => !d.protocol || d.protocol === 'bacnet');

    for (const d of bacnetDevices) {
      const config: BACnetDeviceConfig = {
        id: d.deviceId,
        name: d.name,
        deviceInstance: d.deviceInstance ?? 0,
        ipAddress: d.ip,
        port: d.port,
        net: typeof d.net === 'number' && d.net > 0 ? d.net : null,
        adr: Array.isArray(d.adr) && d.adr.length > 0 ? d.adr : null,
        pollingIntervalMs: d.pollingIntervalMs || 15_000,
        objects: d.objects ?? [],
        covSubscriptions: [],
      };
      newKeys.add(this.configKey(config));
      this.applyDeviceConfig(config);
    }

    // Encerra polls de devices que estavam na config dinâmica anterior mas saíram
    for (const key of this.dynamicKeys) {
      if (!newKeys.has(key)) {
        this.stopPoll(key);
        this.logger.log(`Polling encerrado para ${key} (device removido da config)`);
      }
    }
    this.dynamicKeys = newKeys;

    const totalObjects = bacnetDevices.reduce((acc, d) => acc + (d.objects?.length ?? 0), 0);
    this.logger.log(
      `Config dinâmica BACnet aplicada — ${bacnetDevices.length} device(s), ${totalObjects} ponto(s) ` +
        '(leitura automática dos pontos cadastrados)',
    );
  }

  /**
   * (Re)inicia o intervalo de polling de um dispositivo, substituindo qualquer
   * poll anterior para o mesmo IP:porta. Executa uma leitura imediata.
   */
  private applyDeviceConfig(device: BACnetDeviceConfig): void {
    const key = this.configKey(device);
    this.stopPoll(key);
    // Reavalia suporte a RPM a cada (re)configuração do device.
    this.rpmUnsupported.delete(key);

    const pollableObjects = device.objects.filter((obj) => !obj.useCov);

    if (pollableObjects.length === 0) {
      this.logger.warn(
        `Dispositivo ${device.id} (${device.ipAddress}): nenhum objeto para polling`,
      );
      return;
    }

    // Jitter determinístico de partida: espalha os ciclos dos devices do
    // gateway dentro do intervalo, evitando rajadas sincronizadas no broker.
    const jitterMs = computeStartJitterMs(key, device.pollingIntervalMs);

    this.logger.log(
      `Dispositivo ${device.id} (${device.ipAddress}): polling a cada ` +
        `${device.pollingIntervalMs}ms — ${pollableObjects.length} objeto(s)` +
        ` (partida em ${jitterMs}ms)`,
    );

    const state = {
      timeout: null as ReturnType<typeof setTimeout> | null,
      interval: null as ReturnType<typeof setInterval> | null,
      busy: false,
    };

    state.timeout = setTimeout(() => {
      state.timeout = null;
      void this.pollDevice(state, device, pollableObjects);
      state.interval = setInterval(() => {
        void this.pollDevice(state, device, pollableObjects);
      }, device.pollingIntervalMs);
    }, jitterMs);

    this.activePolls.set(key, state);
  }

  private stopPoll(key: string): void {
    const state = this.activePolls.get(key);
    if (state) {
      if (state.timeout) clearTimeout(state.timeout);
      if (state.interval) clearInterval(state.interval);
      this.activePolls.delete(key);
    }
    this.rpmUnsupported.delete(key);
  }

  /**
   * Chave única do poll: IP:porta + rota BACnet. Vários devices MS/TP atrás do
   * MESMO roteador compartilham IP:porta — a rota (net/adr) os distingue.
   */
  private configKey(device: BACnetDeviceConfig): string {
    const route = device.net ? `#${device.net}/${(device.adr ?? []).join('.')}` : '';
    return `${device.ipAddress}:${device.port}${route}`;
  }

  /**
   * Destino BACnet do device para leituras — inclui porta não-padrão e a rota
   * net/adr (NPDU DNET/DADR) quando o device é MS/TP atrás de roteador.
   */
  private deviceDest(device: BACnetDeviceConfig): BacnetTarget {
    const address =
      device.port && device.port !== 47808 && !device.ipAddress.includes(':')
        ? `${device.ipAddress}:${device.port}`
        : device.ipAddress;
    return { address, net: device.net ?? null, adr: device.adr ?? null };
  }

  /**
   * Executa um ciclo completo de leitura para o dispositivo.
   *
   * Por padrão agrupa os objetos em requests ReadPropertyMultiple (RPM), o que
   * reduz drasticamente o número de pacotes UDP e o tempo de ciclo. Devices que
   * não suportam RPM (ou cujo APDU estoure) caem automaticamente para leitura
   * individual, sem perder compatibilidade com hardware antigo.
   *
   * Agrupa os pontos lidos e publica um único payload MQTT.
   */
  private async pollDevice(
    state: { busy: boolean },
    device: BACnetDeviceConfig,
    objects: BACnetObjectConfig[],
  ): Promise<void> {
    const label = device.name || device.id;
    const key = this.configKey(device);

    if (state.busy) {
      // Ciclo anterior ainda em andamento (device lento / sem RPM) — não
      // sobrepõe leituras: pula este ciclo e contabiliza para observabilidade.
      this.pollingMetrics.recordSkipped({
        protocol: 'bacnet',
        deviceId: device.id,
        intervalMs: device.pollingIntervalMs,
      });
      this.logger.warn(
        `[${label}] Ciclo anterior ainda em andamento — ciclo pulado (busy)`,
      );
      return;
    }
    state.busy = true;
    try {
      await this.runPollCycle(device, objects, label, key);
    } finally {
      state.busy = false;
    }
  }

  private async runPollCycle(
    device: BACnetDeviceConfig,
    objects: BACnetObjectConfig[],
    label: string,
    key: string,
  ): Promise<void> {
    const useRpm = this.rpmEnabled && !this.rpmUnsupported.has(key);

    this.logger.log(
      `[${label}] Iniciando ciclo de polling — ${objects.length} objeto(s) ` +
        `(${useRpm ? 'RPM em lote' : 'leitura individual'})`,
    );

    const startedAt = Date.now();
    const points = useRpm
      ? await this.pollViaRpm(device, objects, label, key)
      : await this.pollObjectsIndividually(device, objects);
    const elapsedMs = Date.now() - startedAt;

    this.pollingMetrics.record({
      protocol: 'bacnet',
      deviceId: device.id,
      latencyMs: elapsedMs,
      pointsRead: points.length,
      pointsAttempted: objects.length,
      intervalMs: device.pollingIntervalMs,
    });

    this.logger.log(
      `[${label}] Ciclo concluído em ${elapsedMs}ms — ${points.length}/${objects.length} ponto(s) lidos`,
    );

    if (points.length === 0) {
      // Nenhum ponto lido com sucesso — não publicar payload vazio
      this.logger.warn(
        `[${label}] Nenhum ponto lido — publicação MQTT ignorada neste ciclo`,
      );
      return;
    }

    const topic = `bluebee/${this.tenantId}/gateway/${this.gatewayId}/telemetry`;

    const payload: TelemetryPayload = {
      timestamp: new Date().toISOString(),
      deviceId: device.id,
      points,
    };

    this.mqttService.publish(topic, payload);
  }

  /**
   * Lê os objetos agrupando-os em requests ReadPropertyMultiple, respeitando
   * `rpmBatchSize` (mantém cada request dentro do APDU). Se um lote RPM falhar
   * (device sem suporte, timeout ou APDU excedido), cai para leitura individual
   * apenas daquele lote. Se o device respondeu à leitura individual mas não ao
   * RPM, marca-o para usar leitura individual nos próximos ciclos.
   */
  private async pollViaRpm(
    device: BACnetDeviceConfig,
    objects: BACnetObjectConfig[],
    label: string,
    key: string,
  ): Promise<TelemetryPoint[]> {
    const points: TelemetryPoint[] = [];
    const stats: RpmCycleStats = { rpmBatches: 0, splits: 0, fallbackObjects: 0 };

    for (let i = 0; i < objects.length; i += this.rpmBatchSize) {
      const batch = objects.slice(i, i + this.rpmBatchSize);
      points.push(...(await this.readBatchViaRpm(device, batch, label, key, stats)));

      // Se o device provou não suportar RPM no meio do ciclo, lê o restante
      // ponto a ponto — evita novos timeouts de RPM neste mesmo ciclo.
      if (this.rpmUnsupported.has(key)) {
        const rest = objects.slice(i + this.rpmBatchSize);
        if (rest.length > 0) {
          stats.fallbackObjects += rest.length;
          points.push(...(await this.pollObjectsIndividually(device, rest)));
        }
        break;
      }
    }

    if (stats.fallbackObjects > 0 || stats.splits > 0) {
      this.logger.warn(
        `[${label}] RPM: ${stats.rpmBatches} lote(s) OK` +
          `${stats.splits > 0 ? `, ${stats.splits} divisão(ões) por APDU` : ''}` +
          `${stats.fallbackObjects > 0 ? `, ${stats.fallbackObjects} objeto(s) via fallback individual` : ''}`,
      );
    }

    return points;
  }

  /**
   * Lê um lote via ReadPropertyMultiple. Em falha:
   *  - lote com >1 objeto → divide ao meio e tenta de novo (trata APDU oversize
   *    sem desistir do RPM);
   *  - lote com 1 objeto → cai para leitura individual; se ela funcionar, o
   *    device está online mas não suporta RPM, então é marcado (`rpmUnsupported`)
   *    para ler ponto a ponto nos próximos ciclos.
   */
  private async readBatchViaRpm(
    device: BACnetDeviceConfig,
    batch: BACnetObjectConfig[],
    label: string,
    key: string,
    stats: RpmCycleStats,
  ): Promise<TelemetryPoint[]> {
    if (batch.length === 0) {
      return [];
    }

    const requestList = batch.map((obj) => ({
      objectId: { type: obj.objectType, instance: obj.objectInstance },
      properties: [{ id: obj.property }],
    }));

    const response = await this.bacnetClient.readPropertyMultipleSafe(
      this.deviceDest(device),
      requestList,
      this.RPM_TIMEOUT_MS,
    );

    if (response !== null) {
      stats.rpmBatches += 1;
      const valueMap = this.parseRpmResponse(response);
      const points: TelemetryPoint[] = [];
      for (const obj of batch) {
        const value = this.toTelemetryValue(
          valueMap.get(this.pointKey(obj.objectType, obj.objectInstance, obj.property)),
        );
        if (value === null) {
          continue;
        }
        points.push({
          tag: obj.tag,
          objectType: obj.objectType,
          objectInstance: obj.objectInstance,
          value,
          unit: obj.unit,
        });
      }
      return points;
    }

    // Lote com mais de um objeto: pode ser APDU oversize → divide e reavalia.
    if (batch.length > 1) {
      stats.splits += 1;
      const mid = Math.ceil(batch.length / 2);
      const left = await this.readBatchViaRpm(device, batch.slice(0, mid), label, key, stats);

      // Se a metade esquerda concluiu que o device não suporta RPM, lê a direita
      // direto ponto a ponto (não adianta tentar RPM de novo).
      if (this.rpmUnsupported.has(key)) {
        const rightBatch = batch.slice(mid);
        stats.fallbackObjects += rightBatch.length;
        const right = await this.pollObjectsIndividually(device, rightBatch);
        return [...left, ...right];
      }

      const right = await this.readBatchViaRpm(device, batch.slice(mid), label, key, stats);
      return [...left, ...right];
    }

    // Um único objeto e o RPM falhou → fallback individual.
    stats.fallbackObjects += 1;
    const single = await this.pollObjectsIndividually(device, batch);
    if (single.length > 0) {
      // Device online (respondeu ReadProperty) mas não ao RPM de 1 objeto →
      // sem suporte a RPM. Marca para ler ponto a ponto nos próximos ciclos.
      this.rpmUnsupported.add(key);
      this.logger.warn(
        `[${label}] ReadPropertyMultiple sem resposta, mas leitura individual ` +
          'funcionou — passando a ler este device ponto a ponto',
      );
    }
    return single;
  }

  /**
   * Lê cada objeto individualmente via readPropertySafe (ReadProperty).
   * Usado como fallback quando o RPM falha e para devices sem suporte a RPM.
   * `null` de leitura indica falha/timeout e é ignorado (skip silencioso).
   */
  private async pollObjectsIndividually(
    device: BACnetDeviceConfig,
    objects: BACnetObjectConfig[],
  ): Promise<TelemetryPoint[]> {
    const points: TelemetryPoint[] = [];

    for (const obj of objects) {
      const response = await this.bacnetClient.readPropertySafe(
        this.deviceDest(device),
        { type: obj.objectType, instance: obj.objectInstance },
        obj.property,
        this.READ_TIMEOUT_MS,
      );

      if (response === null) {
        continue;
      }

      // Estrutura esperada: { values: [{ value: number | string }] }
      const rawValue = (response as { values?: Array<{ value: unknown }> })
        ?.values?.[0]?.value;

      const value = this.toTelemetryValue(rawValue);
      if (value === null) {
        continue;
      }

      points.push({
        tag: obj.tag,
        objectType: obj.objectType,
        objectInstance: obj.objectInstance,
        value,
        unit: obj.unit,
      });
    }

    return points;
  }

  /**
   * Converte um valor cru do node-bacnet num valor de telemetria:
   *  - números/booleanos/strings numéricas → número finito (comportamento original);
   *  - strings não-numéricas (ex.: presentValue de CharacterString Value, tipo 40)
   *    → string aparada (monitorável como texto);
   *  - ausente/objeto (ex.: { errorClass, errorCode } dentro de um RPM) → `null`
   *    (ponto ignorado no ciclo).
   */
  private toTelemetryValue(rawValue: unknown): number | string | null {
    if (rawValue === undefined || rawValue === null) {
      return null;
    }
    if (typeof rawValue === 'object') {
      // Ex.: { errorClass, errorCode } — propriedade com erro dentro do RPM.
      return null;
    }
    const numericValue = Number(rawValue);
    if (Number.isFinite(numericValue) && (typeof rawValue !== 'string' || rawValue.trim() !== '')) {
      return numericValue;
    }
    if (typeof rawValue === 'string') {
      const text = rawValue.trim();
      return text.length > 0 ? text : null;
    }
    return null;
  }

  /**
   * Indexa a resposta de ReadPropertyMultiple por `tipo:instância:propriedade`.
   *
   * Formato node-bacnet:
   *   { values: [ { objectId: {type,instance},
   *                 values: [ { id, index, value: [ {type, value} ] } ] } ] }
   */
  private parseRpmResponse(response: unknown): Map<string, unknown> {
    const map = new Map<string, unknown>();
    const entries = (
      response as {
        values?: Array<{
          objectId?: { type?: number; instance?: number };
          values?: Array<{ id?: number; property?: number; value?: Array<{ value?: unknown }> }>;
        }>;
      }
    )?.values;

    if (!Array.isArray(entries)) {
      return map;
    }

    for (const entry of entries) {
      const type = entry?.objectId?.type;
      const instance = entry?.objectId?.instance;
      if (typeof type !== 'number' || typeof instance !== 'number') {
        continue;
      }
      for (const prop of entry?.values ?? []) {
        const propId = typeof prop?.id === 'number' ? prop.id : prop?.property;
        if (typeof propId !== 'number') {
          continue;
        }
        const rawValue = Array.isArray(prop?.value) ? prop.value[0]?.value : undefined;
        map.set(this.pointKey(type, instance, propId), rawValue);
      }
    }

    return map;
  }

  private pointKey(type: number, instance: number, property: number): string {
    return `${type}:${instance}:${property}`;
  }
}
