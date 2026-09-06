import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MqttService } from '../../mqtt/mqtt.service.js';
import type {
  ModbusConnectionResult,
  ModbusConnectionSuccess,
  TestModbusConnectionDto,
} from '../domain/dtos/test-modbus.dto.js';

/** Timeout do lado backend aguardando a resposta do gateway ao teste de conexão. */
const TEST_TIMEOUT_MS = 12_000;

interface PendingTest {
  resolve: (result: ModbusConnectionSuccess) => void;
  reject: (err: Error) => void;
}

interface TestResultPayload {
  command_id: string;
  success: boolean;
  error?: string;
}

/**
 * ModbusConnectionService
 *
 * Dispara um teste de conexão Modbus TCP no gateway e aguarda o resultado.
 * Usado na tela de adicionar dispositivo Modbus para validar a comunicação
 * com o equipamento ANTES de liberar o cadastro de registradores.
 *
 * Fluxo (espelha o scan BACnet):
 *   1. Backend publica comando em .../commands (protocol=modbus, action=test)
 *   2. Gateway tenta abrir o socket Modbus TCP no equipamento
 *   3. Gateway publica resultado em .../modbus/test-result
 */
@Injectable()
export class ModbusConnectionService implements OnModuleInit {
  private readonly logger = new Logger(ModbusConnectionService.name);

  /** Maps command_id → handlers da Promise pendente. */
  private readonly pendingTests = new Map<string, PendingTest>();

  constructor(private readonly mqttService: MqttService) {}

  onModuleInit(): void {
    this.mqttService.subscribe('bluebee/+/gateway/+/modbus/test-result', 0);
    this.mqttService.onMessage((topic: string, rawPayload: Buffer) => {
      if (!topic.endsWith('/modbus/test-result')) {
        return;
      }
      this.handleTestResult(rawPayload);
    });
  }

  async testConnection(dto: TestModbusConnectionDto): Promise<ModbusConnectionResult> {
    const commandId = randomUUID();
    const commandTopic = `bluebee/${dto.tenantId}/gateway/${dto.gatewayId}/commands`;

    const commandPayload = {
      command_id: commandId,
      tenant_id: dto.tenantId,
      device_id: 'modbus-test',
      protocol: 'modbus',
      action: 'test',
      params: {
        connectionType: dto.connectionType ?? 'tcp',
        ip: dto.ip ?? '',
        port: dto.port ?? 502,
        unitId: dto.unitId,
        ...(dto.serial ? { serial: dto.serial } : {}),
      },
    };

    const target =
      dto.connectionType === 'rtu'
        ? `${dto.serial?.path} (serial RTU, unit ${dto.unitId})`
        : `${dto.ip}:${dto.port} (unit ${dto.unitId})`;
    this.logger.log(`Publicando teste de conexão Modbus ${commandId} → ${target}`);

    try {
      await this.mqttService.publish(commandTopic, commandPayload, 1);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      this.logger.error(`Falha ao publicar comando de teste Modbus: ${msg}`);
      return { success: false, error: `Falha ao publicar comando MQTT: ${msg}` };
    }

    return new Promise<ModbusConnectionResult>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        if (this.pendingTests.has(commandId)) {
          this.pendingTests.delete(commandId);
          this.logger.warn(`Timeout no teste Modbus ${commandId} (gateway: ${dto.gatewayId})`);
          resolve({
            success: false,
            error: `Timeout — o gateway não respondeu em ${TEST_TIMEOUT_MS / 1000}s. ` +
              'Verifique se o gateway está online.',
          });
        }
      }, TEST_TIMEOUT_MS);

      this.pendingTests.set(commandId, {
        resolve: (result: ModbusConnectionSuccess) => {
          clearTimeout(timeoutHandle);
          resolve(result);
        },
        reject: (err: Error) => {
          clearTimeout(timeoutHandle);
          resolve({ success: false, error: err.message });
        },
      });
    });
  }

  private handleTestResult(rawPayload: Buffer): void {
    let payload: TestResultPayload;
    try {
      payload = JSON.parse(rawPayload.toString()) as TestResultPayload;
    } catch {
      this.logger.error('Falha ao parsear resultado do teste Modbus');
      return;
    }

    const { command_id } = payload;
    if (!command_id) {
      return;
    }

    const pending = this.pendingTests.get(command_id);
    if (!pending) {
      return; // já expirou ou desconhecido
    }
    this.pendingTests.delete(command_id);

    if (payload.success) {
      pending.resolve({ success: true, command_id });
    } else {
      pending.reject(new Error(payload.error ?? 'O gateway não conseguiu conectar ao equipamento'));
    }
  }
}
