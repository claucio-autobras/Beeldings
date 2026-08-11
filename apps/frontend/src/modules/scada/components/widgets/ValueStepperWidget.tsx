'use client';

import { useState } from 'react';
import { Loader2, Minus, Plus } from 'lucide-react';
import type { ValueStepperWidget } from '../../types/scada.types';
import { toScadaNumber, scadaBackgroundStyle } from '../../types/scada.types';
import type { SendCommand } from '../../hooks/useScreenCommand';

interface Props {
  widget: ValueStepperWidget;
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  onCommand?: SendCommand;
  isEditor?: boolean;
  staticRender?: boolean;
  /** Ponto sem comunicação (viewer): bloqueia o envio de comandos. */
  commOffline?: boolean;
}

/**
 * Stepper numérico de setpoint — botões − / + com valor e unidade no meio
 * (referência dark/neon). Escreve no ponto vinculado respeitando min/max/step;
 * o valor exibido vem do getValue (telemetria + pending otimista compartilhado),
 * então cliques em sequência somam sobre o valor efetivo sem esperar o vivo.
 */
export function ValueStepperWidgetView({ widget: w, getValue, onCommand, isEditor, staticRender, commOffline }: Props) {
  const [phase, setPhase] = useState<'idle' | 'sending' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const bound = Boolean(w.deviceId && w.tag);
  const raw = staticRender || !bound ? null : getValue(w.deviceId, w.tag);
  const num = raw === null ? NaN : toScadaNumber(raw);
  const live = Number.isNaN(num) ? null : num;

  const disabled = isEditor || staticRender || !bound || Boolean(commOffline) || phase === 'sending';

  async function bump(dir: 1 | -1): Promise<void> {
    if (disabled || !onCommand || live === null) return;
    const step = w.step || 1;
    const next = Math.min(w.maxValue, Math.max(w.minValue, live + dir * step));
    if (next === live) return;
    setPhase('sending');
    setErrMsg(null);
    const res = await onCommand(w.deviceId, w.tag, next, w.priority);
    if (res.ok) {
      setPhase('idle');
    } else {
      setPhase('error');
      setErrMsg(res.error ?? 'Falha ao enviar comando');
      setTimeout(() => setPhase('idle'), 2500);
    }
  }

  // Estático (edição): aparência de projeto com um valor exemplo do meio da faixa.
  const displayNum = staticRender ? (w.minValue + w.maxValue) / 2 : live;
  const valueText = displayNum === null ? '—' : displayNum.toLocaleString('pt-BR', { minimumFractionDigits: w.decimals, maximumFractionDigits: w.decimals });
  const btnDisabled = disabled || (!staticRender && live === null);

  const btnStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
    width: 'clamp(28px, 22%, 44px)', alignSelf: 'stretch',
    backgroundColor: w.buttonColor,
    border: `1px solid ${w.borderColor}`,
    borderRadius: Math.max(4, w.borderRadius - 4),
    color: btnDisabled ? w.mutedColor : w.textColor,
    cursor: btnDisabled ? 'default' : 'pointer',
    padding: 0,
    transition: 'color 150ms, border-color 150ms',
  };

  return (
    <div
      title={commOffline ? 'Sem comunicação — comando bloqueado' : (errMsg ?? (bound ? w.tag : 'Vincule um ponto analógico comandável'))}
      style={{
        width: '100%', height: '100%', boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', gap: 8,
        padding: 8,
        ...scadaBackgroundStyle(w.backgroundColor),
        border: `1px solid ${phase === 'error' ? '#EF4444' : w.borderColor}`,
        borderRadius: w.borderRadius,
        fontFamily: 'Inter, sans-serif',
        opacity: bound || staticRender || isEditor ? 1 : 0.6,
        userSelect: 'none',
      }}
    >
      <button type="button" style={btnStyle} disabled={btnDisabled} onClick={() => void bump(-1)} aria-label="Diminuir">
        <Minus style={{ width: 15, height: 15 }} strokeWidth={2} />
      </button>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 4 }}>
        {phase === 'sending' ? (
          <Loader2 className="animate-spin" style={{ width: 16, height: 16, color: w.accentColor, alignSelf: 'center' }} strokeWidth={2} />
        ) : (
          <>
            <span style={{
              fontSize: w.valueFontSize, fontWeight: 700, lineHeight: 1,
              fontFamily: 'Roboto Mono, monospace', fontVariantNumeric: 'tabular-nums',
              color: displayNum === null ? w.mutedColor : w.textColor,
              fontStyle: displayNum === null ? 'italic' : 'normal',
            }}>
              {displayNum === null ? 'sem dados' : valueText}
            </span>
            {w.unit && displayNum !== null && (
              <span style={{ fontSize: Math.max(10, Math.round(w.valueFontSize * 0.5)), fontWeight: 600, color: w.mutedColor }}>{w.unit}</span>
            )}
          </>
        )}
      </div>
      <button type="button" style={btnStyle} disabled={btnDisabled} onClick={() => void bump(1)} aria-label="Aumentar">
        <Plus style={{ width: 15, height: 15 }} strokeWidth={2} />
      </button>
    </div>
  );
}
