// ─── Tipos de domínio do módulo de Alarmes ────────────────────────────────────

export type AlarmStatus = 'ALARME' | 'NORMAL' | 'RECONHECIDO';

export type AlarmSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export interface Alarm {
  id: string;
  /** Origem: 'alarm' = telemetria; 'automation' = aviso de automação (NOTIFY). */
  kind?: 'alarm' | 'automation';
  /** Nome da automação de origem (apenas em avisos). */
  sourceName?: string | null;
  /** Id da automação de origem (apenas em avisos) — deep-link p/ histórico. */
  sourceId?: string | null;
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
  /** Última reativação da ocorrência (null se nunca reativou). */
  lastReactivatedAt?: string | null;
  acknowledgedBy: string | null;
  /** Nome resolvido de quem reconheceu; null se o usuário foi excluído. */
  acknowledgedByName?: string | null;
  acknowledgedAt: string | null;
  note: string | null;
  ackNote?: string;
  /** Severidade herdada da regra de alarme (modelo por-ponto) */
  severity?: AlarmSeverity;
  /** Tag do ponto que disparou o alarme */
  tag?: string;
  /** Valor lido no momento do disparo */
  valueAtTrigger?: number | null;
}

export interface AlarmStats {
  total: number;
  pendingAck: number;
  activeCount: number;
  acknowledgedCount: number;
}
