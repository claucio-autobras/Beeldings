// ─── Types ────────────────────────────────────────────────────────────────────

export type VariableType = 'analog' | 'digital';
export type Protocol = 'bacnet' | 'modbus';

export interface TrendVariable {
  id: string;
  tag: string;
  displayName: string;
  type: VariableType;
  unit: string;
  protocol: Protocol;
  tenantId: string;
  tenantName: string;
  site: string;
  siteId: string;
  /** For BACnet devices, the controller is the device itself (no separate controller layer). */
  controller: string;
  controllerId: string;
  device: string;
  deviceId: string;
  readingInterval: string;
  readingIntervalMinutes: number;
}

export interface TrendRecord {
  id: string;
  timestamp: string;
  variableId: string;
  tag: string;
  displayName: string;
  type: VariableType;
  unit: string;
  protocol: Protocol;
  previousValue: number | boolean | null;
  newValue: number | boolean;
  tenantId: string;
  tenantName: string;
  site: string;
  siteId: string;
  controller: string;
  controllerId: string;
  device: string;
  deviceId: string;
  readingInterval: string;
}

export interface TrendChartPoint {
  timestamp: string;
  value: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isoAt(baseDate: Date, offsetMinutes: number): string {
  const d = new Date(baseDate.getTime() + offsetMinutes * 60_000);
  return d.toISOString();
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Generates a realistic analog random walk clamped to [min, max].
 */
function genAnalogHistory(
  startDate: Date,
  totalDays: number,
  intervalMin: number,
  min: number,
  max: number,
  startValue: number,
): Array<{ timestamp: string; previousValue: number | null; newValue: number }> {
  const records: Array<{ timestamp: string; previousValue: number | null; newValue: number }> = [];
  const totalMinutes = totalDays * 24 * 60;
  let current = startValue;

  for (let t = 0; t <= totalMinutes; t += intervalMin) {
    const prev = t === 0 ? null : current;
    const delta = (Math.random() - 0.5) * (max - min) * 0.04;
    current = round2(Math.min(max, Math.max(min, current + delta)));
    records.push({ timestamp: isoAt(startDate, t), previousValue: prev, newValue: current });
  }
  return records;
}

/**
 * Generates digital on/off transitions with optional fault probability.
 */
function genDigitalHistory(
  startDate: Date,
  totalDays: number,
  onHourStart: number,
  onHourEnd: number,
  faultProbability: number,
): Array<{ timestamp: string; previousValue: boolean | null; newValue: boolean }> {
  const records: Array<{ timestamp: string; previousValue: boolean | null; newValue: boolean }> = [];

  for (let day = 0; day < totalDays; day++) {
    const onOffset = day * 24 * 60 + onHourStart * 60 + Math.floor(Math.random() * 10);
    records.push({
      timestamp: isoAt(startDate, onOffset),
      previousValue: day === 0 ? null : false,
      newValue: true,
    });

    if (Math.random() < faultProbability) {
      const faultOffset = onOffset + Math.floor(Math.random() * (onHourEnd - onHourStart) * 60);
      records.push({ timestamp: isoAt(startDate, faultOffset), previousValue: true, newValue: false });
      records.push({
        timestamp: isoAt(startDate, faultOffset + 15 + Math.floor(Math.random() * 30)),
        previousValue: false,
        newValue: true,
      });
    }

    const offOffset = day * 24 * 60 + onHourEnd * 60 + Math.floor(Math.random() * 10);
    records.push({ timestamp: isoAt(startDate, offOffset), previousValue: true, newValue: false });
  }
  return records;
}

// ─── 3 months: March 1 → May 31 2026 ─────────────────────────────────────────

const START_DATE = new Date('2026-03-01T00:00:00.000Z');
const TOTAL_DAYS = 92; // 31 (Mar) + 30 (Apr) + 31 (May)

// ─── Variable catalog ─────────────────────────────────────────────────────────
// All IDs, names, sites and tenants match exactly with devices.mock.ts.
//
// BACnet devices act as their own controller — the "controller" field carries
// the device name so the filter in the Trends screen is consistent with what
// the user sees on the Devices screen.
//
// Modbus devices are also their own controller entry (no SCADA mid-layer in
// the mock topology).

export const mockTrendVariables: TrendVariable[] = [
  // ── dev-001 — MCP-46D | BACnet | Bloco A — Pavimento 3 | tenant-autobras ──

  {
    id: 'var-001-temp-retorno',
    tag: 'temp_retorno',
    displayName: 'Temperatura Ar Retorno',
    type: 'analog',
    unit: '°C',
    protocol: 'bacnet',
    tenantId: 'tenant-autobras',
    tenantName: 'Autobras',
    site: 'Bloco A — Pavimento 3',
    siteId: 'site-001',
    controller: 'MCP-46D',
    controllerId: 'dev-001',
    device: 'MCP-46D',
    deviceId: 'dev-001',
    readingInterval: '30 minutos',
    readingIntervalMinutes: 30,
  },
  {
    id: 'var-001-temp-insuflamento',
    tag: 'temp_insuflamento',
    displayName: 'Temperatura Ar Insuflamento',
    type: 'analog',
    unit: '°C',
    protocol: 'bacnet',
    tenantId: 'tenant-autobras',
    tenantName: 'Autobras',
    site: 'Bloco A — Pavimento 3',
    siteId: 'site-001',
    controller: 'MCP-46D',
    controllerId: 'dev-001',
    device: 'MCP-46D',
    deviceId: 'dev-001',
    readingInterval: '30 minutos',
    readingIntervalMinutes: 30,
  },
  {
    id: 'var-001-valvula-expansao',
    tag: 'valvula_expansao_1',
    displayName: 'Abertura Válvula de Expansão',
    type: 'analog',
    unit: '%',
    protocol: 'bacnet',
    tenantId: 'tenant-autobras',
    tenantName: 'Autobras',
    site: 'Bloco A — Pavimento 3',
    siteId: 'site-001',
    controller: 'MCP-46D',
    controllerId: 'dev-001',
    device: 'MCP-46D',
    deviceId: 'dev-001',
    readingInterval: '30 minutos',
    readingIntervalMinutes: 30,
  },
  {
    id: 'var-001-status-compressor-1',
    tag: 'status_compressor_1',
    displayName: 'Status Compressor 1',
    type: 'digital',
    unit: '',
    protocol: 'bacnet',
    tenantId: 'tenant-autobras',
    tenantName: 'Autobras',
    site: 'Bloco A — Pavimento 3',
    siteId: 'site-001',
    controller: 'MCP-46D',
    controllerId: 'dev-001',
    device: 'MCP-46D',
    deviceId: 'dev-001',
    readingInterval: 'Por mudança de estado',
    readingIntervalMinutes: 0,
  },
  {
    id: 'var-001-status-compressor-2',
    tag: 'status_compressor_2',
    displayName: 'Status Compressor 2',
    type: 'digital',
    unit: '',
    protocol: 'bacnet',
    tenantId: 'tenant-autobras',
    tenantName: 'Autobras',
    site: 'Bloco A — Pavimento 3',
    siteId: 'site-001',
    controller: 'MCP-46D',
    controllerId: 'dev-001',
    device: 'MCP-46D',
    deviceId: 'dev-001',
    readingInterval: 'Por mudança de estado',
    readingIntervalMinutes: 0,
  },
  {
    id: 'var-001-alarme-geral',
    tag: 'alarme_geral',
    displayName: 'Alarme Geral',
    type: 'digital',
    unit: '',
    protocol: 'bacnet',
    tenantId: 'tenant-autobras',
    tenantName: 'Autobras',
    site: 'Bloco A — Pavimento 3',
    siteId: 'site-001',
    controller: 'MCP-46D',
    controllerId: 'dev-001',
    device: 'MCP-46D',
    deviceId: 'dev-001',
    readingInterval: 'Por mudança de estado',
    readingIntervalMinutes: 0,
  },

  // ── dev-002 — MCP-46D | BACnet | Bloco B — Pavimento 1 | tenant-autobras ──

  {
    id: 'var-002-temp-ambiente',
    tag: 'temp_ambiente',
    displayName: 'Temperatura Ambiente',
    type: 'analog',
    unit: '°C',
    protocol: 'bacnet',
    tenantId: 'tenant-autobras',
    tenantName: 'Autobras',
    site: 'Bloco B — Pavimento 1',
    siteId: 'site-002',
    controller: 'MCP-46D',
    controllerId: 'dev-002',
    device: 'MCP-46D',
    deviceId: 'dev-002',
    readingInterval: '30 minutos',
    readingIntervalMinutes: 30,
  },
  {
    id: 'var-002-velocidade-ventilador',
    tag: 'velocidade_ventilador',
    displayName: 'Velocidade Ventilador',
    type: 'analog',
    unit: '%',
    protocol: 'bacnet',
    tenantId: 'tenant-autobras',
    tenantName: 'Autobras',
    site: 'Bloco B — Pavimento 1',
    siteId: 'site-002',
    controller: 'MCP-46D',
    controllerId: 'dev-002',
    device: 'MCP-46D',
    deviceId: 'dev-002',
    readingInterval: '30 minutos',
    readingIntervalMinutes: 30,
  },
  {
    id: 'var-002-status-ventilador',
    tag: 'status_ventilador',
    displayName: 'Status Ventilador',
    type: 'digital',
    unit: '',
    protocol: 'bacnet',
    tenantId: 'tenant-autobras',
    tenantName: 'Autobras',
    site: 'Bloco B — Pavimento 1',
    siteId: 'site-002',
    controller: 'MCP-46D',
    controllerId: 'dev-002',
    device: 'MCP-46D',
    deviceId: 'dev-002',
    readingInterval: 'Por mudança de estado',
    readingIntervalMinutes: 0,
  },
  {
    id: 'var-002-alarme-temperatura',
    tag: 'alarme_temperatura',
    displayName: 'Alarme de Temperatura',
    type: 'digital',
    unit: '',
    protocol: 'bacnet',
    tenantId: 'tenant-autobras',
    tenantName: 'Autobras',
    site: 'Bloco B — Pavimento 1',
    siteId: 'site-002',
    controller: 'MCP-46D',
    controllerId: 'dev-002',
    device: 'MCP-46D',
    deviceId: 'dev-002',
    readingInterval: 'Por mudança de estado',
    readingIntervalMinutes: 0,
  },

  // ── dev-003 — Gerador 01 | Modbus | Bloco A — Pavimento 1 | tenant-autobras ──

  {
    id: 'var-003-tensao-fase-a',
    tag: 'tensao_fase_a',
    displayName: 'Tensão Fase A',
    type: 'analog',
    unit: 'V',
    protocol: 'modbus',
    tenantId: 'tenant-autobras',
    tenantName: 'Autobras',
    site: 'Bloco A — Pavimento 1',
    siteId: 'site-003',
    controller: 'Gerador 01',
    controllerId: 'dev-003',
    device: 'Gerador 01',
    deviceId: 'dev-003',
    readingInterval: '5 minutos',
    readingIntervalMinutes: 5,
  },
  {
    id: 'var-003-corrente-fase-a',
    tag: 'corrente_fase_a',
    displayName: 'Corrente Fase A',
    type: 'analog',
    unit: 'A',
    protocol: 'modbus',
    tenantId: 'tenant-autobras',
    tenantName: 'Autobras',
    site: 'Bloco A — Pavimento 1',
    siteId: 'site-003',
    controller: 'Gerador 01',
    controllerId: 'dev-003',
    device: 'Gerador 01',
    deviceId: 'dev-003',
    readingInterval: '5 minutos',
    readingIntervalMinutes: 5,
  },
  {
    id: 'var-003-potencia-ativa',
    tag: 'potencia_ativa',
    displayName: 'Potência Ativa Total',
    type: 'analog',
    unit: 'kW',
    protocol: 'modbus',
    tenantId: 'tenant-autobras',
    tenantName: 'Autobras',
    site: 'Bloco A — Pavimento 1',
    siteId: 'site-003',
    controller: 'Gerador 01',
    controllerId: 'dev-003',
    device: 'Gerador 01',
    deviceId: 'dev-003',
    readingInterval: '5 minutos',
    readingIntervalMinutes: 5,
  },
  {
    id: 'var-003-fator-potencia',
    tag: 'fator_potencia',
    displayName: 'Fator de Potência',
    type: 'analog',
    unit: 'PF',
    protocol: 'modbus',
    tenantId: 'tenant-autobras',
    tenantName: 'Autobras',
    site: 'Bloco A — Pavimento 1',
    siteId: 'site-003',
    controller: 'Gerador 01',
    controllerId: 'dev-003',
    device: 'Gerador 01',
    deviceId: 'dev-003',
    readingInterval: '5 minutos',
    readingIntervalMinutes: 5,
  },
  {
    id: 'var-003-frequencia',
    tag: 'frequencia',
    displayName: 'Frequência',
    type: 'analog',
    unit: 'Hz',
    protocol: 'modbus',
    tenantId: 'tenant-autobras',
    tenantName: 'Autobras',
    site: 'Bloco A — Pavimento 1',
    siteId: 'site-003',
    controller: 'Gerador 01',
    controllerId: 'dev-003',
    device: 'Gerador 01',
    deviceId: 'dev-003',
    readingInterval: '5 minutos',
    readingIntervalMinutes: 5,
  },
  {
    id: 'var-003-energia-acumulada',
    tag: 'energia_acumulada',
    displayName: 'Energia Acumulada',
    type: 'analog',
    unit: 'kWh',
    protocol: 'modbus',
    tenantId: 'tenant-autobras',
    tenantName: 'Autobras',
    site: 'Bloco A — Pavimento 1',
    siteId: 'site-003',
    controller: 'Gerador 01',
    controllerId: 'dev-003',
    device: 'Gerador 01',
    deviceId: 'dev-003',
    readingInterval: '5 minutos',
    readingIntervalMinutes: 5,
  },

  // ── dev-004 — Gerador 02 | Modbus | Bloco A — Subsolo | tenant-autobras ──

  {
    id: 'var-004-tensao-saida',
    tag: 'tensao_saida',
    displayName: 'Tensão de Saída',
    type: 'analog',
    unit: 'V',
    protocol: 'modbus',
    tenantId: 'tenant-autobras',
    tenantName: 'Autobras',
    site: 'Bloco A — Subsolo',
    siteId: 'site-004',
    controller: 'Gerador 02',
    controllerId: 'dev-004',
    device: 'Gerador 02',
    deviceId: 'dev-004',
    readingInterval: '5 minutos',
    readingIntervalMinutes: 5,
  },
  {
    id: 'var-004-corrente',
    tag: 'corrente',
    displayName: 'Corrente',
    type: 'analog',
    unit: 'A',
    protocol: 'modbus',
    tenantId: 'tenant-autobras',
    tenantName: 'Autobras',
    site: 'Bloco A — Subsolo',
    siteId: 'site-004',
    controller: 'Gerador 02',
    controllerId: 'dev-004',
    device: 'Gerador 02',
    deviceId: 'dev-004',
    readingInterval: '5 minutos',
    readingIntervalMinutes: 5,
  },
  {
    id: 'var-004-rpm',
    tag: 'rpm',
    displayName: 'Rotação (RPM)',
    type: 'analog',
    unit: 'RPM',
    protocol: 'modbus',
    tenantId: 'tenant-autobras',
    tenantName: 'Autobras',
    site: 'Bloco A — Subsolo',
    siteId: 'site-004',
    controller: 'Gerador 02',
    controllerId: 'dev-004',
    device: 'Gerador 02',
    deviceId: 'dev-004',
    readingInterval: '5 minutos',
    readingIntervalMinutes: 5,
  },
  {
    id: 'var-004-temp-motor',
    tag: 'temp_motor',
    displayName: 'Temperatura do Motor',
    type: 'analog',
    unit: '°C',
    protocol: 'modbus',
    tenantId: 'tenant-autobras',
    tenantName: 'Autobras',
    site: 'Bloco A — Subsolo',
    siteId: 'site-004',
    controller: 'Gerador 02',
    controllerId: 'dev-004',
    device: 'Gerador 02',
    deviceId: 'dev-004',
    readingInterval: '5 minutos',
    readingIntervalMinutes: 5,
  },
  {
    id: 'var-004-status-gerador',
    tag: 'status_gerador',
    displayName: 'Status do Gerador',
    type: 'digital',
    unit: '',
    protocol: 'modbus',
    tenantId: 'tenant-autobras',
    tenantName: 'Autobras',
    site: 'Bloco A — Subsolo',
    siteId: 'site-004',
    controller: 'Gerador 02',
    controllerId: 'dev-004',
    device: 'Gerador 02',
    deviceId: 'dev-004',
    readingInterval: 'Por mudança de estado',
    readingIntervalMinutes: 0,
  },

  // ── shopb-ecb-01 — MCP-46D | BACnet | Área de Vendas — Térreo | tenant-shopb ──

  {
    id: 'var-shopb-ecb-temp-ambiente',
    tag: 'temp_ambiente',
    displayName: 'Temperatura Ambiente',
    type: 'analog',
    unit: '°C',
    protocol: 'bacnet',
    tenantId: 'tenant-shopb',
    tenantName: 'Shopping Boulevard',
    site: 'Área de Vendas — Térreo',
    siteId: 'site-005',
    controller: 'MCP-46D',
    controllerId: 'shopb-ecb-01',
    device: 'MCP-46D',
    deviceId: 'shopb-ecb-01',
    readingInterval: '30 minutos',
    readingIntervalMinutes: 30,
  },
  {
    id: 'var-shopb-ecb-abertura-damper',
    tag: 'abertura_damper',
    displayName: 'Abertura Damper',
    type: 'analog',
    unit: '%',
    protocol: 'bacnet',
    tenantId: 'tenant-shopb',
    tenantName: 'Shopping Boulevard',
    site: 'Área de Vendas — Térreo',
    siteId: 'site-005',
    controller: 'MCP-46D',
    controllerId: 'shopb-ecb-01',
    device: 'MCP-46D',
    deviceId: 'shopb-ecb-01',
    readingInterval: '30 minutos',
    readingIntervalMinutes: 30,
  },
  {
    id: 'var-shopb-ecb-status-ventilador',
    tag: 'status_ventilador',
    displayName: 'Status Ventilador',
    type: 'digital',
    unit: '',
    protocol: 'bacnet',
    tenantId: 'tenant-shopb',
    tenantName: 'Shopping Boulevard',
    site: 'Área de Vendas — Térreo',
    siteId: 'site-005',
    controller: 'MCP-46D',
    controllerId: 'shopb-ecb-01',
    device: 'MCP-46D',
    deviceId: 'shopb-ecb-01',
    readingInterval: 'Por mudança de estado',
    readingIntervalMinutes: 0,
  },
  {
    id: 'var-shopb-ecb-alarme-temperatura',
    tag: 'alarme_temperatura',
    displayName: 'Alarme de Temperatura',
    type: 'digital',
    unit: '',
    protocol: 'bacnet',
    tenantId: 'tenant-shopb',
    tenantName: 'Shopping Boulevard',
    site: 'Área de Vendas — Térreo',
    siteId: 'site-005',
    controller: 'MCP-46D',
    controllerId: 'shopb-ecb-01',
    device: 'MCP-46D',
    deviceId: 'shopb-ecb-01',
    readingInterval: 'Por mudança de estado',
    readingIntervalMinutes: 0,
  },

  // ── shopb-fx-01 — MCP-46D | BACnet | Casa de Máquinas — Cob. | tenant-shopb ──

  {
    id: 'var-shopb-fx-temp-saida-chiller',
    tag: 'temp_saida_chiller',
    displayName: 'Temperatura Saída Chiller',
    type: 'analog',
    unit: '°C',
    protocol: 'bacnet',
    tenantId: 'tenant-shopb',
    tenantName: 'Shopping Boulevard',
    site: 'Casa de Máquinas — Cob.',
    siteId: 'site-006',
    controller: 'MCP-46D',
    controllerId: 'shopb-fx-01',
    device: 'MCP-46D',
    deviceId: 'shopb-fx-01',
    readingInterval: '30 minutos',
    readingIntervalMinutes: 30,
  },
  {
    id: 'var-shopb-fx-pressao-succao',
    tag: 'pressao_succao',
    displayName: 'Pressão de Sucção',
    type: 'analog',
    unit: 'bar',
    protocol: 'bacnet',
    tenantId: 'tenant-shopb',
    tenantName: 'Shopping Boulevard',
    site: 'Casa de Máquinas — Cob.',
    siteId: 'site-006',
    controller: 'MCP-46D',
    controllerId: 'shopb-fx-01',
    device: 'MCP-46D',
    deviceId: 'shopb-fx-01',
    readingInterval: '30 minutos',
    readingIntervalMinutes: 30,
  },
  {
    id: 'var-shopb-fx-status-compressor',
    tag: 'status_compressor',
    displayName: 'Status Compressor',
    type: 'digital',
    unit: '',
    protocol: 'bacnet',
    tenantId: 'tenant-shopb',
    tenantName: 'Shopping Boulevard',
    site: 'Casa de Máquinas — Cob.',
    siteId: 'site-006',
    controller: 'MCP-46D',
    controllerId: 'shopb-fx-01',
    device: 'MCP-46D',
    deviceId: 'shopb-fx-01',
    readingInterval: 'Por mudança de estado',
    readingIntervalMinutes: 0,
  },
  {
    id: 'var-shopb-fx-alarme-geral',
    tag: 'alarme_geral',
    displayName: 'Alarme Geral',
    type: 'digital',
    unit: '',
    protocol: 'bacnet',
    tenantId: 'tenant-shopb',
    tenantName: 'Shopping Boulevard',
    site: 'Casa de Máquinas — Cob.',
    siteId: 'site-006',
    controller: 'MCP-46D',
    controllerId: 'shopb-fx-01',
    device: 'MCP-46D',
    deviceId: 'shopb-fx-01',
    readingInterval: 'Por mudança de estado',
    readingIntervalMinutes: 0,
  },

  // ── shopb-pm-01 — Multimedidor 1 | Modbus | Depósito — Subsolo | tenant-shopb ──

  {
    id: 'var-shopb-pm-tensao-fase-a',
    tag: 'tensao_fase_a',
    displayName: 'Tensão Fase A',
    type: 'analog',
    unit: 'V',
    protocol: 'modbus',
    tenantId: 'tenant-shopb',
    tenantName: 'Shopping Boulevard',
    site: 'Depósito — Subsolo',
    siteId: 'site-007',
    controller: 'Multimedidor 1',
    controllerId: 'shopb-pm-01',
    device: 'Multimedidor 1',
    deviceId: 'shopb-pm-01',
    readingInterval: '5 minutos',
    readingIntervalMinutes: 5,
  },
  {
    id: 'var-shopb-pm-tensao-fase-b',
    tag: 'tensao_fase_b',
    displayName: 'Tensão Fase B',
    type: 'analog',
    unit: 'V',
    protocol: 'modbus',
    tenantId: 'tenant-shopb',
    tenantName: 'Shopping Boulevard',
    site: 'Depósito — Subsolo',
    siteId: 'site-007',
    controller: 'Multimedidor 1',
    controllerId: 'shopb-pm-01',
    device: 'Multimedidor 1',
    deviceId: 'shopb-pm-01',
    readingInterval: '5 minutos',
    readingIntervalMinutes: 5,
  },
  {
    id: 'var-shopb-pm-tensao-fase-c',
    tag: 'tensao_fase_c',
    displayName: 'Tensão Fase C',
    type: 'analog',
    unit: 'V',
    protocol: 'modbus',
    tenantId: 'tenant-shopb',
    tenantName: 'Shopping Boulevard',
    site: 'Depósito — Subsolo',
    siteId: 'site-007',
    controller: 'Multimedidor 1',
    controllerId: 'shopb-pm-01',
    device: 'Multimedidor 1',
    deviceId: 'shopb-pm-01',
    readingInterval: '5 minutos',
    readingIntervalMinutes: 5,
  },
  {
    id: 'var-shopb-pm-corrente-fase-a',
    tag: 'corrente_fase_a',
    displayName: 'Corrente Fase A',
    type: 'analog',
    unit: 'A',
    protocol: 'modbus',
    tenantId: 'tenant-shopb',
    tenantName: 'Shopping Boulevard',
    site: 'Depósito — Subsolo',
    siteId: 'site-007',
    controller: 'Multimedidor 1',
    controllerId: 'shopb-pm-01',
    device: 'Multimedidor 1',
    deviceId: 'shopb-pm-01',
    readingInterval: '5 minutos',
    readingIntervalMinutes: 5,
  },
  {
    id: 'var-shopb-pm-potencia-ativa',
    tag: 'potencia_ativa',
    displayName: 'Potência Ativa',
    type: 'analog',
    unit: 'kW',
    protocol: 'modbus',
    tenantId: 'tenant-shopb',
    tenantName: 'Shopping Boulevard',
    site: 'Depósito — Subsolo',
    siteId: 'site-007',
    controller: 'Multimedidor 1',
    controllerId: 'shopb-pm-01',
    device: 'Multimedidor 1',
    deviceId: 'shopb-pm-01',
    readingInterval: '5 minutos',
    readingIntervalMinutes: 5,
  },
  {
    id: 'var-shopb-pm-fator-potencia',
    tag: 'fator_potencia',
    displayName: 'Fator de Potência',
    type: 'analog',
    unit: 'PF',
    protocol: 'modbus',
    tenantId: 'tenant-shopb',
    tenantName: 'Shopping Boulevard',
    site: 'Depósito — Subsolo',
    siteId: 'site-007',
    controller: 'Multimedidor 1',
    controllerId: 'shopb-pm-01',
    device: 'Multimedidor 1',
    deviceId: 'shopb-pm-01',
    readingInterval: '5 minutos',
    readingIntervalMinutes: 5,
  },
];

// ─── Record builder ────────────────────────────────────────────────────────────

let _recordId = 1;
function nextId(): string {
  return `trend-rec-${String(_recordId++).padStart(6, '0')}`;
}

function buildAnalogRecords(
  variable: TrendVariable,
  rawHistory: Array<{ timestamp: string; previousValue: number | null; newValue: number }>,
): TrendRecord[] {
  return rawHistory.map((h) => ({
    id: nextId(),
    timestamp: h.timestamp,
    variableId: variable.id,
    tag: variable.tag,
    displayName: variable.displayName,
    type: variable.type,
    unit: variable.unit,
    protocol: variable.protocol,
    previousValue: h.previousValue,
    newValue: h.newValue,
    tenantId: variable.tenantId,
    tenantName: variable.tenantName,
    site: variable.site,
    siteId: variable.siteId,
    controller: variable.controller,
    controllerId: variable.controllerId,
    device: variable.device,
    deviceId: variable.deviceId,
    readingInterval: variable.readingInterval,
  }));
}

function buildDigitalRecords(
  variable: TrendVariable,
  rawHistory: Array<{ timestamp: string; previousValue: boolean | null; newValue: boolean }>,
): TrendRecord[] {
  return rawHistory.map((h) => ({
    id: nextId(),
    timestamp: h.timestamp,
    variableId: variable.id,
    tag: variable.tag,
    displayName: variable.displayName,
    type: variable.type,
    unit: variable.unit,
    protocol: variable.protocol,
    previousValue: h.previousValue,
    newValue: h.newValue,
    tenantId: variable.tenantId,
    tenantName: variable.tenantName,
    site: variable.site,
    siteId: variable.siteId,
    controller: variable.controller,
    controllerId: variable.controllerId,
    device: variable.device,
    deviceId: variable.deviceId,
    readingInterval: variable.readingInterval,
  }));
}

// ─── History generation — 3 months (Mar–May 2026) ────────────────────────────

// dev-001 — MCP-46D | Bloco A Pav. 3 — BACnet air-handling unit
const h001TempRetorno        = genAnalogHistory(START_DATE, TOTAL_DAYS, 30, 18, 28, 22.4);
const h001TempInsuflamento   = genAnalogHistory(START_DATE, TOTAL_DAYS, 30, 10, 18, 14.2);
const h001ValvulaExpansao    = genAnalogHistory(START_DATE, TOTAL_DAYS, 30, 30, 100, 75.5);
const h001StatusCompressor1  = genDigitalHistory(START_DATE, TOTAL_DAYS, 7, 22, 0.08);
const h001StatusCompressor2  = genDigitalHistory(START_DATE, TOTAL_DAYS, 7, 22, 0.10);
const h001AlarmeGeral        = genDigitalHistory(START_DATE, TOTAL_DAYS, 0, 0, 0.0).concat([
  { timestamp: isoAt(START_DATE,  5 * 24 * 60 + 14 * 60),      previousValue: false, newValue: true  },
  { timestamp: isoAt(START_DATE,  5 * 24 * 60 + 14 * 60 + 30), previousValue: true,  newValue: false },
  { timestamp: isoAt(START_DATE, 18 * 24 * 60 +  9 * 60),      previousValue: false, newValue: true  },
  { timestamp: isoAt(START_DATE, 18 * 24 * 60 +  9 * 60 + 45), previousValue: true,  newValue: false },
  { timestamp: isoAt(START_DATE, 60 * 24 * 60 +  3 * 60),      previousValue: false, newValue: true  },
  { timestamp: isoAt(START_DATE, 60 * 24 * 60 +  3 * 60 + 90), previousValue: true,  newValue: false },
]);

// dev-002 — MCP-46D | Bloco B Pav. 1 — BACnet fan-coil
const h002TempAmbiente       = genAnalogHistory(START_DATE, TOTAL_DAYS, 30, 19, 30, 23.1);
const h002VelocidadeVent     = genAnalogHistory(START_DATE, TOTAL_DAYS, 30, 20, 100, 60.0);
const h002StatusVentilador   = genDigitalHistory(START_DATE, TOTAL_DAYS, 8, 20, 0.07);
const h002AlarmeTemperatura  = genDigitalHistory(START_DATE, TOTAL_DAYS, 0, 0, 0.0).concat([
  { timestamp: isoAt(START_DATE, 12 * 24 * 60 + 13 * 60),       previousValue: false, newValue: true  },
  { timestamp: isoAt(START_DATE, 12 * 24 * 60 + 13 * 60 + 20),  previousValue: true,  newValue: false },
  { timestamp: isoAt(START_DATE, 45 * 24 * 60 + 11 * 60),       previousValue: false, newValue: true  },
  { timestamp: isoAt(START_DATE, 45 * 24 * 60 + 11 * 60 + 60),  previousValue: true,  newValue: false },
]);

// dev-003 — Gerador 01 | Bloco A Pav. 1 — Modbus energy meter (PowerLogic PM5560)
const h003TensaoFaseA     = genAnalogHistory(START_DATE, TOTAL_DAYS, 5, 210, 230, 220.4);
const h003CorrenteFaseA   = genAnalogHistory(START_DATE, TOTAL_DAYS, 5, 20, 80, 45.2);
const h003PotenciaAtiva   = genAnalogHistory(START_DATE, TOTAL_DAYS, 5, 10, 120, 28.6);
const h003FatorPotencia   = genAnalogHistory(START_DATE, TOTAL_DAYS, 5, 0.82, 1.0, 0.92);
const h003Frequencia      = genAnalogHistory(START_DATE, TOTAL_DAYS, 5, 59.5, 60.5, 60.0);
// Energia acumulada é monotonicamente crescente — simula acúmulo contínuo
const h003EnergiaAcum: Array<{ timestamp: string; previousValue: number | null; newValue: number }> = [];
{
  let energy = 12450.8;
  const totalMinutes = TOTAL_DAYS * 24 * 60;
  for (let t = 0; t <= totalMinutes; t += 5) {
    const prev = t === 0 ? null : energy;
    energy = round2(energy + Math.random() * 0.5 + 0.1);
    h003EnergiaAcum.push({ timestamp: isoAt(START_DATE, t), previousValue: prev, newValue: energy });
  }
}

// dev-004 — Gerador 02 | Bloco A Subsolo — Modbus generator controller (Cummins)
// Device was offline (fault) — simulate mostly-off with brief operational windows
const h004TensaoSaida  = genAnalogHistory(START_DATE, TOTAL_DAYS, 5, 0, 230, 0);
const h004Corrente     = genAnalogHistory(START_DATE, TOTAL_DAYS, 5, 0, 150, 0);
const h004RPM          = genAnalogHistory(START_DATE, TOTAL_DAYS, 5, 0, 1860, 0);
const h004TempMotor    = genAnalogHistory(START_DATE, TOTAL_DAYS, 5, 20, 95, 25);
const h004StatusGerador = genDigitalHistory(START_DATE, TOTAL_DAYS, 0, 0, 0.0).concat([
  // A few planned test runs
  { timestamp: isoAt(START_DATE, 10 * 24 * 60 +  8 * 60), previousValue: null,  newValue: true  },
  { timestamp: isoAt(START_DATE, 10 * 24 * 60 + 10 * 60), previousValue: true,  newValue: false },
  { timestamp: isoAt(START_DATE, 30 * 24 * 60 +  8 * 60), previousValue: false, newValue: true  },
  { timestamp: isoAt(START_DATE, 30 * 24 * 60 + 10 * 60), previousValue: true,  newValue: false },
  { timestamp: isoAt(START_DATE, 60 * 24 * 60 +  8 * 60), previousValue: false, newValue: true  },
  { timestamp: isoAt(START_DATE, 60 * 24 * 60 + 10 * 60), previousValue: true,  newValue: false },
]);

// shopb-ecb-01 — MCP-46D | Área de Vendas Térreo — BACnet VAV (temperature alarm active)
const hEcbTempAmbiente      = genAnalogHistory(START_DATE, TOTAL_DAYS, 30, 20, 34, 31.2);
const hEcbAbertDamper       = genAnalogHistory(START_DATE, TOTAL_DAYS, 30, 40, 100, 100.0);
const hEcbStatusVentilador  = genDigitalHistory(START_DATE, TOTAL_DAYS, 8, 22, 0.06);
const hEcbAlarmeTemperatura = genDigitalHistory(START_DATE, TOTAL_DAYS, 0, 0, 0.0).concat([
  { timestamp: isoAt(START_DATE,  2 * 24 * 60 + 11 * 60),       previousValue: null,  newValue: true  },
  { timestamp: isoAt(START_DATE,  2 * 24 * 60 + 11 * 60 + 50),  previousValue: true,  newValue: false },
  { timestamp: isoAt(START_DATE, 20 * 24 * 60 + 14 * 60),       previousValue: false, newValue: true  },
  { timestamp: isoAt(START_DATE, 20 * 24 * 60 + 14 * 60 + 120), previousValue: true,  newValue: false },
  { timestamp: isoAt(START_DATE, 55 * 24 * 60 + 10 * 60),       previousValue: false, newValue: true  },
  { timestamp: isoAt(START_DATE, 55 * 24 * 60 + 10 * 60 + 90),  previousValue: true,  newValue: false },
]);

// shopb-fx-01 — MCP-46D | Casa de Máquinas Cob. — BACnet chiller controller
const hFxTempChiller     = genAnalogHistory(START_DATE, TOTAL_DAYS, 30, 7, 16, 12.8);
const hFxPressaoSuccao   = genAnalogHistory(START_DATE, TOTAL_DAYS, 30, 2.5, 5.5, 3.8);
const hFxStatusComp      = genDigitalHistory(START_DATE, TOTAL_DAYS, 7, 23, 0.09);
const hFxAlarmeGeral     = genDigitalHistory(START_DATE, TOTAL_DAYS, 0, 0, 0.0).concat([
  { timestamp: isoAt(START_DATE,  7 * 24 * 60 + 16 * 60),      previousValue: null,  newValue: true  },
  { timestamp: isoAt(START_DATE,  7 * 24 * 60 + 16 * 60 + 30), previousValue: true,  newValue: false },
  { timestamp: isoAt(START_DATE, 35 * 24 * 60 +  4 * 60),      previousValue: false, newValue: true  },
  { timestamp: isoAt(START_DATE, 35 * 24 * 60 +  4 * 60 + 60), previousValue: true,  newValue: false },
]);

// shopb-pm-01 — Multimedidor 1 | Depósito Subsolo — Modbus power meter (PowerLogic)
const hPmTensaoFaseA  = genAnalogHistory(START_DATE, TOTAL_DAYS, 5, 205, 230, 217.8);
const hPmTensaoFaseB  = genAnalogHistory(START_DATE, TOTAL_DAYS, 5, 205, 230, 218.5);
const hPmTensaoFaseC  = genAnalogHistory(START_DATE, TOTAL_DAYS, 5, 205, 230, 219.1);
const hPmCorrenteFaseA = genAnalogHistory(START_DATE, TOTAL_DAYS, 5, 10, 80, 38.4);
const hPmPotenciaAtiva = genAnalogHistory(START_DATE, TOTAL_DAYS, 5, 5, 100, 21.3);
const hPmFatorPotencia = genAnalogHistory(START_DATE, TOTAL_DAYS, 5, 0.80, 1.0, 0.88);

// ─── Assemble all records ─────────────────────────────────────────────────────

// Variable index aligned with mockTrendVariables array positions:
// [0]  var-001-temp-retorno
// [1]  var-001-temp-insuflamento
// [2]  var-001-valvula-expansao
// [3]  var-001-status-compressor-1
// [4]  var-001-status-compressor-2
// [5]  var-001-alarme-geral
// [6]  var-002-temp-ambiente
// [7]  var-002-velocidade-ventilador
// [8]  var-002-status-ventilador
// [9]  var-002-alarme-temperatura
// [10] var-003-tensao-fase-a
// [11] var-003-corrente-fase-a
// [12] var-003-potencia-ativa
// [13] var-003-fator-potencia
// [14] var-003-frequencia
// [15] var-003-energia-acumulada
// [16] var-004-tensao-saida
// [17] var-004-corrente
// [18] var-004-rpm
// [19] var-004-temp-motor
// [20] var-004-status-gerador
// [21] var-shopb-ecb-temp-ambiente
// [22] var-shopb-ecb-abertura-damper
// [23] var-shopb-ecb-status-ventilador
// [24] var-shopb-ecb-alarme-temperatura
// [25] var-shopb-fx-temp-saida-chiller
// [26] var-shopb-fx-pressao-succao
// [27] var-shopb-fx-status-compressor
// [28] var-shopb-fx-alarme-geral
// [29] var-shopb-pm-tensao-fase-a
// [30] var-shopb-pm-tensao-fase-b
// [31] var-shopb-pm-tensao-fase-c
// [32] var-shopb-pm-corrente-fase-a
// [33] var-shopb-pm-potencia-ativa
// [34] var-shopb-pm-fator-potencia

export const mockTrendRecords: TrendRecord[] = [
  // dev-001 — BACnet
  ...buildAnalogRecords(mockTrendVariables[0],  h001TempRetorno),
  ...buildAnalogRecords(mockTrendVariables[1],  h001TempInsuflamento),
  ...buildAnalogRecords(mockTrendVariables[2],  h001ValvulaExpansao),
  ...buildDigitalRecords(mockTrendVariables[3], h001StatusCompressor1),
  ...buildDigitalRecords(mockTrendVariables[4], h001StatusCompressor2),
  ...buildDigitalRecords(mockTrendVariables[5], h001AlarmeGeral),
  // dev-002 — BACnet
  ...buildAnalogRecords(mockTrendVariables[6],  h002TempAmbiente),
  ...buildAnalogRecords(mockTrendVariables[7],  h002VelocidadeVent),
  ...buildDigitalRecords(mockTrendVariables[8], h002StatusVentilador),
  ...buildDigitalRecords(mockTrendVariables[9], h002AlarmeTemperatura),
  // dev-003 — Modbus (Gerador 01)
  ...buildAnalogRecords(mockTrendVariables[10], h003TensaoFaseA),
  ...buildAnalogRecords(mockTrendVariables[11], h003CorrenteFaseA),
  ...buildAnalogRecords(mockTrendVariables[12], h003PotenciaAtiva),
  ...buildAnalogRecords(mockTrendVariables[13], h003FatorPotencia),
  ...buildAnalogRecords(mockTrendVariables[14], h003Frequencia),
  ...buildAnalogRecords(mockTrendVariables[15], h003EnergiaAcum),
  // dev-004 — Modbus (Gerador 02)
  ...buildAnalogRecords(mockTrendVariables[16], h004TensaoSaida),
  ...buildAnalogRecords(mockTrendVariables[17], h004Corrente),
  ...buildAnalogRecords(mockTrendVariables[18], h004RPM),
  ...buildAnalogRecords(mockTrendVariables[19], h004TempMotor),
  ...buildDigitalRecords(mockTrendVariables[20], h004StatusGerador),
  // shopb-ecb-01 — BACnet
  ...buildAnalogRecords(mockTrendVariables[21], hEcbTempAmbiente),
  ...buildAnalogRecords(mockTrendVariables[22], hEcbAbertDamper),
  ...buildDigitalRecords(mockTrendVariables[23], hEcbStatusVentilador),
  ...buildDigitalRecords(mockTrendVariables[24], hEcbAlarmeTemperatura),
  // shopb-fx-01 — BACnet
  ...buildAnalogRecords(mockTrendVariables[25], hFxTempChiller),
  ...buildAnalogRecords(mockTrendVariables[26], hFxPressaoSuccao),
  ...buildDigitalRecords(mockTrendVariables[27], hFxStatusComp),
  ...buildDigitalRecords(mockTrendVariables[28], hFxAlarmeGeral),
  // shopb-pm-01 — Modbus (Multimedidor 1)
  ...buildAnalogRecords(mockTrendVariables[29], hPmTensaoFaseA),
  ...buildAnalogRecords(mockTrendVariables[30], hPmTensaoFaseB),
  ...buildAnalogRecords(mockTrendVariables[31], hPmTensaoFaseC),
  ...buildAnalogRecords(mockTrendVariables[32], hPmCorrenteFaseA),
  ...buildAnalogRecords(mockTrendVariables[33], hPmPotenciaAtiva),
  ...buildAnalogRecords(mockTrendVariables[34], hPmFatorPotencia),
].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
