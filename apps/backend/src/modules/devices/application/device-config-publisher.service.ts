import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EXCLUDE_VIRTUAL_DEVICES } from '../../prisma/device-filters.js';
import { decryptCameraSecret } from './camera-credentials.util.js';
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
  /** Fator de escala aplicado ao valor cru (ex.: 0.01 p/ sysUpTime → segundos). */
  scale?: number;
  /** OID comprovadamente não suportado pela câmera (diagnóstico) — fora do GET. */
  unsupported?: boolean;
}

/** Config SNMP do device persistida em Device.config (câmeras CFTV). */
interface SnmpDeviceConfig {
  snmpVersion?: '1' | '2c';
  community?: string;
  rtspUrl?: string | null;
  pollingIntervalMs?: number;
  /** Fabricante do cadastro (identificação de provider no gateway). */
  manufacturer?: string | null;
  /**
   * Credenciais HTTP opcionais p/ fallback proprietário (ex.: ISAPI Hikvision
   * em câmera SNMP). Senha cifrada — decifrada só ao publicar ao gateway.
   */
  isapi?: { username?: string; passwordEnc?: string; port?: number } | null;
}

/** Porta SNMP padrão. */
const DEFAULT_SNMP_PORT = 161;

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
  async onApplicationBootstrap(): Promise<void> {
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
      include: { points: { orderBy: [{ instance: 'asc' }, { tag: 'asc' }] } },
    });

    const payload = {
      tenantId,
      gatewayId,
      devices: devices.map((d) => this.buildDeviceBlock(d)),
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
   * Monta o bloco de config de um device conforme o protocolo. O gateway roteia
   * cada bloco pelo campo `protocol` para o serviço correspondente
   * (BacnetPolling / ModbusPolling / MqttBridge).
   */
  private buildDeviceBlock(
    device: { id: string; name: string; protocol: string; ip: string; port: number; config: unknown; points: Array<{ tag: string; objectType: string; instance: number; unit: string | null; binding: unknown }> },
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
      const points = device.points.map((p) => {
        const b = (p.binding ?? {}) as SnmpBinding;
        return {
          tag: p.tag,
          metric: b.metric ?? 'custom',
          oid: b.oid ?? null,
          scale: b.scale ?? 1,
          unit: p.unit ?? null,
          // OID marcado como não suportado sai do GET em lote do gateway —
          // em SNMP v1, um único OID inválido derruba a requisição inteira.
          ...(b.unsupported ? { unsupported: true } : {}),
        };
      });
      return {
        deviceId: device.id,
        name: device.name,
        protocol: 'snmp',
        ip: device.ip,
        port: device.port || DEFAULT_SNMP_PORT,
        snmpVersion: cfg.snmpVersion ?? '2c',
        community: cfg.community ?? 'public',
        pollingIntervalMs: cfg.pollingIntervalMs ?? DEFAULT_POLLING_MS,
        // Fabricante manual do cadastro — precedência máxima na identificação
        // de provider do gateway (Hikvision/Dahua/Intelbras…).
        manufacturer: cfg.manufacturer ?? null,
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
