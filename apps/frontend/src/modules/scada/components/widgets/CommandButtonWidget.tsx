'use client';

import { useState } from 'react';
import {
  Loader2, Power, Play, Pause, RotateCw, Zap, Lightbulb, Fan, Droplet,
  Lock, Unlock, Bell, Snowflake, Flame, ChevronUp, ChevronDown,
} from 'lucide-react';
import type { CommandButtonWidget } from '../../types/scada.types';
import { toScadaNumber } from '../../types/scada.types';
import type { SendCommand } from '../../hooks/useScreenCommand';

interface Props {
  widget: CommandButtonWidget;
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  onCommand?: SendCommand;
  isEditor?: boolean;
  staticRender?: boolean;
  /** Ponto sem comunicação (viewer): bloqueia o envio de comandos. */
  commOffline?: boolean;
}

type Phase = 'idle' | 'sending' | 'error';

const ICON_MAP: Record<string, React.ComponentType<{ style?: React.CSSProperties; strokeWidth?: number }>> = {
  power: Power, play: Play, pause: Pause, refresh: RotateCw, zap: Zap, lightbulb: Lightbulb,
  fan: Fan, droplet: Droplet, lock: Lock, unlock: Unlock, bell: Bell, snowflake: Snowflake,
  flame: Flame, 'chevron-up': ChevronUp, 'chevron-down': ChevronDown,
};

