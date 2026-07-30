'use client';

import { useQuery } from '@tanstack/react-query';
import { getScreen } from '../services/scada.service';
import { getDevices, type Device } from '@/modules/devices/services/devices.service';
import { getCameras, type Camera } from '@/modules/cftv/services/cftv.service';
import { getProjectVirtualDevices } from '../services/simulator.service';
import { useScreenTelemetry, type PointStatus, type PointReading } from './useScreenTelemetry';
import { useScreenAlarmGroups } from './useScreenAlarmGroups';
import type { AlarmGroupAggregate } from '../services/alarm-groups.service';
import type { ScadaScreen } from '../types/scada.types';
import type { ScreenDevice, VirtualDevice } from '../types/virtual.types';

export interface UseViewerResult {
  screen: ScadaScreen | null;
  loading: boolean;
  /** true quando conectado ao stream de telemetria do backend. */
  connected: boolean;
  getTagValue: (deviceId: string, tag: string) => number | boolean | string | null;
  /** Leitura completa (valor + horário) de um ponto — popup de telemetria da câmera. */
  getTagReading: (deviceId: string, tag: string) => PointReading | null;
  /** Status de comunicação de um ponto (live / stale / no-data) para sinalizar offline. */
  getTagStatus: (deviceId: string, tag: string) => PointStatus;
  /** Resolve o agregado ao vivo de uma soma de alarme por id (widget alarm-group-badge). */
  getGroupAggregate: (groupId: string) => AlarmGroupAggregate | null;
  /** Controladoras do projeto da tela (reais + virtuais, fonte de comandos). */
  devices: ScreenDevice[];
}

/**
 * Carrega uma tela SCADA real (persistida) e resolve valores ao vivo dos pontos
 * via telemetria (socket). Ver [[useScreenTelemetry]] para a resolução do valor.
 */
export function useViewer(screenId: string): UseViewerResult {
  const { data: screen, isLoading } = useQuery<ScadaScreen>({
    queryKey: ['scada-screen', screenId],
    queryFn: () => getScreen(screenId),
  });

  const { data: devices = [] } = useQuery<Device[]>({
    queryKey: ['devices', screen?.tenantId ?? null],
    queryFn: () => getDevices(screen?.tenantId),
    enabled: Boolean(screen?.tenantId),
  });

  const { data: virtualDevices = [] } = useQuery<VirtualDevice[]>({
    queryKey: ['scada-virtual-devices', screen?.projectId],
    queryFn: () => getProjectVirtualDevices(screen?.projectId as string),
    enabled: Boolean(screen?.projectId),
  });

  // Câmeras CFTV não vêm no GET /devices (fora do universo BMS) — busca
  // dedicada para o widget de câmera resolver STATUS/telemetria ao vivo.
  const { data: cameras = [] } = useQuery<Camera[]>({
    queryKey: ['cftv-cameras', screen?.tenantId ?? null],
    queryFn: () => getCameras(screen?.tenantId),
    enabled: Boolean(screen?.tenantId),
  });

  const merged: ScreenDevice[] = [...devices, ...cameras, ...virtualDevices];

  const { getValue, getReading, getPointStatus, connected } = useScreenTelemetry(merged, Boolean(screen));

  const { getGroupAggregate } = useScreenAlarmGroups(
    screen?.tenantId,
    screen?.projectId,
    Boolean(screen),
  );

  return {
    screen: screen ?? null,
    loading: isLoading,
    connected,
    getTagValue: getValue,
    getTagReading: getReading,
    getTagStatus: getPointStatus,
    getGroupAggregate,
    devices: merged,
  };
}
