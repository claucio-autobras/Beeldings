export type AlarmStatus = 'ALARME' | 'NORMAL' | 'RECONHECIDO';

export interface Alarm {
  id: string;
  /** Origem: 'alarm' = telemetria; 'automation' = aviso de automação (NOTIFY). */
  kind?: 'alarm' | 'automation';
  /** Nome da automação de origem (apenas em avisos). */
  sourceName?: string | null;
  tenantId: string;
  tenantName: string;
  deviceId: string;
  deviceName: string;
  site: string;
  alarmText: string;
  /** Ciclo de vida: ALARME → NORMAL → RECONHECIDO */
  status: AlarmStatus;
  triggeredAt: string;
  occurredAt: string;
  acknowledgedBy: string | null;
  acknowledgedByName?: string | null;
  acknowledgedAt: string | null;
  note: string | null;
  ackNote?: string;
  /** Tag do ponto que disparou o alarme */
  tag?: string;
  /** Valor lido no momento do disparo */
  valueAtTrigger?: number | null;
}

// Referência: 2026-06-02T14:30:00Z (currentDate conforme memória do projeto)
const now = new Date('2026-06-02T14:30:00Z').getTime();

function minsAgo(minutes: number): string {
  return new Date(now - minutes * 60_000).toISOString();
}

function daysAgo(days: number, hour: number, minute: number): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

