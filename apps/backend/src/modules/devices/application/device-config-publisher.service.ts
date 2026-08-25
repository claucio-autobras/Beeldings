import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EXCLUDE_VIRTUAL_DEVICES } from '../../prisma/device-filters.js';
import { decryptCameraSecret } from './camera-credentials.util.js';
import {
  resolveSnmpRuntimeCredentials,
  type SnmpCredentialRow,
} from './snmp-credential.util.js';
import {
  ACCESS_CONTROLLER_OID_PROFILES,
  GENERIC_AC_PROFILE,
  resolveAcOidProfile,
} from './access-controller-oid-profiles.js';
import { detectNvrProfile, NVR_OID_PROFILES } from './nvr-oid-profiles.js';
import { normalizeMetricKey } from './snmp-metric.service.js';
import { MqttService } from '../../mqtt/mqtt.service.js';

/**
 * Mapa de rótulo de tipo BACnet → código numérico esperado pelo gateway.
 * MSV=19, ACC=23 (accumulator), PC=24 (pulse-converter),
 * CSV=40 (characterstring-value), IV=45 (integer-value),
 * LAV=46 (large-analog-value), PIV=48 (positive-integer-value).
 */
const OBJECT_TYPE_NUM: Record<string, number> = {
  AI: 0, AO: 1, AV: 2, BI: 3, BO: 4, BV: 5, MSI: 13, MSO: 14, MSV: 19,
  ACC: 23, PC: 24, CSV: 40, IV: 45, LAV: 46, PIV: 48,
};

/** Intervalo de polling padrão (ms) — alinhado ao gateway. */
const DEFAULT_POLLING_MS = 15_000;
const CONTROL_ID_MEMORY_MEMBERS = [
  '1.3.6.1.4.1.2021.4.6.0',
  '1.3.6.1.4.1.2021.4.14.0',
  '1.3.6.1.4.1.2021.4.15.0',
  '1.3.6.1.4.1.2021.4.5.0',
];

/** Propriedade BACnet lida no polling — presentValue. */
const PRESENT_VALUE = 85;

/** Porta Modbus TCP padrão. */
const DEFAULT_MODBUS_PORT = 502;

/** Binding Modbus persistido em DevicePoint.binding. */
interface ModbusBinding {
  register: number;
  registerType?: 'holding' | 'input' | 'coil' | 'discrete';
  dataType?: 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32';
  endianness?: 'big' | 'little';
  scale?: number;
  offset?: number;
}

/** Config Modbus do device persistida em Device.config. */
interface ModbusDeviceConfig {
  /** 'tcp' (rede) ou 'rtu' (serial RS485). Ausente = TCP (configs antigas). */
  connectionType?: 'tcp' | 'rtu';
  /** Parâmetros da porta serial — só no modo RTU. */
  serial?: {
    path: string;
    baudRate: number;
    parity: 'none' | 'even' | 'odd';
    dataBits: 7 | 8;
    stopBits: 1 | 2;
  };
  unitId?: number;
  pollingIntervalMs?: number;
}

/** Binding MQTT-nativo persistido em DevicePoint.binding. */
interface MqttBinding {
  sourceTopic: string;
  jsonPath?: string;
  valueType?: 'number' | 'boolean';
}

/** Binding SNMP persistido em DevicePoint.binding (câmeras CFTV). */
interface SnmpBinding {
  /** Métrica padrão ('status' | 'uptime' | 'memory' | 'packet_loss') ou custom. */
  metric?: string;
  /** OID consultado no polling (status não tem OID — derivado da alcançabilidade). */
  oid?: string | null;
  /** Subconjunto persistido de OIDs de um agregado (ex.: um volume hrStorage). */
  memberOids?: string[];
  /** Fator de escala aplicado ao valor cru (ex.: 0.01 p/ sysUpTime → segundos). */
  scale?: number;
  /** OID comprovadamente não suportado pela câmera (diagnóstico) — fora do GET. */
  unsupported?: boolean;
  /** Prefixo legado de coluna; materializado como OID completo antes do publish. */
  tableOidPrefix?: string | null;
}

/** Unidade canônica enviada ao gateway; payloads antigos são migrados na borda. */
function canonicalSnmpUnit(metric: string | undefined, unit: string | null): string | null {
  if (metric === 'net_in_rate' || metric === 'net_out_rate' ||
      metric === 'if_in_octets' || metric === 'if_out_octets') return 'bit/s';
  if (metric === 'memory_total' || metric === 'ram_total' || metric === 'memory_available') {
    return 'bytes';
  }
  return unit;
}

