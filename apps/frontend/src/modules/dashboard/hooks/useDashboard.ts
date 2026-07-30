'use client';

import { useQuery } from '@tanstack/react-query';
import {
  getAlarms,
  getPendingAckAlarms,
  getAlarmStatusCounts,
  getDevices,
  getAdminStats,
  getRecentCommands,
  getSystemStatuses,
  getClientStats,
  getDashboardOverview,
  getCriticalAssets,
  type DashboardPeriod,
} from '../services/dashboard.service';
import { getAlarmEvents } from '@/modules/alarms/services/alarms-api.service';

export function useDevices(tenantId?: string) {
  return useQuery({
    // Mesma chave do hook da tela de Dispositivos (modules/devices) para que os
    // dois ecrãs compartilhem o mesmo cache e nunca exibam status divergentes.
    queryKey: ['devices', tenantId],
    queryFn: () => getDevices(tenantId),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useAlarms(tenantId?: string) {
  return useQuery({
    queryKey: ['dashboard-alarms', tenantId ?? 'all'],
    queryFn: () => getAlarms(tenantId),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

// Linhas dos normalizados-sem-ACK (a lista "a reconhecer" do card "Prioridade
// dos alarmes"). Compartilha o prefixo de chave ['dashboard-alarms'] com
// useAlarms, de modo que as invalidações já disparadas ao reconhecer um alarme
// (por prefixo) também atualizam este feed.
export function usePendingAckAlarms(tenantId?: string) {
  return useQuery({
    queryKey: ['dashboard-alarms', tenantId ?? 'all', 'pending-ack'],
    queryFn: () => getPendingAckAlarms(tenantId),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

// Contagens autoritativas (mesma fonte da tela de Alarmes). A chave mantém o
// prefixo ['dashboard-alarm-status-counts'] já invalidado ao reconhecer alarmes.
export function useAlarmStatusCounts(tenantId?: string, siteId?: string) {
  return useQuery({
    queryKey: ['dashboard-alarm-status-counts', tenantId ?? 'all', siteId ?? 'all'],
    queryFn: () => getAlarmStatusCounts(tenantId, siteId),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useAdminStats() {
  return useQuery({
    queryKey: ['dashboard-admin-stats'],
    queryFn: getAdminStats,
    // Mesma cadência das telas de devices/gateways para o status de gateway no
    // dashboard não ficar defasado em relação às demais telas.
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useRecentCommands(tenantId?: string, siteId?: string) {
  return useQuery({
    queryKey: ['recent-commands', tenantId ?? 'all', siteId ?? 'all'],
    queryFn: () => getRecentCommands(tenantId, siteId),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useSystemStatuses(tenantId?: string) {
  return useQuery({
    queryKey: ['system-statuses', tenantId ?? 'all'],
    queryFn: () => getSystemStatuses(tenantId),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

export function useClientStats(tenantId?: string) {
  return useQuery({
    queryKey: ['dashboard-client-stats', tenantId ?? 'all'],
    queryFn: () => getClientStats(tenantId),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

// Agregados de período do dashboard modernizado (janela atual vs anterior,
// tempo médio até ACK, ranking de clientes e auditoria recente na visão global).
export function useDashboardOverview(params: {
  period: DashboardPeriod;
  tenantId?: string;
  siteId?: string;
}) {
  const { period, tenantId, siteId } = params;
  return useQuery({
    queryKey: ['dashboard-overview', tenantId ?? 'all', siteId ?? 'all', period],
    queryFn: () => getDashboardOverview(period, tenantId, siteId),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}

// Ativos críticos (card do dashboard): estado atual + horas ligado no período,
// falha contínua e tempo offline dos itens marcados como críticos.
export function useCriticalAssets(params: {
  period: DashboardPeriod;
  tenantId?: string;
  siteId?: string;
}) {
  const { period, tenantId, siteId } = params;
  return useQuery({
    queryKey: ['dashboard-critical-assets', tenantId ?? 'all', siteId ?? 'all', period],
    queryFn: () => getCriticalAssets(period, tenantId, siteId),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

// Eventos de alarme (kind='ALARM') para o gráfico "Alarmes ao longo do tempo".
// A janela é ROLANTE: [now - windowMs, now] é recalculada dentro da queryFn a
// cada busca (incluindo os refetches periódicos), de modo que "últimas 24h/7d/
// 30d" nunca fica defasada durante uma sessão longa. A queryKey usa apenas o
// período (rótulo) + tenant/site — estável entre renders e refetches — e a
// própria queryFn devolve o {from, to} usado, para o gráfico montar os buckets
// exatamente sobre a janela buscada.
export function useAlarmTimeline(params: {
  tenantId?: string;
  siteId?: string;
  period: string;
  windowMs: number;
}) {
  const { tenantId, siteId, period, windowMs } = params;
  return useQuery({
    queryKey: ['dashboard-alarm-timeline', tenantId ?? 'all', siteId ?? 'all', period],
    queryFn: async () => {
      const to = new Date();
      const from = new Date(to.getTime() - windowMs);
      const events = await getAlarmEvents({ tenantId, siteId, from, to });
      return { events, from, to };
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
