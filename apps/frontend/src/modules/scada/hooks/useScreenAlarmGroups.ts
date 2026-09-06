'use client';

import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listAlarmGroups, type AlarmGroupAggregate } from '../services/alarm-groups.service';

export interface UseScreenAlarmGroupsResult {
  /** Resolve o agregado ao vivo (ativos/total/severidade) de uma soma de alarme por id. */
  getGroupAggregate: (groupId: string) => AlarmGroupAggregate | null;
}

/**
 * Carrega as somas de alarme (alarm groups) do projeto da tela e expõe um
 * resolvedor por id para os widgets 'alarm-group-badge'. O agregado é derivado
 * no backend a cada leitura; aqui só revalidamos periodicamente.
 */
export function useScreenAlarmGroups(
  tenantId?: string,
  projectId?: string,
  enabled = true,
): UseScreenAlarmGroupsResult {
  const { data: groups = [] } = useQuery({
    queryKey: ['alarm-groups', 'screen', tenantId ?? null, projectId ?? null],
    queryFn: () => listAlarmGroups({ tenantId, projectId }),
    enabled: enabled && Boolean(tenantId),
    refetchInterval: 10_000,
    staleTime: 5_000,
  });

  const byId = useMemo(() => {
    const map = new Map<string, AlarmGroupAggregate>();
    for (const g of groups) map.set(g.id, g.aggregate);
    return map;
  }, [groups]);

  const getGroupAggregate = useCallback(
    (groupId: string): AlarmGroupAggregate | null => byId.get(groupId) ?? null,
    [byId],
  );

  return { getGroupAggregate };
}
