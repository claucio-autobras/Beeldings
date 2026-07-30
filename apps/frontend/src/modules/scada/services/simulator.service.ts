import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api-client';
import type { VirtualDevice, NewVirtualPoint } from '../types/virtual.types';

/**
 * Serviço da bancada de pontos virtuais (SCADA). Fala com o módulo `scada` do
 * backend (`/scada/simulator`). Os dispositivos virtuais são isolados da
 * produção (`protocol='virtual'`, `gatewayId=null`).
 */

/** Lista os dispositivos virtuais de um projeto (com seus pontos). */
export async function getProjectVirtualDevices(projectId: string): Promise<VirtualDevice[]> {
  return apiGet<VirtualDevice[]>(`/scada/simulator/devices?projectId=${encodeURIComponent(projectId)}`);
}

/** Garante (idempotente) o dispositivo virtual do projeto e o retorna. */
export async function ensureVirtualDevice(params: {
  projectId: string;
  tenantId?: string;
}): Promise<VirtualDevice> {
  return apiPost<VirtualDevice>('/scada/simulator/ensure', params);
}

/** Adiciona pontos virtuais ao dispositivo e retorna o dispositivo atualizado. */
export async function addVirtualPoints(
  deviceId: string,
  points: NewVirtualPoint[],
): Promise<VirtualDevice> {
  return apiPost<VirtualDevice>(`/scada/simulator/${deviceId}/points`, { points });
}

/** Altera o valor corrente de um ponto virtual (dispara emissão de telemetria). */
export async function setVirtualPointValue(
  deviceId: string,
  pointId: string,
  value: number | boolean,
): Promise<VirtualDevice> {
  return apiPatch<VirtualDevice>(`/scada/simulator/${deviceId}/points/${pointId}/value`, { value });
}

/** Remove um ponto virtual. */
export async function deleteVirtualPoint(
  deviceId: string,
  pointId: string,
): Promise<void> {
  await apiDelete(`/scada/simulator/${deviceId}/points/${pointId}`);
}
