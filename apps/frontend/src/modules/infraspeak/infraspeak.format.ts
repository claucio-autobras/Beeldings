import type { InfraspeakRequestItem } from './services/infraspeak-api.service';

/**
 * Datas da Infraspeak chegam como "YYYY-MM-DD HH:mm:ss" (sem timezone).
 * Exibimos como texto local "dd/mm/aaaa hh:mm" sem conversão de fuso — o valor
 * mostrado é exatamente o registrado na Infraspeak.
 */
export function formatDate(value: string | null): string {
  if (!value) return '—';
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return value;
  return `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}`;
}

/** SLA vencido = data-limite no passado e chamado ainda não concluído. */
export function isSlaOverdue(item: InfraspeakRequestItem): boolean {
  if (!item.nextSlaDate || item.completedDate || item.solved) return false;
  const parsed = new Date(item.nextSlaDate.replace(' ', 'T'));
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() < Date.now();
}

export function stateBadgeClass(state: string | null): string {
  switch (state) {
    case 'WAITING_APPROVAL':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400';
    case 'IN_PROGRESS':
    case 'STARTED':
      return 'bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-400';
    case 'PAUSED':
      return 'bg-slate-200 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300';
    case 'COMPLETED':
    case 'APPROVED':
    case 'CLOSED':
      return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

export function priorityBadgeClass(priority: number | null): string {
  if (priority === null) return 'bg-muted text-muted-foreground';
  if (priority >= 3) return 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400';
  if (priority === 2) return 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400';
  return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400';
}

/** Lê um número do payload bruto da Infraspeak (attributes), quando existir. */
export function rawNumber(item: InfraspeakRequestItem, key: string): number | null {
  const v = item.raw?.attributes?.[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Lê uma string do payload bruto da Infraspeak (attributes), quando existir. */
export function rawString(item: InfraspeakRequestItem, key: string): string | null {
  const v = item.raw?.attributes?.[key];
  return typeof v === 'string' && v !== '' ? v : null;
}
