import type {
  AlarmEventItem,
  AlarmSeverity,
} from '@/modules/alarms/services/alarms-api.service';

/** Horário canônico da atividade que posicionou o alarme no feed recente. */
export function recentAlarmActivityAt(
  event: Pick<AlarmEventItem, 'activatedAt' | 'lastReactivatedAt'>,
): string {
  return event.lastReactivatedAt ?? event.activatedAt;
}

const RECENT_ALARM_SEVERITY_LABEL: Record<AlarmSeverity, string> = {
  HIGH: 'Alta',
  MEDIUM: 'Média',
  LOW: 'Baixa',
};

export function recentAlarmSeverityLabel(severity: AlarmSeverity): string {
  return RECENT_ALARM_SEVERITY_LABEL[severity];
}