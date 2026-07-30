import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NodeBacnetClient, BacnetTarget } from '../infrastructure/node-bacnet.client';
import { repairMojibake } from '../domain/mojibake-repair.util';
import { GatewayMqttService } from '../../mqtt/gateway-mqtt.service';
import {
  BacnetDiscoveryCommand,
  BacnetDiscoveryResult,
  DiscoveredObject,
  DiscoverySource,
} from '../domain/interfaces/bacnet-discovery.interface';

/**
 * Mapa de unidades de engenharia BACnet (property 117).
 * Códigos definidos pela ASHRAE 135 — Clause 21.
 */
const BACNET_UNIT_MAP: Record<number, string> = {
  62: '°C',
  64: '°F',
  55: '%',
  53: 'Pa',
  141: 'bar',
  84: 'A',
  116: 'V',
  48: 'W',
  93: 'kWh',
  83: 'm³/h',
  186: 'l/s',
  47: 'Hz',
  119: 'rpm',
  98: '', // no-units (digitais, adimensional)
};

/**
 * Tipos de objeto com valor numérico "analógico" — property units (117) é
 * relevante para estes. Inclui os tipos numéricos estendidos: Accumulator (23),
 * PulseConverter (24), IntegerValue (45), LargeAnalogValue (46) e
 * PositiveIntegerValue (48). Para digitais (BI/BO/BV), multi-state
 * (MSI/MSO/MSV) e CharacterStringValue (40) não há unidade.
 */
const ANALOG_LIKE_TYPES = new Set([0, 1, 2, 23, 24, 45, 46, 48]);

/**
 * Tipos válidos para monitoramento — filtramos o Device Object (8) e outros
 * tipos de suporte (Schedule=17, NotificationClass=15, TrendLog=20, etc.)
 *
 *   0=AI, 1=AO, 2=AV, 3=BI, 4=BO, 5=BV, 13=MSI, 14=MSO, 19=MSV,
 *   23=ACC, 24=PC, 40=CSV, 45=IV, 46=LAV, 48=PIV
 */
const VALID_OBJECT_TYPES = new Set([0, 1, 2, 3, 4, 5, 13, 14, 19, 23, 24, 40, 45, 46, 48]);

/**
 * BacnetDiscoveryService
 *
 * Responsável por executar o discovery de objetos BACnet quando solicitado
 * pelo backend via MQTT. O fluxo é:
 *
 *   1. Backend publica comando em bluebee/{tenantId}/gateway/{gatewayId}/commands
 *   2. CommandDispatcherService recebe, parseia e emite evento 'command.bacnet.discover'
 *   3. Este serviço captura o evento via @OnEvent
 *   4. Enumera objetos: objectList completa → objectList índice-a-índice → SCAN_MAP
 *   5. Para cada objeto: lê objectName (property 77); sem nome → nome padrão "TIPO-instância"
 *   6. Para objetos numéricos: lê units (property 117)
 *   7. Publica resultado em bluebee/{tenantId}/gateway/{gatewayId}/discovery/result
 *
 * Suporta dispositivos MS/TP atrás de roteadores BACnet: o comando (ou o I-Am
 * do Who-Is) fornece net/adr, e TODAS as leituras usam esse endereçamento.
 */
@Injectable()
export class BacnetDiscoveryService {
  private readonly logger = new Logger(BacnetDiscoveryService.name);

  /**
   * Lock de concorrência por-tipo: impede que dois discoveries de objetos rodem
   * ao mesmo tempo disputando o mesmo socket UDP BACnet (duplo clique, retry do
   * backend, dois usuários). É apenas por tipo de operação — NÃO há lock cruzado
   * entre discovery e scan (vivem em serviços distintos), nem com o polling, que
   * continua rodando em paralelo normalmente.
   */
  private discoveryInProgress = false;

  constructor(
    private readonly bacnetClient: NodeBacnetClient,
    private readonly mqttService: GatewayMqttService,
  ) {}

