'use client';

import { formatPhoneDisplay, parsePhoneInput } from '@/lib/phone';

interface PhoneInputProps {
  /** Valor normalizado (E.164, possivelmente parcial) — ex.: "+5511999990000". */
  value: string;
  /** Recebe o valor normalizado a cada digitação. */
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  id?: string;
}

/**
 * Input de telefone com máscara brasileira.
 *
 * - Só aceita dígitos (e "+" inicial); letras/símbolos são ignorados.
 * - Números BR aparecem como "(11) 99999-0000" (fixo ou celular).
 * - Colar com pontuação (ex.: "+55 (11) 99999-0000") é reformatado.
 * - Internacional (DDI ≠ 55) fica sem máscara: "+<dígitos>".
 * - O valor emitido via onChange já está normalizado em E.164 (+55 assumido).
 */
export default function PhoneInput({
  value,
  onChange,
  className,
  placeholder = '(11) 99999-0000',
  disabled,
  autoFocus,
  id,
}: PhoneInputProps) {
  return (
    <input
      id={id}
      type="tel"
      inputMode="tel"
      autoComplete="tel"
      value={formatPhoneDisplay(value)}
      onChange={(e) => onChange(parsePhoneInput(e.target.value))}
      className={className}
      placeholder={placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
    />
  );
}
