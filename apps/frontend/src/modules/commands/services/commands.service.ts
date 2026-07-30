import { apiGet, apiPost } from '@/lib/api-client';

// ─── Comandos de escrita BACnet ──────────────────────────────────────────────

/** Mapa de rótulo de tipo BACnet → número do protocolo. */
const OBJECT_TYPE_NUM: Record<string, number> = {
  AI: 0, AO: 1, AV: 2, BI: 3, BO: 4, BV: 5, MSI: 13, MSO: 14,
};

/** Mapa inverso número → rótulo. */
const NUM_TO_LABEL: Record<number, string> = Object.fromEntries(
  Object.entries(OBJECT_TYPE_NUM).map(([label, num]) => [num, label]),
);

/** Números de tipos de objeto BACnet que aceitam escrita (AO, AV, BO, BV, MSO). */
const WRITABLE_NUMS = new Set([1, 2, 4, 5, 14]);

/** Números de tipos digitais — valor 0/1 (BO, BV, MSO). */
const DIGITAL_NUMS = new Set([4, 5, 14]);

/**
 * Normaliza o objectType (número, string numérica "4" ou rótulo "BO") para o
 * número do protocolo BACnet. Dispositivos podem armazenar qualquer das formas.
 */
export function objectTypeToNum(t: string | number): number {
  if (typeof t === 'number') return t;
  const n = Number(t);
  if (!Number.isNaN(n) && t.trim() !== '') return n;
  return OBJECT_TYPE_NUM[t] ?? 0;
}

/** Rótulo legível (AO, BO, …) a partir de número, string numérica ou rótulo. */
export function objectTypeLabel(t: string | number): string {
  const n = objectTypeToNum(t);
  return NUM_TO_LABEL[n] ?? String(t);
}

export function isWritableType(t: string | number): boolean {
  return WRITABLE_NUMS.has(objectTypeToNum(t));
}

export function isDigitalType(t: string | number): boolean {
  return DIGITAL_NUMS.has(objectTypeToNum(t));
}

export interface SendBacnetCommandParams {
  tenantId: string;
  gatewayId: string;
  ip: string;
  port: number;
  objectType: number;
  objectInstance: number;
  value: number | boolean;
  priority?: number;
  /** Rótulo legível do ponto — usado na trilha de auditoria/dashboard. */
  pointLabel?: string;
  /** Id do Device comandado — usado só pela trilha de auditoria (site no dashboard). */
  deviceId?: string;
}

interface BacnetWriteResponse {
  success: boolean;
  command_id?: string;
  error?: string;
}

/**
 * Envia um comando de escrita BACnet ao backend, que publica via MQTT ao gateway.
 * O endpoint sempre responde HTTP 200; o sucesso real vem em `success`.
 * Lança erro com mensagem amigável se o gateway recusar ou não responder.
 */
export async function sendBacnetCommand(
  params: SendBacnetCommandParams,
): Promise<{ commandId: string }> {
  const data = await apiPost<BacnetWriteResponse>('/devices/bacnet/write', params);
  if (!data.success) {
    throw new Error(data.error ?? 'O gateway não confirmou a execução do comando.');
  }
  return { commandId: data.command_id ?? '' };
}

// ─── Histórico de comandos ───────────────────────────────────────────────────

export type CommandResult = 'success' | 'error' | 'unknown';

/** Uma entrada do histórico de comandos (trilha de auditoria `device_command`). */
export interface CommandHistoryEntry {
  id: string;
  createdAt: string;
  userId: string | null;
  userName: string;
  userEmail: string;
  userRole: string;
  tenantId: string | null;
  gatewayId: string | null;
  siteId: string | null;
  siteName: string | null;
  target: string;
  value: string;
  result: CommandResult;
  error: string | null;
}

export interface CommandHistoryFilters {
  tenantId?: string;
  gatewayId?: string;
  userId?: string;
  result?: 'success' | 'error';
  from?: Date;
  to?: Date;
}

/**
 * Busca o histórico de comandos no backend (reaproveita a trilha de auditoria).
 * Usa `apiGet`, que sempre faz parse de JSON — o endpoint retorna um array.
 */
export async function getCommandHistory(
  filters: CommandHistoryFilters,
): Promise<CommandHistoryEntry[]> {
  const params = new URLSearchParams();
  if (filters.tenantId) params.set('tenantId', filters.tenantId);
  if (filters.gatewayId) params.set('gatewayId', filters.gatewayId);
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.result) params.set('result', filters.result);
  if (filters.from) params.set('from', filters.from.toISOString());
  if (filters.to) params.set('to', filters.to.toISOString());
  const qs = params.toString();
  return apiGet<CommandHistoryEntry[]>(`/reports/command-history${qs ? `?${qs}` : ''}`);
}
