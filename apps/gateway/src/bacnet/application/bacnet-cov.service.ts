import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import {
  BacnetCovNotification,
  BacnetTarget,
  NodeBacnetClient,
} from '../infrastructure/node-bacnet.client';
import { GatewayMqttService } from '../../mqtt/gateway-mqtt.service';
import { bacnetDevices } from '../../config/bacnet-devices.config';
import {
  BACnetDeviceConfig,
  BACnetObjectConfig,
} from '../domain/interfaces/bacnet-config.interface';

/**
 * Config recebida do backend via MQTT (tópico .../config) — mesmo payload
 * consumido pelo BacnetPollingService. Aqui só interessam os pontos useCov.
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
 * Ponto de telemetria — DEVE ser idêntico ao publicado pelo BacnetPollingService
 * (o backend consome o mesmo formato/tópico independentemente da origem).
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
 * Payload publicado no MQTT — idêntico ao do polling.
 * Tópico: bluebee/{tenantId}/gateway/{gatewayId}/telemetry
 */
interface TelemetryPayload {
  timestamp: string;
  deviceId: string;
  points: TelemetryPoint[];
}

/** Estado de uma assinatura COV de um objeto. */
interface CovSubscription {
  /** subscriberProcessId — estável durante toda a vida da assinatura. */
  subscribeId: number;
  deviceKey: string;
  device: BACnetDeviceConfig;
  obj: BACnetObjectConfig;
  pointKey: string;
  /** ACTIVE = COV confirmado pelo device; FAILED = caiu para polling normal. */
  state: 'ACTIVE' | 'FAILED';
  /** Instante da última assinatura/renovação bem-sucedida (para renovar antes de expirar). */
  subscribedAt: number;
  /**
   * Instante do último dado publicado deste ponto (via COV ou via leitura).
   * Usado para decidir quando disparar heartbeat (ACTIVE) ou fallback (FAILED).
   */
  lastPublishedAt: number;
}

/** Propriedade padrão lida/monitorada quando o ponto não especifica outra. */
const PRESENT_VALUE_PROPERTY = 85;

/**
 * BacnetCovService
 *
 * Gerencia os pontos marcados com `useCov: true` — os quais o BacnetPollingService
 * ignora de propósito. Para cada ponto:
 *   1. Assina COV (Change of Value) no device; o valor passa a chegar por evento.
 *   2. Renova a assinatura periodicamente, antes de expirar o lifetime.
 *   3. Cancela a assinatura no reload de config (ponto removido) e no shutdown.
 *   4. Fallback: se a assinatura falhar/expirar, o ponto volta a polling normal
 *      (leitura no intervalo do device). Se voltar a assinar, retoma o COV.
 *   5. Heartbeat: mesmo com COV ativo, faz uma leitura de baixa frequência para
 *      garantir dado periódico quando não há eventos.
 *
 * Publica no MESMO tópico/payload de telemetria do polling — o backend não
 * distingue a origem.
 */
