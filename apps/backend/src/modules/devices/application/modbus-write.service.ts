import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MqttService } from '../../mqtt/mqtt.service.js';
import type {
  ModbusWriteResult,
  ModbusWriteSuccess,
} from '../domain/dtos/write-modbus.dto.js';

/**
 * Timeout do backend aguardando o resultado do gateway (tópico
 * .../commands/result). O gateway pode gastar até ~12s numa escrita RTU
 * enfileirada (fila serial + releitura); 20s é o teto para broker/gateway
 * indisponível — mesmo racional dos writes BACnet/MQTT.
 */
const WRITE_TIMEOUT_MS = 20_000;

interface PendingWrite {
  resolve: (result: ModbusWriteSuccess) => void;
  reject: (err: Error) => void;
}

interface WriteResultPayload {
  command_id: string;
  success: boolean;
  error?: string;
}

/** Parâmetros já resolvidos (binding + config lidos do banco pelo controller). */
export interface ModbusWriteRequest {
  tenantId: string;
  gatewayId: string;
  deviceId: string;
  /** 'tcp' (rede) ou 'rtu' (serial RS485). */
  connectionType: 'tcp' | 'rtu';
  ip: string;
  port: number;
  unitId: number;
  /** Parâmetros da porta serial — só no modo RTU. */
  serial?: {
    path: string;
    baudRate: number;
    parity: 'none' | 'even' | 'odd';
    dataBits: 7 | 8;
    stopBits: 1 | 2;
  };
  /** Binding do registrador (do cadastro do ponto). */
  register: number;
  registerType: 'holding' | 'coil';
  dataType: 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32';
  endianness: 'big' | 'little';
  scale: number;
  offset: number;
  /** Valor em unidade de engenharia. */
  value: number;
  /** Tag/unidade do ponto — o gateway publica a telemetria confirmada pós-escrita. */
  pointTag: string;
  pointUnit: string | null;
}

/**
 * ModbusWriteService
 *
 * Escrita de pontos Modbus (holding register / coil) seguindo o mesmo padrão
 * maduro dos writes BACnet/MQTT: command_id UUID, mapa de pendências
 * registrado ANTES do publish (evita a corrida QoS2 conhecida), timeout de 20s
 * e resultado vindo do gateway em bluebee/+/gateway/+/commands/result.
 */
@Injectable()
export class ModbusWriteService implements OnModuleInit {
  private readonly logger = new Logger(ModbusWriteService.name);

  private readonly pendingWrites = new Map<string, PendingWrite>();

  constructor(private readonly mqttService: MqttService) {}

  onModuleInit(): void {
    // Assinatura idempotente no broker (BACnet/MQTT writes assinam o mesmo
    // padrão) — cada serviço filtra pelo próprio command_id.
    this.mqttService.subscribe('bluebee/+/gateway/+/commands/result', 0);

    this.mqttService.onMessage((topic: string, rawPayload: Buffer) => {
      if (!topic.endsWith('/commands/result')) {
        return;
      }
      this.handleWriteResult(rawPayload);
    });
  }

  async writeModbus(req: ModbusWriteRequest): Promise<ModbusWriteResult> {
    if (!req.tenantId || req.tenantId.trim() === '') {
      return { success: false, error: 'tenantId é obrigatório' };
    }

    // UUID (não Date.now()) para evitar colisão de command_id sob concorrência.
    const commandId = `modbus-write-${randomUUID()}`;
    const commandTopic = `bluebee/${req.tenantId}/gateway/${req.gatewayId}/commands`;

    // Envelope padrão do gateway (CommandDispatcherService): protocol + action + params.
    const commandPayload = {
      command_id: commandId,
      tenant_id: req.tenantId,
      gateway_id: req.gatewayId,
      device_id: req.deviceId,
      protocol: 'modbus',
      action: 'write',
      params: {
        connectionType: req.connectionType,
        ip: req.ip,
        port: req.port,
        unitId: req.unitId,
        ...(req.connectionType === 'rtu' && req.serial ? { serial: req.serial } : {}),
        register: req.register,
        registerType: req.registerType,
        dataType: req.dataType,
        endianness: req.endianness,
        scale: req.scale,
        offset: req.offset,
        value: req.value,
        // Contexto para o gateway publicar a telemetria confirmada pós-escrita
        // (payload idêntico ao do polling).
        tag: req.pointTag,
        unit: req.pointUnit,
      },
    };

    this.logger.log(
      `Publicando comando de escrita Modbus ${commandId} → device ${req.deviceId} ` +
        `${req.registerType} reg ${req.register} value=${req.value} ` +
        `(${req.connectionType})`,
    );

    // IMPORTANTE: registra o pending ANTES de publicar — com QoS 2 o handshake
    // do publish pode demorar mais que o resultado do gateway (corrida conhecida
    // do fluxo BACnet; registrar antes elimina o timeout falso de 20s).
    return new Promise<ModbusWriteResult>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        if (this.pendingWrites.has(commandId)) {
          this.pendingWrites.delete(commandId);
          this.logger.warn(
            `Timeout do write Modbus ${commandId} (gateway: ${req.gatewayId})`,
          );
          resolve({
            success: false,
            error: 'Timeout - gateway nao respondeu em 20s',
          });
        }
      }, WRITE_TIMEOUT_MS);

      this.pendingWrites.set(commandId, {
        resolve: (result: ModbusWriteSuccess) => {
          clearTimeout(timeoutHandle);
          resolve(result);
        },
        reject: (err: Error) => {
          clearTimeout(timeoutHandle);
          resolve({ success: false, error: err.message });
        },
      });

      // Publica DEPOIS de registrar o pending; falha de publish encerra na hora.
      this.mqttService.publish(commandTopic, commandPayload, 2).catch((err: unknown) => {
        const pending = this.pendingWrites.get(commandId);
        if (pending) {
          this.pendingWrites.delete(commandId);
          clearTimeout(timeoutHandle);
          this.logger.error(
            `Falha ao publicar comando de escrita Modbus ${commandId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          resolve({
            success: false,
            error: 'Falha ao publicar o comando no broker MQTT',
          });
        }
      });
    });
  }

  private handleWriteResult(rawPayload: Buffer): void {
    let payload: WriteResultPayload;

    try {
      payload = JSON.parse(rawPayload.toString()) as WriteResultPayload;
    } catch {
      // Payload não-JSON no tópico de resultados — outro consumidor loga.
      return;
    }

    const { command_id } = payload;
    if (!command_id) return;

    const pending = this.pendingWrites.get(command_id);
    if (!pending) {
      // Já expirou ou é resultado de outro tipo de comando — ignora.
      return;
    }

    this.pendingWrites.delete(command_id);

    if (payload.success) {
      pending.resolve({ success: true, command_id });
    } else {
      pending.reject(new Error(payload.error ?? 'Gateway reportou falha no write'));
    }
  }
}
