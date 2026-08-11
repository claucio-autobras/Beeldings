'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  acquireTelemetrySocket,
  releaseTelemetrySocket,
} from '@/lib/telemetry-socket';
import { ApiError } from '@/lib/api-client';
import {
  keepAliveLiveView,
  startLiveView,
  stopLiveView,
} from '../services/cftv.service';

/** Estado da sessão de visualização ao vivo. */
export type LiveViewStatus =
  | 'connecting' // sessão iniciada, aguardando o primeiro frame
  | 'live' // recebendo frames
  | 'signal_lost' // frames pararam de chegar (>~10s) — retry disponível
  | 'unsupported' // câmera não expõe snapshot/stream compatível (retry não ajuda)
  | 'error'; // falha de captura/credenciais/gateway — retry disponível

/** Evento `camera:frame` do socket /telemetry (ver telemetry.gateway do backend). */
interface CameraFrameEvent {
  sessionId: string;
  deviceId: string;
  type: 'frame' | 'error' | 'ended';
  ts: string;
  seq?: number;
  /** JPEG em base64 (type='frame'). */
  image?: string;
  errorCode?: string;
  error?: string;
  reason?: string;
}

export interface CameraLiveViewState {
  status: LiveViewStatus;
  /** Data-URL do último frame JPEG recebido (null antes do primeiro frame). */
  frameUrl: string | null;
  /** Horário do último frame (ISO) — timestamp exibido no modal. */
  lastFrameAt: string | null;
  /** Mensagem de erro amigável (status 'error'/'unsupported'). */
  errorMessage: string | null;
  /** Reinicia a sessão (sinal perdido / erro recuperável). */
  retry: () => void;
}

/** Sem frame novo neste intervalo, o status vira 'signal_lost' (nunca congela mudo). */
const STALL_MS = 10_000;
/** Cadência da checagem de estagnação. */
const STALL_CHECK_MS = 2_000;

/**
 * useCameraLiveView — sessão de visualização ao vivo de UMA câmera ONVIF.
 *
 * Ciclo: start via API → keep-alive periódico enquanto montado → frames pelo
 * socket /telemetry COMPARTILHADO (acquire/release — nunca io() direto) →
 * stop no unmount/fechamento. Uma sessão por operador: abrir outra câmera
 * substitui a anterior no backend.
 *
 * @param cameraId câmera a visualizar (null = hook inativo)
 * @param tenantId tenant efetivo (papéis globais) — repassado ao start
 */
