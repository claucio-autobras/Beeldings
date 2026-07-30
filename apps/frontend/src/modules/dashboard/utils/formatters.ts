import type { Alarm } from '@/mocks/data/alarms.mock';

export interface NoAckInfo {
  label: string;
  colorClass: string;
}

export function getNoAckInfo(alarm: Alarm): NoAckInfo | null {
  if (alarm.status !== 'ALARME' || alarm.acknowledgedAt !== null) return null;
  const diffMs = Date.now() - new Date(alarm.triggeredAt).getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  if (diffMins < 1) return null;

  let label: string;
  if (diffMins < 60) {
    label = `Sem ACK há ${diffMins}min`;
  } else {
    const h = Math.floor(diffMins / 60);
    const rem = diffMins % 60;
    label = rem > 0 ? `Sem ACK há ${h}h${rem}min` : `Sem ACK há ${h}h`;
  }

  const colorClass =
    diffMins >= 60
      ? 'text-red-600 bg-red-50 border-red-200'
      : diffMins >= 30
        ? 'text-orange-600 bg-orange-50 border-orange-200'
        : null;

  if (!colorClass) return null;
  return { label, colorClass };
}

export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}min atrás`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h atrás`;
  return `${Math.floor(hours / 24)}d atrás`;
}

const STATUS_ORDER = { ALARME: 0, NORMAL: 1, RECONHECIDO: 2 } as const;

export function sortAlarms(alarms: Alarm[]): Alarm[] {
  return [...alarms].sort((a, b) => {
    const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (statusDiff !== 0) return statusDiff;
    return new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime();
  });
}
