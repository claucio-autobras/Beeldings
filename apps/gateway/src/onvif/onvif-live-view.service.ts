import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { GatewayMqttService } from '../mqtt/gateway-mqtt.service';
import {
  OnvifConnectionError,
  connectOnvif,
  getRtspStreamUri,
  getSnapshotUri,
  type OnvifCam,
} from './onvif-connection';
import {
  SnapshotError,
  captureRtspFrame,
  fetchSnapshotJpeg,
  type SnapshotErrorCode,
} from './onvif-snapshot.util';

/** Comando de visualização ao vivo roteado pelo CommandDispatcher. */
export interface OnvifLiveViewCommand {
  command_id: string;
  tenant_id: string;
  gateway_id: string;
  device_id: string;
  /** Identificador da sessão de visualização (gerado no backend). */
  session_id: string;
  action: 'live_start' | 'live_keepalive' | 'live_stop';
  /** Presentes apenas no live_start. */
  ip?: string;
  port?: number;
  username?: string;
  password?: string;
  /** URL RTSP manual do cadastro (fallback preferencial quando presente). */
  rtspUrl?: string | null;
}

/** Intervalo entre frames (~1 fps — "plus" de visualização, não VMS). */
const FRAME_INTERVAL_MS = 1_000;

/**
 * Janela do watchdog de keep-alive: sem renovação do espectador dentro deste
 * prazo, o loop de captura é encerrado sozinho (nenhum vazamento de captura).
 * O backend renova a cada poucos segundos enquanto houver espectador.
 */
const KEEPALIVE_WINDOW_MS = 12_000;

/** Falhas consecutivas de captura toleradas antes de encerrar a sessão. */
const MAX_CONSECUTIVE_FAILURES = 5;

interface LiveSession {
  sessionId: string;
  deviceId: string;
  tenantId: string;
  gatewayId: string;
  cam: OnvifCam | null;
  /** URI de snapshot resolvida na 1ª captura (cache por sessão). */
  snapshotUri: string | null;
  /** URI RTSP para o fallback (manual do cadastro ou GetStreamUri). */
  rtspUri: string | null;
  username: string;
  password: string;
  ip: string;
  port: number;
  timer: NodeJS.Timeout | null;
  deadline: number;
  capturing: boolean;
  stopped: boolean;
  seq: number;
  consecutiveFailures: number;
}

/**
 * OnvifLiveViewService
 *
 * Sessão de visualização ao vivo sob demanda: captura frames JPEG de UMA
 * câmera ONVIF (~1 fps) e os publica num tópico efêmero próprio da sessão
 * enquanto o backend renovar o keep-alive.
 *
 *   Tópico de frames (QoS0, sem retain, sem store-and-forward):
 *     bluebee/{tenantId}/gateway/{gatewayId}/live-view/{sessionId}
 *
 * Estratégia de captura por frame:
 *   1. GetSnapshotUri + HTTP GET (digest/basic) — caminho preferido;
 *   2. fallback: frame único do stream RTSP via ffmpeg (quando instalado).
 *
 * Garantias:
 *   - UMA sessão por câmera por vez (nova sessão substitui a anterior);
 *   - watchdog: sem keep-alive em KEEPALIVE_WINDOW_MS → encerra sozinho;
 *   - erro de captura vira evento de erro no MESMO tópico (nunca silêncio);
 *   - frames nunca passam pelo tópico de telemetria (nada é persistido).
 */
@Injectable()
export class OnvifLiveViewService implements OnModuleDestroy {
  private readonly logger = new Logger(OnvifLiveViewService.name);

  /** Sessões ativas por deviceId (uma câmera = no máximo uma sessão). */
  private readonly sessions = new Map<string, LiveSession>();

  constructor(private readonly mqttService: GatewayMqttService) {}

  onModuleDestroy(): void {
    for (const session of [...this.sessions.values()]) {
      this.endSession(session, 'shutdown');
    }
  }

  @OnEvent('command.onvif.live_view')
  handleLiveViewCommand(command: OnvifLiveViewCommand): void {
    if (command.action === 'live_start') {
      void this.startSession(command);
      return;
    }
    if (command.action === 'live_keepalive') {
      this.renewSession(command.session_id);
      return;
    }
    if (command.action === 'live_stop') {
      const session = this.findBySessionId(command.session_id);
      if (session) {
        this.endSession(session, 'stop');
      }
    }
  }

