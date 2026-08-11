'use client';

import { useQuery } from '@tanstack/react-query';
import { getProject } from '@/modules/projects/services/projects.service';
import { getDevices, type Device } from '@/modules/devices/services/devices.service';
import {
  getCameras,
  getSwitches,
  type Camera,
  type ManagedSwitch,
  type SwitchScalarPoint,
} from '@/modules/cftv/services/cftv.service';
import { getProjectVirtualDevices } from '../services/simulator.service';
import type { ScreenDevice, VirtualDevice } from '../types/virtual.types';

interface UseScreenDevicesResult {
  /** Controladoras da tela: reais (gateway do projeto) + virtuais (bancada). */
  devices: ScreenDevice[];
  loading: boolean;
  /** Gateway resolvido a partir do projeto (para diagnóstico/empty-state). */
  gatewayId: string | null;
}

// ─── Switch flattening ────────────────────────────────────────────────────────

/**
 * Converte um ponto de porta (embutido em SwitchPortEntry) no mesmo formato de
 * SwitchScalarPoint para que o BindingSelector possa listá-lo junto dos
 * pontos escalares (STATUS / UPTIME / CPU).
 *
 * Os campos `metric` e `unit` são inferidos a partir do objectType de origem:
 *   sw-state → if_oper_status (sem unidade)
 *   sw-in    → if_in_octets  (B/s)
 *   sw-out   → if_out_octets (B/s)
 */
function portPointAsScalar(
  p: { id: string; tag: string; objectName: string; lastValue: number | null; lastValueAt: string | null },
  metric: string,
  unit: string,
): SwitchScalarPoint {
  return {
    id: p.id,
    tag: p.tag,
    objectName: p.objectName,
    metric,
    oid: null,
    unsupported: false,
    unit,
    critical: false,
    lastValue: p.lastValue,
    lastValueAt: p.lastValueAt,
    lastValueState: null,
  };
}

/**
 * Retorna uma cópia do switch com todos os pontos de porta achatados em
 * `points` (além dos pontos escalares já presentes). Usado apenas para o
 * SCADA — a página CFTV continua lendo `sw.ports` do seu próprio cache.
 */
function flattenSwitchForScada(sw: ManagedSwitch): ManagedSwitch {
  const portPoints: SwitchScalarPoint[] = sw.ports.flatMap((port) => {
    const pts: SwitchScalarPoint[] = [];
    if (port.statePoint)
      pts.push(portPointAsScalar(port.statePoint, 'if_oper_status', ''));
    if (port.inPoint)
      pts.push(portPointAsScalar(port.inPoint, 'if_in_octets', 'B/s'));
    if (port.outPoint)
      pts.push(portPointAsScalar(port.outPoint, 'if_out_octets', 'B/s'));
    return pts;
  });
  // Porta points appended after scalars; sw.ports preserved (same reference).
  return { ...sw, points: [...sw.points, ...portPoints] };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

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

  // Switches gerenciáveis — pontos escalares + pontos de porta achatados para
  // que o BindingSelector possa vinculá-los a widgets genéricos.
  const { data: switches = [], isLoading: loadingSwitches } = useQuery<ManagedSwitch[]>({
    queryKey: ['cftv-switches', tenantId],
    queryFn: () => getSwitches(tenantId),
    enabled: Boolean(tenantId),
  });

  const scoped = gatewayId ? devices.filter((d) => d.gatewayId === gatewayId) : [];
  const scopedCameras = gatewayId ? cameras.filter((c) => c.gatewayId === gatewayId) : [];
  // flattenSwitchForScada appends port points to sw.points for the selector.
  const scopedSwitches = gatewayId
    ? switches.filter((s) => s.gatewayId === gatewayId).map(flattenSwitchForScada)
    : [];
  const merged: ScreenDevice[] = [...scoped, ...scopedCameras, ...scopedSwitches, ...virtualDevices];

  return {
    devices: merged,
    gatewayId,
    loading: loadingProject || loadingDevices || loadingVirtual || loadingCameras || loadingSwitches,
  };
}
