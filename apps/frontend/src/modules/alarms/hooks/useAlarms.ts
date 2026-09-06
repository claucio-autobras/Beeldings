'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { acknowledgeAlarm, getAlarmStats, getAlarms, markNoticesRead } from '../services/alarms.service';

export function useAlarms(tenantId?: string) {
  return useQuery({
    queryKey: ['alarms', tenantId ?? 'all'],
    queryFn: () => getAlarms(tenantId),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useAlarmStats(tenantId?: string) {
  return useQuery({
    queryKey: ['alarms', 'stats', tenantId ?? 'all'],
    queryFn: () => getAlarmStats(tenantId),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useAcknowledgeAlarm() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      alarmId,
      userId,
      note,
    }: {
      alarmId: string;
      userId: string;
      note: string;
    }) => acknowledgeAlarm(alarmId, userId, note),

    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alarms'] });
    },
  });
}

export function useMarkNoticesRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ids: string[]) => markNoticesRead(ids),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alarms'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-alarms'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-alarm-status-counts'] });
    },
  });
}
