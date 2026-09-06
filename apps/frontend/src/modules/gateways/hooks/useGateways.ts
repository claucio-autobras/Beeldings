'use client';

import { useQuery } from '@tanstack/react-query';
import { getGateways } from '../services/gateways.service';

/**
 * Lista gateways, opcionalmente filtrados por tenant.
 * `enabled: false` evita a chamada (ex.: formulário global sem cliente
 * escolhido — tenant vazio no backend significa "sem filtro").
 */
export function useGateways(tenantId?: string | null, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['gateways', tenantId],
    queryFn: () => getGateways(tenantId ?? undefined),
    staleTime: 15_000,
    refetchInterval: 30_000,
    enabled: opts?.enabled ?? true,
  });
}