export function useCameraLiveView(
  cameraId: string | null,
  tenantId?: string,
): CameraLiveViewState {
  const [status, setStatus] = useState<LiveViewStatus>('connecting');
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [lastFrameAt, setLastFrameAt] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Incrementado a cada retry — reroda o efeito da sessão sem trocar de câmera.
  const [attempt, setAttempt] = useState(0);

  // Refs de sessão: geração invalida callbacks assíncronos de sessões antigas.
  const generationRef = useRef(0);
  // Espelho do status para decisões em callbacks (keep-alive) sem re-render.
  const statusRef = useRef<LiveViewStatus>('connecting');
  const sessionIdRef = useRef<string | null>(null);
  const lastFrameMsRef = useRef<number>(0);
  const lastSeqRef = useRef<number>(-1);

  const retry = useCallback(() => {
    setAttempt((a) => a + 1);
  }, []);

  useEffect(() => {
    if (!cameraId) return;

    const generation = ++generationRef.current;
    const isCurrent = () => generationRef.current === generation;

    sessionIdRef.current = null;
    lastFrameMsRef.current = 0;
    lastSeqRef.current = -1;

    let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
    let stallTimer: ReturnType<typeof setInterval> | null = null;
    let disposed = false;

    // Socket compartilhado do /telemetry — listeners próprios, nunca disconnect().
    const socket = acquireTelemetrySocket();

    const onFrame = (event: CameraFrameEvent) => {
      if (!isCurrent()) return;
      if (!sessionIdRef.current || event.sessionId !== sessionIdRef.current) return;
      if (event.type === 'frame' && event.image) {
        // Frames podem chegar fora de ordem (QoS0) — nunca regride a imagem.
        const seq = event.seq ?? 0;
        if (seq <= lastSeqRef.current) return;
        lastSeqRef.current = seq;
        lastFrameMsRef.current = Date.now();
        setFrameUrl(`data:image/jpeg;base64,${event.image}`);
        setLastFrameAt(event.ts);
        statusRef.current = 'live';
        setStatus('live');
        return;
      }
      if (event.type === 'error') {
        // UNSUPPORTED/AUTH encerram a sessão no backend — retry não ajuda no
        // primeiro caso; no segundo o operador precisa corrigir o cadastro.
        // Estado TERMINAL: o keep-alive para e NUNCA reinicia sozinho — a
        // sessão morta no backend responderia 404 e criaria loop de restart.
        const code = (event.errorCode ?? '').toUpperCase();
        setErrorMessage(event.error ?? null);
        const next: LiveViewStatus = code === 'UNSUPPORTED' ? 'unsupported' : 'error';
        statusRef.current = next;
        setStatus(next);
        sessionIdRef.current = null; // sessão já encerrada no backend
        return;
      }
      if (event.type === 'ended') {
        // Sessão substituída (outra câmera aberta) ou expirada — se este hook
        // ainda é o atual, mostra sinal perdido com opção de retomar (manual).
        if (statusRef.current !== 'error' && statusRef.current !== 'unsupported') {
          statusRef.current = 'signal_lost';
          setStatus('signal_lost');
        }
        sessionIdRef.current = null;
      }
    };
    socket.on('camera:frame', onFrame);

    const failWith = (err: unknown) => {
      if (!isCurrent() || disposed) return;
      const msg =
        err instanceof ApiError || err instanceof Error ? err.message : null;
      setErrorMessage(msg);
      statusRef.current = 'error';
      setStatus('error');
    };

    void (async () => {
      try {
        // Reset assíncrono (nunca setState síncrono no corpo do efeito).
        statusRef.current = 'connecting';
        setStatus('connecting');
        setFrameUrl(null);
        setLastFrameAt(null);
        setErrorMessage(null);
        const info = await startLiveView(cameraId, tenantId);
        if (!isCurrent() || disposed) {
          // O modal fechou durante o start — encerra a sessão órfã.
          void stopLiveView(info.sessionId).catch(() => {});
          return;
        }
        sessionIdRef.current = info.sessionId;
        lastFrameMsRef.current = Date.now(); // carência inicial do watchdog

        // Keep-alive na cadência sugerida pelo backend (metade do TTL).
        keepAliveTimer = setInterval(() => {
          const sid = sessionIdRef.current;
          if (!sid) return;
          void keepAliveLiveView(sid).catch((err: unknown) => {
            if (!isCurrent() || disposed) return;
            // Reinício automático SÓ para sessão saudável que sumiu do backend
            // (expirou / keep-alive caiu em outra instância). Estados terminais
            // (erro/unsupported/sinal perdido) NUNCA reiniciam sozinhos — a
            // retomada é sempre ação explícita do operador (botão de retry).
            const healthy =
              statusRef.current === 'live' || statusRef.current === 'connecting';
            if (err instanceof ApiError && healthy) {
              sessionIdRef.current = null;
              setAttempt((a) => a + 1);
            }
            // Falha de rede momentânea: mantém — o watchdog de frames decide.
          });
        }, Math.max(1_000, info.keepAliveIntervalMs || 4_000));

        // Watchdog de estagnação: frames pararam >STALL_MS → "sinal perdido".
        stallTimer = setInterval(() => {
          if (!isCurrent() || disposed) return;
          setStatus((prev) => {
            if (prev !== 'live' && prev !== 'connecting') return prev;
            const elapsed = Date.now() - lastFrameMsRef.current;
            if (elapsed > STALL_MS) {
              statusRef.current = 'signal_lost';
              return 'signal_lost';
            }
            return prev;
          });
        }, STALL_CHECK_MS);
      } catch (err) {
        failWith(err);
      }
    })();

    return () => {
      disposed = true;
      if (keepAliveTimer) clearInterval(keepAliveTimer);
      if (stallTimer) clearInterval(stallTimer);
      socket.off('camera:frame', onFrame);
      releaseTelemetrySocket();
      const sid = sessionIdRef.current;
      sessionIdRef.current = null;
      // Encerramento imediato no backend (fire-and-forget — o TTL cobre falhas).
      if (sid) void stopLiveView(sid).catch(() => {});
    };
  }, [cameraId, tenantId, attempt]);

  return { status, frameUrl, lastFrameAt, errorMessage, retry };
}