  private findBySessionId(sessionId: string): LiveSession | null {
    for (const session of this.sessions.values()) {
      if (session.sessionId === sessionId) return session;
    }
    return null;
  }

  private frameTopic(session: LiveSession): string {
    return (
      `bluebee/${session.tenantId}/gateway/${session.gatewayId}` +
      `/live-view/${session.sessionId}`
    );
  }

  private async startSession(command: OnvifLiveViewCommand): Promise<void> {
    const ip = String(command.ip ?? '').trim();
    const username = String(command.username ?? '');
    const rtspUrl = command.rtspUrl?.trim() || null;
    // Sem usuário ONVIF a sessão ainda funciona em modo RTSP-only (câmera
    // SNMP com URL RTSP manual no cadastro) — mas precisa de uma das duas.
    if (!ip || (!username && !rtspUrl)) {
      this.logger.error(
        `live_start sem ip/usuário/RTSP — session=${command.session_id}`,
      );
      return;
    }

    // Uma sessão por câmera: substitui a anterior (sem loops órfãos).
    const existing = this.sessions.get(command.device_id);
    if (existing) {
      this.endSession(existing, 'replaced');
    }

    const session: LiveSession = {
      sessionId: command.session_id,
      deviceId: command.device_id,
      tenantId: command.tenant_id,
      gatewayId: command.gateway_id,
      cam: null,
      snapshotUri: null,
      rtspUri: command.rtspUrl?.trim() || null,
      username,
      password: String(command.password ?? ''),
      ip,
      port: Number(command.port ?? 80),
      timer: null,
      deadline: Date.now() + KEEPALIVE_WINDOW_MS,
      capturing: false,
      stopped: false,
      seq: 0,
      consecutiveFailures: 0,
    };
    this.sessions.set(session.deviceId, session);
    this.logger.log(
      `Sessão ao vivo iniciada — device=${session.deviceId} session=${session.sessionId}`,
    );

    // 1º frame imediato (valida a câmera de cara) + loop periódico.
    await this.captureCycle(session);
    if (session.stopped) return;
    session.timer = setInterval(() => {
      void this.captureCycle(session);
    }, FRAME_INTERVAL_MS);
    session.timer.unref?.();
  }

  private renewSession(sessionId: string): void {
    const session = this.findBySessionId(sessionId);
    if (!session) return;
    session.deadline = Date.now() + KEEPALIVE_WINDOW_MS;
  }

  private endSession(session: LiveSession, reason: string): void {
    if (session.stopped) return;
    session.stopped = true;
    if (session.timer) {
      clearInterval(session.timer);
      session.timer = null;
    }
    if (session.cam) {
      try {
        session.cam.removeAllListeners();
      } catch {
        // best-effort
      }
      session.cam = null;
    }
    if (this.sessions.get(session.deviceId) === session) {
      this.sessions.delete(session.deviceId);
    }
    // Evento de encerramento — o backend limpa a assinatura ao recebê-lo ou
    // pelo próprio timeout de keep-alive (dupla garantia).
    this.mqttService.publishVolatile(this.frameTopic(session), {
      sessionId: session.sessionId,
      deviceId: session.deviceId,
      type: 'ended',
      reason,
      ts: new Date().toISOString(),
    });
    this.logger.log(
      `Sessão ao vivo encerrada (${reason}) — device=${session.deviceId} session=${session.sessionId}`,
    );
  }

  /** Um ciclo: verifica o watchdog, captura um frame e publica. */
  private async captureCycle(session: LiveSession): Promise<void> {
    if (session.stopped) return;
    if (Date.now() > session.deadline) {
      this.endSession(session, 'keepalive_timeout');
      return;
    }
    if (session.capturing) return; // captura anterior ainda em andamento
    session.capturing = true;
    try {
      const frame = await this.captureFrame(session);
      if (session.stopped) return;
      session.consecutiveFailures = 0;
      session.seq += 1;
      this.mqttService.publishVolatile(this.frameTopic(session), {
        sessionId: session.sessionId,
        deviceId: session.deviceId,
        type: 'frame',
        seq: session.seq,
        ts: new Date().toISOString(),
        image: frame.toString('base64'),
      });
    } catch (err) {
      if (session.stopped) return;
      session.consecutiveFailures += 1;
      const { code, message } = this.classifyCaptureError(err);
      this.logger.warn(
        `Falha de captura (${code}) — device=${session.deviceId} ` +
          `tentativa ${session.consecutiveFailures}: ${message}`,
      );
      // Erro é um evento, não silêncio: o espectador vê o motivo na hora.
      this.mqttService.publishVolatile(this.frameTopic(session), {
        sessionId: session.sessionId,
        deviceId: session.deviceId,
        type: 'error',
        errorCode: code,
        error: message,
        ts: new Date().toISOString(),
      });
      // Sem suporte a snapshot/RTSP não melhora tentando de novo; falhas
      // repetidas (câmera caiu no meio) também encerram.
      if (code === 'UNSUPPORTED' || code === 'AUTH' ||
          session.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        this.endSession(session, 'capture_failed');
      }
    } finally {
      session.capturing = false;
    }
  }

