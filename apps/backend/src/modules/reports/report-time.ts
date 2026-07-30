/**
 * Formatação central de data/hora dos relatórios (PDF/CSV e rótulos de
 * cabeçalho). O servidor roda em UTC, então SEMPRE fixamos o fuso de
 * Brasília para que os horários batam com o que o usuário vê na tela.
 */
export const REPORT_TIMEZONE = 'America/Sao_Paulo';

const FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'medium',
  timeZone: REPORT_TIMEZONE,
});

export function fmtDateTime(d: Date | null | undefined): string {
  if (!d) return '';
  return FORMATTER.format(d);
}
