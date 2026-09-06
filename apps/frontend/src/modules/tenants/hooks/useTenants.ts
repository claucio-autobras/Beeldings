'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getTenants,
  createTenant,
  type CreateTenantDto,
} from '../services/tenants.service';

interface UseTenantsOptions {
  enabled?: boolean;
  /**
   * Separates tenant-scoped responses in the React Query cache from the
   * global tenant list used by administrative screens.
   */
  scope?: string | null;
}

export function useTenants(opts?: UseTenantsOptions) {
  const scopeKey = opts?.scope === undefined ? 'all' : `tenant:${opts.scope ?? 'none'}`;

  return useQuery({
    queryKey: ['tenants', scopeKey],
    queryFn: getTenants,
    staleTime: 30_000,
    enabled: opts?.enabled ?? true,
  });
}

export function useCreateTenant() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateTenantDto) => createTenant(data),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['tenants'] });
    },
  });
}
