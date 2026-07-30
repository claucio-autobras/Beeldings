'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getTenants,
  createTenant,
  type CreateTenantDto,
} from '../services/tenants.service';

export function useTenants() {
  return useQuery({
    queryKey: ['tenants'],
    queryFn: getTenants,
    staleTime: 30_000,
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
