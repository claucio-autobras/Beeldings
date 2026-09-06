import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ONVIF_PROTOCOL } from '../../prisma/device-filters.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { MqttService } from '../../mqtt/mqtt.service.js';
import {
  TelemetryGateway,
  type CameraFramePayload,
} from '../../mqtt/telemetry.gateway.js';
import { decryptCameraSecret } from './camera-credentials.util.js';

/**
 * Janela de expiração da sessão no backend: sem keep-alive do espectador
 * dentro deste prazo, a sessão é encerrada (comando de stop ao gateway +
 * limpeza local). O gateway tem watchdog próprio (dupla garantia).
 */
export const LIVE_VIEW_TTL_MS = 10_000;

/** Cadência de renovação sugerida ao frontend (metade da janela). */
export const LIVE_VIEW_KEEPALIVE_INTERVAL_MS = 4_000;

/** Cadência com que o gateway recebe o keep-alive repassado. */
const SWEEP_INTERVAL_MS = 2_000;

interface LiveViewSession {
  sessionId: string;
  userId: string;
  tenantId: string;
  cameraId: string;
  gatewayId: string;
  /** Instante-limite: sem keep-alive até lá, a sessão expira. */
  expiresAt: number;
}

/**
 * CameraLiveViewService — sessão de visualização ao vivo de câmera ONVIF.
 *
 * Fluxo: start → comando MQTT `onvif.live_start` ao gateway (com as
 * credenciais decifradas, como a config) → gateway captura frames JPEG
 * (~1 fps) e publica em `bluebee/{tenant}/gateway/{gw}/live-view/{sessionId}`
 * → CADA instância do backend (assinatura MQTT com fan-out no broker) repassa
 * o frame pelo socket /telemetry com escopo de tenant (emissão direta, como
 * telemetria/alarme — nunca via barramento do cluster).
 *
 * Garantias:
 *   - canal EFÊMERO: frames não são persistidos (nem telemetria, nem trends,
 *     nem store-and-forward);
 *   - UMA sessão por operador: um segundo start do mesmo usuário encerra e
 *     substitui a anterior;
 *   - expiração: sem keep-alive em LIVE_VIEW_TTL_MS o backend envia stop ao
 *     gateway e limpa a sessão (o gateway também para sozinho pelo watchdog).
 *
 * Nota multi-instância: o registro de sessões é por instância (o start,
 * keep-alive e stop do mesmo espectador chegam à mesma instância via sessão
 * HTTP). O REPASSE de frames, porém, é feito por TODA instância a partir do
 * tenant do próprio tópico — clientes de qualquer instância recebem.
 */