  @OnEvent('command.bacnet.discover')
  async handleDiscoveryCommand(command: BacnetDiscoveryCommand): Promise<void> {
    this.logger.log(
      `Discovery iniciado — device ${command.deviceInstance} em ${command.ip}:${command.port}` +
        `${command.net ? ` via net ${command.net}/adr [${(command.adr ?? []).join(',')}]` : ''} ` +
        `(command_id=${command.command_id})`,
    );

    const topic = `bluebee/${command.tenant_id}/gateway/${command.gateway_id}/discovery/result`;

    if (this.discoveryInProgress) {
      this.logger.warn(
        `Discovery ignorado — já há um discovery em andamento (command_id=${command.command_id})`,
      );
      const busyResult: BacnetDiscoveryResult = {
        command_id: command.command_id,
        tenant_id: command.tenant_id,
        success: false,
        objects: [],
        error: 'Discovery já em andamento — aguarde o anterior finalizar.',
      };
      this.mqttService.publish(topic, busyResult);
      return;
    }

    this.discoveryInProgress = true;
    try {
      const result = await this.executeDiscovery(command);

      this.mqttService.publish(topic, result);

      this.logger.log(
        `Discovery concluído — ${
          result.success
            ? `${result.objects.length} objetos (fonte: ${result.discoverySource})`
            : 'falhou: ' + result.error
        }`,
      );
    } finally {
      this.discoveryInProgress = false;
    }
  }

  /**
   * Mapa de tipos BACnet para escanear — usado como ÚLTIMO fallback quando
   * objectList (property 76) não está disponível nem completa nem por índice.
   *
   * Em CAMADAS (tiers) por tipo: a camada 1 cobre os ranges mais comuns; as
   * camadas seguintes só são varridas para um tipo se a camada anterior
   * encontrou ao menos um objeto daquele tipo — expande a cobertura para
   * controladoras densas sem explodir o tempo de varredura nas esparsas.
   *
   * [ objectType, [fim_tier1, fim_tier2, ...] ] — instâncias 0..fim-1.
   */
  private static readonly SCAN_TIERS: Array<[number, number[]]> = [
    [0,  [64, 256, 1024]],  // AI  (analog input)
    [1,  [32, 128, 512]],   // AO  (analog output)
    [2,  [64, 256, 1024]],  // AV  (analog value)
    [3,  [64, 256, 1024]],  // BI  (binary input)
    [4,  [32, 128, 512]],   // BO  (binary output)
    [5,  [32, 256, 1024]],  // BV  (binary value)
    [13, [32, 128]],        // MSI (multi-state input)
    [14, [32, 128]],        // MSO (multi-state output)
    [19, [32, 128]],        // MSV (multi-state value)
    [23, [16, 64]],         // ACC (accumulator)
    [24, [16, 64]],         // PC  (pulse-converter)
    [40, [16, 64]],         // CSV (characterstring-value)
    [45, [16, 64]],         // IV  (integer-value)
    [46, [16, 64]],         // LAV (large-analog-value)
    [48, [16, 64]],         // PIV (positive-integer-value)
  ];

  /**
   * Tamanho do lote de leituras paralelas durante o discovery.
   * Controladores BACnet embarcados (MPC46D, etc.) processam poucos requests UDP
   * simultâneos — lotes grandes fazem o dispositivo descartar ou atrasar respostas,
   * causando falsos timeouts e pontos não descobertos.
   * 4 requests paralelos é o equilíbrio entre velocidade e confiabilidade.
   */
  private static readonly BATCH_SIZE = 4;

  /**
   * Timeout por leitura durante o discovery.
   * 1500ms acomoda dispositivos lentos sem sacrificar a velocidade total.
   * Objetos inexistentes respondem com erro APDU em < 100ms; o timeout só
   * é atingido quando o dispositivo está sobrecarregado ou inacessível.
   */
  private static readonly READ_TIMEOUT_MS = 1500;

  /** Timeout do Who-Is unicast (BACNET_UNICAST_TIMEOUT_MS — padrão 5000ms). */
  private get unicastTimeoutMs(): number {
    const v = Number(process.env.BACNET_UNICAST_TIMEOUT_MS?.trim() || '');
    return Number.isFinite(v) && v > 0 ? v : 5000;
  }

  /** Tentativas extra de Who-Is unicast (BACNET_UNICAST_RETRIES — padrão 1). */
  private get unicastRetries(): number {
    const v = Number(process.env.BACNET_UNICAST_RETRIES?.trim() || '');
    return Number.isInteger(v) && v >= 0 && v <= 5 ? v : 1;
  }

