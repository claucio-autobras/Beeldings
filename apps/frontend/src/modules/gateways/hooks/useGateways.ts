'use client';

import { useQuery } from '@tanstack/react-query';
import { getGateways } from '../services/gateways.service';

export function useGateways(tenantId?: string | null) {
  return useQuery({
    queryKey: ['gateways', tenantId],
    queryFn: () => getGateways(tenantId ?? undefined),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
