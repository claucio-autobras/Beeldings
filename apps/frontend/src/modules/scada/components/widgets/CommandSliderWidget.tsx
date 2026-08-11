'use client';

import { useState } from 'react';
import type { CommandSliderWidget } from '../../types/scada.types';
import { toScadaNumber } from '../../types/scada.types';
import type { SendCommand } from '../../hooks/useScreenCommand';

interface Props {
  widget: CommandSliderWidget;
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  onCommand?: SendCommand;
  isEditor?: boolean;
  staticRender?: boolean;
  /** Ponto sem comunicação (viewer): bloqueia o envio de comandos. */
  commOffline?: boolean;
}

export function CommandSliderWidgetView({ widget, getValue, onCommand, isEditor, staticRender, commOffline }: Props) {
  // Valor que o operador ajustou/comandou (otimista). Tem prioridade sobre a
  // telemetria até o vivo confirmar (dentro de meio passo); enquanto null, reflete o vivo.
  const [draft, setDraft] = useState<number | null>(null);
  const [phase, setPhase] = useState<'idle' | 'sending' | 'error'>('idle');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const raw = staticRender ? null : getValue(widget.deviceId, widget.tag);
  const rawNum = raw === null ? null : toScadaNumber(raw);
  const liveNum = rawNum === null || Number.isNaN(rawNum) ? null : rawNum;
  const bound = Boolean(widget.deviceId && widget.tag);

  const display = draft ?? (liveNum !== null ? liveNum : widget.minValue);
  const clamped = Math.min(widget.maxValue, Math.max(widget.minValue, display));
  const pct = widget.maxValue > widget.minValue
    ? ((clamped - widget.minValue) / (widget.maxValue - widget.minValue)) * 100
    : 0;

  async function commit(value: number): Promise<void> {
    if (isEditor || !onCommand) return;
    // Ponto sem comunicação: não envia comando (o slider já fica desabilitado).
    if (commOffline) { setDraft(null); return; }
    setDraft(value); // mantém o valor comandado na tela de imediato
    setPhase('sending');
    setErrMsg(null);
    const res = await onCommand(widget.deviceId, widget.tag, value, widget.priority);
    if (res.ok) {
      // O pending store otimista já reflete o valor comandado via getValue,
      // então o rascunho local pode ser liberado (sem setState em efeito).
      setDraft(null);
      setPhase('idle');
    } else {
      setPhase('error');
      setErrMsg(res.error ?? 'Falha ao enviar comando');
      setDraft(null); // não confirmou — volta a refletir o valor real
      setTimeout(() => setPhase('idle'), 2500);
    }
  }

  const valueLabel = `${clamped.toFixed(widget.decimals)}${widget.unit ? ` ${widget.unit}` : ''}`;
  const accent = phase === 'error' ? '#EF4444' : widget.color;

  // Variante 'card' — cartão estilo dashboard com rótulo e percentual da faixa
  // embutidos (ex.: "Intensidade — 85%"), referência das telas do PDF BlueBee.
  if (widget.variant === 'card') {
    const cardBg = widget.cardBackgroundColor ?? '#FFFFFF';
    const cardText = widget.cardTextColor ?? '#0F172A';
    const cardMuted = widget.cardMutedColor ?? '#64748B';
    const hasLive = staticRender ? false : (draft !== null || liveNum !== null);
    const pctLabel = staticRender ? '––' : hasLive ? `${Math.round(pct)}%` : 'sem dados';
    return (
      <div
        title={commOffline ? 'Sem comunicação — comando bloqueado' : (errMsg ?? (bound ? widget.tag : 'Vincule um ponto analógico comandável (AO)'))}
        style={{
          width: '100%', height: '100%', boxSizing: 'border-box',
          display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8,
          padding: '12px 14px',
          backgroundColor: cardBg,
          border: '1px solid rgba(148,163,184,0.35)',
          borderRadius: 12,
          fontFamily: 'Inter, sans-serif',
          boxShadow: '0 1px 2px rgba(15,23,42,0.06)',
          opacity: bound || staticRender || isEditor ? 1 : 0.6,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 11, color: cardMuted, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {widget.label}
          </span>
          <span style={{
            fontSize: 13, fontWeight: 700, fontFamily: 'Roboto Mono, monospace', fontVariantNumeric: 'tabular-nums',
            color: phase === 'error' ? '#EF4444' : hasLive || staticRender ? cardText : cardMuted,
            fontStyle: hasLive || staticRender ? 'normal' : 'italic',
          }}>
            {phase === 'sending' ? '…' : pctLabel}
          </span>
        </div>
        <input
          type="range"
          min={widget.minValue}
          max={widget.maxValue}
          step={widget.step || 1}
          value={clamped}
          disabled={isEditor || staticRender || !bound || commOffline}
          onChange={(e) => setDraft(Number(e.target.value))}
          onPointerUp={() => { if (!isEditor && draft !== null) void commit(draft); }}
          onKeyUp={() => { if (!isEditor && draft !== null) void commit(draft); }}
          style={{
            width: '100%',
            accentColor: accent,
            cursor: isEditor || staticRender || !bound || commOffline ? 'default' : 'pointer',
            background: `linear-gradient(to right, ${accent} ${pct}%, rgba(148,163,184,0.3) ${pct}%)`,
            height: 4, borderRadius: 4, appearance: 'none', WebkitAppearance: 'none',
          }}
        />
      </div>
    );
  }

  return (
    <div
      title={commOffline ? 'Sem comunicação — comando bloqueado' : (errMsg ?? (bound ? widget.tag : 'Vincule um ponto analógico comandável (AO)'))}
      style={{
        width: '100%', height: '100%',
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 4,
        padding: '6px 10px',
        backgroundColor: 'rgba(15,23,42,0.72)',
        border: '1px solid rgba(148,163,184,0.18)',
        borderRadius: 8,
        fontFamily: 'Inter, sans-serif',
        opacity: bound ? 1 : 0.6,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6 }}>
        <span style={{ fontSize: 11, color: '#94A3B8', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {widget.label}
        </span>
        {widget.showValue && (
          <span style={{ fontSize: 13, fontWeight: 600, color: accent, fontFamily: 'Roboto Mono, monospace', fontVariantNumeric: 'tabular-nums' }}>
            {phase === 'sending' ? '…' : valueLabel}
          </span>
        )}
      </div>
      <input
        type="range"
        min={widget.minValue}
        max={widget.maxValue}
        step={widget.step || 1}
        value={clamped}
        disabled={isEditor || !bound || commOffline}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={() => { if (!isEditor && draft !== null) void commit(draft); }}
        onKeyUp={() => { if (!isEditor && draft !== null) void commit(draft); }}
        style={{
          width: '100%',
          accentColor: accent,
          cursor: isEditor || !bound || commOffline ? 'default' : 'pointer',
          background: `linear-gradient(to right, ${accent} ${pct}%, rgba(148,163,184,0.25) ${pct}%)`,
          height: 4, borderRadius: 4, appearance: 'none', WebkitAppearance: 'none',
        }}
      />
    </div>
  );
}
