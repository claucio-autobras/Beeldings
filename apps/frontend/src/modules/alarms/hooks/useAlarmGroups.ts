'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  listAlarmGroups,
  createAlarmGroup,
  updateAlarmGroup,
  deleteAlarmGroup,
  type AlarmGroupFilters,
  type CreateAlarmGroupInput,
  type UpdateAlarmGroupInput,
} from '@/modules/scada/services/alarm-groups.service';

export function useAlarmGroups(filters: AlarmGroupFilters = {}) {
  return useQuery({
    queryKey: ['alarm-groups', 'manage', filters.tenantId ?? 'all', filters.siteId ?? 'all', filters.projectId ?? 'all'],
    queryFn: () => listAlarmGroups(filters),
    refetchInterval: 15_000,
    staleTime: 5_000,
    enabled: Boolean(filters.tenantId),
  });
}

export function useCreateAlarmGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAlarmGroupInput) => createAlarmGroup(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['alarm-groups'] }),
  });
}

export function useUpdateAlarmGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateAlarmGroupInput }) => updateAlarmGroup(id, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['alarm-groups'] }),
  });
}

export function useDeleteAlarmGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteAlarmGroup(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['alarm-groups'] }),
  });
}
