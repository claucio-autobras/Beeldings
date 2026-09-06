'use client';

import { useState } from 'react';
import type { VirtualPoint } from '../types/virtual.types';

interface Props {
  point: VirtualPoint;
  onChange: (value: number | boolean) => void;
  disabled?: boolean;
  /** false (padrão) = tema claro (página); true = tema escuro (viewer). */
  dark?: boolean;
}

/**
 * Controle de valor de um ponto virtual, por tipo:
 * - digital: toggle ON/OFF;
 * - multistate: dropdown de estados;
 * - analog: input numérico aplicado no blur/Enter, re-sincronizado quando
 *   `currentValue` muda por fora.
 */
export function VirtualPointControl({ point, onChange, disabled, dark }: Props) {
  if (point.kind === 'digital') {
    return <DigitalControl point={point} onChange={onChange} disabled={disabled} dark={dark} />;
  }
  if (point.kind === 'multistate') {
    return <MultistateControl point={point} onChange={onChange} disabled={disabled} dark={dark} />;
  }
  return <AnalogControl point={point} onChange={onChange} disabled={disabled} dark={dark} />;
}

function DigitalControl({ point, onChange, disabled, dark }: Props) {
  const on = Boolean(point.currentValue);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={[
        'inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50',
        on ? 'bg-emerald-600 text-white' : dark ? 'bg-slate-700 text-slate-300' : 'bg-slate-200 text-slate-600',
      ].join(' ')}
    >
      <span className={`h-2 w-2 rounded-full ${on ? 'bg-card' : dark ? 'bg-slate-400' : 'bg-slate-400'}`} />
      {on ? 'ON' : 'OFF'}
    </button>
  );
}

function MultistateControl({ point, onChange, disabled, dark }: Props) {
  const idx = Number(point.currentValue) || 0;
  return (
    <select
      disabled={disabled}
      value={idx}
      onChange={(e) => onChange(Number(e.target.value))}
      className={[
        'rounded border px-2 py-1 text-xs outline-none disabled:opacity-50',
        dark
          ? 'border-slate-600 bg-slate-900 text-slate-200 focus:border-cyan-500'
          : 'border-slate-300 bg-card text-foreground focus:border-cyan-500',
      ].join(' ')}
    >
      {point.states.map((s, i) => (
        <option key={i} value={i}>{s.label}</option>
      ))}
    </select>
  );
}

function AnalogControl({ point, onChange, disabled, dark }: Props) {
  const [draft, setDraft] = useState<string>(String(Number(point.currentValue) || 0));

  // Re-sincroniza o input quando o valor muda por fora (ex.: outra sessão) —
  // ajuste durante o render, sem setState em efeito.
  const [prevValue, setPrevValue] = useState(point.currentValue);
  if (point.currentValue !== prevValue) {
    setPrevValue(point.currentValue);
    setDraft(String(Number(point.currentValue) || 0));
  }

  function apply() {
    const n = Number(draft);
    if (Number.isFinite(n) && n !== Number(point.currentValue)) onChange(n);
    else setDraft(String(Number(point.currentValue) || 0));
  }

  return (
    <div className="inline-flex items-center gap-1">
      <input
        type="number"
        value={draft}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            apply();
          }
        }}
        className={[
          'w-24 rounded border px-2 py-1 text-xs outline-none disabled:opacity-50',
          dark
            ? 'border-slate-600 bg-slate-900 text-slate-200 focus:border-cyan-500'
            : 'border-slate-300 bg-card text-foreground focus:border-cyan-500',
        ].join(' ')}
      />
      {point.unit && <span className={`text-[10px] ${dark ? 'text-slate-400' : 'text-slate-500'}`}>{point.unit}</span>}
    </div>
  );
}
