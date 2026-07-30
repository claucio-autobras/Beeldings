'use client';

import { useQuery } from '@tanstack/react-query';
import { getProject } from '@/modules/projects/services/projects.service';
import { getDevices, type Device } from '@/modules/devices/services/devices.service';
import { getCameras, type Camera } from '@/modules/cftv/services/cftv.service';
import { getProjectVirtualDevices } from '../services/simulator.service';
import type { ScreenDevice, VirtualDevice } from '../types/virtual.types';

interface UseScreenDevicesResult {
  /** Controladoras da tela: reais (gateway do projeto) + virtuais (bancada). */
  devices: ScreenDevice[];
  loading: boolean;
  /** Gateway resolvido a partir do projeto (para diagnóstico/empty-state). */
  gatewayId: string | null;
}

/**
 * Resolve as controladoras reais de uma tela SCADA: tela → projeto → gateway →
 * dispositivos. "Dispositivos do projeto" = devices cujo `gatewayId` é o gateway
 * do projeto. Usado tanto pelo binding (editor) quanto pelo viewer.
 */
export function useScreenDevices(
  projectId: string | undefined,
  tenantId: string | undefined,
): UseScreenDevicesResult {
  const { data: project, isLoading: loadingProject } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId as string),
    enabled: Boolean(projectId),
  });

  const gatewayId = project?.gateway?.id ?? null;

  const { data: devices = [], isLoading: loadingDevices } = useQuery<Device[]>({
    queryKey: ['devices', tenantId ?? null],
    queryFn: () => getDevices(tenantId),
    enabled: Boolean(tenantId),
  });

  const { data: virtualDevices = [], isLoading: loadingVirtual } = useQuery<VirtualDevice[]>({
    queryKey: ['scada-virtual-devices', projectId],
    queryFn: () => getProjectVirtualDevices(projectId as string),
    enabled: Boolean(projectId),
  });

  // Câmeras CFTV (protocol snmp/onvif) NÃO vêm no GET /devices (fora do universo
  // BMS) — busca dedicada para o widget de câmera do SCADA poder vinculá-las.
  const { data: cameras = [], isLoading: loadingCameras } = useQuery<Camera[]>({
    queryKey: ['cftv-cameras', tenantId],
    queryFn: () => getCameras(tenantId),
    enabled: Boolean(tenantId),
  });

  const scoped = gatewayId ? devices.filter((d) => d.gatewayId === gatewayId) : [];
  const scopedCameras = gatewayId ? cameras.filter((c) => c.gatewayId === gatewayId) : [];
  const merged: ScreenDevice[] = [...scoped, ...scopedCameras, ...virtualDevices];

  return {
    devices: merged,
    gatewayId,
    loading: loadingProject || loadingDevices || loadingVirtual || loadingCameras,
  };
}