/** Config SNMP do device persistida em Device.config (câmeras CFTV). */
interface SnmpDeviceConfig {
  snmpVersion?: '1' | '2c';
  community?: string;
  rtspUrl?: string | null;
  pollingIntervalMs?: number;
  /** Fabricante do cadastro (identificação de provider no gateway). */
  manufacturer?: string | null;
  /** Perfil já identificado pelo diagnóstico/sync do backend. */
  profileId?: string | null;
  /**
   * Credenciais HTTP opcionais p/ fallback proprietário (ex.: ISAPI Hikvision
   * em câmera SNMP). Senha cifrada — decifrada só ao publicar ao gateway.
   */
  isapi?: { username?: string; passwordEnc?: string; port?: number } | null;
}

/** Porta SNMP padrão. */
const DEFAULT_SNMP_PORT = 161;

/**
 * OIDs genéricos que os cadastros ANTIGOS de controladoras semeavam de forma
 * engessada nos pontos padrão (HOST-RESOURCES/UCD/lm-sensors/IF-MIB). Um OID
 * fixo no binding impede o gateway de cair no OID do perfil do fabricante —
 * então, ao publicar a config, bindings intocados (sem a chave `unsupported`,
 * que o diagnóstico/edição manual sempre grava) com exatamente esse OID
 * legado são re-resolvidos para `oid: null`, devolvendo a resolução à cadeia
 * de perfis base→fabricante do gateway. OIDs aplicados deliberadamente pelo
 * operador/diagnóstico ficam intactos.
 */
const LEGACY_AC_SEEDED_OIDS = new Map<string, string>(
  [
    ...Object.entries(GENERIC_AC_PROFILE.oids),
    // Seed anterior ao contrato memory_available.
    ['memory', '1.3.6.1.4.1.2021.4.6.0'],
  ].map(([metric, entry]) => [metric, typeof entry === 'string' ? entry : entry.oid]),
);

/**
 * Decide se um binding de ponto de controladora ainda é o seed engessado do
 * cadastro antigo (metric+OID genérico, nunca tocado por diagnóstico/manual).
 */
export function isLegacySeededAcBinding(
  binding: Record<string, unknown> | null | undefined,
): boolean {
  if (!binding) return false;
  const metric = binding.metric;
  const oid = binding.oid;
  if (typeof metric !== 'string' || typeof oid !== 'string') return false;
  // Diagnóstico e edição manual SEMPRE gravam a chave `unsupported` — um
  // binding sem ela só pode ser o seed original do cadastro.
  if (Object.prototype.hasOwnProperty.call(binding, 'unsupported')) return false;
  return LEGACY_AC_SEEDED_OIDS.get(metric) === oid;
}

/**
 * Materializa no backend os bindings legados que antes dependiam da seleção de
 * perfil no gateway. O resultado é persistido em device_metric_binding e o
 * polling recebe somente OIDs concretos para GET.
 */
function materializeLegacySnmpBinding(
  device: {
    monitoredDeviceType?: string | null;
    config: unknown;
  },
  rawBinding: unknown,
): SnmpBinding {
  const binding = (rawBinding ?? {}) as SnmpBinding;
  if (binding.unsupported) return binding;

  if (!binding.oid && binding.tableOidPrefix) {
    return { ...binding, oid: binding.tableOidPrefix };
  }

  const replaceLegacyAcSeed =
    device.monitoredDeviceType === 'ACCESS_CONTROLLER' &&
    isLegacySeededAcBinding(rawBinding as Record<string, unknown> | null);
  if (binding.oid && !replaceLegacyAcSeed) return binding;

  const metric = binding.metric;
  if (!metric) return binding;
  const cfg = (device.config ?? {}) as SnmpDeviceConfig;
  const profile =
    device.monitoredDeviceType === 'ACCESS_CONTROLLER'
      ? ACCESS_CONTROLLER_OID_PROFILES.find((candidate) => candidate.id === cfg.profileId) ??
        resolveAcOidProfile(cfg.manufacturer)
      : null;
   // Em controladoras Linux, o legado `memory` significava memória livre.
   // Reaponta-o para a métrica explícita de memória recuperável. Perfis que
   // fornecem memória percentual (ex.: Hikvision) continuam em `memory`.
   const canonicalMetric =
     metric === 'memory_total'
       ? 'ram_total'
       : metric === 'memory' && profile?.oids.memory_available
         ? 'memory_available'
         : metric;
  if (device.monitoredDeviceType === 'ACCESS_CONTROLLER') {
    const acProfile = profile ??
      ACCESS_CONTROLLER_OID_PROFILES.find((candidate) => candidate.id === cfg.profileId) ??
      resolveAcOidProfile(cfg.manufacturer);
    const entry = acProfile.oids[canonicalMetric as keyof typeof acProfile.oids];
    return entry
      ? { ...binding, metric: canonicalMetric, oid: entry.oid, scale: entry.scale }
        : {
            ...binding,
            metric: canonicalMetric,
            oid: null,
            ...(canonicalMetric === 'temperature'
              ? { unsupported: true, healthState: 'unsupported', healthReason: 'not_exposed_by_firmware' }
              : {}),
          };
  }

  if (device.monitoredDeviceType === 'NVR') {
    const profile =
      NVR_OID_PROFILES.find((candidate) => candidate.id === cfg.profileId) ??
      detectNvrProfile(null, null, cfg.manufacturer);
    const entry = profile.oids[metric as keyof typeof profile.oids];
    return entry
      ? { ...binding, oid: entry.oid, scale: entry.scale }
      : { ...binding, oid: null };
  }

  return binding;
}

