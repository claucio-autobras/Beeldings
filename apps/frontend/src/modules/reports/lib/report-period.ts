// Conversão do período dos relatórios: os campos datetime-local são digitados
// em hora de Brasília (America/Sao_Paulo) e precisam virar instantes UTC para
// a query no backend — de forma determinística, independente do fuso do
// navegador/servidor. O mesmo par from/to alimenta a prévia e o download,
// garantindo que ambos mostrem o mesmo recorte.

const REPORT_TIMEZONE = 'America/Sao_Paulo';

const PARTS_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: REPORT_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

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

/** Converte "YYYY-MM-DDTHH:mm" (hora de Brasília) para o instante UTC. */
function zonedToUtc(value: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!m) return undefined;
  const naiveUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  // Uma iteração basta: Brasília não tem horário de verão desde 2019, e uma
  // segunda passada corrigiria eventuais transições.
  let utc = naiveUtc - tzOffsetMs(new Date(naiveUtc));
  utc = naiveUtc - tzOffsetMs(new Date(utc));
  return new Date(utc);
}

/** Data inicial do período (início do minuto digitado, em hora de Brasília). */
export function parsePeriodStart(value: string): Date | undefined {
  if (!value) return undefined;
  return zonedToUtc(value);
}

/**
 * Data final do período, INCLUSIVA até o fim do minuto digitado (…:59.999).
 * Sem isso, um alarme às 10:46:30 ficaria fora de um filtro "até 10:46".
 */
export function parsePeriodEnd(value: string): Date | undefined {
  const d = zonedToUtc(value ?? '');
  if (!d) return undefined;
  return new Date(d.getTime() + 59_999);
}
