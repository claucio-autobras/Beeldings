// ─── Tipos de domínio do módulo de Dashboard ──────────────────────────────────

export type TenantAlarmSeverity = 'active' | 'acknowledged' | 'none';

export interface TenantAlarmEntry {
  tenantName: string;
  alarmCount: number;
  severity: TenantAlarmSeverity;
}

export interface GatewayEntry {
  id: string;
  name: string;
  tenantName: string;
  status: 'online' | 'offline' | 'degraded';
}

export interface AdminStats {
  totalSites: number;
  activeSites: number;
  totalDevices: number;
  onlineDevices: number;
  pendingCommands: number;
  alarmsByTenant: TenantAlarmEntry[];
  devicesByStatus: { online: number; offline: number };
  alarmsByStatus: { alarme: number; normal: number; reconhecido: number };
  gateways: GatewayEntry[];
  activeAutomations: number;
}

export interface PendingCommand {
  id: string;
  tenantName: string;
  /** Site de onde o comando partiu — null em logs antigos sem vínculo resolvível. */
  siteId: string | null;
  siteName: string | null;
  deviceName: string;
  command: string;
  requestedAt: string;
  requestedBy: string;
  status: 'pending' | 'executing' | 'done' | 'failed';
}

export interface SystemStatus {
  id: string;
  name: string;
  status: 'normal' | 'atencao' | 'falha';
  lastCheck: string;
}

export interface ClientStats {
  energyKwh: number;
  energyDeltaPct: number;
  avgTemperature: number;
  avgHumidity: number;
  totalSystems: number;
  systemsWithIssues: number;
}