/** Binding ONVIF persistido em DevicePoint.binding (câmeras CFTV ONVIF). */
interface OnvifBinding {
  /**
   * 'status' | 'uptime' | 'stream' | 'motion' | 'tamper' | 'video_loss'
   * ou métrica de saúde via SNMP ('cpu' | 'memory' | 'temperature' | 'packet_loss').
   */
  metric?: string;
  /** OID SNMP (só nos pontos de saúde do canal SNMP opcional). */
  oid?: string | null;
  /** Fator de escala do valor cru SNMP. */
  scale?: number;
  /** OID comprovadamente não suportado pela câmera (diagnóstico) — fora do GET. */
  unsupported?: boolean;
}

/** Canal SNMP opcional de saúde persistido em Device.config (ONVIF híbrido). */
interface OnvifSnmpHealthConfig {
  enabled?: boolean;
  port?: number;
  snmpVersion?: '1' | '2c';
  community?: string;
}

/** Config ONVIF do device persistida em Device.config (câmeras CFTV ONVIF). */
interface OnvifDeviceConfig {
  onvifUsername?: string;
  /** Senha cifrada (AES-256-GCM) — decifrada só ao publicar para o gateway. */
  onvifPasswordEnc?: string;
  rtspUrl?: string | null;
  pollingIntervalMs?: number;
  snmpHealth?: OnvifSnmpHealthConfig | null;
  /** Fabricante/modelo detectados no probe ONVIF. */
  deviceInfo?: { manufacturer?: string | null } | null;
}

/** Porta ONVIF padrão (HTTP). */
const DEFAULT_ONVIF_PORT = 80;

/**
 * Config BACnet do device persistida em Device.config (Json).
 * net/adr endereçam devices MS/TP atrás de roteador BACnet (NPDU DNET/DADR);
 * deviceInstance é a instância BACnet real (para COV/identificação).
 */
interface BacnetDeviceConfigJson {
  deviceInstance?: number;
  net?: number | null;
  adr?: number[] | null;
  pollingIntervalMs?: number;
}

/**
 * DeviceConfigPublisherService
 *
 * Publica a configuração de polling dos dispositivos BACnet para o gateway,
 * derivada dos pontos CADASTRADOS no banco (fonte da verdade). Assim, quando
 * um ponto é adicionado/sincronizado/removido pela UI, o gateway passa a
 * ler (ou parar de ler) o objeto automaticamente — sem editar config estática.
 *
 * Tópico (retido, QoS 1):
 *   bluebee/{tenantId}/gateway/{gatewayId}/config
 *
 * Como é retido, o gateway recebe a última config ao (re)conectar.
 */
