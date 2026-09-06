'use client';

import { useQuery } from '@tanstack/react-query';
import { getControllers } from '../services/sca.service';
import { useTenantFilter } from '@/hooks/useTenantFilter';

/**
 * Hook que carrega a lista de controladoras de acesso do tenant efetivo.
 * Revalida a cada 30 s para refletir mudanças de status (online/offline).
 */
export function useControllers() {
  const { selectedTenantId } = useTenantFilter();

  return useQuery({
    queryKey: ['sca-controllers', selectedTenantId ?? ''],
    queryFn: () => getControllers(selectedTenantId ?? undefined),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
