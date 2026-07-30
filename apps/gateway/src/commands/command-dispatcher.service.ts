import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BacnetDiscoveryCommand, BacnetScanCommand } from '../bacnet/domain/interfaces/bacnet-discovery.interface';
import { BacnetWriteCommand } from '../bacnet/application/bacnet-write.service';
import { ModbusTestCommand } from '../modbus/modbus-connection.service';
import { ModbusWriteCommand } from '../modbus/modbus-write.service';
import { MqttSampleCommand, MqttWriteCommand } from '../mqtt-bridge/mqtt-bridge.service';
import { SnmpDiagnoseCommand } from '../snmp/snmp-diagnose.service';
import { SnmpScanCommand } from '../snmp/snmp-scan.service';
import { SnmpTestCommand } from '../snmp/snmp-test.service';
import { OnvifProbeCommand } from '../onvif/onvif-probe.service';
import { OnvifScanCommand } from '../onvif/onvif-discovery.service';
import { OtaUpdateCommand } from '../ota/ota-update.service';

/**
 * Payload de comando recebido via MQTT.
 *
 * Tópico de entrada:
 *   bluebee/{tenantId}/gateway/{gatewayId}/commands
 */
interface GatewayCommand {
  command_id: string;
  tenant_id: string;
  device_id: string;
  gateway_id?: string;
  protocol: 'bacnet' | 'modbus' | 'mqtt' | 'snmp' | 'onvif' | 'system';
  action: string;
  params: Record<string, unknown>;
}

/**
 * CommandDispatcherService
 *
 * Recebe mensagens MQTT do tópico de comandos (via evento 'mqtt.message')
 * e as roteia para o handler correto por protocolo e action.
 *
 * Roteamento atual:
 *   protocol=bacnet + action=scan     → emite 'command.bacnet.scan'
 *     → BacnetNetworkDiscoveryService.handleScanCommand()
 *   protocol=bacnet + action=discover → emite 'command.bacnet.discover'
 *     → BacnetDiscoveryService.handleDiscoveryCommand()
 */
