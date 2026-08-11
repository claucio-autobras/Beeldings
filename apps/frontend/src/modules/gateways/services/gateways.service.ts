import { apiGet, apiPost } from '@/lib/api-client';

/** Estado da conexão MQTT do gateway (parte do resumo de saúde). */
export interface GatewayMqttHealth {
  connected: boolean;
  broker?: string;
  connectCount?: number;
  reconnectCount?: number;
  lastConnectedAt?: string | null;
  lastDisconnectedAt?: string | null;
  lastError?: string | null;
}

/** Latência do último ciclo de polling de um device (parte do resumo). */
export interface GatewayPollingHealth {
  protocol: string;
  deviceId: string;
  /** Nome do device (enriquecido pelo backend a partir do cadastro; opcional). */
  deviceName?: string;
  lastLatencyMs: number;
  lastPointsRead: number;
  lastPointsAttempted: number;
  lastPollAt: string;
  totalCycles: number;
  /** Instante da última leitura bem-sucedida (>0 pontos), se houver. */
  lastSuccessAt?: string;
  /** MQTT (passivo): total de mensagens recebidas desde o boot. */
  messagesReceived?: number;
  /** MQTT (passivo): instante da última mensagem recebida (ISO). */
  lastMessageAt?: string;
}

/** Último resumo de saúde recebido de um gateway (aditivo, pode faltar). */
export interface GatewayHealthSummary {
  timestamp: string;
  receivedAt: string;
  uptimeSeconds: number;
  /** Versão do gateway em execução (ausente em gateways antigos). */
  version?: string;
  /** True quando o gateway roda sob o launcher OTA (suporta atualização remota). */
  otaSupported?: boolean;
  mqtt: GatewayMqttHealth;
  storeAndForward: { pending: number; dropped: number };
  polling: GatewayPollingHealth[];
}

/** Estágios da atualização remota (OTA) reportados pelo gateway (+ `expired`, gerado pelo backend). */
export type GatewayOtaStage =
  | 'downloading'
  | 'applying'
  | 'restarting'
  | 'completed'
  | 'failed'
  | 'rolled_back'
  | 'expired';

/** Progresso da atualização remota em andamento (em memória no backend). */
export interface GatewayOtaProgress {
  commandId: string;
  stage: GatewayOtaStage;
  version: string;
  fromVersion: string;
  error: string | null;
  ts: string;
  receivedAt: string;
}

export interface GatewayItem {
  id: string;
  tenantId: string;
  status: string;
  lastSeen?: string | null;
  createdAt: string;
  health?: GatewayHealthSummary | null;
  /** Versão reportada pelo gateway (health ao vivo ou persistida). */
  reportedVersion?: string | null;
  /** Versão do código do gateway disponível no servidor. */
  latestVersion?: string;
  /** True quando o gateway suporta atualização remota (launcher OTA). */
  otaSupported?: boolean;
  /** Progresso da OTA em andamento, se houver. */
  ota?: GatewayOtaProgress | null;
  /** Último resultado persistido de OTA. */
  otaState?: string | null;
  otaMessage?: string | null;
  otaAt?: string | null;
}

export async function getGateways(tenantId?: string): Promise<GatewayItem[]> {
  const qs = tenantId ? `?tenantId=${tenantId}` : '';
  return apiGet<GatewayItem[]>(`/gateways${qs}`);
}

/** Resumo leve para o badge do menu: número de gateways online com update disponível. */
export async function getGatewayUpdateSummary(tenantId?: string): Promise<{ updatable: number }> {
  const qs = tenantId ? `?tenantId=${tenantId}` : '';
  return apiGet<{ updatable: number }>(`/gateways/update-summary${qs}`);
}

/** Dispara a atualização remota (OTA) de um gateway. */
export async function triggerGatewayUpdate(id: string): Promise<{ version: string }> {
  return apiPost<{ version: string }>(`/gateways/${id}/update`, {});
}

/** Cancela/limpa uma atualização OTA travada (libera novo disparo). */
export async function cancelGatewayUpdate(id: string): Promise<void> {
  await apiPost<void>(`/gateways/${id}/update/cancel`, {});
}

/**
 * Compara versões semânticas simples ("1.2.3"). Retorna >0 se a > b.
 * Tolerante a valores ausentes (tratados como 0.0.0).
 */
export function compareVersions(a?: string | null, b?: string | null): number {
  const pa = (a ?? '0.0.0').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = (b ?? '0.0.0').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
