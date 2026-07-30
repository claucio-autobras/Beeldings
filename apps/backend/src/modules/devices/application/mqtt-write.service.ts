import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID, randomInt } from 'crypto';
import { MqttService } from '../../mqtt/mqtt.service.js';
import type {
  MqttWriteBinding,
  MqttWriteResult,
  MqttWriteSuccess,
} from '../domain/dtos/write-mqtt.dto.js';

/**
 * Timeout do backend aguardando o resultado do gateway (tópico .../commands/result).
 * Mesmo racional do write BACnet: o gateway pode demorar até ~10s aguardando a
 * confirmação RPC do dispositivo; 20s é o teto para broker/gateway indisponível.
 */
const WRITE_TIMEOUT_MS = 20_000;

interface PendingWrite {
  resolve: (result: MqttWriteSuccess) => void;
  reject: (err: Error) => void;
}

interface WriteResultPayload {
  command_id: string;
  success: boolean;
  error?: string;
  /** true quando o gateway confirmou via tópico de resposta (RPC). */
  confirmed?: boolean;
}

/** Parâmetros já resolvidos (binding lido do banco pelo controller). */
export interface MqttWriteRequest {
  tenantId: string;
  gatewayId: string;
  deviceId: string;
  write: MqttWriteBinding;
  valueType: 'number' | 'boolean';
  value: number | boolean;
  /** Tag do ponto comandado — usada pelo gateway para publicar a telemetria confirmada pós-escrita. */
  pointTag: string;
  /** Unidade do ponto (mesma da telemetria de polling). */
  pointUnit: string | null;
  /**
   * Prefixo de escopo permitido para os tópicos de comando/resposta — o
   * namespace de sensores do gateway (modo prefixo) OU `{rootTopic}/` (modo
   * tópico raiz próprio). Resolvido pelo mqtt-write-target.util a partir da
   * config do device no banco.
   */
  topicScope: string;
}

/**
 * MqttWriteService
 *
 * Escrita de pontos MQTT-nativos (ex.: relé Shelly Gen4) seguindo o mesmo
 * padrão maduro do BacnetWriteService: command_id UUID, mapa de pendências
 * registrado ANTES do publish (evita a corrida QoS2 conhecida), timeout de 20s
 * e resultado vindo do gateway em bluebee/+/gateway/+/commands/result.
 *
 * O backend renderiza o payload a partir do template do binding — placeholders
 * `{{value}}` (JSON conforme valueType) e `{{id}}` (id numérico de RPC gerado
 * aqui, repassado ao gateway para casar a resposta do dispositivo).
 */
@Injectable()
export class MqttWriteService implements OnModuleInit {
  private readonly logger = new Logger(MqttWriteService.name);

  private readonly pendingWrites = new Map<string, PendingWrite>();

  constructor(private readonly mqttService: MqttService) {}

  onModuleInit(): void {
    // A assinatura do tópico de resultados é idempotente no broker (o
    // BacnetWriteService assina o mesmo padrão) — cada serviço filtra pelo
    // próprio command_id no mapa de pendências.
    this.mqttService.subscribe('bluebee/+/gateway/+/commands/result', 0);

    this.mqttService.onMessage((topic: string, rawPayload: Buffer) => {
      if (!topic.endsWith('/commands/result')) {
        return;
      }
      this.handleWriteResult(rawPayload);
    });
  }

  /**
   * Renderiza o template do payload substituindo os placeholders.
   * Retorna também o rpcId gerado (quando o template usa `{{id}}`) para o
   * gateway casar a resposta RPC.
   */
  renderPayload(
    template: string,
    value: number | boolean,
    valueType: 'number' | 'boolean',
  ): { payload: string; rpcId: number | null } {
    const jsonValue =
      valueType === 'boolean'
        ? String(value === true || value === 1)
        : String(typeof value === 'number' ? value : Number(value));

    const usesId = template.includes('{{id}}');
    const rpcId = usesId ? randomInt(1, 2_000_000_000) : null;

    let payload = template.split('{{value}}').join(jsonValue);
    if (rpcId !== null) {
      payload = payload.split('{{id}}').join(String(rpcId));
    }
    return { payload, rpcId };
  }

