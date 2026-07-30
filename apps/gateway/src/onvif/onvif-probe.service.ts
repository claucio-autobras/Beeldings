import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { GatewayMqttService } from '../mqtt/gateway-mqtt.service';
import {
  OnvifConnectionError,
  connectOnvif,
  getDeviceInformation,
  type OnvifDeviceInformation,
} from './onvif-connection';

/** Comando de probe ONVIF roteado pelo CommandDispatcher. */
export interface OnvifProbeCommand {
  command_id: string;
  tenant_id: string;
  gateway_id: string;
  ip: string;
  port: number;
  username: string;
  password: string;
}

/**
 * Portas ONVIF comuns tentadas automaticamente quando a porta informada não
 * responde ONVIF (a porta já tentada é pulada).
 */
const FALLBACK_ONVIF_PORTS = [80, 8080, 8000, 2020];

/** Timeout reduzido por porta alternativa (a soma precisa caber no timeout do backend). */
const FALLBACK_TIMEOUT_MS = 8_000;

/**
 * OnvifProbeService
 *
 * Conecta numa câmera via ONVIF (autenticação + GetDeviceInformation) sob
 * demanda do backend — usado no cadastro para validar credenciais e preencher
 * fabricante/modelo/firmware/série automaticamente.
 *
 * Tolerante a porta errada: se a porta informada falhar com NOT_ONVIF ou
 * UNREACHABLE, tenta sequencialmente as portas ONVIF comuns (80, 8080, 8000,
 * 2020) e retorna a porta que funcionou junto com o deviceInfo.
 *
 * Publica o resultado em (mesmo padrão request/response dos scans):
 *   bluebee/{tenantId}/gateway/{gatewayId}/discovery/onvif-probe-result
 *
 * Nunca loga nem republica a senha da câmera.
 */
@Injectable()
export class OnvifProbeService {
  private readonly logger = new Logger(OnvifProbeService.name);

  constructor(private readonly mqttService: GatewayMqttService) {}

  @OnEvent('command.onvif.probe')
  async handleProbeCommand(command: OnvifProbeCommand): Promise<void> {
    const resultTopic =
      `bluebee/${command.tenant_id}/gateway/${command.gateway_id}` +
      `/discovery/onvif-probe-result`;

    this.logger.log(
      `Probe ONVIF ${command.command_id} — ${command.ip}:${command.port} (user=${command.username})`,
    );

    try {
      const { info, port } = await this.probeWithPortFallback(command);
      this.logger.log(
        `Probe ONVIF ${command.command_id} OK na porta ${port} — ` +
          `${info.manufacturer ?? '?'} ${info.model ?? '?'}`,
      );
      this.mqttService.publish(resultTopic, {
        command_id: command.command_id,
        success: true,
        port,
        deviceInfo: info,
      });
    } catch (err) {
      const known = err instanceof OnvifConnectionError ? err : null;
      this.logger.warn(
        `Probe ONVIF ${command.command_id} falhou (${known?.code ?? 'UNKNOWN'}): ` +
          `${(err as Error).message}`,
      );
      this.mqttService.publish(resultTopic, {
        command_id: command.command_id,
        success: false,
        errorCode: known?.code ?? 'UNKNOWN',
        error: known?.message ?? 'Falha ao conectar via ONVIF na câmera.',
      });
    }
  }

  /**
   * Tenta a porta informada; falhando com NOT_ONVIF/UNREACHABLE/UNKNOWN,
   * tenta as portas comuns (pulando a já tentada). Erro AUTH não tem fallback:
   * a câmera fala ONVIF, o problema são as credenciais.
   * Em falha total, propaga o erro da porta ORIGINAL (mensagem mais fiel ao
   * que o usuário digitou).
   */
  private async probeWithPortFallback(
    command: OnvifProbeCommand,
  ): Promise<{ info: OnvifDeviceInformation; port: number }> {
    let originalError: unknown;
    try {
      return {
        info: await this.probePort(command, command.port),
        port: command.port,
      };
    } catch (err) {
      originalError = err;
      const known = err instanceof OnvifConnectionError ? err : null;
      if (known?.code === 'AUTH') {
        throw err;
      }
    }

    const alternates = FALLBACK_ONVIF_PORTS.filter((p) => p !== command.port);
    for (const port of alternates) {
      try {
        const info = await this.probePort(command, port, FALLBACK_TIMEOUT_MS);
        return { info, port };
      } catch (err) {
        // AUTH numa porta alternativa = a câmera fala ONVIF ali, mas recusou
        // as credenciais — erro mais acionável que o da porta original.
        if (err instanceof OnvifConnectionError && err.code === 'AUTH') {
          throw err;
        }
        this.logger.debug(
          `Probe ONVIF ${command.command_id}: porta alternativa ${port} também falhou`,
        );
      }
    }
    throw originalError;
  }

  private async probePort(
    command: OnvifProbeCommand,
    port: number,
    timeoutMs?: number,
  ): Promise<OnvifDeviceInformation> {
    const cam = await connectOnvif({
      ip: command.ip,
      port,
      username: command.username,
      password: command.password,
      ...(timeoutMs ? { timeoutMs } : {}),
    });
    try {
      return await getDeviceInformation(cam);
    } finally {
      try {
        cam.removeAllListeners();
      } catch {
        // best-effort
      }
    }
  }
}
