import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MqttService } from '../../mqtt/mqtt.service.js';

/**
 * Timeout do lado backend para aguardar a resposta do gateway ao probe ONVIF.
 * O gateway tenta a porta informada (~10s) e, se ela falhar, até 4 portas
 * alternativas (~8s cada) — 60s cobre o pior caso sem pendurar o cadastro
 * indefinidamente.
 */
const PROBE_TIMEOUT_MS = 60_000;

/** Informações do dispositivo lidas via GetDeviceInformation. */
export interface OnvifDeviceInfo {
  manufacturer: string | null;
  model: string | null;
  firmwareVersion: string | null;
  serialNumber: string | null;
}

export type OnvifProbeErrorCode =
  | 'AUTH'
  | 'UNREACHABLE'
  | 'NOT_ONVIF'
  | 'GATEWAY_TIMEOUT'
  | 'UNKNOWN';

export type OnvifProbeResult =
  /** `port` = porta que efetivamente respondeu ONVIF (pode diferir da pedida). */
  | { success: true; deviceInfo: OnvifDeviceInfo; port: number }
  | { success: false; errorCode: OnvifProbeErrorCode; error: string };

export interface ProbeOnvifDto {
  tenantId: string;
  gatewayId: string;
  ip: string;
  port: number;
  username: string;
  password: string;
}

interface PendingProbe {
  resolve: (result: OnvifProbeResult) => void;
}

interface ProbeResultPayload {
  command_id: string;
  success: boolean;
  deviceInfo?: OnvifDeviceInfo;
  /** Porta que efetivamente respondeu ONVIF (fallback automático no gateway). */
  port?: number;
  errorCode?: string;
  error?: string;
}

/**
 * OnvifProbeService (backend)
 *
 * Pede ao gateway que conecte numa câmera via ONVIF e devolva as informações
 * do dispositivo (fabricante/modelo/firmware/série) — usado no cadastro para
 * validar credenciais e auto-preencher os dados. Mesmo padrão request/response
 * dos scans: pendências por command_id + tópico de resultado próprio.
 *
 * A senha trafega apenas no comando MQTT ao gateway — nunca é logada.
 */
@Injectable()
export class OnvifProbeService implements OnModuleInit {
  private readonly logger = new Logger(OnvifProbeService.name);

  private readonly pendingProbes = new Map<string, PendingProbe>();

  constructor(private readonly mqttService: MqttService) {}

  onModuleInit(): void {
    this.mqttService.subscribe('bluebee/+/gateway/+/discovery/onvif-probe-result', 0);
    this.mqttService.onMessage((topic: string, rawPayload: Buffer) => {
      if (topic.endsWith('/discovery/onvif-probe-result')) {
        this.handleProbeResult(rawPayload);
      }
    });
  }

  async probe(dto: ProbeOnvifDto): Promise<OnvifProbeResult> {
    const commandId = randomUUID();
    const commandTopic = `bluebee/${dto.tenantId}/gateway/${dto.gatewayId}/commands`;

    const commandPayload = {
      command_id: commandId,
      tenant_id: dto.tenantId,
      device_id: 'onvif-probe',
      protocol: 'onvif',
      action: 'probe',
      params: {
        ip: dto.ip,
        port: dto.port,
        username: dto.username,
        password: dto.password,
      },
    };

    this.logger.log(
      `Publicando probe ONVIF ${commandId} em ${commandTopic} (${dto.ip}:${dto.port})`,
    );

    try {
      await this.mqttService.publish(commandTopic, commandPayload, 1);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      this.logger.error(`Falha ao publicar probe ONVIF: ${msg}`);
      return {
        success: false,
        errorCode: 'UNKNOWN',
        error: 'Falha ao enviar o comando ao gateway. Tente novamente.',
      };
    }

    return new Promise<OnvifProbeResult>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        if (this.pendingProbes.has(commandId)) {
          this.pendingProbes.delete(commandId);
          this.logger.warn(`Timeout do probe ONVIF ${commandId} (gateway: ${dto.gatewayId})`);
          resolve({
            success: false,
            errorCode: 'GATEWAY_TIMEOUT',
            error:
              'O gateway não respondeu à conexão ONVIF. Verifique se o gateway está online e alcança a câmera.',
          });
        }
      }, PROBE_TIMEOUT_MS);

      this.pendingProbes.set(commandId, {
        resolve: (result: OnvifProbeResult) => {
          clearTimeout(timeoutHandle);
          resolve(result);
        },
      });
    });
  }

  private handleProbeResult(rawPayload: Buffer): void {
    let payload: ProbeResultPayload;
    try {
      payload = JSON.parse(rawPayload.toString()) as ProbeResultPayload;
    } catch {
      this.logger.error('Falha ao parsear payload do resultado de probe ONVIF');
      return;
    }
    if (!payload.command_id) return;

    const pending = this.pendingProbes.get(payload.command_id);
    if (!pending) return;
    this.pendingProbes.delete(payload.command_id);

    if (payload.success && payload.deviceInfo) {
      pending.resolve({
        success: true,
        deviceInfo: payload.deviceInfo,
        port: typeof payload.port === 'number' ? payload.port : 0,
      });
    } else {
      const code = (payload.errorCode as OnvifProbeErrorCode) ?? 'UNKNOWN';
      pending.resolve({
        success: false,
        errorCode: code,
        error: payload.error ?? 'Falha ao conectar via ONVIF na câmera.',
      });
    }
  }
}
