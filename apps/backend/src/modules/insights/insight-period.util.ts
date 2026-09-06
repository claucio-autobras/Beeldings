// Períodos dos insights de IA em America/Sao_Paulo. O servidor roda em UTC —
// todas as fronteiras de semana/mês são calculadas na hora de Brasília e
// convertidas para instantes UTC de forma determinística (mesma técnica do
// report-period do frontend: Brasília não tem horário de verão desde 2019).

export type InsightFrequencyKey = 'WEEKLY' | 'MONTHLY';

export interface InsightPeriod {
  /** Início do período (inclusivo, instante UTC). */
  from: Date;
  /** Fim do período (exclusivo, instante UTC). */
  to: Date;
  /** Rótulo legível em pt-BR (ex.: "Semana de 04/08/2026 a 10/08/2026"). */
  label: string;
}

const TZ = 'America/Sao_Paulo';

const PARTS_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

const DATE_FMT = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, dateStyle: 'short' });

const MONTH_NAMES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

/** Offset (ms) do fuso de Brasília no instante dado (ex.: -3h = -10800000). */
function tzOffsetMs(at: Date): number {
  const parts: Record<string, string> = {};
  for (const p of PARTS_FMT.formatToParts(at)) parts[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour) % 24,
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - at.getTime();
}

/** Data civil (ano/mês 1-12/dia) vigente em São Paulo no instante dado. */
function spCivilDate(at: Date): { y: number; m: number; d: number } {
  const parts: Record<string, string> = {};
  for (const p of PARTS_FMT.formatToParts(at)) parts[p.type] = p.value;
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) };
}

/** Instante UTC da meia-noite de São Paulo da data civil dada (mês 1-12). */
export function spMidnightUtc(y: number, m: number, d: number): Date {
  const naive = Date.UTC(y, m - 1, d);
  // Uma iteração basta: Brasília não tem horário de verão desde 2019.
  const guess = new Date(naive - tzOffsetMs(new Date(naive)));
  return new Date(naive - tzOffsetMs(guess));
}

function fmtSpDate(at: Date): string {
  return DATE_FMT.format(at);
}

/** Rótulo do período semanal: datas inclusivas (to é exclusivo). */
function weeklyLabel(from: Date, to: Date): string {
  const lastDay = new Date(to.getTime() - 24 * 60 * 60 * 1000);
  return `Semana de ${fmtSpDate(from)} a ${fmtSpDate(lastDay)}`;
}

function monthlyLabel(from: Date): string {
  const { y, m } = spCivilDate(from);
  return `${MONTH_NAMES[m - 1]} de ${y}`;
}

/** Meia-noite SP da segunda-feira da semana corrente (semana começa na segunda). */
function currentWeekStart(now: Date): Date {
  const { y, m, d } = spCivilDate(now);
  // Dia da semana da data civil (0=domingo..6=sábado) — independe do fuso do
  // servidor porque usamos a data civil de SP em UTC "naive".
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  const daysSinceMonday = (dow + 6) % 7;
  return spMidnightUtc(y, m, d - daysSinceMonday);
}

function currentMonthStart(now: Date): Date {
  const { y, m } = spCivilDate(now);
  return spMidnightUtc(y, m, 1);
}

/**
 * Último período FECHADO (semana ou mês em SP) relativo a `now`. É o período
 * que o job automático gera no fechamento de cada ciclo.
 */
export function lastClosedPeriod(frequency: InsightFrequencyKey, now: Date = new Date()): InsightPeriod {
  if (frequency === 'WEEKLY') {
    const to = currentWeekStart(now);
    const { y, m, d } = spCivilDate(to);
    // spCivilDate(to) é a própria segunda-feira; recua 7 dias civis.
    const from = spMidnightUtc(y, m, d - 7);
    return { from, to, label: weeklyLabel(from, to) };
  }
  const to = currentMonthStart(now);
  const { y, m } = spCivilDate(now);
  const from = spMidnightUtc(y, m - 1, 1);
  return { from, to, label: monthlyLabel(from) };
}

/**
 * Período corrente PARCIAL (do início da semana/mês em SP até `now`) — usado
 * na geração sob demanda para antecipar o insight do ciclo em andamento.
 */
export function currentPartialPeriod(frequency: InsightFrequencyKey, now: Date = new Date()): InsightPeriod {
  if (frequency === 'WEEKLY') {
    const from = currentWeekStart(now);
    return { from, to: now, label: `Semana de ${fmtSpDate(from)} (parcial até ${fmtSpDate(now)})` };
  }
  const from = currentMonthStart(now);
  return { from, to: now, label: `${monthlyLabel(from)} (parcial até ${fmtSpDate(now)})` };
}

/** Presets aceitos pela geração sob demanda. */
export type InsightPeriodPreset = 'last_week' | 'last_month' | 'current_week' | 'current_month';

export function resolvePresetPeriod(preset: InsightPeriodPreset, now: Date = new Date()): {
  period: InsightPeriod;
  frequency: InsightFrequencyKey;
} {
  switch (preset) {
    case 'last_week':
      return { period: lastClosedPeriod('WEEKLY', now), frequency: 'WEEKLY' };
    case 'last_month':
      return { period: lastClosedPeriod('MONTHLY', now), frequency: 'MONTHLY' };
    case 'current_week':
      return { period: currentPartialPeriod('WEEKLY', now), frequency: 'WEEKLY' };
    case 'current_month':
      return { period: currentPartialPeriod('MONTHLY', now), frequency: 'MONTHLY' };
  }
}