/** Converte #rrggbb em rgba(r,g,b,a). Para cores não-hex, devolve a própria. */
function withAlpha(hex: string, a: number): string {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n) || h.length !== 6) return hex;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function CommandButtonWidgetView({ widget, getValue, onCommand, isEditor, staticRender, commOffline }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [pressed, setPressed] = useState(false);

  // Feedback otimista COMPARTILHADO: o valor comandado é registrado no
  // pending-commands.store pelo useScreenCommand e já vem embutido no
  // getValue — todos os widgets do mesmo ponto (ícone, botão, status,
  // animação) mudam juntos na hora, e revertem juntos se o comando falhar.
  const raw = staticRender ? null : getValue(widget.deviceId, widget.tag);
  const rawNum = raw === null ? null : toScadaNumber(raw);
  const effective = rawNum === null || Number.isNaN(rawNum) ? null : rawNum;
  const offline = effective === null;
  const isOn = !offline && effective !== widget.offValue;

  const bound = Boolean(widget.deviceId && widget.tag);
  const bg = isOn ? widget.colorOn : widget.colorOff;
  const stateLabel = offline ? '—' : isOn ? 'ON' : 'OFF';

  async function send(value: number): Promise<void> {
    if (isEditor || !onCommand) return;
    // Ponto sem comunicação: não dispara comando silenciosamente sobre um
    // estado visual possivelmente defasado (o botão já está desabilitado).
    if (commOffline) return;
    if (widget.confirm) {
      const verb = value === widget.offValue ? 'DESLIGAR' : 'LIGAR';
      if (!window.confirm(`Confirmar comando: ${verb} "${widget.label}"?`)) return;
    }
    setPhase('sending');
    setErrMsg(null);
    const res = await onCommand(widget.deviceId, widget.tag, value, widget.priority);
    if (res.ok) {
      // ok com warning = "enviado, sem confirmação": NÃO é erro — o estado
      // otimista segue até a telemetria de readback confirmar (ou TTL expirar).
      setPhase('idle');
      setErrMsg(res.warning ?? null);
    } else {
      setPhase('error');
      setErrMsg(res.error ?? 'Falha ao enviar comando');
      setTimeout(() => setPhase('idle'), 2500);
    }
  }

  function targetValue(): number {
    if (widget.mode === 'set-on') return widget.onValue;
    if (widget.mode === 'set-off') return widget.offValue;
    // toggle: alterna a partir do valor EFETIVO (otimista pendente ?? telemetria)
    // — cliques em sequência invertem corretamente sem esperar o vivo confirmar.
    return isOn ? widget.offValue : widget.onValue;
  }

  function handleClick(): void {
    if (widget.mode === 'momentary') return; // momentâneo usa mousedown/up
    void send(targetValue());
  }

  // Momentâneo: pulso — liga ao pressionar, desliga ao soltar (ou ao sair do botão).
  const momentaryHandlers = widget.mode === 'momentary' && !isEditor && !commOffline
    ? {
        onMouseDown: () => { setPressed(true); void send(widget.onValue); },
        onMouseUp: () => { if (pressed) { setPressed(false); void send(widget.offValue); } },
        onMouseLeave: () => { if (pressed) { setPressed(false); void send(widget.offValue); } },
      }
    : {};

  const disabled = isEditor || !bound || Boolean(commOffline);
  const error = phase === 'error';

  // Estilo por variante. `accent` é a cor de estado (on/off); no erro, vermelho.
  const accent = error ? '#EF4444' : bg;
  const variant = widget.variant ?? 'solid';
  const isSolid = variant === 'solid' || variant === 'pill';
  const radius = variant === 'pill' ? 999 : widget.borderRadius;

  let backgroundColor = 'transparent';
  let border = '1px solid transparent';
  let textColor = widget.textColor;
  if (isSolid) {
    backgroundColor = accent;
    border = isOn ? '1px solid rgba(255,255,255,0.35)' : '1px solid rgba(255,255,255,0.12)';
  } else if (variant === 'outline') {
    border = `1.5px solid ${accent}`;
    textColor = accent;
  } else if (variant === 'soft') {
    backgroundColor = withAlpha(accent, 0.18);
    border = `1px solid ${withAlpha(accent, 0.4)}`;
    textColor = accent;
  } else if (variant === 'ghost') {
    textColor = accent;
  }

  const Icon = widget.iconName && widget.iconName !== 'none' ? (ICON_MAP[widget.iconName] ?? null) : null;
  const iconStyle = { width: widget.fontSize, height: widget.fontSize, flexShrink: 0 };
  const showLabel = !widget.iconOnly && widget.label;

  return (
    <button
      type="button"
      onClick={handleClick}
      {...momentaryHandlers}
      disabled={!isEditor && (commOffline || !bound)}
      title={commOffline ? 'Sem comunicação — comando bloqueado' : (errMsg ?? (bound ? widget.tag : 'Vincule um ponto comandável (DO)'))}
      style={{
        width: '100%', height: '100%',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
        backgroundColor,
        color: textColor,
        borderRadius: radius,
        fontSize: widget.fontSize,
        fontFamily: 'Inter, sans-serif', fontWeight: 600,
        border,
        boxShadow: isSolid && isOn && !offline ? `0 0 12px ${withAlpha(accent, 0.5)}` : undefined,
        cursor: disabled ? 'default' : 'pointer',
        opacity: bound ? 1 : 0.55,
        transition: 'background-color 150ms, box-shadow 150ms, filter 150ms', userSelect: 'none', padding: 4,
      }}
      onMouseEnter={(e) => { if (!disabled) (e.currentTarget as HTMLButtonElement).style.filter = variant === 'ghost' || variant === 'outline' ? 'brightness(1.3)' : 'brightness(1.1)'; }}
      onMouseOut={(e) => { (e.currentTarget as HTMLButtonElement).style.filter = ''; }}
    >
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: showLabel ? 5 : 0 }}>
        {phase === 'sending'
          ? <Loader2 style={iconStyle} className="animate-spin" strokeWidth={2} />
          : Icon
            ? <Icon style={iconStyle} strokeWidth={2} />
            : null}
        {showLabel && widget.label}
      </span>
      {widget.showState && !widget.iconOnly && (
        <span style={{ fontSize: Math.max(9, widget.fontSize * 0.7), opacity: 0.85, fontWeight: 500, letterSpacing: 0.5 }}>
          {error ? 'ERRO' : stateLabel}
        </span>
      )}
    </button>
  );
}