export const mockAlarms: Alarm[] = [
  // ─── Empresa Demo (tenant-autobras) ──────────────────────────────────────────

  {
    id: 'alarm-001',
    tenantId: 'tenant-autobras',
    tenantName: 'Empresa Demo',
    deviceId: 'dev-001',
    deviceName: 'MCP-46D',
    site: 'Casa de Máquinas — Subsolo',
    alarmText: 'FALHA NA BOMBA DE ÁGUA GELADA',
    triggeredAt: minsAgo(348),
    occurredAt: daysAgo(0, 8, 42),
    status: 'ALARME',
    acknowledgedBy: null,
    acknowledgedAt: null,
    note: null,
    tag: 'status_bomba_agua_gelada',
    valueAtTrigger: 0,
  },
  {
    id: 'alarm-002',
    tenantId: 'tenant-autobras',
    tenantName: 'Empresa Demo',
    deviceId: 'dev-002',
    deviceName: 'MCP-46D',
    site: 'Casa de Máquinas — Subsolo',
    alarmText: 'SOBRECORRENTE NO COMPRESSOR CHILLER-02',
    triggeredAt: minsAgo(92),
    occurredAt: daysAgo(0, 12, 58),
    status: 'NORMAL',
    acknowledgedBy: null,
    acknowledgedAt: null,
    note: null,
  },
  {
    id: 'alarm-003',
    tenantId: 'tenant-autobras',
    tenantName: 'Empresa Demo',
    deviceId: 'dev-002',
    deviceName: 'MCP-46D',
    site: 'Casa de Máquinas — Subsolo',
    alarmText: 'TEMPERATURA DE RETORNO CHILLER-01 ACIMA DO LIMITE — 14.3°C',
    triggeredAt: minsAgo(95),
    occurredAt: daysAgo(0, 12, 55),
    status: 'RECONHECIDO',
    acknowledgedBy: 'eng.silva@autobras.com.br',
    acknowledgedByName: 'Eng. Silva',
    acknowledgedAt: minsAgo(80),
    note: 'Manutenção agendada para amanhã às 08:00. Equipamento em operação monitorada.',
    ackNote: 'Manutenção agendada para amanhã às 08:00. Equipamento em operação monitorada.',
  },
  
  {
    id: 'alarm-005',
    tenantId: 'tenant-autobras',
    tenantName: 'Empresa Demo',
    deviceId: 'dev-004',
    deviceName: 'Gerador Cummins C110D5',
    site: 'Área Técnica — Cobertura',
    alarmText: 'NÍVEL BAIXO DE ÁGUA GELADA — RESERVATÓRIO EXPANSÃO SISTEMA 1',
    triggeredAt: minsAgo(18),
    occurredAt: daysAgo(0, 14, 12),
    status: 'ALARME',
    acknowledgedBy: null,
    acknowledgedAt: null,
    note: null,
    tag: 'nivel_agua_gelada',
    valueAtTrigger: 0,
  },
  {
    id: 'alarm-006',
    tenantId: 'tenant-autobras',
    tenantName: 'Empresa Demo',
    deviceId: 'dev-001',
    deviceName: 'MCP-46A',
    site: 'Bloco B — 2° Pavimento',
    alarmText: 'DIFERENCIAL DE PRESSÃO DO FILTRO AHU-02 — BLOCO B PAV.2',
    triggeredAt: minsAgo(720),
    occurredAt: daysAgo(2, 9, 30),
    status: 'NORMAL',
    acknowledgedBy: null,
    acknowledgedAt: null,
    note: null,
  },
  {
    id: 'alarm-007',
    tenantId: 'tenant-autobras',
    tenantName: 'Empresa Demo',
    deviceId: 'dev-003',
    deviceName: 'MCP-18',
    site: 'Quadro Elétrico — Bloco A Térreo',
    alarmText: 'DEMANDA ELÉTRICA ACIMA DO CONTRATO',
    triggeredAt: minsAgo(1440),
    occurredAt: daysAgo(3, 7, 0),
    status: 'RECONHECIDO',
    acknowledgedBy: 'admin@autobras.com.br',
    acknowledgedByName: 'Admin Autobras',
    acknowledgedAt: minsAgo(1380),
    note: 'OS #4521 aberta no sistema. Aguardando ajuste de setpoint de demanda.',
    ackNote: 'OS #4521 aberta no sistema. Aguardando ajuste de setpoint de demanda.',
  },
  {
    id: 'alarm-008',
    tenantId: 'tenant-autobras',
    tenantName: 'Empresa Demo',
    deviceId: 'dev-001',
    deviceName: 'MCP-46D',
    site: 'Bloco A — 3° Pavimento',
    alarmText: 'SETPOINT DE TEMPERATURA',
    triggeredAt: minsAgo(345),
    occurredAt: daysAgo(0, 8, 45),
    status: 'ALARME',
    acknowledgedBy: null,
    acknowledgedAt: null,
    note: null,
    tag: 'setpoint_temp',
    valueAtTrigger: 17.5,
  },
  {
    id: 'alarm-009',
    tenantId: 'tenant-autobras',
    tenantName: 'Empresa Demo',
    deviceId: 'dev-005',
    deviceName: 'MCP-46D',
    site: 'Bloco A — 3° Pavimento',
    alarmText: 'TEMPERATURA AMBIENTE ALTA',
    triggeredAt: minsAgo(210),
    occurredAt: daysAgo(0, 11, 0),
    status: 'ALARME',
    acknowledgedBy: null,
    acknowledgedAt: null,
    note: null,
    tag: 'temp_ambiente',
    valueAtTrigger: 27.8,
  },
  {
    id: 'alarm-010',
    tenantId: 'tenant-autobras',
    tenantName: 'Empresa Demo',
    deviceId: 'dev-006',
    deviceName: 'MCP-46D',
    site: 'Casa de Máquinas — Subsolo',
    alarmText: 'VÁLVULA DE 2 VIAS AHU-03 SEM RESPOSTA',
    triggeredAt: minsAgo(60),
    occurredAt: daysAgo(0, 13, 30),
    status: 'ALARME',
    acknowledgedBy: null,
    acknowledgedAt: null,
    note: null,
    tag: 'status_valvula_ahu03',
    valueAtTrigger: 0,
  },
  {
    id: 'alarm-011',
    tenantId: 'tenant-autobras',
    tenantName: 'Empresa Demo',
    deviceId: 'dev-007',
    deviceName: 'MCP-18',
    site: 'Quadro Elétrico — Bloco C Térreo',
    alarmText: 'PRESSÃO DE CONDENSAÇÃO ACIMA DO LIMITE',
    triggeredAt: minsAgo(480),
    occurredAt: daysAgo(2, 6, 45),
    status: 'RECONHECIDO',
    acknowledgedBy: 'eng.carvalho@autobras.com.br',
    acknowledgedByName: 'Eng. Carvalho',
    acknowledgedAt: minsAgo(460),
    note: 'Torre de resfriamento inspecionada. Limpeza agendada para 28/05.',
    ackNote: 'Torre de resfriamento inspecionada. Limpeza agendada para 28/05.',
  },
  {
    id: 'alarm-012',
    tenantId: 'tenant-autobras',
    tenantName: 'Empresa Demo',
    deviceId: 'dev-008',
    deviceName: 'MCP-46A',
    site: 'Bloco B — Mezanino',
    alarmText: 'EXE- 01 - FALHA NO VENTILADOR DE EXAUSTÃO',
    triggeredAt: minsAgo(30),
    occurredAt: daysAgo(0, 14, 0),
    status: 'ALARME',
    acknowledgedBy: null,
    acknowledgedAt: null,
    note: null,
    tag: 'status_ventilador_exe01',
    valueAtTrigger: 0,
  },
  {
    id: 'alarm-013',
    tenantId: 'tenant-autobras',
    tenantName: 'Empresa Demo',
    deviceId: 'dev-009',
    deviceName: 'MCP-18',
    site: 'Subestação — Pavimento Térreo',
    alarmText: 'TEMPERATURA ALTA NO TRANSFORMADOR TR-01',
    triggeredAt: minsAgo(135),
    occurredAt: daysAgo(0, 12, 15),
    status: 'NORMAL',
    acknowledgedBy: null,
    acknowledgedAt: null,
    note: null,
  },

  // ─── Shop B Ltda (tenant-shopb) ───────────────────────────────────────────────

  {
    id: 'alarm-shopb-001',
    tenantId: 'tenant-shopb',
    tenantName: 'Shop B Ltda',
    deviceId: 'shopb-ecb-01',
    deviceName: 'MCP-46D',
    site: 'Área de Vendas — Térreo',
    alarmText: 'TEMPERATURA AMBIENTE ALTA',
    triggeredAt: minsAgo(55),
    occurredAt: daysAgo(0, 13, 35),
    status: 'ALARME',
    acknowledgedBy: null,
    acknowledgedAt: null,
    note: null,
    tag: 'temp_ambiente',
    valueAtTrigger: 27.5,
  },
  {
    id: 'alarm-shopb-002',
    tenantId: 'tenant-shopb',
    tenantName: 'Shop B Ltda',
    deviceId: 'shopb-fx-01',
    deviceName: 'MCP-46D',
    site: 'Casa de Máquinas — Cobertura',
    alarmText: 'TEMPERATURA DE SAÍDA CHILLER-02 ALTA',
    triggeredAt: minsAgo(72),
    occurredAt: daysAgo(0, 13, 18),
    status: 'NORMAL',
    acknowledgedBy: null,
    acknowledgedAt: null,
    note: null,
  },
  {
    id: 'alarm-shopb-003',
    tenantId: 'tenant-shopb',
    tenantName: 'Shop B Ltda',
    deviceId: 'shopb-ecb-01',
    deviceName: 'MCP-46D',
    site: 'Área de Vendas — Térreo',
    alarmText: 'DIFERENCIAL DE PRESSÃO DO FILTRO',
    triggeredAt: minsAgo(480),
    occurredAt: daysAgo(4, 16, 20),
    status: 'RECONHECIDO',
    acknowledgedBy: 'manutencao@shopb.com.br',
    acknowledgedByName: 'Manutenção Shop B',
    acknowledgedAt: minsAgo(420),
    note: 'Filtro encomendado. Substituição prevista para 29/05/2026.',
    ackNote: 'Filtro encomendado. Substituição prevista para 29/05/2026.',
  },
 
  {
    id: 'alarm-shopb-005',
    tenantId: 'tenant-shopb',
    tenantName: 'Shop B Ltda',
    deviceId: 'shopb-fx-02',
    deviceName: 'MCP-46A',
    site: 'Casa de Máquinas — Cobertura',
    alarmText: 'BOMBA-CW-01 DESLIGADA POR PROTEÇÃO TÉRMICA',
    triggeredAt: minsAgo(142),
    occurredAt: daysAgo(0, 12, 8),
    status: 'ALARME',
    acknowledgedBy: null,
    acknowledgedAt: null,
    note: null,
    tag: 'status_bomba_cw01',
    valueAtTrigger: 0,
  },
  {
    id: 'alarm-shopb-006',
    tenantId: 'tenant-shopb',
    tenantName: 'Shop B Ltda',
    deviceId: 'shopb-ecb-02',
    deviceName: 'MCP-46D',
    site: 'Praça de Alimentação — 2° Piso',
    alarmText: 'SETPOINT DE TEMPERATURA NÃO ATINGIDO',
    triggeredAt: minsAgo(310),
    occurredAt: daysAgo(0, 9, 20),
    status: 'NORMAL',
    acknowledgedBy: null,
    acknowledgedAt: null,
    note: null,
  },
  {
    id: 'alarm-shopb-007',
    tenantId: 'tenant-shopb',
    tenantName: 'Shop B Ltda',
    deviceId: 'shopb-gen-01',
    deviceName: 'Gerador Stemac ST-150',
    site: 'Área Técnica — Subsolo',
    alarmText: 'NÍVEL DE COMBUSTÍVEL BAIXO — GERADOR STEMAC ST-150',
    triggeredAt: minsAgo(870),
    occurredAt: daysAgo(3, 20, 10),
    status: 'RECONHECIDO',
    acknowledgedBy: 'operacao@shopb.com.br',
    acknowledgedByName: 'Operação Shop B',
    acknowledgedAt: minsAgo(840),
    note: 'Abastecimento agendado para 28/05 às 07:00.',
    ackNote: 'Abastecimento agendado para 28/05 às 07:00.',
  },
];

