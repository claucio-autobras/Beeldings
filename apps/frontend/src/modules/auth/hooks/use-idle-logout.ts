'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from './use-auth';
import { usePreferencesStore } from '@/modules/preferences/preferences.store';
import type { SessionTimeoutPreference } from '@/modules/preferences/preferences.types';

/**
 * Encerra a sessão automaticamente após um período sem atividade do usuário,
 * exibindo um aviso com contagem regressiva pouco antes do logout.
 *
 * - Tempo padrão: 30 min. Configurável via `NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES`
 *   e, com prioridade, pela preferência do usuário (Preferências → Sessão),
 *   incluindo "Nunca expirar" que desativa listeners, aviso e logout.
 * - Aviso: aparece 1 min antes do fim (ou na metade do tempo, se o timeout
 *   total for menor que 2 min). O usuário pode "Continuar conectado".
 * - Considera atividade: mouse, teclado, toque, rolagem e cliques.
 * - Sincroniza entre abas via localStorage: atividade em qualquer aba reinicia
 *   o contador de todas, evitando logout/aviso prematuro com várias abas.
 */

const DEFAULT_TIMEOUT_MINUTES = 30;
const WARNING_BEFORE_MS = 60_000;
const LAST_ACTIVITY_KEY = 'bluebee_last_activity';
const THROTTLE_MS = 5_000;

const ACTIVITY_EVENTS = [
  'mousemove',
  'mousedown',
  'keydown',
  'scroll',
  'touchstart',
  'click',
] as const;

/**
 * Resolve o timeout efetivo: preferência do usuário > env > 30 min.
 * Retorna null quando o usuário escolheu "Nunca expirar".
 */
function getTimeoutMs(preference: SessionTimeoutPreference): number | null {
  if (preference === 'never') return null;
  if (typeof preference === 'number' && preference > 0) return preference * 60_000;
  const raw = process.env.NEXT_PUBLIC_IDLE_TIMEOUT_MINUTES;
  const minutes = raw ? Number(raw) : DEFAULT_TIMEOUT_MINUTES;
  const safe = Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_TIMEOUT_MINUTES;
  return safe * 60_000;
}

export interface IdleLogoutState {
  /** Se o aviso de expiração iminente deve ser exibido. */
  warning: boolean;
  /** Segundos restantes até o logout (válido quando `warning` é true). */
  secondsLeft: number;
  /** Renova a sessão (reinicia o contador de inatividade). */
  stayConnected: () => void;
  /** Encerra a sessão imediatamente. */
  logout: () => void;
}

export function useIdleLogout(): IdleLogoutState {
  const { isAuthenticated, logout } = useAuth();
  const sessionTimeoutPreference = usePreferencesStore(
    (s) => s.preferences.sessionTimeoutMinutes,
  );
  const [warning, setWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const warnTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastWriteRef = useRef(0);
  const loggingOutRef = useRef(false);
  const stayRef = useRef<() => void>(() => {});

  const stayConnected = useCallback(() => stayRef.current(), []);

  useEffect(() => {
    if (!isAuthenticated) return;
    if (typeof window === 'undefined') return;

    const timeoutMs = getTimeoutMs(sessionTimeoutPreference);
    if (timeoutMs === null) {
      // "Nunca expirar": nenhum listener, aviso ou logout automático.
      setWarning(false);
      return;
    }

    loggingOutRef.current = false;
    const warnBeforeMs = Math.min(WARNING_BEFORE_MS, Math.floor(timeoutMs / 2));

    const readLastActivity = (): number => {
      const value = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
      return Number.isFinite(value) && value > 0 ? value : Date.now();
    };

    const safeLogout = () => {
      if (loggingOutRef.current) return;
      loggingOutRef.current = true;
      void logout();
    };

    const stopCountdown = () => {
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };

    const clearTimers = () => {
      if (warnTimerRef.current) {
        clearTimeout(warnTimerRef.current);
        warnTimerRef.current = null;
      }
      stopCountdown();
    };

    const enterWarning = (expiry: number) => {
      setWarning(true);
      const tick = () => {
        const left = Math.ceil((expiry - Date.now()) / 1000);
        if (left <= 0) {
          stopCountdown();
          safeLogout();
          return;
        }
        setSecondsLeft(left);
      };
      stopCountdown();
      tick();
      countdownRef.current = setInterval(tick, 1_000);
    };

    const schedule = () => {
      clearTimers();
      const expiry = readLastActivity() + timeoutMs;
      const now = Date.now();
      if (now >= expiry) {
        safeLogout();
        return;
      }
      const warnAt = expiry - warnBeforeMs;
      if (now >= warnAt) {
        enterWarning(expiry);
        return;
      }
      setWarning(false);
      warnTimerRef.current = setTimeout(() => enterWarning(expiry), warnAt - now);
    };

    const registerActivity = (now: number) => {
      lastWriteRef.current = now;
      localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
      schedule();
    };

    const markActivity = () => {
      const now = Date.now();
      if (now - lastWriteRef.current < THROTTLE_MS) return;
      registerActivity(now);
    };

    const onStorage = (event: StorageEvent) => {
      if (event.key === LAST_ACTIVITY_KEY) schedule();
    };

    stayRef.current = () => registerActivity(Date.now());

    registerActivity(Date.now());

    ACTIVITY_EVENTS.forEach((event) =>
      window.addEventListener(event, markActivity, { passive: true }),
    );
    window.addEventListener('storage', onStorage);

    return () => {
      clearTimers();
      setWarning(false);
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, markActivity));
      window.removeEventListener('storage', onStorage);
    };
  }, [isAuthenticated, logout, sessionTimeoutPreference]);

  return { warning, secondsLeft, stayConnected, logout };
}
