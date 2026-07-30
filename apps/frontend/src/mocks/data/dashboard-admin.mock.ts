export type TenantAlarmSeverity = 'active' | 'acknowledged' | 'none';

export interface TenantAlarmEntry {
  tenantName: string;
  alarmCount: number;
  /** Pior status de alarme do cliente: active (sem ACK) > acknowledged > none */
  severity: TenantAlarmSeverity;
}

export interface GatewayEntry {
  id: string;
  name: string;
  tenantName: string;
  status: 'online' | 'offline' | 'degraded';
}

export const mockGateways: GatewayEntry[] = [
  { id: 'gw-001', name: 'Gateway Empresa Demo',        tenantName: 'Empresa Demo',        status: 'online'   },
  { id: 'gw-002', name: 'Gateway Petroquímica Norte',  tenantName: 'Petroquímica Norte',  status: 'online'   },
  { id: 'gw-003', name: 'Gateway Shopping Metrópolis', tenantName: 'Shopping Metrópolis', status: 'online'   },
  { id: 'gw-004', name: 'Gateway Hospital São Rafael', tenantName: 'Hospital São Rafael', status: 'offline'  },
  { id: 'gw-005', name: 'Gateway Shop B Ltda',         tenantName: 'Shop B Ltda',         status: 'online'   },
  { id: 'gw-006', name: 'Gateway Logística Express',   tenantName: 'Logística Express',   status: 'degraded' },
  { id: 'gw-007', name: 'Gateway Torres Corporativas', tenantName: 'Torres Corporativas', status: 'online'   },
  { id: 'gw-008', name: 'Gateway Ind. Cimenteira',     tenantName: 'Indústria Cimenteira',status: 'online'   },
];

export const mockAdminStats = {
  totalSites: 13,
  activeSites: 11,
  totalDevices: 1248,
  onlineDevices: 1056,
  pendingCommands: 5,
  alarmsByTenant: [
    { tenantName: 'Petroquímica Norte',    alarmCount: 8, severity: 'active'       },
    { tenantName: 'Shopping Metrópolis',   alarmCount: 6, severity: 'active'       },
    { tenantName: 'Empresa Demo',          alarmCount: 5, severity: 'active'       },
    { tenantName: 'Hospital São Rafael',   alarmCount: 4, severity: 'acknowledged' },
    { tenantName: 'Shop B Ltda',           alarmCount: 3, severity: 'active'       },
    { tenantName: 'Logística Express',     alarmCount: 3, severity: 'acknowledged' },
    { tenantName: 'Torres Corporativas',   alarmCount: 2, severity: 'acknowledged' },
    { tenantName: 'Indústria Cimenteira',  alarmCount: 1, severity: 'none'         },
  ] as TenantAlarmEntry[],
  devicesByStatus: { online: 1056, offline: 192 },
  alarmsByStatus: { alarme: 6, normal: 3, reconhecido: 12 },
  gateways: mockGateways,
  activeAutomations: 14,
};

export interface PendingCommand {
  id: string;
  requestedAt: string;
  tenantName: string;
  siteName: string;
  deviceName: string;
  action: string;
  requestedBy: string;
}

const now = new Date('2026-06-01T10:00:00Z').getTime();
const minsAgo = (m: number) => new Date(now - m * 60_000).toISOString();

export const mockPendingCommands: PendingCommand[] = [
  {
    id: 'cmd-001',
    requestedAt: minsAgo(5),
    tenantName: 'Empresa Demo',
    siteName: 'Casa de Máquinas — Subsolo',
    deviceName: 'Chiller 1 — MCP-46D',
    action: 'Desligar compressor',
    requestedBy: 'eng.silva@autobras.com.br',
  },
  {
    id: 'cmd-002',
    requestedAt: minsAgo(12),
    tenantName: 'Hospital São Rafael',
    siteName: 'UTI — 4° Andar',
    deviceName: 'AHU-04 — FCU',
    action: 'Reset de alarme geral',
    requestedBy: 'op.rodrigues@autobras.com.br',
  },
  {
    id: 'cmd-003',
    requestedAt: minsAgo(28),
    tenantName: 'Shopping Metrópolis',
    siteName: 'Praça de Alimentação',
    deviceName: 'Gerador Cummins C275D5',
    action: 'Ligar gerador (teste mensal)',
    requestedBy: 'cco@autobras.com.br',
  },
  {
    id: 'cmd-004',
    requestedAt: minsAgo(47),
    tenantName: 'Petroquímica Norte',
    siteName: 'Área de Processo — Setor 3',
    deviceName: 'Bomba Centrífuga BC-07',
    action: 'Ajustar setpoint para 65%',
    requestedBy: 'eng.silva@autobras.com.br',
  },
  {
    id: 'cmd-005',
    requestedAt: minsAgo(63),
    tenantName: 'Torres Corporativas',
    siteName: 'Bloco Torre A — Cobertura',
    deviceName: 'Chiller 3 — York YK',
    action: 'Reiniciar controladora',
    requestedBy: 'supervisora@autobras.com.br',
  },
];
