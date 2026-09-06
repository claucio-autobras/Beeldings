import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MqttService } from '../../mqtt/mqtt.service.js';
import type {
  WriteBacnetDto,
  BacnetWriteResult,
  BacnetWriteSuccess,
} from '../domain/dtos/write-bacnet.dto.js';

/**
 * Timeout do backend aguardando o resultado do gateway (tópico .../commands/result).
 *
 * O WriteProperty BACnet é um serviço CONFIRMADO: o gateway só publica o
 * resultado depois que o node-bacnet recebe (ou desiste de) o SimpleACK do
 * controlador. Com os defaults do node-bacnet (apduTimeout ~3s × até 3 retries),
 * o callback do write pode levar até ~12s — mesmo quando o relé já atuou, se o
 * primeiro ACK se perdeu na rede. Com o timeout antigo de 10s o backend desistia
 * ANTES de o gateway responder: descartava o pending, retornava timeout e
 * ignorava o resultado de sucesso que chegava logo depois — a UI mostrava
 * "gateway não respondeu a tempo" apesar do comando ter funcionado.
 *
 * Por isso este timeout precisa ser maior que o pior caso do gateway (~12s) com
 * margem para a latência do MQTT. O caminho feliz continua rápido (ACK em <1-2s);
 * 20s é apenas o teto para o caso de gateway/broker realmente indisponível.
 */
const WRITE_TIMEOUT_MS = 20_000;

interface PendingWrite {
  resolve: (result: BacnetWriteSuccess) => void;
  reject: (err: Error) => void;
}

interface WriteResultPayload {
  command_id: string;
  success: boolean;
  error?: string;
}

@Injectable()
export class BacnetWriteService implements OnModuleInit {
  private readonly logger = new Logger(BacnetWriteService.name);

  /**
   * Maps command_id → pending Promise handlers.
   * Allows the HTTP request to wait for the async MQTT response.
   */
  private readonly pendingWrites = new Map<string, PendingWrite>();

  constructor(private readonly mqttService: MqttService) {}

  onModuleInit(): void {
    // Subscribe to all command result topics: bluebee/+/gateway/+/commands/result
    this.mqttService.subscribe('bluebee/+/gateway/+/commands/result', 0);

    this.mqttService.onMessage((topic: string, rawPayload: Buffer) => {
      if (!topic.endsWith('/commands/result')) {
        return;
      }
      this.handleWriteResult(rawPayload);
    });
  }

  async writeBacnet(dto: WriteBacnetDto): Promise<BacnetWriteResult> {
    if (!dto.tenantId || dto.tenantId.trim() === '') {
      return { success: false, error: 'tenantId é obrigatório' };
    }

    // UUID (não Date.now()) para evitar colisão de command_id sob concorrência —
    // duas escritas no mesmo milissegundo sobrescreveriam o pendingWrites e
    // deixariam uma requisição pendurada. Mesmo padrão dos demais comandos.
    const commandId = `write-${randomUUID()}`;
    const commandTopic = `bluebee/${dto.tenantId}/gateway/${dto.gatewayId}/commands`;

    // Envelope padrão do gateway (CommandDispatcherService): protocol + action +
    // params. Os parâmetros vêm DENTRO de `params` — formato idêntico ao usado
    // por discover/scan/modbus-test. Sem isso o gateway rejeita como inválido.
    const commandPayload = {
      command_id: commandId,
      tenant_id: dto.tenantId,
      gateway_id: dto.gatewayId,
      device_id: 'bacnet-write',
      protocol: 'bacnet',
      action: 'write',
      params: {
        ip: dto.ip,
        port: dto.port,
        // Rota BACnet (device MS/TP atrás de roteador) — NPDU DNET/DADR.
        net: dto.net ?? null,
        adr: dto.adr ?? null,
        objectType: dto.objectType,
        objectInstance: dto.objectInstance,
        value: dto.value,
        priority: dto.priority ?? 8,
      },
    };

    this.logger.log(
      `Publishing BACnet write command ${commandId} to ${commandTopic} — ` +
        `objectType: ${dto.objectType}, objectInstance: ${dto.objectInstance}, value: ${String(dto.value)}`,
    );

    // IMPORTANTE: registramos o pending ANTES de publicar. Com QoS 2 para um
    // broker remoto, o callback do publish só resolve após o handshake completo
    // (PUBCOMP) — o que pode demorar MAIS que o resultado do gateway, que chega
    // quase imediatamente. Se o pending só fosse criado depois do await, o
    // resultado chegaria primeiro, handleWriteResult não acharia o pending e o
    // descartaria; a escrita então expirava em 20s SEMPRE, mesmo o gateway tendo
    // confirmado sucesso de imediato. Registrar antes de publicar elimina a corrida.
    return new Promise<BacnetWriteResult>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        if (this.pendingWrites.has(commandId)) {
          this.pendingWrites.delete(commandId);
          this.logger.warn(
            `Write timeout for command ${commandId} (gateway: ${dto.gatewayId})`,
          );
          resolve({
            success: false,
            error: 'Timeout - gateway nao respondeu em 20s',
          });
        }
      }, WRITE_TIMEOUT_MS);

      this.pendingWrites.set(commandId, {
        resolve: (result: BacnetWriteSuccess) => {
          clearTimeout(timeoutHandle);
          resolve(result);
        },
        reject: (err: Error) => {
          clearTimeout(timeoutHandle);
          resolve({ success: false, error: err.message });
        },
      });

      // Publica DEPOIS de registrar o pending. Se a publicação em si falhar,
      // encerramos o pending na hora em vez de pendurar a requisição por 20s.
      this.mqttService.publish(commandTopic, commandPayload, 2).catch((err: unknown) => {
        const pending = this.pendingWrites.get(commandId);
        if (pending) {
          this.pendingWrites.delete(commandId);
          clearTimeout(timeoutHandle);
          this.logger.error(
            `Falha ao publicar comando de escrita ${commandId}: ${
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
      this.logger.error('Failed to parse write result payload');
      return;
    }

    const { command_id } = payload;

    if (!command_id) {
      this.logger.warn('Write result missing command_id — ignoring');
      return;
    }

    const pending = this.pendingWrites.get(command_id);

    if (!pending) {
      // Already timed out or not a write command — safe to ignore
      return;
    }

    this.pendingWrites.delete(command_id);

    if (payload.success) {
      pending.resolve({ success: true, command_id });
    } else {
      pending.reject(
        new Error(payload.error ?? 'Gateway reportou falha no write'),
      );
    }
  }
}
