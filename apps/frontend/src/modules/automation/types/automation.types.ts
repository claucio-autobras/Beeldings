// Espelha os tipos do backend (motor de automação QUANDO/SE/ENTÃO).

export type AutomationMode = 'ONESHOT' | 'CONTINUOUS';
export type AutomationTriggerType = 'SCHEDULE';
export type AutomationActionType = 'WRITE_POINT' | 'NOTIFY';
export type AutomationBranch = 'ALWAYS' | 'ON_TRUE' | 'ON_FALSE';
export type AutomationExecutesOn = 'CLOUD' | 'EDGE';
export type ConditionOperator = 'EQ' | 'NEQ' | 'GT' | 'LT' | 'GTE' | 'LTE';

export interface ScheduleEntry {
  time: string;
  endTime?: string;
  days: number[];
}

export interface ScheduleTriggerConfig {
  entries: ScheduleEntry[];
  timezone: string;
}

export interface AutomationCondition {
  pointId: string;
  operator: ConditionOperator;
  value: number | boolean;
}

export interface NotifyConfig {
  message: string;
}

export interface AutomationAction {
  id: string;
  automationId: string;
  order: number;
  branch: AutomationBranch;
  type: AutomationActionType;
  targetPointId: string | null;
  value: number | boolean | null;
  delaySeconds: number;
  config: NotifyConfig | null;
  createdAt: string;
}

export interface Automation {
  id: string;
  tenantId: string;
  siteId: string | null;
  name: string;
  enabled: boolean;
  mode: AutomationMode;
  triggerType: AutomationTriggerType;
  triggerConfig: ScheduleTriggerConfig;
  condition: AutomationCondition | null;
  evalSeconds: number;
  executesOn: AutomationExecutesOn;
  priority: number;
  createdBy: string | null;
  lastRunAt: string | null;
  lastRunResult: string | null;
  createdAt: string;
  updatedAt: string;
  actions: AutomationAction[];
}

export interface AutomationActionInput {
  order: number;
  branch: AutomationBranch;
  type: AutomationActionType;
  targetPointId?: string | null;
  value?: number | boolean | null;
  delaySeconds?: number;
  config?: NotifyConfig | null;
}

export interface CreateAutomationInput {
  name: string;
  siteId?: string | null;
  tenantId?: string;
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

// ─── Histórico de execuções ──────────────────────────────────────────────────

export type AutomationRunResult = 'SUCCESS' | 'PARTIAL' | 'FAILURE';

export interface AutomationRunActionDetail {
  type: AutomationActionType;
  branch: AutomationBranch;
  /** Rótulo legível: tag do ponto (WRITE_POINT) ou "Aviso" (NOTIFY). */
  label: string;
  status: 'SUCCESS' | 'FAILURE' | 'SKIPPED';
  error?: string;
}

export interface AutomationRun {
  id: string;
  tenantId: string;
  automationId: string;
  automationName: string;
  /** 'agenda' | 'término' | 'enquanto' */
  trigger: string;
  result: AutomationRunResult;
  startedAt: string;
  details: AutomationRunActionDetail[];
  errorSummary: string | null;
  createdAt: string;
}

export interface AutomationRunsPage {
  items: AutomationRun[];
  total: number;
  page: number;
  pageSize: number;
}
