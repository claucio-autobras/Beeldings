'use client';

import { useState } from 'react';
import type { SegmentedControlWidget } from '../../types/scada.types';
import { toScadaNumber } from '../../types/scada.types';
import { dashCardStyle, withAlpha } from './dashCard';
import type { SendCommand } from '../../hooks/useScreenCommand';

interface Props {
  widget: SegmentedControlWidget;
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  onCommand?: SendCommand;
  isEditor?: boolean;
  staticRender?: boolean;
}

/**
 * Controle segmentado de escrita (ex.: Automático/Manual) — opções mapeadas a
 * valores, com o mesmo fluxo de comando otimista dos demais widgets de comando.
 */
export function SegmentedControlWidgetView({ widget: w, getValue, onCommand, isEditor, staticRender }: Props) {
  const [draft, setDraft] = useState<number | null>(null);
  const [phase, setPhase] = useState<'idle' | 'sending' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const bound = Boolean(w.deviceId && w.tag);
  const raw = staticRender || !bound ? null : getValue(w.deviceId, w.tag);
  const rawNum = raw === null ? null : toScadaNumber(raw);
  const liveNum = rawNum === null || Number.isNaN(rawNum) ? null : rawNum;

  // Reconcilia otimista derivando no render: quando o vivo confirma o rascunho,
  // o valor ao vivo volta a mandar (sem setState em efeito).
  const draftConfirmed = draft !== null && liveNum !== null && Math.abs(liveNum - draft) < 1e-6;
  const current = draftConfirmed ? liveNum : (draft ?? liveNum);
  const activeId = staticRender
    ? (w.options[0]?.id ?? null)
    : current === null
      ? null
      : (w.options.find((o) => Math.abs(o.value - current) < 1e-6)?.id ?? null);

  async function select(value: number): Promise<void> {
    if (isEditor || staticRender || !onCommand || !bound) return;
    if (w.confirm && !window.confirm(`Enviar comando "${w.label}" = ${value}?`)) return;
    setDraft(value);
    setPhase('sending');
    setErrMsg(null);
    const res = await onCommand(w.deviceId, w.tag, value, w.priority);
    if (res.ok) {
      // O pending store otimista já reflete o valor via getValue.
      setDraft(null);
      setPhase('idle');
    } else {
      setPhase('error');
      setErrMsg(res.error ?? 'Falha ao enviar comando');
      setDraft(null);
      setTimeout(() => setPhase('idle'), 2500);
    }
  }

  return (
    <div
      title={errMsg ?? (bound ? w.tag : 'Vincule um ponto comandável')}
      style={{ ...dashCardStyle(w), padding: '10px 12px', gap: 8, justifyContent: 'center', opacity: bound || staticRender || isEditor ? 1 : 0.6 }}
    >
      {w.showLabel && w.label && (
        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: w.mutedColor }}>
          {w.label}{phase === 'sending' ? ' …' : ''}
        </span>
      )}
      <div style={{
        display: 'flex', gap: 2, padding: 3, borderRadius: 999,
        backgroundColor: withAlpha(w.mutedColor, 0.14),
      }}>
        {w.options.slice(0, 3).map((o) => {
          const active = o.id === activeId;
          return (
            <button
              key={o.id}
              type="button"
              disabled={isEditor || staticRender || !bound}
              onClick={() => void select(o.value)}
              style={{
                flex: 1, minWidth: 0, border: 'none', borderRadius: 999,
                padding: '6px 8px', fontSize: w.fontSize, fontWeight: 600,
                fontFamily: 'Inter, sans-serif', lineHeight: 1.1,
                cursor: isEditor || staticRender || !bound ? 'default' : 'pointer',
                backgroundColor: active ? (phase === 'error' ? '#EF4444' : w.activeColor) : 'transparent',
                color: active ? w.activeTextColor : w.mutedColor,
                boxShadow: active ? '0 1px 2px rgba(15,23,42,0.18)' : 'none',
                transition: 'background-color 150ms ease, color 150ms ease',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
