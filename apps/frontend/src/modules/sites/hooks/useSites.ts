'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getSites,
  createSite,
  type CreateSiteDto,
} from '../services/sites.service';

export function useSites(tenantId?: string | null) {
  return useQuery({
    queryKey: ['sites', tenantId],
    queryFn: () => getSites(tenantId ?? undefined),
    staleTime: 30_000,
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