@Injectable()
export class CommandDispatcherService {
  private readonly logger = new Logger(CommandDispatcherService.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  @OnEvent('mqtt.message')
  handleMqttMessage(event: { topic: string; message: Record<string, unknown> }): void {
    const { topic, message } = event;

    // Filtra apenas tópicos de comandos do gateway
    if (!topic.includes('/commands')) {
      return;
    }

    if (!this.isValidCommand(message)) {
      this.logger.warn(`Comando inválido recebido em ${topic}: campos obrigatórios ausentes`);
      return;
    }

    const command = message as unknown as GatewayCommand;

    this.logger.log(
      `Comando recebido — protocol=${command.protocol} action=${command.action} ` +
        `command_id=${command.command_id}`,
    );

    this.dispatch(command, topic);
  }

  private dispatch(command: GatewayCommand, topic: string): void {
    if (command.protocol === 'bacnet') {
      this.dispatchBacnet(command, topic);
      return;
    }

    if (command.protocol === 'modbus') {
      this.dispatchModbus(command, topic);
      return;
    }

    if (command.protocol === 'mqtt') {
      this.dispatchMqtt(command, topic);
      return;
    }

    if (command.protocol === 'snmp') {
      this.dispatchSnmp(command, topic);
      return;
    }

    if (command.protocol === 'onvif') {
      this.dispatchOnvif(command, topic);
      return;
    }

    if (command.protocol === 'system') {
      this.dispatchSystem(command, topic);
      return;
    }

    this.logger.warn(`Protocolo desconhecido: ${command.protocol}`);
  }

  /** Comandos de sistema do gateway (atualização OTA). */
  private dispatchSystem(command: GatewayCommand, topic: string): void {
    if (command.action === 'ota_update') {
      const gatewayId = command.gateway_id ?? this.extractGatewayId(topic);
      const updateCommand: OtaUpdateCommand = {
        command_id: command.command_id,
        tenant_id: command.tenant_id,
        gateway_id: gatewayId,
        version: String(command.params.version ?? ''),
        checksum: String(command.params.checksum ?? ''),
        url: String(command.params.url ?? ''),
      };
      if (!updateCommand.version || !updateCommand.checksum || !updateCommand.url) {
        this.logger.error(
          `Comando system.ota_update incompleto — command_id=${command.command_id}`,
        );
        return;
      }
      this.eventEmitter.emit('command.ota.update', updateCommand);
      return;
    }

    this.logger.warn(`Action de sistema desconhecida: ${command.action}`);
  }

  private dispatchSnmp(command: GatewayCommand, topic: string): void {
    if (command.action === 'scan') {
      const gatewayId = command.gateway_id ?? this.extractGatewayId(topic);
      const scanCommand: SnmpScanCommand = {
        command_id: command.command_id,
        tenant_id: command.tenant_id,
        gateway_id: gatewayId,
        ipStart: String(command.params.ipStart ?? ''),
        ipEnd: String(command.params.ipEnd ?? ''),
        snmpVersion: command.params.snmpVersion === '1' ? '1' : '2c',
        communities: Array.isArray(command.params.communities)
          ? (command.params.communities as unknown[]).map(String)
          : [String(command.params.community ?? 'public')],
        port: Number(command.params.port ?? 161),
      };
      if (!scanCommand.ipStart || !scanCommand.ipEnd) {
        this.logger.error(
          `Comando snmp.scan sem range de IP — command_id=${command.command_id}`,
        );
        return;
      }
      this.eventEmitter.emit('command.snmp.scan', scanCommand);
      return;
    }

    if (command.action === 'test') {
      const gatewayId = command.gateway_id ?? this.extractGatewayId(topic);
      const rawOids = command.params.oids;
      const oids: Record<string, string> = {};
      if (rawOids && typeof rawOids === 'object') {
        for (const [metric, oid] of Object.entries(rawOids as Record<string, unknown>)) {
          if (typeof oid === 'string' && oid.trim()) {
            oids[metric] = oid.trim();
          }
        }
      }
      const testCommand: SnmpTestCommand = {
        command_id: command.command_id,
        tenant_id: command.tenant_id,
        gateway_id: gatewayId,
        ip: String(command.params.ip ?? ''),
        port: Number(command.params.port ?? 161),
        snmpVersion: command.params.snmpVersion === '1' ? '1' : '2c',
        community: String(command.params.community ?? 'public'),
        oids,
      };
      if (!testCommand.ip) {
        this.logger.error(
          `Comando snmp.test sem IP — command_id=${command.command_id}`,
        );
        return;
      }
      this.eventEmitter.emit('command.snmp.test', testCommand);
      return;
    }

    if (command.action === 'diagnose') {
      const gatewayId = command.gateway_id ?? this.extractGatewayId(topic);
      const parseProbes = (raw: unknown): Array<{ metric: string; oid: string }> => {
        if (!Array.isArray(raw)) return [];
        return (raw as unknown[])
          .map((p) => {
            const o = p as Record<string, unknown>;
            return {
              metric: String(o?.metric ?? ''),
              oid: typeof o?.oid === 'string' ? o.oid.trim() : '',
            };
          })
          .filter((p) => p.metric && p.oid);
      };
      const diagnoseCommand: SnmpDiagnoseCommand = {
        command_id: command.command_id,
        tenant_id: command.tenant_id,
        gateway_id: gatewayId,
        ip: String(command.params.ip ?? ''),
        port: Number(command.params.port ?? 161),
        snmpVersion: command.params.snmpVersion === '1' ? '1' : '2c',
        community: String(command.params.community ?? 'public'),
        current: parseProbes(command.params.current),
        candidates: parseProbes(command.params.candidates),
      };
      if (!diagnoseCommand.ip) {
        this.logger.error(
          `Comando snmp.diagnose sem IP — command_id=${command.command_id}`,
        );
        return;
      }
      this.eventEmitter.emit('command.snmp.diagnose', diagnoseCommand);
      return;
    }

    this.logger.warn(`Action SNMP desconhecida: ${command.action}`);
  }

  private dispatchOnvif(command: GatewayCommand, topic: string): void {
    if (command.action === 'probe') {
      const gatewayId = command.gateway_id ?? this.extractGatewayId(topic);
      const probeCommand: OnvifProbeCommand = {
        command_id: command.command_id,
        tenant_id: command.tenant_id,
        gateway_id: gatewayId,
        ip: String(command.params.ip ?? ''),
        port: Number(command.params.port ?? 80),
        username: String(command.params.username ?? ''),
        password: String(command.params.password ?? ''),
      };
      if (!probeCommand.ip || !probeCommand.username) {
        this.logger.error(
          `Comando onvif.probe sem IP/usuário — command_id=${command.command_id}`,
        );
        return;
      }
      this.eventEmitter.emit('command.onvif.probe', probeCommand);
      return;
    }

    if (command.action === 'scan') {
      const gatewayId = command.gateway_id ?? this.extractGatewayId(topic);
      const scanCommand: OnvifScanCommand = {
        command_id: command.command_id,
        tenant_id: command.tenant_id,
        gateway_id: gatewayId,
        // IPs opcionais para sondagem unicast direta (além do multicast).
        targets: Array.isArray(command.params.targets)
          ? (command.params.targets as unknown[]).map(String)
          : undefined,
      };
      this.eventEmitter.emit('command.onvif.scan', scanCommand);
      return;
    }

    this.logger.warn(`Action ONVIF desconhecida: ${command.action}`);
  }

  private dispatchMqtt(command: GatewayCommand, topic: string): void {
    if (command.action === 'sample') {
      const gatewayId = command.gateway_id ?? this.extractGatewayId(topic);
      const sampleCommand: MqttSampleCommand = {
        command_id: command.command_id,
        tenant_id: command.tenant_id,
        gateway_id: gatewayId,
        topic: String(command.params.topic ?? ''),
      };
      if (!sampleCommand.topic) {
        this.logger.error(`Comando mqtt.sample sem tópico — command_id=${command.command_id}`);
        return;
      }
      this.eventEmitter.emit('command.mqtt.sample', sampleCommand);
      return;
    }

    if (command.action === 'write') {
      const gatewayId = command.gateway_id ?? this.extractGatewayId(topic);
      const writeCommand: MqttWriteCommand = {
        command_id: command.command_id,
        tenant_id: command.tenant_id,
        gateway_id: gatewayId,
        commandTopic: String(command.params.commandTopic ?? ''),
        payload: String(command.params.payload ?? ''),
        responseTopic:
          typeof command.params.responseTopic === 'string' && command.params.responseTopic
            ? command.params.responseTopic
            : null,
        matchId:
          command.params.matchId !== undefined && command.params.matchId !== null
            ? Number(command.params.matchId)
            : null,
        confirm: this.parseWriteConfirm(command.params.confirm),
      };
      if (!writeCommand.commandTopic || !writeCommand.payload) {
        this.logger.error(
          `Comando mqtt.write sem tópico/payload — command_id=${command.command_id}`,
        );
        return;
      }
      this.eventEmitter.emit('command.mqtt.write', writeCommand);
      return;
    }

    this.logger.warn(`Action MQTT desconhecida: ${command.action}`);
  }

  private dispatchModbus(command: GatewayCommand, topic: string): void {
    if (command.action === 'test') {
      const gatewayId = command.gateway_id ?? this.extractGatewayId(topic);

      const isRtu = command.params.connectionType === 'rtu';
      const serialRaw = (command.params.serial ?? null) as {
        path?: unknown; baudRate?: unknown; parity?: unknown; dataBits?: unknown; stopBits?: unknown;
      } | null;

      const testCommand: ModbusTestCommand = {
        command_id: command.command_id,
        tenant_id: command.tenant_id,
        gateway_id: gatewayId,
        connectionType: isRtu ? 'rtu' : 'tcp',
        ip: String(command.params.ip ?? ''),
        port: Number(command.params.port ?? 502),
        unitId: Number(command.params.unitId ?? 1),
        ...(isRtu && serialRaw
          ? {
              serial: {
                path: String(serialRaw.path ?? ''),
                baudRate: Number(serialRaw.baudRate ?? 9600),
                parity: (['none', 'even', 'odd'].includes(String(serialRaw.parity))
                  ? String(serialRaw.parity)
                  : 'none') as 'none' | 'even' | 'odd',
                dataBits: (Number(serialRaw.dataBits) === 7 ? 7 : 8) as 7 | 8,
                stopBits: (Number(serialRaw.stopBits) === 2 ? 2 : 1) as 1 | 2,
              },
            }
          : {}),
      };

      if (isRtu ? !testCommand.serial?.path : !testCommand.ip) {
        this.logger.error(
          `Comando modbus.test sem ${isRtu ? 'porta serial' : 'IP'} — command_id=${command.command_id}`,
        );
        return;
      }

      this.eventEmitter.emit('command.modbus.test', testCommand);
      return;
    }

    if (command.action === 'write') {
      const gatewayId = command.gateway_id ?? this.extractGatewayId(topic);

      const isRtu = command.params.connectionType === 'rtu';
      const serialRaw = (command.params.serial ?? null) as {
        path?: unknown; baudRate?: unknown; parity?: unknown; dataBits?: unknown; stopBits?: unknown;
      } | null;

      const registerType = String(command.params.registerType ?? '');
      if (registerType !== 'holding' && registerType !== 'coil') {
        this.logger.warn(
          `Comando modbus.write com registerType não escrevível: ${registerType}`,
        );
        return;
      }
      const dataType = String(command.params.dataType ?? 'uint16');

      const writeCommand: ModbusWriteCommand = {
        command_id: command.command_id,
        tenant_id: command.tenant_id,
        gateway_id: gatewayId,
        device_id: command.device_id,
        connectionType: isRtu ? 'rtu' : 'tcp',
        ip: String(command.params.ip ?? ''),
        port: Number(command.params.port ?? 502),
        unitId: Number(command.params.unitId ?? 1),
        ...(isRtu && serialRaw
          ? {
              serial: {
                path: String(serialRaw.path ?? ''),
                baudRate: Number(serialRaw.baudRate ?? 9600),
                parity: (['none', 'even', 'odd'].includes(String(serialRaw.parity))
                  ? String(serialRaw.parity)
                  : 'none') as 'none' | 'even' | 'odd',
                dataBits: (Number(serialRaw.dataBits) === 7 ? 7 : 8) as 7 | 8,
                stopBits: (Number(serialRaw.stopBits) === 2 ? 2 : 1) as 1 | 2,
              },
            }
          : {}),
        register: Number(command.params.register ?? 0),
        registerType,
        dataType: (['int16', 'uint16', 'int32', 'uint32', 'float32'].includes(dataType)
          ? dataType
          : 'uint16') as ModbusWriteCommand['dataType'],
        endianness: command.params.endianness === 'little' ? 'little' : 'big',
        scale: Number(command.params.scale ?? 1),
        offset: Number(command.params.offset ?? 0),
        value: Number(command.params.value ?? 0),
        tag: String(command.params.tag ?? ''),
        unit: command.params.unit != null ? String(command.params.unit) : null,
      };

      this.eventEmitter.emit('command.modbus.write', writeCommand);
      return;
    }

    this.logger.warn(`Action Modbus desconhecida: ${command.action}`);
  }

  private dispatchBacnet(command: GatewayCommand, topic: string): void {
    if (command.action === 'scan') {
      const gatewayId = command.gateway_id ?? this.extractGatewayId(topic);

      const scanCommand: BacnetScanCommand = {
        command_id: command.command_id,
        tenant_id: command.tenant_id,
        gateway_id: gatewayId,
      };

      this.eventEmitter.emit('command.bacnet.scan', scanCommand);
      return;
    }

    if (command.action === 'discover') {
      const gatewayId = command.gateway_id ?? this.extractGatewayId(topic);

      const discoveryCommand: BacnetDiscoveryCommand = {
        command_id: command.command_id,
        tenant_id: command.tenant_id,
        gateway_id: gatewayId,
        ip: String(command.params.ip ?? ''),
        port: Number(command.params.port ?? 47808),
        deviceInstance: command.params.deviceInstance !== undefined
          ? Number(command.params.deviceInstance)
          : undefined,
        net: this.parseNet(command.params.net),
        adr: this.parseAdr(command.params.adr),
      };

      if (!discoveryCommand.ip) {
        this.logger.error(
          `Comando bacnet.discover sem IP — command_id=${command.command_id}`,
        );
        return;
      }

      this.eventEmitter.emit('command.bacnet.discover', discoveryCommand);
      return;
    }

    if (command.action === 'write') {
      const gatewayId = command.gateway_id ?? this.extractGatewayId(topic);

      const writeCommand: BacnetWriteCommand = {
        command_id: command.command_id,
        tenant_id: command.tenant_id,
        gateway_id: gatewayId,
        ip: String(command.params.ip ?? ''),
        port: Number(command.params.port ?? 47808),
        net: this.parseNet(command.params.net),
        adr: this.parseAdr(command.params.adr),
        objectType: Number(command.params.objectType ?? 0),
        objectInstance: Number(command.params.objectInstance ?? 0),
        value: Number(command.params.value ?? 0),
        priority: command.params.priority !== undefined
          ? Number(command.params.priority)
          : undefined,
      };

      if (!writeCommand.ip) {
        this.logger.error(
          `Comando bacnet.write sem IP — command_id=${command.command_id}`,
        );
        return;
      }

      this.eventEmitter.emit('command.bacnet.write', writeCommand);
      return;
    }

    this.logger.warn(`Action BACnet desconhecida: ${command.action}`);
  }

  /**
   * Contexto do ponto comandado para a telemetria confirmada pós-escrita MQTT.
   * Opcional: comandos antigos (backend anterior) simplesmente não o trazem.
   */
  private parseWriteConfirm(
    raw: unknown,
  ): { deviceId: string; tag: string; value: number; unit: string | null } | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const deviceId = typeof o.deviceId === 'string' ? o.deviceId : '';
    const tag = typeof o.tag === 'string' ? o.tag : '';
    const value = Number(o.value);
    if (!deviceId || !tag || !Number.isFinite(value)) return null;
    return {
      deviceId,
      tag,
      value,
      unit: typeof o.unit === 'string' && o.unit ? o.unit : null,
    };
  }

