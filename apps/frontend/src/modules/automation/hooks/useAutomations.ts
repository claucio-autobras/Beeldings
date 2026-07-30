'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getAutomations,
  getAutomationRuns,
  createAutomation,
  updateAutomation,
  setAutomationEnabled,
  deleteAutomation,
} from '../services/automation-api.service';
import type {
  CreateAutomationInput,
  UpdateAutomationInput,
} from '../types/automation.types';

export function useAutomations(tenantId?: string, siteId?: string) {
  return useQuery({
    queryKey: ['automations', tenantId, siteId],
    queryFn: () => getAutomations(tenantId, siteId),
    refetchInterval: 30_000,
    enabled: Boolean(tenantId),
  });
}

export function useAutomationRuns(params: {
  tenantId?: string;
  siteId?: string;
  automationId?: string;
  result?: string;
  page: number;
  pageSize?: number;
}) {
  return useQuery({
    queryKey: [
      'automation-runs',
      params.tenantId,
      params.siteId,
      params.automationId,
      params.result,
      params.page,
      params.pageSize,
    ],
    queryFn: () => getAutomationRuns(params),
    refetchInterval: 30_000,
    enabled: Boolean(params.tenantId),
  });
}

export function useCreateAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateAutomationInput) => createAutomation(input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['automations'] }),
  });
}

export function useUpdateAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateAutomationInput }) =>
      updateAutomation(id, input),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['automations'] }),
  });
}

export function useToggleAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled, tenantId }: { id: string; enabled: boolean; tenantId?: string }) =>
      setAutomationEnabled(id, enabled, tenantId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['automations'] }),
  });
}

export function useDeleteAutomation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, tenantId }: { id: string; tenantId?: string }) =>
      deleteAutomation(id, tenantId),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['automations'] }),
  });
}