// ─── Mock Generator ───────────────────────────────────────────────────────────

const MOCK_ALARM_TEMPLATES: Array<{
  deviceName: string;
  site: string;
  alarmText: string;
  tenantId: string;
  tenantName: string;
}> = [
  {
    deviceName: 'MCP-46D',
    site: 'Casa de Máquinas — Subsolo',
    alarmText: 'FALHA NA BOMBA DE RETORNO CW-02',
    tenantId: 'tenant-autobras',
    tenantName: 'Empresa Demo',
  },
  {
    deviceName: 'MCP-18',
    site: 'Quadro Elétrico — Bloco B Térreo',
    alarmText: 'SOBRECORRENTE NO COMPRESSOR CHILLER-03',
    tenantId: 'tenant-autobras',
    tenantName: 'Empresa Demo',
  },
  {
    deviceName: 'MCP-46A',
    site: 'Bloco C — 4° Pavimento',
    alarmText: 'TEMPERATURA AMBIENTE ALTA',
    tenantId: 'tenant-autobras',
    tenantName: 'Empresa Demo',
  },
  {
    deviceName: 'Gerador Cummins C110D5',
    site: 'Área Técnica — Cobertura',
    alarmText: 'FALHA NO SISTEMA DE PRÉ-AQUECIMENTO DO MOTOR — GERADOR PRINCIPAL',
    tenantId: 'tenant-autobras',
    tenantName: 'Empresa Demo',
  },
  {
    deviceName: 'MCP-46D',
    site: 'Casa de Máquinas — Cobertura',
    alarmText: 'DIFERENCIAL DE PRESSÃO AHU-04 FORA DA FAIXA',
    tenantId: 'tenant-shopb',
    tenantName: 'Shop B Ltda',
  },
  {
    deviceName: 'MCP-18',
    site: 'Subestação — Pavimento Térreo',
    alarmText: 'TEMPERATURA NO PAINEL ELÉTRICO SE-02',
    tenantId: 'tenant-shopb',
    tenantName: 'Shop B Ltda',
  },

  {
    deviceName: 'MCP-46D',
    site: 'Praça de Alimentação — 3° Piso',
    alarmText: 'NÍVEL BAIXO DE ÓLEO LUBRIFICANTE — COMPRESSOR CHILLER-01',
    tenantId: 'tenant-shopb',
    tenantName: 'Shop B Ltda',
  },
];

let mockAlarmCounter = 1000;

export function generateMockAlarm(overrides?: Partial<Alarm>): Alarm {
  const template = MOCK_ALARM_TEMPLATES[Math.floor(Math.random() * MOCK_ALARM_TEMPLATES.length)];
  const id = `alarm-sim-${++mockAlarmCounter}-${Date.now()}`;
  const triggeredAt = new Date().toISOString();

  const base: Alarm = {
    id,
    tenantId: template.tenantId,
    tenantName: template.tenantName,
    deviceId: `dev-sim-${mockAlarmCounter}`,
    deviceName: template.deviceName,
    site: template.site,
    alarmText: template.alarmText,
    status: 'ALARME',
    triggeredAt,
    occurredAt: triggeredAt,
    acknowledgedBy: null,
    acknowledgedAt: null,
    note: null,
  };

  return { ...base, ...overrides };
}
