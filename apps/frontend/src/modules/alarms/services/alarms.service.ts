import { apiGet, apiPost } from '@/lib/api-client';
import type { Alarm, AlarmStats } from '../types/alarm.types';

export type { Alarm, AlarmStats };

export async function getAlarms(tenantId?: string): Promise<Alarm[]> {
  const path = tenantId ? `/alarms?tenantId=${encodeURIComponent(tenantId)}` : '/alarms';
  return apiGet<Alarm[]>(path);
}

export async function acknowledgeAlarm(
  alarmId: string,
  userId: string,
  note: string,
): Promise<Alarm> {
  return apiPost<Alarm>(`/alarms/${encodeURIComponent(alarmId)}/acknowledge`, { userId, note });
}

/** Marca avisos de automação como lidos de forma persistente (some do sino). */
export async function markNoticesRead(ids: string[]): Promise<{ updated: number }> {
  return apiPost<{ updated: number }>(`/alarms/notices/read`, { ids });
}

export async function getAlarmStats(tenantId?: string): Promise<AlarmStats> {
  const path = tenantId ? `/alarms/stats?tenantId=${encodeURIComponent(tenantId)}` : '/alarms/stats';
  return apiGet<AlarmStats>(path);
}
