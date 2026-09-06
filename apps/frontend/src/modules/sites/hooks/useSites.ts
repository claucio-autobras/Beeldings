'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getSites,
  createSite,
  type CreateSiteDto,
} from '../services/sites.service';

/**
 * Lista sites, opcionalmente filtrados por tenant.
 * `enabled: false` evita a chamada (ex.: formulário global sem cliente
 * escolhido — tenant vazio no backend significa "sem filtro").
 */
export function useSites(tenantId?: string | null, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['sites', tenantId],
    queryFn: () => getSites(tenantId ?? undefined),
    staleTime: 30_000,
    enabled: opts?.enabled ?? true,
  });
}

export function useCreateSite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateSiteDto) => createSite(data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sites'] });
    },
  });
}
