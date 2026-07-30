import type {
  AutomationMode,
  AutomationTriggerType,
  AutomationActionType,
  AutomationBranch,
  AutomationExecutesOn,
} from '@prisma/client';

export type {
  AutomationMode,
  AutomationTriggerType,
  AutomationActionType,
  AutomationBranch,
  AutomationExecutesOn,
};

// ─── Configuração do gatilho (SCHEDULE) ────────────────────────────────────────

/** Uma entrada de agenda: liga em `time`, opcionalmente desliga em `endTime`. */
export interface ScheduleEntry {
  /** "HH:mm" — horário de disparo (ligar). */
  time: string;
  /** "HH:mm" — horário de término (desliga: reverte só digitais). Opcional. */
  endTime?: string;
  /** Dias da semana: 0=domingo … 6=sábado. */
  days: number[];
}

export interface ScheduleTriggerConfig {
  entries: ScheduleEntry[];
  /** IANA timezone, ex.: "America/Sao_Paulo". */
  timezone: string;
}

// ─── Condição (CONTINUOUS) ──────────────────────────────────────────────────────

export type ConditionOperator = 'EQ' | 'NEQ' | 'GT' | 'LT' | 'GTE' | 'LTE';

export interface AutomationCondition {
  pointId: string;
  operator: ConditionOperator;
  value: number | boolean;
}

// ─── Ações ──────────────────────────────────────────────────────────────────────

export interface NotifyConfig {
  message: string;
}

export interface AutomationActionInput {
  order: number;
  branch: AutomationBranch;
  type: AutomationActionType;
  /** Obrigatório em WRITE_POINT (id do DevicePoint gravável). */
  targetPointId?: string | null;
  /** number (analógico) | boolean (digital) — obrigatório em WRITE_POINT. */
  value?: number | boolean | null;
  delaySeconds?: number;
  /** NOTIFY: { message }. */
  config?: NotifyConfig | null;
}

export interface CreateAutomationInput {
  name: string;
  siteId?: string | null;
  enabled?: boolean;
  mode: AutomationMode;
  triggerType?: AutomationTriggerType;
  triggerConfig: ScheduleTriggerConfig;
  condition?: AutomationCondition | null;
  evalSeconds?: number;
  executesOn?: AutomationExecutesOn;
  priority?: number;
  actions: AutomationActionInput[];
}

export type UpdateAutomationInput = CreateAutomationInput;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Mapa de rótulo de tipo de objeto BACnet → número do protocolo.
 * AI:0, AO:1, AV:2, BI:3, BO:4, BV:5, MSI:13, MSO:14, MSV:19.
 */
const OBJECT_TYPE_NUM: Record<string, number> = {
  AI: 0,
  AO: 1,
  AV: 2,
  BI: 3,
  BO: 4,
  BV: 5,
  MSI: 13,
  MSO: 14,
  MSV: 19,
};

/**
 * Converte um `objectType` (rótulo "AO"/"BV"… ou já numérico) para o número do
 * protocolo BACnet. Retorna `undefined` se não reconhecido.
 */
export function objectTypeToNum(objectType: string | number): number | undefined {
  if (typeof objectType === 'number') return objectType;
  const trimmed = objectType.trim();
  if (trimmed in OBJECT_TYPE_NUM) return OBJECT_TYPE_NUM[trimmed];
  const asNum = Number(trimmed);
  return Number.isNaN(asNum) ? undefined : asNum;
}

/** Normaliza um valor de escrita: boolean → 1/0; number → number. */
export function toWriteNumber(value: number | boolean): number {
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

/** objectType numéricos considerados DIGITAIS (BO, BV, MSO). */
const DIGITAL_OBJECT_TYPES = new Set<number>([4, 5, 14]);

export function isDigitalObjectType(objectTypeNum: number): boolean {
  return DIGITAL_OBJECT_TYPES.has(objectTypeNum);
}