  private async executeDiscovery(
    command: BacnetDiscoveryCommand,
  ): Promise<BacnetDiscoveryResult> {
    const { ip, port, command_id, tenant_id } = command;

    // Endereço base: "ip" ou "ip:porta" (porta não-padrão preservada).
    const address =
      port && port !== 47808 && !ip.includes(':') ? `${ip}:${port}` : ip;

    // Rota BACnet (net/adr) — a fornecida pelo comando (device já persistido)
    // ou a descoberta no I-Am do Who-Is (dispositivo MS/TP atrás de roteador).
    let net: number | null = typeof command.net === 'number' && command.net > 0 ? command.net : null;
    let adr: number[] | null =
      Array.isArray(command.adr) && command.adr.length > 0 ? command.adr : null;

    const target = (): BacnetTarget => ({ address, net, adr });

    try {
      // Descobrir device instance via Who-Is unicast quando não fornecida.
      // Who-Is também serve como verificação de conectividade e captura a rota
      // net/adr de dispositivos roteados. Com retry configurável — controladoras
      // "frias" (ARP/address-binding) costumam perder o primeiro pacote.
      let deviceInstance = command.deviceInstance && command.deviceInstance > 0
        ? command.deviceInstance
        : null;

      const attempts = 1 + this.unicastRetries;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          this.logger.log(
            `Who-Is unicast para ${address} (tentativa ${attempt}/${attempts}, ` +
              `timeout ${this.unicastTimeoutMs}ms)...`,
          );
          const iAm = await this.bacnetClient.whoIs(address, this.unicastTimeoutMs);
          if (!deviceInstance && iAm.instance > 0) {
            deviceInstance = iAm.instance;
          }
          // Adota a rota do I-Am quando o comando não trouxe uma.
          if (net === null && iAm.net !== null && iAm.adr !== null) {
            net = iAm.net;
            adr = iAm.adr;
            this.logger.log(
              `Dispositivo roteado detectado — net=${net}, adr=[${adr.join(',')}] ` +
                `(roteador BACnet em ${address})`,
            );
          }
          this.logger.log(`I-Am recebido: device instance = ${iAm.instance}`);
          break;
        } catch {
          if (attempt === attempts) {
            this.logger.warn(
              `Who-Is sem resposta em ${address} após ${attempts} tentativa(s) — ` +
                'seguindo com a instância fornecida (se houver) ou SCAN_MAP',
            );
          }
        }
      }

      // Estratégia 1: ler objectList completa do Device Object.
      // Estratégia 2: fallback índice-a-índice da objectList (APDU pequeno).
      // Estratégia 3: SCAN_MAP em camadas.
      let candidates: Array<{ objectType: number; instance: number }> | null = null;
      let discoverySource: DiscoverySource = 'scan';

      if (deviceInstance !== null) {
        candidates = await this.readObjectListFull(target(), deviceInstance);
        if (candidates) {
          discoverySource = 'objectList';
        } else {
          candidates = await this.readObjectListByIndex(target(), deviceInstance);
          if (candidates) {
            discoverySource = 'objectListIndex';
          }
        }
      }

      const fromExactList = candidates !== null;

      const objects: DiscoveredObject[] = [];

      if (candidates) {
        this.logger.log(
          `Lendo detalhes de ${candidates.length} objetos (fonte: ${discoverySource}, ` +
            `lotes de ${BacnetDiscoveryService.BATCH_SIZE})...`,
        );
        objects.push(...(await this.readObjectsDetails(target(), candidates, fromExactList)));
      } else {
        discoverySource = 'scan';
        this.logger.log('objectList indisponível — usando SCAN_MAP em camadas...');
        objects.push(...(await this.scanByTiers(target())));
      }