  async writeMqtt(req: MqttWriteRequest): Promise<MqttWriteResult> {
    if (!req.tenantId || req.tenantId.trim() === '') {
      return { success: false, error: 'tenantId é obrigatório' };
    }
    const commandTopicBinding = (req.write.commandTopic ?? '').trim();
    const template = (req.write.payloadTemplate ?? '').trim();
    if (!commandTopicBinding || !template) {
      return { success: false, error: 'Ponto sem binding de escrita configurado' };
    }

    // Defesa em profundidade: comando/resposta precisam estar sob o escopo do
    // dispositivo — namespace de sensores do gateway (modo prefixo) ou o tópico
    // raiz próprio do equipamento (mesma regra do sourceTopic).
    const prefix = (req.topicScope ?? '').trim() ||
      `bluebee/${req.tenantId}/gateway/${req.gatewayId}/sensors/`;
    if (!commandTopicBinding.startsWith(prefix)) {
      return {
        success: false,
        error: `Tópico de comando fora do escopo do dispositivo (${prefix})`,
      };
    }
    const responseTopic = (req.write.responseTopic ?? '')?.trim() || null;
    if (responseTopic && !responseTopic.startsWith(prefix)) {
      return {
        success: false,
        error: `Tópico de resposta fora do escopo do dispositivo (${prefix})`,
      };
    }

    const { payload, rpcId } = this.renderPayload(template, req.value, req.valueType);

    // UUID (não Date.now()) para evitar colisão de command_id sob concorrência.
    const commandId = `mqtt-write-${randomUUID()}`;
    const commandTopic = `bluebee/${req.tenantId}/gateway/${req.gatewayId}/commands`;

    // Envelope padrão do gateway (CommandDispatcherService): protocol + action + params.
    const commandPayload = {
      command_id: commandId,
      tenant_id: req.tenantId,
      gateway_id: req.gatewayId,
      device_id: req.deviceId,
      protocol: 'mqtt',
      action: 'write',
      params: {
        commandTopic: commandTopicBinding,
        payload,
        responseTopic,
        matchId: responseTopic ? rpcId : null,
        // Contexto para o gateway publicar a telemetria confirmada pós-escrita
        // (mesmo payload do bridge) assim que a resposta RPC validar o comando.
        confirm: {
          deviceId: req.deviceId,
          tag: req.pointTag,
          // Valor numérico no formato canônico da telemetria (boolean → 0/1).
          value:
            req.valueType === 'boolean'
              ? (req.value === true || req.value === 1 ? 1 : 0)
              : Number(req.value),
          unit: req.pointUnit,
        },
      },
    };

    this.logger.log(
      `Publicando comando de escrita MQTT ${commandId} → ${commandTopicBinding} ` +
        `(confirmação: ${responseTopic ? 'sim' : 'não'})`,
    );

    // IMPORTANTE: registra o pending ANTES de publicar — com QoS 2 o handshake
    // do publish pode demorar mais que o resultado do gateway (corrida conhecida
    // do fluxo BACnet; registrar antes elimina o timeout falso de 20s).
    return new Promise<MqttWriteResult>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        if (this.pendingWrites.has(commandId)) {
          this.pendingWrites.delete(commandId);
          this.logger.warn(
            `Timeout do write MQTT ${commandId} (gateway: ${req.gatewayId})`,
          );
          resolve({
            success: false,
            error: 'Timeout - gateway nao respondeu em 20s',
          });
        }
      }, WRITE_TIMEOUT_MS);

      this.pendingWrites.set(commandId, {
        resolve: (result: MqttWriteSuccess) => {
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
            `Falha ao publicar comando de escrita MQTT ${commandId}: ${
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
      pending.resolve({
        success: true,
        command_id,
        confirmed: payload.confirmed === true,
      });
    } else {
      pending.reject(new Error(payload.error ?? 'Gateway reportou falha no write'));
    }
  }
}
