import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MqttService } from '../../mqtt/mqtt.service.js';
import type {
  MqttSampleResult,
  MqttSampleSuccess,
  SampleMqttTopicDto,
} from '../domain/dtos/sample-mqtt.dto.js';

/**
 * Timeout do lado backend aguardando a resposta do gateway. Deve ser maior que
 * a janela de escuta do gateway (que captura mensagens por alguns segundos).
 */
const SAMPLE_TIMEOUT_MS = 15_000;

interface PendingSample {
  resolve: (result: MqttSampleSuccess) => void;
  reject: (err: Error) => void;
}

interface SampleResultPayload {
  command_id: string;
  success: boolean;
  samples?: MqttSampleSuccess['samples'];
  error?: string;
}

/**
 * MqttSampleService
 *
 * Pede ao gateway para "escutar" um tópico MQTT-nativo por alguns segundos e
 * devolver uma amostra do payload. Usado na tela de cadastro de dispositivo MQTT
 * para o usuário (1) confirmar que o equipamento está publicando e (2) ver a
 * estrutura do payload e escolher o jsonPath correto.
 *
 * Fluxo (espelha o test-connection do Modbus):
 *   1. Backend publica comando em .../commands (protocol=mqtt, action=sample)
 *   2. Gateway assina o tópico no broker, captura mensagens por alguns segundos
 *   3. Gateway publica resultado em .../mqtt/sample-result
 */
@Injectable()
export class MqttSampleService implements OnModuleInit {
  private readonly logger = new Logger(MqttSampleService.name);

  private readonly pending = new Map<string, PendingSample>();

  constructor(private readonly mqttService: MqttService) {}

  onModuleInit(): void {
    this.mqttService.subscribe('bluebee/+/gateway/+/mqtt/sample-result', 0);
    this.mqttService.onMessage((topic: string, rawPayload: Buffer) => {
      if (!topic.endsWith('/mqtt/sample-result')) {
        return;
      }
      this.handleResult(rawPayload);
    });
  }

  async sampleTopic(dto: SampleMqttTopicDto): Promise<MqttSampleResult> {
    const commandId = randomUUID();
    const commandTopic = `bluebee/${dto.tenantId}/gateway/${dto.gatewayId}/commands`;

    const commandPayload = {
      command_id: commandId,
      tenant_id: dto.tenantId,
      device_id: 'mqtt-sample',
      protocol: 'mqtt',
      action: 'sample',
      params: { topic: dto.topic },
    };

    this.logger.log(`Publicando amostra MQTT ${commandId} para o tópico "${dto.topic}"`);

    try {
      await this.mqttService.publish(commandTopic, commandPayload, 1);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      return { success: false, error: `Falha ao publicar comando MQTT: ${msg}` };
    }

    return new Promise<MqttSampleResult>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        if (this.pending.has(commandId)) {
          this.pending.delete(commandId);
          resolve({
            success: false,
            error: `Timeout — o gateway não respondeu em ${SAMPLE_TIMEOUT_MS / 1000}s. ` +
              'Verifique se o gateway está online.',
          });
        }
      }, SAMPLE_TIMEOUT_MS);

      this.pending.set(commandId, {
        resolve: (result: MqttSampleSuccess) => {
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

  private handleResult(rawPayload: Buffer): void {
    let payload: SampleResultPayload;
    try {
      payload = JSON.parse(rawPayload.toString()) as SampleResultPayload;
    } catch {
      this.logger.error('Falha ao parsear resultado da amostra MQTT');
      return;
    }

    const pending = payload.command_id ? this.pending.get(payload.command_id) : undefined;
    if (!pending) {
      return;
    }
    this.pending.delete(payload.command_id);

    if (payload.success) {
      pending.resolve({
        success: true,
        command_id: payload.command_id,
        samples: payload.samples ?? [],
      });
    } else {
      pending.reject(new Error(payload.error ?? 'O gateway não conseguiu capturar amostra'));
    }
  }
}