@Injectable()
export class CameraLiveViewService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CameraLiveViewService.name);

  /** Sessões iniciadas NESTA instância, por sessionId. */
  private readonly sessions = new Map<string, LiveViewSession>();

  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mqttService: MqttService,
    private readonly telemetryGateway: TelemetryGateway,
  ) {}

  onModuleInit(): void {
    // Frames de qualquer sessão/gateway: o tenant vem do próprio tópico e o
    // repasse acontece em toda instância (fan-out no broker MQTT).
    this.mqttService.subscribe('bluebee/+/gateway/+/live-view/+', 0);
    this.mqttService.onMessage((topic, payload) => {
      if (topic.includes('/live-view/')) {
        this.handleFrameMessage(topic, payload);
      }
    });

    this.sweepTimer = setInterval(() => this.sweepExpired(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    for (const session of [...this.sessions.values()]) {
      void this.terminate(session, 'shutdown');
    }
  }

  /**
   * Inicia uma sessão de visualização para UMA câmera ONVIF do tenant.
   * Um start com sessão anterior ativa do MESMO usuário a encerra/substitui.
   */
  async start(
    user: { id: string; tenantId: string | null },
    cameraId: string,
    requestedTenantId?: string,
  ): Promise<{ sessionId: string; ttlMs: number; keepAliveIntervalMs: number }> {
    const camera = await this.prisma.device.findUnique({
      where: { id: cameraId },
      select: {
        id: true,
        protocol: true,
        tenantId: true,
        gatewayId: true,
        ip: true,
        port: true,
        config: true,
      },
    });
    if (!camera) throw new NotFoundException('Câmera não encontrada');

    // Escopo de tenant: usuário de cliente só vê câmeras do próprio cliente;
    // papéis globais podem visualizar qualquer uma.
    if (user.tenantId && camera.tenantId !== user.tenantId) {
      throw new ForbiddenException('Câmera não pertence ao seu cliente');
    }
    if (requestedTenantId && camera.tenantId !== requestedTenantId) {
      throw new ForbiddenException('Câmera não pertence ao cliente informado');
    }

    if (!camera.gatewayId) {
      throw new BadRequestException('Câmera sem gateway associado');
    }

    // Vídeo disponível pela PRESENÇA de credenciais de vídeo na config — não
    // pelo protocolo de monitoramento: câmera SNMP também pode ter usuário/
    // senha ONVIF e/ou URL RTSP opcionais só para o "Ver ao vivo".
    const isOnvif = camera.protocol === ONVIF_PROTOCOL;
    const cfg = (camera.config ?? {}) as Record<string, unknown>;
    const username = typeof cfg.onvifUsername === 'string' ? cfg.onvifUsername : '';
    const password = decryptCameraSecret(cfg.onvifPasswordEnc as string | undefined);
    const rtspUrl = typeof cfg.rtspUrl === 'string' && cfg.rtspUrl ? cfg.rtspUrl : null;
    const hasOnvifCreds = Boolean(username && password);
    if (!hasOnvifCreds && !rtspUrl) {
      throw new BadRequestException(
        isOnvif
          ? 'Câmera sem credenciais ONVIF válidas — edite o cadastro e informe usuário/senha'
          : 'Câmera sem credenciais de vídeo — edite o cadastro e informe usuário/senha ONVIF ou uma URL RTSP na seção "Vídeo ao vivo"',
      );
    }

    // Porta do serviço de vídeo: câmera ONVIF usa a porta principal do
    // cadastro; câmera SNMP tem a porta principal ocupada pelo SNMP (161) e
    // usa a porta ONVIF opcional da config (padrão 80).
    const videoPort = isOnvif
      ? (camera.port ?? 80)
      : Number(cfg.onvifPort) || 80;

    // UMA sessão por operador: substitui a anterior do mesmo usuário.
    const previous = [...this.sessions.values()].find((s) => s.userId === user.id);
    if (previous) {
      await this.terminate(previous, 'replaced');
    }

    const session: LiveViewSession = {
      sessionId: randomUUID(),
      userId: user.id,
      tenantId: camera.tenantId,
      cameraId: camera.id,
      gatewayId: camera.gatewayId,
      expiresAt: Date.now() + LIVE_VIEW_TTL_MS,
    };
    this.sessions.set(session.sessionId, session);

    try {
      await this.publishCommand(session, 'live_start', {
        sessionId: session.sessionId,
        ip: camera.ip,
        port: videoPort,
        username,
        password,
        rtspUrl,
      });
    } catch (err) {
      this.sessions.delete(session.sessionId);
      this.logger.error(
        `Falha ao enviar live_start ao gateway ${session.gatewayId}: ${(err as Error).message}`,
      );
      throw new BadRequestException(
        'Falha ao enviar o comando ao gateway. Verifique se o gateway está online.',
      );
    }

    this.logger.log(
      `Sessão ao vivo iniciada — câmera=${camera.id} sessão=${session.sessionId} por ${user.id}`,
    );
    return {
      sessionId: session.sessionId,
      ttlMs: LIVE_VIEW_TTL_MS,
      keepAliveIntervalMs: LIVE_VIEW_KEEPALIVE_INTERVAL_MS,
    };
  }

  /** Renova a sessão (espectador ainda presente) e repassa ao gateway. */
  async keepAlive(
    user: { id: string; tenantId: string | null },
    sessionId: string,
  ): Promise<{ ttlMs: number }> {
    const session = this.getOwnSession(user, sessionId);
    session.expiresAt = Date.now() + LIVE_VIEW_TTL_MS;
    try {
      await this.publishCommand(session, 'live_keepalive', { sessionId });
    } catch (err) {
      // Broker momentaneamente fora: a sessão local segue renovada; o gateway
      // tem watchdog próprio e encerra sozinho se os keep-alives pararem.
      this.logger.warn(
        `Falha ao repassar keep-alive ao gateway: ${(err as Error).message}`,
      );
    }
    return { ttlMs: LIVE_VIEW_TTL_MS };
  }

  /** Encerra a sessão explicitamente (espectador fechou a visualização). */
  async stop(
    user: { id: string; tenantId: string | null },
    sessionId: string,
  ): Promise<void> {
    const session = this.getOwnSession(user, sessionId);
    await this.terminate(session, 'stopped_by_user');
  }

  private getOwnSession(
    user: { id: string; tenantId: string | null },
    sessionId: string,
  ): LiveViewSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new NotFoundException('Sessão de visualização não encontrada');
    if (session.userId !== user.id) {
      throw new ForbiddenException('Sessão pertence a outro usuário');
    }
    return session;
  }

  /** Encerra: comando de stop ao gateway (best-effort) + limpeza local. */
  private async terminate(session: LiveViewSession, reason: string): Promise<void> {
    if (!this.sessions.delete(session.sessionId)) return;
    try {
      await this.publishCommand(session, 'live_stop', { sessionId: session.sessionId });
    } catch (err) {
      this.logger.warn(
        `Falha ao enviar live_stop ao gateway ${session.gatewayId}: ${(err as Error).message}`,
      );
    }
    this.logger.log(
      `Sessão ao vivo encerrada (${reason}) — sessão=${session.sessionId}`,
    );
  }

  /** Expira sessões sem keep-alive (nenhum vazamento de captura contínua). */
  private sweepExpired(): void {
    const now = Date.now();
    for (const session of [...this.sessions.values()]) {
      if (now > session.expiresAt) {
        void this.terminate(session, 'keepalive_timeout');
      }
    }
  }

  private publishCommand(
    session: LiveViewSession,
    action: 'live_start' | 'live_keepalive' | 'live_stop',
    params: Record<string, unknown>,
  ): Promise<void> {
    const topic = `bluebee/${session.tenantId}/gateway/${session.gatewayId}/commands`;
    return this.mqttService.publish(
      topic,
      {
        command_id: randomUUID(),
        tenant_id: session.tenantId,
        device_id: session.cameraId,
        gateway_id: session.gatewayId,
        protocol: 'onvif',
        action,
        params,
      },
      1,
    );
  }

  /**
   * Frame/erro/fim publicado pelo gateway no tópico efêmero da sessão:
   * repassa pelo socket /telemetry com escopo do tenant do TÓPICO.
   * Nada é persistido em nenhuma hipótese.
   */
  private handleFrameMessage(topic: string, rawPayload: Buffer): void {
    const parts = topic.split('/');
    // bluebee/{tenantId}/gateway/{gatewayId}/live-view/{sessionId}
    const tenantId = parts[1];
    const topicSessionId = parts[5];
    if (!tenantId || !topicSessionId) return;

    let payload: CameraFramePayload;
    try {
      payload = JSON.parse(rawPayload.toString()) as CameraFramePayload;
    } catch {
      this.logger.warn(`Payload inválido no tópico de frames ${topic}`);
      return;
    }
    if (!payload.sessionId || payload.sessionId !== topicSessionId) return;
    if (payload.type !== 'frame' && payload.type !== 'error' && payload.type !== 'ended') {
      return;
    }

    // Gateway encerrou por conta própria (watchdog/falha): limpa a sessão
    // local sem reenviar stop (nesta instância, se ela for a dona).
    if (payload.type === 'ended') {
      this.sessions.delete(payload.sessionId);
    }

    this.telemetryGateway.emitCameraFrame(payload, tenantId);
  }
}
