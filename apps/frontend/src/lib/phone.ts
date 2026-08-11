/**
 * Helpers de telefone (WhatsApp) — máscara brasileira + normalização E.164.
 *
 * Armazenamento/envio ao backend: sempre E.164 (ex.: +5511999990000).
 * Exibição: números BR (+55) ganham máscara "(11) 99999-0000"; internacionais
 * (outro DDI) ficam sem máscara, apenas "+<dígitos>".
 */

/** E.164: + seguido de 8 a 15 dígitos. */
export const PHONE_E164_REGEX = /^\+[1-9]\d{7,14}$/;

/** BR: +55 + DDD (2 dígitos, primeiro 1-9) + 8 (fixo) ou 9 (celular) dígitos. */
export const PHONE_BR_REGEX = /^\+55[1-9][0-9]\d{8,9}$/;

/** Normaliza telefone para E.164 com DDI +55 como padrão se não houver +. */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (!digits) return '';
  if (hasPlus) return `+${digits}`;
  return `+55${digits}`;
}

/**
 * Valida um telefone já normalizado em E.164.
 * Números +55 exigem DDD + 8/9 dígitos; demais DDIs seguem apenas o E.164.
 */
export function isValidPhone(e164: string): boolean {
  if (!PHONE_E164_REGEX.test(e164)) return false;
  if (e164.startsWith('+55')) return PHONE_BR_REGEX.test(e164);
  return true;
}

/**
 * Converte o texto digitado/colado no input para o valor normalizado (E.164,
 * possivelmente parcial). Ignora letras e pontuação; aceita colagem com
 * formatação (ex.: "+55 (11) 99999-0000").
 */
export function parsePhoneInput(input: string): string {
  const hasPlus = input.trimStart().startsWith('+');
  const digits = input.replace(/\D/g, '');
  if (hasPlus) {
    if (!digits) return '+';
    if (digits.startsWith('55')) return `+55${digits.slice(2, 13)}`;
    return `+${digits.slice(0, 15)}`;
  }
  if (!digits) return '';
  return `+55${digits.slice(0, 11)}`;
}

/** Máscara nacional brasileira: (11) 9999-0000 ou (11) 99999-0000. */
function formatBrNational(d: string): string {
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  if (rest.length <= 5) return `(${ddd}) ${rest}`;
  if (rest.length <= 8) return `(${ddd}) ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`;
  return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5, 9)}`;
}

/** Formata o valor normalizado (E.164, possivelmente parcial) para exibição. */
export function formatPhoneDisplay(value: string): string {
  if (!value) return '';
  if (/^\+5{0,2}$/.test(value)) return value; // '+', '+5', '+55' parciais
  const br = /^\+55(\d+)$/.exec(value);
  if (br && br[1].length <= 11) return formatBrNational(br[1]);
  return value;
}