  /** Captura um frame: snapshot HTTP preferido, RTSP como fallback. */
  private async captureFrame(session: LiveSession): Promise<Buffer> {
    // Modo RTSP-only (sem credenciais ONVIF): vai direto ao frame RTSP —
    // nunca tenta conectar ONVIF (falharia sem usuário).
    if (!session.username) {
      if (!session.rtspUri) {
        throw new SnapshotError(
          'UNSUPPORTED',
          'Câmera sem credenciais ONVIF e sem URL RTSP para captura de frame.',
        );
      }
      return captureRtspFrame({
        rtspUri: session.rtspUri,
        username: session.username,
        password: session.password,
      });
    }

    if (!session.cam) {
      session.cam = await connectOnvif({
        ip: session.ip,
        port: session.port,
        username: session.username,
        password: session.password,
      });
      if (session.stopped) {
        throw new SnapshotError('UNKNOWN', 'Sessão encerrada durante a conexão.');
      }
    }

    let snapshotError: unknown = null;
    if (!session.snapshotUri) {
      session.snapshotUri = await getSnapshotUri(session.cam);
    }
    if (session.snapshotUri) {
      try {
        return await fetchSnapshotJpeg({
          uri: session.snapshotUri,
          username: session.username,
          password: session.password,
        });
      } catch (err) {
        snapshotError = err;
        // URI de snapshot pode ter expirado — força nova resolução no próximo ciclo.
        session.snapshotUri = null;
      }
    }

    // Fallback: frame único do RTSP (URL manual do cadastro > GetStreamUri).
    if (!session.rtspUri) {
      session.rtspUri = await getRtspStreamUri(session.cam);
    }
    if (session.rtspUri) {
      try {
        return await captureRtspFrame({
          rtspUri: session.rtspUri,
          username: session.username,
          password: session.password,
        });
      } catch (rtspErr) {
        // Snapshot falhou com erro mais específico? Propaga o mais acionável.
        throw this.pickMoreActionable(snapshotError, rtspErr);
      }
    }

    if (snapshotError) throw snapshotError;
    throw new SnapshotError(
      'UNSUPPORTED',
      'A câmera não expõe snapshot JPEG nem stream RTSP para captura de frame.',
    );
  }

  /** Entre dois erros de captura, prefere o de código mais acionável. */
  private pickMoreActionable(a: unknown, b: unknown): unknown {
    const rank = (e: unknown): number => {
      const code =
        e instanceof SnapshotError
          ? e.code
          : e instanceof OnvifConnectionError
            ? e.code
            : 'UNKNOWN';
      switch (code) {
        case 'AUTH':
          return 3;
        case 'UNREACHABLE':
          return 2;
        case 'TOO_LARGE':
        case 'NOT_ONVIF':
          return 1;
        default:
          return 0;
      }
    };
    if (!a) return b;
    return rank(a) >= rank(b) ? a : b;
  }

  private classifyCaptureError(err: unknown): { code: SnapshotErrorCode; message: string } {
    if (err instanceof SnapshotError) {
      return { code: err.code, message: err.message };
    }
    if (err instanceof OnvifConnectionError) {
      const code: SnapshotErrorCode =
        err.code === 'AUTH' ? 'AUTH' : err.code === 'UNREACHABLE' ? 'UNREACHABLE' : 'UNKNOWN';
      return { code, message: err.message };
    }
    return { code: 'UNKNOWN', message: (err as Error)?.message ?? 'Falha ao capturar frame.' };
  }
}