@Injectable()
export class BacnetCovService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BacnetCovService.name);
  private readonly tenantId: string;
  private readonly gatewayId: string;

  /** Assinaturas indexadas por pointKey (`ip:port:type:instance:property`). */
  private readonly subscriptions = new Map<string, CovSubscription>();
  /** Índice reverso subscribeId → assinatura (correlação das notificações). */
  private readonly subscriptionsById = new Map<number, CovSubscription>();
  /** Devices com pontos COV, por deviceKey (`ip:port`). */
  private readonly covDevices = new Map<string, BACnetDeviceConfig>();
  /** Ciclos de heartbeat/fallback ativos, por deviceKey → handle do setInterval. */
  private readonly deviceCycles = new Map<string, ReturnType<typeof setInterval>>();
  /** Chaves (ip:port) atualmente gerenciadas pela config dinâmica do backend. */
  private dynamicKeys = new Set<string>();

  /** Contador incremental de subscribeId (subscriberProcessId único por assinatura). */
  private nextSubscribeId = 1;

  /** Loop global de manutenção (renovação + retry de assinaturas). */
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null;
  /** Guarda de reentrância do loop de manutenção. */
  private maintenanceRunning = false;
  /** Guarda de reentrância dos ciclos por device (deviceKey em execução). */
  private readonly runningCycles = new Set<string>();

  /** Habilita/desabilita COV globalmente (BACNET_COV_ENABLED=false). */
  private readonly covEnabled: boolean;
  /** Lifetime da assinatura COV no device, em segundos. */
  private readonly covLifetimeS: number;
  /** Intervalo de heartbeat para pontos COV ativos (dado periódico garantido). */
  private readonly heartbeatMs: number;
  /** Antecedência da renovação (fração do lifetime já decorrida). */
  private readonly renewEveryMs: number;
  /** Frequência do loop de manutenção (renovação/retry). */
  private readonly MAINTENANCE_TICK_MS = 30_000;
  /** Timeout do subscribeCov. */
  private readonly SUBSCRIBE_TIMEOUT_MS = 3000;
  /** Timeout de leitura individual (heartbeat/fallback). */
  private readonly READ_TIMEOUT_MS = 1500;

  constructor(
    private readonly bacnetClient: NodeBacnetClient,
    private readonly mqttService: GatewayMqttService,
    private readonly configService: ConfigService,
  ) {
    this.tenantId = this.configService.get<string>('TENANT_ID', 'default');
    this.gatewayId = this.configService.get<string>('GATEWAY_ID', 'gw-01');

    this.covEnabled =
      this.configService.get<string>('BACNET_COV_ENABLED', 'true') !== 'false';

    const lifetime = Number(
      this.configService.get<string>('BACNET_COV_LIFETIME_S', '300'),
    );
    this.covLifetimeS =
      Number.isFinite(lifetime) && lifetime > 0 ? Math.floor(lifetime) : 300;

    const heartbeat = Number(
      this.configService.get<string>('BACNET_COV_HEARTBEAT_MS', '300000'),
    );
    this.heartbeatMs =
      Number.isFinite(heartbeat) && heartbeat > 0
        ? Math.floor(heartbeat)
        : 300_000;

    // Renova quando ~80% do lifetime já passou, para não expirar entre ciclos.
    this.renewEveryMs = Math.max(
      Math.floor(this.covLifetimeS * 1000 * 0.8),
      this.MAINTENANCE_TICK_MS,
    );
  }

  onModuleInit(): void {
    if (!this.covEnabled) {
      this.logger.log('COV desabilitado (BACNET_COV_ENABLED=false)');
      return;
    }

    // Recebe as notificações COV de todos os devices (correlação por subscribeId).
    this.bacnetClient.onCovNotification((n) => this.handleCovNotification(n));

    // Bootstrap com config estática (fallback até a config dinâmica chegar).
    for (const device of bacnetDevices) {
      this.applyDeviceConfig(device);
    }

    // Loop global de renovação/retry das assinaturas.
    this.maintenanceTimer = setInterval(() => {
      void this.runMaintenance();
    }, this.MAINTENANCE_TICK_MS);

    const covCount = bacnetDevices.reduce(
      (acc, d) => acc + d.objects.filter((o) => o.useCov).length,
      0,
    );
    this.logger.log(
      covCount > 0
        ? `COV bootstrap: ${covCount} ponto(s) COV estático(s) — aguardando config dinâmica`
        : 'COV pronto — nenhum ponto COV estático, aguardando config dinâmica',
    );
  }

  onModuleDestroy(): void {
    if (this.maintenanceTimer) {
      clearInterval(this.maintenanceTimer);
      this.maintenanceTimer = null;
    }
    for (const handle of this.deviceCycles.values()) {
      clearInterval(handle);
    }
    this.deviceCycles.clear();
    // Cancela assinaturas ativas no device (best-effort).
    for (const sub of this.subscriptions.values()) {
      void this.bacnetClient.cancelCovSafe(
        this.deviceDest(sub.device),
        { type: sub.obj.objectType, instance: sub.obj.objectInstance },
        sub.subscribeId,
      );
    }
    this.subscriptions.clear();
    this.subscriptionsById.clear();
  }

  /**
   * Recebe a config publicada pelo backend e aplica a parte COV (pontos useCov).
   * Mesmo evento consumido pelo polling — cada serviço filtra o que lhe compete.
   */
  @OnEvent('mqtt.message')
  handleConfigMessage(event: {
    topic: string;
    message: Record<string, unknown>;
  }): void {
    if (!this.covEnabled || !event.topic.endsWith('/config')) {
      return;
    }

    const payload = event.message as unknown as GatewayConfigPayload;
    if (!Array.isArray(payload.devices)) {
      return;
    }

    this.applyGatewayConfig(payload.devices);
  }

  /**
   * Aplica a config dinâmica: (re)assina os pontos COV de cada device e cancela
   * os que sumiram da config.
   */
  private applyGatewayConfig(devices: GatewayConfigPayload['devices']): void {
    const newKeys = new Set<string>();

    const bacnetOnly = devices.filter(
      (d) => !d.protocol || d.protocol === 'bacnet',
    );

    for (const d of bacnetOnly) {
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
      const key = this.deviceKey(config);
      const hasCov = config.objects.some((o) => o.useCov);
      if (hasCov) {
        newKeys.add(key);
      }
      this.applyDeviceConfig(config);
    }

    // Cancela devices que estavam na config dinâmica anterior mas saíram.
    for (const key of this.dynamicKeys) {
      if (!newKeys.has(key)) {
        this.stopDevice(key);
      }
    }
    this.dynamicKeys = newKeys;

    const totalCov = bacnetOnly.reduce(
      (acc, d) => acc + (d.objects ?? []).filter((o) => o.useCov).length,
      0,
    );
    if (totalCov > 0) {
      this.logger.log(
        `Config COV dinâmica aplicada — ${totalCov} ponto(s) COV em ${newKeys.size} device(s)`,
      );
    }
  }

  /**
   * (Re)configura os pontos COV de um device: assina os novos, cancela os que
   * saíram e (re)inicia o ciclo de heartbeat/fallback. Sem pontos COV, encerra o
   * device.
   */
  private applyDeviceConfig(device: BACnetDeviceConfig): void {
    const key = this.deviceKey(device);
    const covObjects = device.objects.filter((o) => o.useCov);

    if (covObjects.length === 0) {
      this.stopDevice(key);
      return;
    }

    this.covDevices.set(key, device);

    const desiredPointKeys = new Set(
      covObjects.map((o) =>
        this.pointKey(
          device,
          o.objectType,
          o.objectInstance,
          o.property ?? PRESENT_VALUE_PROPERTY,
        ),
      ),
    );

    // Remove/cancela assinaturas deste device que não estão mais na config.
    for (const [pk, sub] of this.subscriptions) {
      if (sub.deviceKey === key && !desiredPointKeys.has(pk)) {
        this.cancelSubscription(sub);
        this.subscriptions.delete(pk);
        this.subscriptionsById.delete(sub.subscribeId);
      }
    }

    // Cria e assina os pontos novos.
    for (const obj of covObjects) {
      const pk = this.pointKey(
        device,
        obj.objectType,
        obj.objectInstance,
        obj.property ?? PRESENT_VALUE_PROPERTY,
      );
      if (this.subscriptions.has(pk)) {
        // Já existe — mantém a assinatura viva, apenas atualiza a referência
        // do device/obj (intervalo pode ter mudado).
        const existing = this.subscriptions.get(pk)!;
        existing.device = device;
        existing.obj = obj;
        continue;
      }
      const sub: CovSubscription = {
        subscribeId: this.nextSubscribeId++,
        deviceKey: key,
        device,
        obj,
        pointKey: pk,
        state: 'FAILED', // até o SimpleACK chegar, trata como fallback
        subscribedAt: 0,
        lastPublishedAt: 0,
      };
      this.subscriptions.set(pk, sub);
      this.subscriptionsById.set(sub.subscribeId, sub);
      void this.subscribe(sub);
    }

    this.startDeviceCycle(device);

    this.logger.log(
      `Device ${device.id} (${device.ipAddress}): ${covObjects.length} ponto(s) COV — ` +
        `lifetime ${this.covLifetimeS}s, heartbeat ${this.heartbeatMs}ms`,
    );
  }

  /**
   * (Re)inicia o ciclo de heartbeat/fallback do device, no intervalo de polling
   * dele. A cada tick lê os pontos "vencidos": FAILED no intervalo de polling
   * (fallback), ACTIVE apenas se ficou sem evento por heartbeatMs.
   */
  private startDeviceCycle(device: BACnetDeviceConfig): void {
    const key = this.deviceKey(device);
    const existing = this.deviceCycles.get(key);
    if (existing) {
      clearInterval(existing);
    }
    const handle = setInterval(() => {
      void this.runDeviceCycle(key);
    }, device.pollingIntervalMs);
    this.deviceCycles.set(key, handle);
  }

  /** Encerra o ciclo do device e cancela suas assinaturas COV. */
  private stopDevice(key: string): void {
    const handle = this.deviceCycles.get(key);
    if (handle) {
      clearInterval(handle);
      this.deviceCycles.delete(key);
    }
    this.covDevices.delete(key);

    for (const [pk, sub] of this.subscriptions) {
      if (sub.deviceKey === key) {
        this.cancelSubscription(sub);
        this.subscriptions.delete(pk);
        this.subscriptionsById.delete(sub.subscribeId);
      }
    }
  }

  /**
   * Assina COV de um ponto; atualiza estado conforme o resultado.
   * Nunca rejeita: também é disparado com `void this.subscribe(sub)` no reload
   * de config — uma exceção inesperada vira estado FAILED, não crash.
   */
  private async subscribe(sub: CovSubscription): Promise<void> {
    let ok = false;
    try {
      ok = await this.bacnetClient.subscribeCovSafe(
        this.deviceDest(sub.device),
        { type: sub.obj.objectType, instance: sub.obj.objectInstance },
        sub.subscribeId,
        this.covLifetimeS,
        this.SUBSCRIBE_TIMEOUT_MS,
      );
    } catch (err) {
      this.logger.error(
        `Erro inesperado ao assinar COV de ${sub.obj.tag} (${sub.device.ipAddress}): ` +
          `${(err as Error)?.message ?? String(err)}`,
      );
      ok = false;
    }

    if (ok) {
      sub.state = 'ACTIVE';
      sub.subscribedAt = Date.now();
      this.logger.log(
        `COV ativo: ${sub.obj.tag} (${sub.device.ipAddress} ` +
          `${sub.obj.objectType}:${sub.obj.objectInstance})`,
      );
    } else if (sub.state !== 'FAILED') {
      sub.state = 'FAILED';
      this.logger.warn(
        `COV falhou/expirou: ${sub.obj.tag} (${sub.device.ipAddress}) — ` +
          'caindo para polling normal',
      );
    }
  }

  /** Cancela a assinatura COV no device (best-effort). */
  private cancelSubscription(sub: CovSubscription): void {
    void this.bacnetClient.cancelCovSafe(
      this.deviceDest(sub.device),
      { type: sub.obj.objectType, instance: sub.obj.objectInstance },
      sub.subscribeId,
    );
  }

  /**
   * Loop de manutenção: renova assinaturas ativas antes de expirar e tenta
   * reassinar as que estão em fallback (self-healing).
   */
  private async runMaintenance(): Promise<void> {
    // Evita ciclos concorrentes se o anterior atrasar (devices lentos).
    if (this.maintenanceRunning) {
      return;
    }
    this.maintenanceRunning = true;
    try {
      const now = Date.now();
      // Snapshot: subscriptions pode mudar (reload) durante os awaits.
      for (const sub of [...this.subscriptions.values()]) {
        // Ignora assinaturas removidas do mapa durante este ciclo.
        if (this.subscriptions.get(sub.pointKey) !== sub) {
          continue;
        }
        if (sub.state === 'ACTIVE') {
          if (now - sub.subscribedAt >= this.renewEveryMs) {
            await this.subscribe(sub); // renova (mesmo subscribeId)
          }
        } else {
          // FAILED → tenta reassinar; se conseguir, retoma COV.
          await this.subscribe(sub);
        }
      }
    } catch (err) {
      // Isolamento: exceção inesperada não pode escapar como unhandled rejection
      // (disparo é `void runMaintenance()`) — loga e o próximo tick segue.
      this.logger.error(
        `Loop de manutenção COV abortado por erro inesperado: ` +
          `${(err as Error)?.stack ?? (err as Error)?.message ?? String(err)}`,
      );
    } finally {
      this.maintenanceRunning = false;
    }
  }

  /**
   * Ciclo de heartbeat/fallback de um device: lê os pontos vencidos e publica.
   * Não lê nada quando não há ponto vencido (evita tráfego desnecessário).
   */
  private async runDeviceCycle(key: string): Promise<void> {
    const device = this.covDevices.get(key);
    if (!device) {
      return;
    }

    // Evita ciclos concorrentes do mesmo device (leituras duplicadas).
    if (this.runningCycles.has(key)) {
      return;
    }
    this.runningCycles.add(key);
    try {
      const now = Date.now();
      const due: CovSubscription[] = [];
      for (const sub of this.subscriptions.values()) {
        if (sub.deviceKey !== key) {
          continue;
        }
        // FAILED usa o intervalo de polling do device (fallback normal);
        // ACTIVE só lê se ficou sem evento por heartbeatMs.
        const interval =
          sub.state === 'FAILED' ? device.pollingIntervalMs : this.heartbeatMs;
        if (now - sub.lastPublishedAt >= interval) {
          due.push(sub);
        }
      }

      if (due.length === 0) {
        return;
      }

      const points: TelemetryPoint[] = [];
      for (const sub of due) {
        // Assinatura pode ter sido removida (reload) entre a seleção e a leitura.
        if (this.subscriptions.get(sub.pointKey) !== sub) {
          continue;
        }
        const obj = sub.obj;
        const response = await this.bacnetClient.readPropertySafe(
          this.deviceDest(device),
          { type: obj.objectType, instance: obj.objectInstance },
          obj.property ?? PRESENT_VALUE_PROPERTY,
          this.READ_TIMEOUT_MS,
        );

        // Espaça a próxima tentativa mesmo em falha (evita marteladas no device).
        sub.lastPublishedAt = now;

        if (response === null) {
          continue;
        }

        const rawValue = (response as { values?: Array<{ value: unknown }> })
          ?.values?.[0]?.value;
        const heartbeatValue = this.toTelemetryValue(rawValue);
        if (heartbeatValue === null) {
          continue;
        }

        points.push({
          tag: obj.tag,
          objectType: obj.objectType,
          objectInstance: obj.objectInstance,
          value: heartbeatValue,
          unit: obj.unit,
        });
      }

      this.publishPoints(device.id, points);
    } catch (err) {
      // Isolamento: exceção inesperada não pode escapar como unhandled rejection
      // (disparo é `void runDeviceCycle(key)`) — loga e o próximo ciclo segue.
      this.logger.error(
        `[${device.id}] Ciclo COV (heartbeat/fallback) abortado por erro inesperado: ` +
          `${(err as Error)?.stack ?? (err as Error)?.message ?? String(err)}`,
      );
    } finally {
      this.runningCycles.delete(key);
    }
  }

  /**
   * Trata uma notificação COV recebida: correlaciona pela subscribeId, extrai o
   * valor da propriedade monitorada e publica no mesmo tópico de telemetria.
   */
  private handleCovNotification(notification: BacnetCovNotification): void {
    const sub = this.subscriptionsById.get(notification.subscribeId);
    if (!sub) {
      return; // notificação de uma assinatura que não é nossa / já cancelada
    }

    // Validação tripla contra misrouting: além do subscribeId (que pode colidir
    // após restart/reinício do contador), confere origem e objeto monitorado.
    // Para devices MS/TP roteados a notificação chega com o IP do ROTEADOR —
    // que é exatamente o ipAddress configurado. Comparação ignora porta padrão.
    if (
      notification.address &&
      !this.sameHost(notification.address, sub.device.ipAddress)
    ) {
      this.logger.warn(
        `Notificação COV descartada: origem ${notification.address} ≠ ` +
          `${sub.device.ipAddress} (subscribeId ${notification.subscribeId})`,
      );
      return;
    }
    const mon = notification.monitoredObjectId;
    if (
      mon &&
      (mon.type !== sub.obj.objectType || mon.instance !== sub.obj.objectInstance)
    ) {
      this.logger.warn(
        `Notificação COV descartada: objeto ${mon.type}:${mon.instance} ≠ ` +
          `${sub.obj.objectType}:${sub.obj.objectInstance} (subscribeId ${notification.subscribeId})`,
      );
      return;
    }

    // Uma notificação confirma que o COV está funcionando para este ponto.
    if (sub.state !== 'ACTIVE') {
      sub.state = 'ACTIVE';
      sub.subscribedAt = Date.now();
    }

    const property = sub.obj.property ?? PRESENT_VALUE_PROPERTY;
    // Procura a propriedade monitorada (presentValue por padrão) entre os valores.
    const entry =
      notification.values.find((v) => v?.property?.id === property) ??
      notification.values[0];
    const rawValue = entry?.value?.[0]?.value;
    const value = this.toTelemetryValue(rawValue);
    if (value === null) {
      return;
    }

    sub.lastPublishedAt = Date.now();

    this.publishPoints(sub.device.id, [
      {
        tag: sub.obj.tag,
        objectType: sub.obj.objectType,
        objectInstance: sub.obj.objectInstance,
        value,
        unit: sub.obj.unit,
      },
    ]);
  }

  /** Publica um payload de telemetria (mesmo tópico/formato do polling). */
  private publishPoints(deviceId: string, points: TelemetryPoint[]): void {
    if (points.length === 0) {
      return;
    }
    const topic = `bluebee/${this.tenantId}/gateway/${this.gatewayId}/telemetry`;
    const payload: TelemetryPayload = {
      timestamp: new Date().toISOString(),
      deviceId,
      points,
    };
    this.mqttService.publish(topic, payload);
  }

  /**
   * Converte um valor cru do node-bacnet num valor de telemetria — mesma
   * semântica do BacnetPollingService: numérico quando possível, string aparada
   * para textos (ex.: CharacterString Value, tipo 40), `null` quando ausente.
   */
  private toTelemetryValue(rawValue: unknown): number | string | null {
    if (rawValue === undefined || rawValue === null) {
      return null;
    }
    if (typeof rawValue === 'object') {
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
   * Chave única do device: IP:porta + rota BACnet. Vários devices MS/TP atrás
   * do MESMO roteador compartilham IP:porta — a rota (net/adr) os distingue.
   */
  private deviceKey(device: BACnetDeviceConfig): string {
    const route = device.net ? `#${device.net}/${(device.adr ?? []).join('.')}` : '';
    return `${device.ipAddress}:${device.port}${route}`;
  }

  /**
   * Destino BACnet do device — inclui porta não-padrão e a rota net/adr
   * (NPDU DNET/DADR) quando o device é MS/TP atrás de roteador.
   */
  private deviceDest(device: BACnetDeviceConfig): BacnetTarget {
    const address =
      device.port && device.port !== 47808 && !device.ipAddress.includes(':')
        ? `${device.ipAddress}:${device.port}`
        : device.ipAddress;
    return { address, net: device.net ?? null, adr: device.adr ?? null };
  }

  /** Compara endereços "ip" ou "ip:porta" ignorando a porta padrão 47808. */
  private sameHost(a: string, b: string): boolean {
    const normalize = (s: string): string => {
      const trimmed = s.trim();
      return trimmed.endsWith(':47808') ? trimmed.slice(0, -6) : trimmed;
    };
    return normalize(a) === normalize(b);
  }

  private pointKey(
    device: BACnetDeviceConfig,
    type: number,
    instance: number,
    property: number,
  ): string {
    return `${this.deviceKey(device)}:${type}:${instance}:${property}`;
  }
}