      this.logger.log(
        `Discovery concluído — ${objects.length} objetos encontrados em ${address} ` +
          `(fonte: ${discoverySource})`,
      );
      return {
        command_id,
        tenant_id,
        success: true,
        objects,
        discoverySource,
        deviceInstance: deviceInstance ?? null,
        net,
        adr,
      };

    } catch (err) {
      const errorMessage = (err as Error).message ?? String(err);
      this.logger.error(`Falha no discovery de ${address}: ${errorMessage}`);
      return { command_id, tenant_id, success: false, objects: [], error: errorMessage };
    }
  }

  /**
   * Estratégia 1: leitura COMPLETA da objectList (property 76) em um request.
   * Funciona quando a lista cabe no APDU ou o device suporta segmentação.
   * Retorna null quando indisponível (timeout, APDU estourado, sem suporte).
   */
  private async readObjectListFull(
    target: BacnetTarget,
    deviceInstance: number,
  ): Promise<Array<{ objectType: number; instance: number }> | null> {
    try {
      this.logger.log(`Lendo objectList (property 76) completa do device ${deviceInstance}...`);
      const raw = await this.bacnetClient.readPropertySafe(
        target, { type: 8, instance: deviceInstance }, 76, 5000,
      );
      if (!raw) return null;

      const allObjects = this.parseObjectList(raw);
      const filtered = allObjects.filter((o) => VALID_OBJECT_TYPES.has(o.type));
      if (filtered.length === 0) return null;

      this.logger.log(
        `objectList lida com sucesso — ${filtered.length} objetos válidos de ${allObjects.length} total`,
      );
      return this.dedupeCandidates(
        filtered.map((o) => ({ objectType: o.type, instance: o.instance })),
      );
    } catch (err) {
      this.logger.warn(
        `objectList completa indisponível (${(err as Error).message}) — tentando índice-a-índice`,
      );
      return null;
    }
  }

  /**
   * Estratégia 2: leitura da objectList ÍNDICE-A-ÍNDICE.
   * Índice 0 da property 76 é o COUNT do array; índices 1..N são os
   * ObjectIdentifiers individuais — cada request cabe em qualquer APDU.
   * É o caminho para controladoras com muitas dezenas/centenas de objetos que
   * não suportam segmentação (comum em devices embarcados de vários fabricantes).
   */
  private async readObjectListByIndex(
    target: BacnetTarget,
    deviceInstance: number,
  ): Promise<Array<{ objectType: number; instance: number }> | null> {
    const deviceObj = { type: 8, instance: deviceInstance };

    // Índice 0 → quantidade de entradas da objectList.
    const countRaw = await this.bacnetClient.readPropertyIndexSafe(
      target, deviceObj, 76, 0, BacnetDiscoveryService.READ_TIMEOUT_MS,
    );
    const count = this.parseUnsignedValue(countRaw);
    if (count === null || count <= 0 || count > 20000) {
      this.logger.warn(
        `objectList índice 0 (count) indisponível ou inválido (${count}) — usando SCAN_MAP`,
      );
      return null;
    }

    this.logger.log(
      `objectList índice-a-índice — device reporta ${count} entradas; lendo em lotes de ` +
        `${BacnetDiscoveryService.BATCH_SIZE}...`,
    );

    const found: Array<{ objectType: number; instance: number }> = [];
    let readFailures = 0;
    const batchSize = BacnetDiscoveryService.BATCH_SIZE;

    for (let start = 1; start <= count; start += batchSize) {
      const indices: number[] = [];
      for (let i = start; i < start + batchSize && i <= count; i++) {
        indices.push(i);
      }

      const batchResults = await Promise.all(
        indices.map((index) =>
          this.bacnetClient.readPropertyIndexSafe(
            target, deviceObj, 76, index, BacnetDiscoveryService.READ_TIMEOUT_MS,
          ),
        ),
      );

      for (const raw of batchResults) {
        const id = this.parseObjectIdentifier(raw);
        if (!id) {
          readFailures++;
          continue;
        }
        if (VALID_OBJECT_TYPES.has(id.type)) {
          found.push({ objectType: id.type, instance: id.instance });
        }
      }
    }

    if (found.length === 0) {
      this.logger.warn(
        `objectList índice-a-índice não retornou objetos válidos ` +
          `(${readFailures} falhas de leitura) — usando SCAN_MAP`,
      );
      return null;
    }

    if (readFailures > 0) {
      this.logger.warn(
        `objectList índice-a-índice — ${readFailures} de ${count} índices falharam ` +
          '(objetos podem estar faltando)',
      );
    }

    this.logger.log(
      `objectList índice-a-índice concluída — ${found.length} objetos válidos de ${count} entradas`,
    );
    return this.dedupeCandidates(found);
  }

  /** Remove duplicatas tipo+instância (objectLists corrompidas/repetidas). */
  private dedupeCandidates(
    list: Array<{ objectType: number; instance: number }>,
  ): Array<{ objectType: number; instance: number }> {
    const seen = new Set<string>();
    const out: Array<{ objectType: number; instance: number }> = [];
    for (const c of list) {
      const key = `${c.objectType}:${c.instance}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
    return out;
  }

  /**
   * Estratégia 3: SCAN_MAP em camadas. Varre cada tipo pela camada 1; se a
   * camada encontrou ao menos um objeto do tipo, varre a camada seguinte
   * (instâncias mais altas). Objetos aqui só são detectados se responderem à
   * leitura de objectName — sem nome legível E sem resposta, não há como saber
   * que existem (limitação inerente do scan heurístico).
   */
  private async scanByTiers(target: BacnetTarget): Promise<DiscoveredObject[]> {
    const objects: DiscoveredObject[] = [];

    for (const [objectType, tiers] of BacnetDiscoveryService.SCAN_TIERS) {
      let rangeStart = 0;
      for (const rangeEnd of tiers) {
        const candidates: Array<{ objectType: number; instance: number }> = [];
        for (let instance = rangeStart; instance < rangeEnd; instance++) {
          candidates.push({ objectType, instance });
        }

        const tierObjects = await this.readObjectsDetails(target, candidates, false);
        objects.push(...tierObjects);

        // Só expande para a próxima camada se esta encontrou algo deste tipo.
        if (tierObjects.length === 0) break;
        rangeStart = rangeEnd;
      }
    }

    return objects;
  }

  /**
   * Lê os detalhes (objectName + units) de uma lista de candidatos, em lotes
   * paralelos limitados.
   *
   * `fromExactList=true` (candidato veio da objectList): o objeto EXISTE mesmo
   * que a leitura do nome falhe ou venha vazia — recebe nome padrão
   * "TIPO-instância" e unnamed=true, nunca é descartado.
   *
   * `fromExactList=false` (SCAN_MAP): resposta de nome é a prova de existência;
   * sem resposta → objeto ignorado. Resposta com nome vazio → existe, entra
   * com nome padrão e unnamed=true.
   */
  private async readObjectsDetails(
    target: BacnetTarget,
    candidates: Array<{ objectType: number; instance: number }>,
    fromExactList: boolean,
  ): Promise<DiscoveredObject[]> {
    const objects: DiscoveredObject[] = [];
    const batchSize = BacnetDiscoveryService.BATCH_SIZE;
    const readTimeout = BacnetDiscoveryService.READ_TIMEOUT_MS;

    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);

      const batchResults = await Promise.all(
        batch.map(async ({ objectType, instance }) => {
          const nameRaw = await this.bacnetClient.readPropertySafe(
            target, { type: objectType, instance }, 77, readTimeout,
          );

          // SCAN_MAP: sem resposta = inexistente/inacessível → ignora.
          // objectList: o objeto existe; leitura falhou → nome padrão.
          if (!nameRaw && !fromExactList) return null;

          const parsedName = nameRaw ? this.parseStringValue(nameRaw) : null;
          const unnamed = !parsedName;
          const objectName = parsedName ?? `${this.objectTypeLabel(objectType)}-${instance}`;

          let unit: string | null = null;
          let unitCode: number | null = null;

          if (ANALOG_LIKE_TYPES.has(objectType)) {
            const unitsRaw = await this.bacnetClient.readPropertySafe(
              target, { type: objectType, instance }, 117, readTimeout,
            );
            if (unitsRaw) {
              unitCode = this.parseEnumeratedValue(unitsRaw);
              unit = unitCode != null ? (BACNET_UNIT_MAP[unitCode] ?? null) : null;
            }
          }

          return {
            objectType,
            objectInstance: instance,
            objectName,
            unnamed,
            unit,
            unitCode,
          } satisfies DiscoveredObject;
        }),
      );

      for (const result of batchResults) {
        if (result) {
          objects.push(result);
          this.logger.debug(
            `Encontrado: ${this.objectTypeLabel(result.objectType)} ${result.objectInstance}` +
              ` = "${result.objectName}"${result.unnamed ? ' (sem nome no controlador)' : ''}` +
              `${result.unit ? ` [${result.unit}]` : ''}`,
          );
        }
      }
    }

    return objects;
  }

  // ---------------------------------------------------------------------------
  // Parsers de resposta node-bacnet
  // ---------------------------------------------------------------------------

  /**
   * Extrai a lista de ObjectIdentifiers da resposta de objectList (property 76).
   *
   * A resposta node-bacnet tem o formato:
   *   { values: [{ value: [{ value: { type, instance } }] }] }
   */
  private parseObjectList(raw: unknown): Array<{ type: number; instance: number }> {
    const response = raw as {
      values?: Array<{ value?: Array<{ value?: { type: number; instance: number } }> }>;
    };

    const valueArray = response?.values?.[0]?.value;
    if (!Array.isArray(valueArray)) {
      throw new Error('Resposta de objectList em formato inesperado');
    }

    const result: Array<{ type: number; instance: number }> = [];
    for (const item of valueArray) {
      const id = item?.value;
      if (id && typeof id.type === 'number' && typeof id.instance === 'number') {
        result.push({ type: id.type, instance: id.instance });
      }
    }
    return result;
  }

  /**
   * Extrai UM ObjectIdentifier de uma leitura por índice da objectList.
   * Formatos aceitos:
   *   { values: [{ value: { type, instance } }] }            — objeto direto
   *   { values: [{ value: [{ value: { type, instance } }] }] } — aninhado
   */
  private parseObjectIdentifier(raw: unknown): { type: number; instance: number } | null {
    try {
      const response = raw as { values?: Array<{ value?: unknown }> };
      let val = response?.values?.[0]?.value;
      if (Array.isArray(val)) {
        val = (val[0] as { value?: unknown })?.value;
      }
      const id = val as { type?: unknown; instance?: unknown } | undefined;
      if (id && typeof id.type === 'number' && typeof id.instance === 'number') {
        return { type: id.type, instance: id.instance };
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Extrai um valor unsigned (ex: count da objectList no índice 0).
   * node-bacnet retorna: { values: [{ type: 2, value: 42 }] }
   */
  private parseUnsignedValue(raw: unknown): number | null {
    try {
      const response = raw as { values?: Array<{ value?: unknown }> };
      const val = response?.values?.[0]?.value;
      if (typeof val === 'number' && Number.isFinite(val)) return val;
      if (typeof val === 'string' && val.trim() !== '' && !Number.isNaN(Number(val))) {
        return Number(val);
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Extrai o valor string de uma resposta ReadProperty (objectName, property 77).
   *
   * node-bacnet v0.2.x retorna: { values: [{ type: 7, value: 'NomeDoObjeto' }] }
   * O valor está em values[0].value diretamente (não aninhado).
   */
  private parseStringValue(raw: unknown): string | null {
    try {
      const response = raw as {
        values?: Array<{ type?: number; value?: unknown }>;
      };
      const val = response?.values?.[0]?.value;
      if (typeof val === 'string' && val.trim() !== '') return repairMojibake(val.trim());
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Extrai valor numérico enumerado de uma resposta ReadProperty (units, property 117).
   *
   * node-bacnet v0.2.x retorna: { values: [{ type: 9, value: 62 }] }
   * O valor está em values[0].value diretamente.
   */
  private parseEnumeratedValue(raw: unknown): number | null {
    try {
      const response = raw as {
        values?: Array<{ type?: number; value?: unknown }>;
      };
      const val = response?.values?.[0]?.value;
      if (val == null) return null;
      const num = Number(val);
      return isNaN(num) ? null : num;
    } catch {
      return null;
    }
  }

  /**
   * Retorna rótulo textual do tipo de objeto para logs e nomes padrão.
   */
  private objectTypeLabel(type: number): string {
    const labels: Record<number, string> = {
      0: 'AI', 1: 'AO', 2: 'AV',
      3: 'BI', 4: 'BO', 5: 'BV',
      13: 'MSI', 14: 'MSO', 19: 'MSV',
      23: 'ACC', 24: 'PC', 40: 'CSV',
      45: 'IV', 46: 'LAV', 48: 'PIV',
      8: 'DEV', 15: 'NC', 20: 'TL', 17: 'SCH',
    };
    return labels[type] ?? `OBJ_${type}`;
  }
}