  /** Rede BACnet remota (DNET) — válida quando número > 0. */
  private parseNet(raw: unknown): number | null {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  /** MAC remoto (DADR) — array de bytes não-vazio. */
  private parseAdr(raw: unknown): number[] | null {
    if (!Array.isArray(raw) || raw.length === 0) {
      return null;
    }
    const bytes = raw.map((b) => Number(b));
    return bytes.every((b) => Number.isFinite(b) && b >= 0 && b <= 255)
      ? bytes
      : null;
  }

  /**
   * Extrai o gateway_id do tópico MQTT caso não venha no payload.
   * Formato do tópico: bluebee/{tenantId}/gateway/{gatewayId}/commands
   */
  private extractGatewayId(topic: string): string {
    const parts = topic.split('/');
    const gatewayIndex = parts.indexOf('gateway');
    if (gatewayIndex !== -1 && parts[gatewayIndex + 1]) {
      return parts[gatewayIndex + 1];
    }
    return 'unknown';
  }

  private isValidCommand(message: Record<string, unknown>): boolean {
    return (
      typeof message.command_id === 'string' &&
      typeof message.tenant_id === 'string' &&
      typeof message.protocol === 'string' &&
      typeof message.action === 'string' &&
      typeof message.params === 'object' &&
      message.params !== null
    );
  }
}
