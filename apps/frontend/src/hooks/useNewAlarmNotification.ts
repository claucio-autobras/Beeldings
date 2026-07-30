'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import type { Alarm } from '@/mocks/data/alarms.mock';
import { generateMockAlarm } from '@/mocks/data/alarms.mock';


const IS_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === 'true';

// Intervalo de simulação automática em modo mock (30 segundos)
const MOCK_AUTO_INTERVAL_MS = 30_000;

export interface NewAlarmNotificationState {
  /** Alarmes novos pendentes de visualização */
  pendingAlarms: Alarm[];
  /** Se o modal deve ser exibido */
  showModal: boolean;
  /** Adiciona novos alarmes à fila de pendentes e exibe o modal */
  addAlarms: (alarms: Alarm[]) => void;
  /** Fecha o modal sem reconhecer os alarmes */
  dismissModal: () => void;
  /** Reconhece todos os alarmes pendentes e fecha o modal */
  acknowledgeAll: () => void;
  /** Liga/desliga a simulação automática de alarmes (apenas em modo mock) */
  setAutoSimulate: (enabled: boolean) => void;
  /** Estado da simulação automática */
  autoSimulate: boolean;
}

/**
 * Hook que gerencia o estado de notificação de novos alarmes em tempo real.
 *
 * Em modo mock (`NEXT_PUBLIC_USE_MOCK=true`), pode simular chegada automática
 * de novos alarmes a cada 30 segundos quando `autoSimulate` estiver ativado.
 */
export function useNewAlarmNotification(): NewAlarmNotificationState {
  const [pendingAlarms, setPendingAlarms] = useState<Alarm[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [autoSimulate, setAutoSimulateState] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const addAlarms = useCallback((alarms: Alarm[]) => {
    if (alarms.length === 0) return;
    setPendingAlarms((prev) => {
      // Evitar duplicatas pelo id
      const existingIds = new Set(prev.map((a) => a.id));
      const novos = alarms.filter((a) => !existingIds.has(a.id));
      if (novos.length === 0) return prev;
      return [...prev, ...novos];
    });
    setShowModal(true);
  }, []);

  const dismissModal = useCallback(() => {
    setShowModal(false);
    // Mantém pendingAlarms para referência, limpa ao reabrir
    setPendingAlarms([]);
  }, []);

  const acknowledgeAll = useCallback(() => {
    setShowModal(false);
    setPendingAlarms([]);
  }, []);

  const setAutoSimulate = useCallback((enabled: boolean) => {
    if (!IS_MOCK) return;
    setAutoSimulateState(enabled);
  }, []);

  // Simulação automática em modo mock
  useEffect(() => {
    if (!IS_MOCK || !autoSimulate) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      const count = Math.random() < 0.4 ? 2 : 1;
      const novos: Alarm[] = Array.from({ length: count }, () => generateMockAlarm());
      addAlarms(novos);
    }, MOCK_AUTO_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [autoSimulate, addAlarms]);

  return {
    pendingAlarms,
    showModal,
    addAlarms,
    dismissModal,
    acknowledgeAll,
    setAutoSimulate,
    autoSimulate,
  };
}
