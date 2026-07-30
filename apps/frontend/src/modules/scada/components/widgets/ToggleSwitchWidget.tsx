'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { ToggleSwitchWidget } from '../../types/scada.types';
import { toScadaNumber, isTransparentColor, scadaColorWithAlpha } from '../../types/scada.types';
import type { SendCommand } from '../../hooks/useScreenCommand';

interface Props {
  widget: ToggleSwitchWidget;
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  onCommand?: SendCommand;
  isEditor?: boolean;
  staticRender?: boolean;
}

type Phase = 'idle' | 'sending' | 'error';

/**
 * Interruptor deslizante (toggle switch estilo iOS): trilho arredondado + bolinha
 * que desliza. Estado derivado do ponto vinculado (telemetria + otimista via
 * pending-commands, embutido no getValue — mesmo padrão do botão de comando).
 * Na renderização estática (modo edição), mostra a aparência de projeto (ligado).
 */
export function ToggleSwitchWidgetView({ widget, getValue, onCommand, isEditor, staticRender }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const raw = staticRender ? null : getValue(widget.deviceId, widget.tag);
  const rawNum = raw === null ? null : toScadaNumber(raw);
  const effective = rawNum === null || Number.isNaN(rawNum) ? null : rawNum;
  // Estático (edição): visual de projeto — ligado, para mostrar a cor escolhida.
  const isOn = staticRender ? true : effective !== null && effective !== widget.offValue;

  const bound = Boolean(widget.deviceId && widget.tag);
  const disabled = isEditor || !bound || phase === 'sending';
  const error = phase === 'error';

  async function toggle(): Promise<void> {
    if (isEditor || !onCommand || !bound) return;
    // toggle a partir do valor EFETIVO (otimista pendente ?? telemetria) — cliques
    // em sequência invertem corretamente sem esperar o vivo confirmar.
    const value = isOn ? widget.offValue : widget.onValue;
    if (widget.confirm) {
      const verb = value === widget.offValue ? 'DESLIGAR' : 'LIGAR';
      if (!window.confirm(`Confirmar comando: ${verb} "${widget.label || widget.tag}"?`)) return;
    }
    setPhase('sending');
    setErrMsg(null);
    const res = await onCommand(widget.deviceId, widget.tag, value, widget.priority);
    if (res.ok) {
      setPhase('idle');
    } else {
      setPhase('error');
      setErrMsg(res.error ?? 'Falha ao enviar comando');
      setTimeout(() => setPhase('idle'), 2500);
    }
  }

  const showLabel = widget.showLabel && widget.label;
  // Espaço vertical do trilho: desconta o rótulo quando presente.
  const labelH = showLabel ? widget.fontSize + 6 : 0;
  const trackH = Math.max(16, Math.min(widget.height - labelH - 4, widget.width / 1.8));
  const trackW = Math.min(widget.width, trackH * 1.8);
  const knob = trackH - 4;

  const trackColor = error ? '#EF4444' : isOn ? widget.colorOn : widget.colorOff;
  const transparent = isTransparentColor(trackColor);

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      title={errMsg ?? (bound ? widget.tag : 'Vincule um ponto comandável')}
      style={{
        width: '100%', height: '100%',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
        background: 'transparent', border: 'none', padding: 0,
        cursor: disabled ? 'default' : 'pointer',
        opacity: bound || isEditor ? 1 : 0.55,
        userSelect: 'none',
      }}
    >
      {showLabel && (
        <span
          style={{
            fontSize: widget.fontSize, color: widget.textColor, fontFamily: 'Inter, sans-serif',
            fontWeight: 500, lineHeight: 1.2, maxWidth: '100%',
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}
        >
          {widget.label}
        </span>
      )}
      <span
        style={{
          position: 'relative', display: 'inline-block', flexShrink: 0,
          width: trackW, height: trackH, borderRadius: trackH / 2,
          backgroundColor: transparent ? 'transparent' : trackColor,
          border: transparent ? '1.5px solid rgba(148,163,184,0.5)' : '1px solid rgba(255,255,255,0.12)',
          boxShadow: isOn && !transparent && !error ? `0 0 10px ${scadaColorWithAlpha(trackColor, '55')}` : undefined,
          transition: 'background-color 180ms, box-shadow 180ms',
          boxSizing: 'border-box',
        }}
      >
        <span
          style={{
            position: 'absolute', top: '50%', transform: 'translateY(-50%)',
            left: isOn ? trackW - knob - 3 : 2,
            width: knob, height: knob, borderRadius: '50%',
            backgroundColor: '#FFFFFF',
            boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
            transition: 'left 180ms ease',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          {phase === 'sending' && (
            <Loader2 className="animate-spin" style={{ width: knob * 0.6, height: knob * 0.6, color: '#64748B' }} strokeWidth={2} />
          )}
        </span>
      </span>
    </button>
  );
}