@Injectable()
export class DeviceConfigPublisherService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DeviceConfigPublisherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mqtt: MqttService,
  ) {}

  /** Ao subir, republica a config atual de todos os gateways com dispositivos. */
  onApplicationBootstrap(): void {
    // Não bloqueia o boot: com o broker MQTT fora do ar, os publishes ficam
    // enfileirados pelo mqtt.js e o await jamais resolveria — o backend nunca
    // abriria a porta HTTP. Roda em background e loga o resultado.
    void this.publishAllOnBoot();
  }

  private async publishAllOnBoot(): Promise<void> {
    try {
      const groups = await this.prisma.device.groupBy({
        by: ['tenantId', 'gatewayId'],
        where: { gatewayId: { not: null }, ...EXCLUDE_VIRTUAL_DEVICES },
      });
      for (const g of groups) {
        if (g.gatewayId) {
          await this.publishForGateway(g.tenantId, g.gatewayId);
        }
      }
      this.logger.log(`Config de polling publicada para ${groups.length} gateway(s) no boot`);
    } catch (err) {
      this.logger.error(`Falha ao publicar config no boot: ${(err as Error).message}`);
    }
  }

  /** Publica a config do gateway dono de um dispositivo específico. */
  async publishForDevice(deviceId: string): Promise<void> {
    const device = await this.prisma.device.findUnique({ where: { id: deviceId } });
    if (!device?.gatewayId) {
      this.logger.warn(`Dispositivo ${deviceId} sem gatewayId — config não publicada`);
      return;
    }
    await this.publishForGateway(device.tenantId, device.gatewayId);
  }

  /** Monta e publica a config de polling de todos os devices de um gateway (por protocolo). */
  async publishForGateway(tenantId: string, gatewayId: string): Promise<void> {
    const devices = await this.prisma.device.findMany({
      where: { tenantId, gatewayId, ...EXCLUDE_VIRTUAL_DEVICES },
      // Ordem estável dos pontos: o gateway compara o bloco de config por JSON
      // para decidir se reinicia a câmera — ordem aleatória reiniciaria todas.
      include: {
        points: { orderBy: [{ instance: 'asc' }, { tag: 'asc' }] },
        // Credencial SNMP (fonte da verdade quando existe; fallback Device.config).
        snmpCredential: true,
        metricBindings: true,
      },
    });

    // Espelha os bindings de coleta (device_metric_binding) a partir dos
    // pontos dos devices SNMP — diff-only: sem mudança, nenhum write (o boot
    // republica config de todos os gateways). O payload é montado a partir do
    // estado PÓS-sync: a tabela de bindings é quem governa a coleta. Se o
    // sync falhar, vale o estado atual do banco (nunca o espelho em memória).
    const bindingsByDevice = new Map<string, Map<string, string>>();
    for (const d of devices) {
      if (d.protocol === 'snmp') {
        try {
          bindingsByDevice.set(d.id, await this.syncMetricBindings(d));
        } catch (err) {
          this.logger.error(
            `Falha ao sincronizar bindings de ${d.id}: ${(err as Error).message}`,
          );
          bindingsByDevice.set(
            d.id,
            new Map((d.metricBindings ?? []).map((b) => [b.metricKey, b.oid])),
          );
        }
      }
    }

    const payload = {
      tenantId,
      gatewayId,
      devices: devices.map((d) => this.buildDeviceBlock(d, bindingsByDevice.get(d.id))),
    };

    const topic = `bluebee/${tenantId}/gateway/${gatewayId}/config`;
    const totalPoints = devices.reduce((acc, d) => acc + d.points.length, 0);

    try {
      await this.mqtt.publish(topic, payload, 1, true);
      this.logger.log(
        `Config publicada em ${topic} — ${payload.devices.length} device(s), ${totalPoints} ponto(s)`,
      );
    } catch (err) {
      this.logger.error(`Falha ao publicar config em ${topic}: ${(err as Error).message}`);
    }
  }

  /**
   * Espelha os pontos SNMP resolvidos do device em `device_metric_binding`
   * (fase 2 da descoberta: a COLETA lê só OIDs do binding, nunca faz walk).
   * Fonte: DevicePoint.binding (source='point'). Diff-only: cria/atualiza/
   * remove apenas o que mudou — o boot republica config de todos os gateways
   * e não pode gerar writes em massa.
   *
   * Retorna o estado PÓS-sync (metricKey → OID), usado para montar o payload
   * de config na MESMA publicação — a tabela de bindings governa a coleta.
   */
  private async syncMetricBindings(device: {
    id: string;
    tenantId: string;
    config: unknown;
    monitoredDeviceType?: string | null;
    points: Array<{ tag: string; binding: unknown }>;
    metricBindings?: Array<{
      id: string;
      metricKey: string;
      oid: string;
      source: string;
      confidenceLabel?: string | null;
    }>;
  }): Promise<Map<string, string>> {
    // Bindings desejados a partir dos pontos com OID resolvido (escalar ou
    // tabela). Métricas derivadas (status/ping_loss/reachability) e pontos
    // não suportados ficam de fora — binding é SEMPRE um OID que a coleta
    // consulta. Seeds legados são materializados aqui, nunca no polling.
    const DERIVED_METRICS = new Set([
      'status',
      'ping_loss',
      'reachability',
      'reachability_latency',
      'reachability_failure_rate',
      // Detalhe derivado dos mesmos membros do binding cpu_usage.
      'cpu_usage_peak',
    ]);
    const desired = new Map<string, string>();
    for (const p of device.points) {
      const b = materializeLegacySnmpBinding(device, p.binding) as SnmpBinding & {
        ifIndex?: number;
        slotIndex?: number;
        channelIndex?: number;
        collectionType?: 'scalar' | 'table';
      };
      if (!b.oid || b.unsupported) continue;
      // Métricas derivadas (alcançabilidade/ping) nunca têm OID para coleta.
      if (b.metric && DERIVED_METRICS.has(b.metric)) continue;
      const tableIndex = b.ifIndex ?? b.slotIndex ?? b.channelIndex;
      if (b.collectionType === 'table') {
        // Ponto de TABELA (switch/NVR): 1 binding por linha, chaveado pela tag
        // (única por porta/slot/canal), com o OID COMPLETO coluna.índice — é o
        // OID que a coleta restrita consulta via GET (nunca subtree).
        if (tableIndex === undefined) continue;
        if (!desired.has(p.tag)) desired.set(p.tag, `${b.oid}.${tableIndex}`);
        continue;
      }
      const metricKey =
        !b.metric || b.metric === 'custom'
          ? p.tag
          : normalizeMetricKey(b.metric);
      if (!desired.has(metricKey)) desired.set(metricKey, b.oid);
    }

    const existing = device.metricBindings ?? [];
    const existingByKey = new Map(existing.map((b) => [b.metricKey, b]));

    for (const [metricKey, oid] of desired) {
      const row = existingByKey.get(metricKey);
      if (!row) {
        // Novo binding vindo de ponto: source='point', confidence padrão 'exact'
        // (operador explicitamente configurou o OID via diagnose/apply).
        await this.prisma.deviceMetricBinding.create({
          data: {
            tenantId: device.tenantId,
            deviceId: device.id,
            metricKey,
            oid,
            source: 'point',
            confidenceLabel: 'exact',
          },
        });
      } else if (row.oid !== oid) {
        // OID mudou (diagnóstico/edição manual): re-resolve e limpa o flag
        // de quebrado. Preserva confidenceLabel semântico do binding existente
        // (manual > exact > inferred): se era 'manual', mantém 'manual';
        // se era 'diagnose'/'inherited', source muda para 'point' mas
        // confidenceLabel fica preservado como estava.
        const existingConf = row.confidenceLabel;
        const nextConf =
          existingConf === 'manual' ? 'manual' :
          existingConf === 'exact' ? 'exact' :
          'exact'; // OID aplicado via diagnose = exact
        await this.prisma.deviceMetricBinding.update({
          where: { id: row.id },
          data: {
            oid,
            source: 'point',
            confidenceLabel: nextConf,
            broken: false,
            brokenReason: null,
            resolvedAt: new Date(),
          },
        });
      }
      // OID não mudou: não tocamos na linha (preserva confidenceLabel/source).
    }
    // Remove só bindings espelhados de pontos (source='point') cujo ponto
    // sumiu/perdeu o OID — fontes futuras ('diagnose'/'inherited') ficam.
    const staleIds = existing
      .filter((b) => b.source === 'point' && !desired.has(b.metricKey))
      .map((b) => b.id);
    if (staleIds.length > 0) {
      await this.prisma.deviceMetricBinding.deleteMany({ where: { id: { in: staleIds } } });
    }

    // Estado pós-sync: linhas de outras fontes preservadas + espelho dos pontos.
    const effective = new Map<string, string>();
    for (const b of existing) {
      if (b.source !== 'point') effective.set(b.metricKey, b.oid);
    }
    for (const [metricKey, oid] of desired) effective.set(metricKey, oid);
    return effective;
  }

  /**
   * Monta o bloco de config de um device conforme o protocolo. O gateway roteia
   * cada bloco pelo campo `protocol` para o serviço correspondente
   * (BacnetPolling / ModbusPolling / MqttBridge).
   */
  private buildDeviceBlock(
    device: {
      id: string;
      name: string;
      protocol: string;
      ip: string;
      port: number;
      config: unknown;
      /** Tipo do dispositivo monitorado — publicado para o motor de perfis do gateway. */
      monitoredDeviceType?: string | null;
      points: Array<{ tag: string; objectType: string; instance: number; unit: string | null; binding: unknown }>;
      /** Credencial SNMP (tabela snmp_credential) — null = fallback Device.config. */
      snmpCredential?: SnmpCredentialRow | null;
      /** Bindings de coleta (device_metric_binding) espelhados dos pontos. */
      metricBindings?: Array<{ metricKey: string; oid: string; memberOids?: unknown }>;
    },
    /**
     * Estado pós-sync de device_metric_binding (metricKey → OID) — fonte dos
     * OIDs escalares emitidos p/ devices SNMP. Ausente = usa as linhas do
     * banco carregadas na query (sync falhou ou device não-SNMP).
     */
    syncedBindings?: Map<string, string>,
  ): Record<string, unknown> {
    if (device.protocol === 'modbus') {
      const cfg = (device.config ?? {}) as ModbusDeviceConfig;
      const registers = device.points.map((p) => {
        const b = (p.binding ?? {}) as ModbusBinding;
        return {
          tag: p.tag,
          register: b.register ?? p.instance,
          registerType: b.registerType ?? 'holding',
          dataType: b.dataType ?? 'float32',
          endianness: b.endianness ?? 'big',
          scale: b.scale ?? 1,
          offset: b.offset ?? 0,
          unit: p.unit ?? null,
        };
      });
      const isRtu = cfg.connectionType === 'rtu';
      return {
        deviceId: device.id,
        name: device.name,
        protocol: 'modbus',
        // Configs antigas sem connectionType são tratadas como TCP.
        connectionType: isRtu ? 'rtu' : 'tcp',
        ip: device.ip,
        port: device.port || DEFAULT_MODBUS_PORT,
        ...(isRtu && cfg.serial ? { serial: { ...cfg.serial } } : {}),
        unitId: cfg.unitId ?? 1,
        pollingIntervalMs: cfg.pollingIntervalMs ?? DEFAULT_POLLING_MS,
        registers,
      };
    }

    if (device.protocol === 'mqtt') {
      // Mapa de bridge: tópico nativo do equipamento → ponto canônico.
      const cfg = (device.config ?? {}) as {
        topicMode?: 'prefix' | 'root';
        rootTopic?: string;
        heartbeatTopic?: string | null;
        heartbeatTimeoutSeconds?: number | null;
      };
      const bridge = device.points.map((p) => {
        const b = (p.binding ?? {}) as MqttBinding;
        return {
          tag: p.tag,
          sourceTopic: b.sourceTopic ?? '',
          jsonPath: b.jsonPath ?? null,
          valueType: b.valueType ?? 'number',
          unit: p.unit ?? null,
        };
      });
      return {
        deviceId: device.id,
        name: device.name,
        protocol: 'mqtt',
        // Modo tópico raiz próprio: o gateway relaxa o guard de prefixo para
        // este namespace (e assina o heartbeat, quando declarado).
        rootTopic: cfg.topicMode === 'root' ? (cfg.rootTopic ?? null) : null,
        heartbeat: cfg.heartbeatTopic
          ? {
              topic: cfg.heartbeatTopic,
              timeoutSeconds: cfg.heartbeatTimeoutSeconds ?? 90,
            }
          : null,
        bridge,
      };
    }

    if (device.protocol === 'snmp') {
      // Câmera CFTV monitorada via SNMP — o gateway consulta os OIDs dos pontos
      // e deriva o ponto 'status' da alcançabilidade (sem resposta = offline).
      const cfg = (device.config ?? {}) as SnmpDeviceConfig;
      // Fonte dos OIDs escalares: estado pós-sync de device_metric_binding
      // (fallback: linhas do banco quando o sync falhou). A tabela GOVERNA a
      // coleta. Compatibilidade de pontos legados é materializada no backend;
      // o gateway nunca resolve perfil ou executa walk durante polling.
      const collectionBindings =
        syncedBindings ??
        new Map((device.metricBindings ?? []).map((b) => [b.metricKey, b.oid]));
      // OIDs membros de métricas agregadas (device_metric_binding.memberOids):
      // cpu/cpu_usage (média de hrProcessorLoad), memory_used_percent/memory_total
      // (colunas hrStorage). Vêm do BANCO (fonte: diagnose/profile) — o sync de
      // pontos nunca os popula. São publicados junto ao ponto escalar da métrica
      // para que o gateway os inclua no GET em lote (NUNCA walk) e re-derive o
      // valor em cada ciclo. Chave = metricKey canônico do binding.
      const memberOidsByKey = new Map<string, string[]>();
      for (const b of device.metricBindings ?? []) {
        const members = Array.isArray(b.memberOids)
          ? (b.memberOids as unknown[]).filter(
              (o): o is string => typeof o === 'string' && o.length > 0,
            )
          : [];
        if (members.length > 0) memberOidsByKey.set(b.metricKey, members);
      }
      const deviceConfig = (device.config ?? {}) as { manufacturer?: string | null; profileId?: string | null };
      const isControlId = /control[\s-]*id|controlid|idflex/i.test(deviceConfig.manufacturer ?? '') ||
        deviceConfig.profileId === 'control-id';
      const points = device.points.map((p) => {
        const b = materializeLegacySnmpBinding(device, p.binding) as SnmpBinding & {
          ifIndex?: number;
          /** Índice de slot de disco NVR (mesma semântica de ifIndex no gateway). */
          slotIndex?: number;
          /** Índice de canal NVR (mesma semântica de ifIndex no gateway). */
          channelIndex?: number;
          collectionType?: 'scalar' | 'table';
          scale?: number;
        };
        // SWITCH usa ifIndex (IF-MIB); NVR usa slotIndex (disco) ou channelIndex (canal).
        // O gateway recebe o campo como `ifIndex` em todos os casos.
        const tableIndex = b.ifIndex ?? b.slotIndex ?? b.channelIndex;
        const isTable = b.collectionType === 'table' && tableIndex !== undefined;
        const metricKey =
          !b.metric || b.metric === 'custom'
            ? p.tag
            : isTable
              ? b.metric
              : normalizeMetricKey(b.metric);
        // OID vem da tabela de bindings (estado do banco governa a coleta).
        // Escalar: OID direto por metricKey. Tabela: o binding guarda o OID
        // COMPLETO coluna.índice por tag — emitimos o prefixo de coluna
        // (o gateway recompõe coluna.índice no GET restrito). Pontos
        // `unsupported` mantêm o OID do ponto.
        // cpu_usage_peak é um ponto derivado de detalhe e reutiliza o binding
        // persistido de cpu_usage; não cria uma segunda escolha canônica.
        const sourceMetricKey =
          metricKey === 'cpu_usage_peak' ? 'cpu_usage' : metricKey;
        const bindingMembers =
          memberOidsByKey.get(sourceMetricKey) ??
          (isControlId && sourceMetricKey === 'memory_available'
            ? CONTROL_ID_MEMORY_MEMBERS
            : []);
        const pointMembers = Array.isArray(b.memberOids)
          ? b.memberOids.filter(
              (oid): oid is string =>
                typeof oid === 'string' && bindingMembers.includes(oid),
            )
          : [];
        const usesPointAggregate =
          pointMembers.length >= 2 &&
          typeof b.oid === 'string' &&
          bindingMembers.includes(b.oid);
        const scalarOid = b.unsupported
          ? (b.oid ?? null)
          : usesPointAggregate
            ? b.oid ?? null
            : (collectionBindings.get(sourceMetricKey) ?? null);
        let tableOid: string | null = null;
        if (isTable) {
          const bound = b.unsupported ? null : (collectionBindings.get(p.tag) ?? null);
          const suffix = `.${tableIndex}`;
          tableOid =
            bound && bound.endsWith(suffix)
              ? bound.slice(0, -suffix.length)
              : b.unsupported
                ? (b.oid ?? null)
                : null;
        }
        // OIDs membros da métrica agregada (só escalares, nunca tabela nem
        // unsupported): incluídos no GET em lote do gateway
        // para re-derivar cpu (média) / memória (percentual) por ciclo.
        const memberOids =
          !isTable && !b.unsupported
            ? usesPointAggregate
              ? pointMembers
              : bindingMembers
            : undefined;
        return {
          tag: p.tag,
          metric: b.metric ?? 'custom',
          oid: isTable ? tableOid : scalarOid,
          scale: b.scale ?? 1,
          unit: canonicalSnmpUnit(
            b.metric === 'memory' && device.monitoredDeviceType === 'ACCESS_CONTROLLER' &&
              (ACCESS_CONTROLLER_OID_PROFILES.find((candidate) => candidate.id === cfg.profileId) ??
                resolveAcOidProfile(cfg.manufacturer)).oids.memory_available
              ? 'memory_available'
              : b.metric,
            p.unit ?? null,
          ),
          // OID marcado como não suportado sai do GET em lote do gateway —
          // em SNMP v1, um único OID inválido derruba a requisição inteira.
          ...(b.unsupported ? { unsupported: true } : {}),
          // OIDs membros (agregado): média de CPUs ou colunas hrStorage.
          ...(memberOids && memberOids.length > 0 ? { memberOids } : {}),
          // Pontos de tabela (SWITCH via IF-MIB ou NVR via slot/canal): ifIndex canônico.
          ...(b.collectionType === 'table' && tableIndex !== undefined
            ? { ifIndex: tableIndex, collectionType: 'table' as const }
            : {}),
        };
      });
      // Credenciais efetivas: tabela snmp_credential quando existe; senão,
      // retrocompat com Device.config. Chaves v3 decifradas SÓ neste payload
      // MQTT ao gateway — nunca em respostas da API nem em logs.
      const creds = resolveSnmpRuntimeCredentials(device.snmpCredential, cfg);
      return {
        deviceId: device.id,
        name: device.name,
        protocol: 'snmp',
        // Tipo de dispositivo monitorado — usado pelo motor de perfis do gateway
        // para selecionar o catálogo de métricas correto (CAMERA/ACCESS_CONTROLLER/…).
        monitoredDeviceType: device.monitoredDeviceType ?? 'CAMERA',
        ip: device.ip,
        port: device.port || DEFAULT_SNMP_PORT,
        snmpVersion: creds.snmpVersion,
        community: creds.community,
        ...(creds.v3 ? { v3: creds.v3 } : {}),
        // Fase 3: polling contínuo é sempre GET-only sobre OIDs persistidos.
        restrictToBindings: true,
        pollingIntervalMs: cfg.pollingIntervalMs ?? DEFAULT_POLLING_MS,
        // Fabricante manual do cadastro — precedência máxima na identificação
        // de provider do gateway (Hikvision/Dahua/Intelbras…).
        manufacturer: cfg.manufacturer ?? null,
        // Perfil manual e overrides de OID por métrica (Device.config).
        profileId: (cfg as { profileId?: string | null }).profileId ?? null,
        profileOverrides: (cfg as { profileOverrides?: Record<string, unknown> | null }).profileOverrides ?? null,
        // Fallback HTTP proprietário (ISAPI) quando credenciais foram salvas.
        ...(cfg.isapi?.username
          ? {
              http: {
                username: cfg.isapi.username,
                password: decryptCameraSecret(cfg.isapi.passwordEnc) ?? '',
                ...(cfg.isapi.port ? { port: cfg.isapi.port } : {}),
              },
            }
          : {}),
        points,
      };
    }

    if (device.protocol === 'onvif') {
      // Câmera CFTV monitorada via ONVIF — o gateway conecta com as credenciais
      // (STATUS via GetDeviceInformation, STREAM via GetStreamUri) e assina os
      // eventos (motion/tamper/video_loss). A senha vai decifrada SOMENTE neste
      // payload MQTT ao gateway; nunca em respostas da API nem em logs.
      const cfg = (device.config ?? {}) as OnvifDeviceConfig;
      const points = device.points.map((p) => {
        const b = (p.binding ?? {}) as OnvifBinding;
        return {
          tag: p.tag,
          metric: b.metric ?? 'custom',
          // OID/scale só existem nos pontos de saúde do canal SNMP opcional.
          ...(b.oid
            ? {
                oid: b.oid,
                scale: b.scale ?? 1,
                ...(b.unsupported ? { unsupported: true } : {}),
              }
            : {}),
          unit: p.unit ?? null,
        };
      });
      const snmpHealth = cfg.snmpHealth?.enabled
        ? {
            port: cfg.snmpHealth.port ?? DEFAULT_SNMP_PORT,
            snmpVersion: cfg.snmpHealth.snmpVersion ?? '2c',
            community: cfg.snmpHealth.community ?? 'public',
          }
        : null;
      return {
        deviceId: device.id,
        name: device.name,
        protocol: 'onvif',
        ip: device.ip,
        port: device.port || DEFAULT_ONVIF_PORT,
        username: cfg.onvifUsername ?? '',
        password: decryptCameraSecret(cfg.onvifPasswordEnc) ?? '',
        pollingIntervalMs: cfg.pollingIntervalMs ?? DEFAULT_POLLING_MS,
        // Fabricante do probe — habilita fallback proprietário no gateway
        // (ex.: uptime real via ISAPI reusando as credenciais ONVIF).
        manufacturer: cfg.deviceInfo?.manufacturer ?? null,
        ...(snmpHealth ? { snmpHealth } : {}),
        points,
      };
    }

    // BACnet (default)
    const cfg = (device.config ?? {}) as BacnetDeviceConfigJson;
    const objects = device.points.map((p) => {
      const parsed = Number(p.objectType);
      return {
        tag: p.tag,
        objectType:
          OBJECT_TYPE_NUM[p.objectType] ?? (Number.isFinite(parsed) ? parsed : 0),
        objectInstance: p.instance,
        property: PRESENT_VALUE,
        unit: p.unit ?? null,
        useCov: false,
      };
    });
    const net = typeof cfg.net === 'number' && cfg.net > 0 ? cfg.net : null;
    const adr = Array.isArray(cfg.adr) && cfg.adr.length > 0 ? cfg.adr : null;
    return {
      deviceId: device.id,
      name: device.name,
      protocol: 'bacnet',
      deviceInstance: cfg.deviceInstance ?? 0,
      ip: device.ip,
      port: device.port,
      // Rota BACnet (device MS/TP atrás de roteador) — gateway usa NPDU DNET/DADR
      net,
      adr,
      pollingIntervalMs: cfg.pollingIntervalMs ?? DEFAULT_POLLING_MS,
      objects,
    };
  }
}
