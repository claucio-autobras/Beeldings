'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ensureVirtualDevice,
  getProjectVirtualDevices,
  addVirtualPoints,
  setVirtualPointValue,
  deleteVirtualPoint,
} from '../services/simulator.service';
import type { NewVirtualPoint, VirtualDevice } from '../types/virtual.types';

/**
 * Estado da bancada de pontos virtuais de um projeto: garante o dispositivo
 * virtual e expõe mutações para criar/alterar/remover pontos. As alterações
 * invalidam a lista de dispositivos virtuais (`['scada-virtual-devices', projectId]`),
 * compartilhada com os hooks de tela (useScreenDevices/useViewer).
 */
export function useVirtualBench(projectId: string | undefined, tenantId: string | undefined) {
  const qc = useQueryClient();

  const deviceQuery = useQuery<VirtualDevice>({
    queryKey: ['scada-virtual-device', projectId],
    queryFn: () => ensureVirtualDevice({ projectId: projectId as string, tenantId }),
    enabled: Boolean(projectId),
  });

  const device = deviceQuery.data;

  function invalidate() {
    void qc.invalidateQueries({ queryKey: ['scada-virtual-device', projectId] });
    void qc.invalidateQueries({ queryKey: ['scada-virtual-devices', projectId] });
  }

  const NOT_READY = 'A bancada ainda está carregando. Tente novamente em instantes.';

  const addPoints = useMutation({
    mutationFn: (points: NewVirtualPoint[]) => {
      if (!device) throw new Error(NOT_READY);
      return addVirtualPoints(device.id, points);
    },
    onSuccess: invalidate,
  });

  const setValue = useMutation({
    mutationFn: ({ pointId, value }: { pointId: string; value: number | boolean }) => {
      if (!device) throw new Error(NOT_READY);
      return setVirtualPointValue(device.id, pointId, value);
    },
    onSuccess: invalidate,
  });

  const removePoint = useMutation({
    mutationFn: (pointId: string) => {
      if (!device) throw new Error(NOT_READY);
      return deleteVirtualPoint(device.id, pointId);
    },
    onSuccess: invalidate,
  });

  return {
    device,
    /** true quando o dispositivo virtual do projeto já foi garantido/carregado. */
    ready: Boolean(device),
    loading: deviceQuery.isLoading,
    /** Erro ao garantir o dispositivo virtual (ensure) — habilita o retry no modal. */
    ensureError: deviceQuery.isError ? (deviceQuery.error as Error) : null,
    /** Refaz a chamada de ensure (botão "tentar novamente"). */
    retryEnsure: () => { void deviceQuery.refetch(); },
    points: device?.points ?? [],
    addPoints,
    setValue,
    removePoint,
  };
}

/** Lista os dispositivos virtuais de um projeto (sem garantir/criar). */
export function useProjectVirtualDevices(projectId: string | undefined) {
  return useQuery<VirtualDevice[]>({
    queryKey: ['scada-virtual-devices', projectId],
    queryFn: () => getProjectVirtualDevices(projectId as string),
    enabled: Boolean(projectId),
  });
}
