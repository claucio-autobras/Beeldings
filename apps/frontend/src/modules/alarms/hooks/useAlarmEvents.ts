'use client';

import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/modules/auth/store/auth.store';
import {
  acquireTelemetrySocket,
  releaseTelemetrySocket,
  setTelemetryScope,
} from '@/lib/telemetry-socket';
import { useTenantFilter } from '@/hooks/useTenantFilter';
import {
  acknowledgeAlarmEvent,
  acknowledgeAlarmEvents,
  getAlarmEvents,
  getAlarmStats,
  type AlarmEventFilters,
} from '../services/alarms-api.service';

const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === 'true';

export function useAlarmEvents(filters: AlarmEventFilters = {}) {
  return useQuery({
    queryKey: ['alarm-events', filters],
    queryFn: () => getAlarmEvents(filters),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function useAlarmEventStats(tenantId?: string, siteId?: string) {
  return useQuery({
    queryKey: ['alarm-events', 'stats', tenantId ?? 'all', siteId ?? 'all'],
    queryFn: () => getAlarmStats(tenantId, siteId),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });
}

export function useAcknowledgeAlarmEvent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, userId, note }: { eventId: string; userId?: string; note?: string }) =>
      acknowledgeAlarmEvent(eventId, userId, note),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alarm-events'] });
      void qc.invalidateQueries({ queryKey: ['alarms'] }); // sino legado
    },
  });
}

export function useAcknowledgeAlarmEvents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, note }: { ids: string[]; note?: string }) => acknowledgeAlarmEvents(ids, note),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['alarm-events'] });
      void qc.invalidateQueries({ queryKey: ['alarms'] }); // sino legado
    },
  });
}

/**
 * Assina o canal `alarm:event` (namespace /telemetry) e invalida as queries de
 * alarmes a cada transição emitida pelo motor — mantém a tela em tempo real.
 */
export function useAlarmRealtime(enabled = true): void {
  const qc = useQueryClient();
  const hasSession = useAuthStore((s) => s.session !== null);
  const { selectedTenantId } = useTenantFilter();
  useEffect(() => {
    // Modo demonstração: sem backend de tempo real, não abre socket.
    if (!enabled || USE_MOCK) return;
    // Sem sessão o handshake seria recusado — aguarda a sessão hidratar.
    if (!hasSession) return;
    // Socket COMPARTILHADO do namespace /telemetry (ver lib/telemetry-socket):
    // um único socket por página; o escopo de tenant é reemitido pelo módulo.
    const socket = acquireTelemetrySocket();
    setTelemetryScope(selectedTenantId ?? null);
    const onAlarmEvent = () => {
      // Cada tela consome os alarmes por uma query key própria; invalida todas:
      // página de alarmes (alarm-events), sino do Topbar (alarms), lista do
      // dashboard (dashboard-alarms) e contagens do gráfico "Alarmes por Status"
      // (dashboard-alarm-status-counts). Sem isso, o gráfico só atualizaria no
      // poll de 30s e os alarmes ativos demoram a aparecer ao chegar.
      void qc.invalidateQueries({ queryKey: ['alarm-events'] });
      void qc.invalidateQueries({ queryKey: ['alarms'] });
      void qc.invalidateQueries({ queryKey: ['dashboard-alarms'] });
      void qc.invalidateQueries({ queryKey: ['dashboard-alarm-status-counts'] });
    };
    socket.on('alarm:event', onAlarmEvent);
    return () => {
      // Remove SÓ o listener deste hook — o socket é compartilhado.
      socket.off('alarm:event', onAlarmEvent);
      releaseTelemetrySocket();
    };
  }, [enabled, qc, hasSession, selectedTenantId]);
}
