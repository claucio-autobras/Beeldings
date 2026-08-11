'use client';

import { useMemo, useState } from 'react';
import { Loader2, Minus, Plus, Power } from 'lucide-react';
import type { ClimateCardWidget } from '../../types/scada.types';
import { toScadaNumber } from '../../types/scada.types';
import type { SendCommand } from '../../hooks/useScreenCommand';
import type { PointStatus, PointReading } from '../../hooks/useScreenTelemetry';
import { dashCardStyle, NoData, withAlpha } from './dashCard';
import { ClimateCardHeader, resolveHeaderStatus, fmtClimateValue, relativeTime } from './climateCard';
import { usePointHistory, pointKey } from '../../hooks/usePointHistory';
import { useEditorStore } from '../../store/editor.store';

interface Props {
  widget: ClimateCardWidget;
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  getTagStatus?: (deviceId: string, tag: string) => PointStatus;
  getReading?: (deviceId: string, tag: string) => PointReading | null;
  onCommand?: SendCommand;
  isEditor?: boolean;
  staticRender?: boolean;
}

/** Mini sparkline em barras (estilo da referência). */
function BarSparkline({ points, color, width, height }: { points: { t: number; value: number }[]; color: string; width: number; height: number }) {
  const bars = useMemo(() => {
    if (points.length < 2) return null;
    const n = Math.min(18, points.length);
    const slice = points.slice(-n);
    const ys = slice.map((p) => p.value);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    const span = y1 - y0 || 1;
    return slice.map((p) => 0.25 + 0.75 * ((p.value - y0) / span));
  }, [points]);
  if (!bars) return null;
  const bw = width / bars.length;
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      {bars.map((f, i) => (
        <rect key={i} x={i * bw + bw * 0.25} y={height * (1 - f)} width={bw * 0.5} height={height * f} rx={1.5} fill={color} opacity={0.35 + 0.65 * f} />
      ))}
    </svg>
  );
}

/**
 * Card de controle de clima — painel composto: leitura principal (valor grande
 * + sparkline opcional), linha de setpoint com slider, stepper − valor + e
 * botão liga/desliga, rodapé com última leitura/origem. Bindings separados
 * para leitura, setpoint e liga/desliga; comandos via fluxo otimista
 * compartilhado e bloqueados sem comunicação.
 */
export function ClimateCardWidgetView({ widget: w, getValue, getTagStatus, getReading, onCommand, isEditor, staticRender }: Props) {
  const [sending, setSending] = useState<'setpoint' | 'stepper' | 'power' | null>(null);
  const [draft, setDraft] = useState<number | null>(null);

  const status = resolveHeaderStatus(w.statusRules, w.statusDeviceId, w.statusTag, getValue, Boolean(staticRender));

  // ── Leitura principal ──
  const readingBound = Boolean(w.readingDeviceId && w.readingTag);
  const readingRaw = staticRender || !readingBound ? null : getValue(w.readingDeviceId, w.readingTag);
  const readingText = staticRender ? '––' : fmtClimateValue(readingRaw, w.readingDecimals);
  const refs = useMemo(() => [{ deviceId: w.readingDeviceId, tag: w.readingTag }], [w.readingDeviceId, w.readingTag]);
  const { series } = usePointHistory(refs, w.periodHours, Boolean(!staticRender && readingBound && w.showSparkline));
  const hist = readingBound ? series[pointKey({ deviceId: w.readingDeviceId, tag: w.readingTag })] ?? null : null;

  // ── Setpoint ──
  const spBound = Boolean(w.setpointDeviceId && w.setpointTag);
  const spRaw = staticRender || !spBound ? null : getValue(w.setpointDeviceId, w.setpointTag);
  const spNum = spRaw === null ? NaN : toScadaNumber(spRaw);
  const spLive = Number.isNaN(spNum) ? null : spNum;
  const spDisplay = draft ?? (staticRender ? (w.minValue + w.maxValue) / 2 : spLive);
  const spClamped = spDisplay === null ? null : Math.min(w.maxValue, Math.max(w.minValue, spDisplay));
  const spPct = spClamped === null || w.maxValue <= w.minValue ? 0 : ((spClamped - w.minValue) / (w.maxValue - w.minValue)) * 100;

  // ── Liga/desliga ──
  const pwBound = Boolean(w.powerDeviceId && w.powerTag);
  const pwRaw = staticRender || !pwBound ? null : getValue(w.powerDeviceId, w.powerTag);
  const pwNum = pwRaw === null ? NaN : toScadaNumber(pwRaw);
  // Estático: aparência de projeto (ligado) para mostrar a cor de acento.
  const isOn = staticRender ? true : !Number.isNaN(pwNum) && pwNum !== w.offValue;

  function offlineAt(deviceId: string, tag: string): boolean {
    if (staticRender || isEditor || !getTagStatus || !deviceId || !tag) return false;
    return getTagStatus(deviceId, tag) !== 'live';
  }
  const spOffline = offlineAt(w.setpointDeviceId, w.setpointTag);
  const pwOffline = offlineAt(w.powerDeviceId, w.powerTag);

  async function sendSetpoint(value: number, via: 'setpoint' | 'stepper'): Promise<void> {
    if (isEditor || staticRender || !onCommand || !spBound || sending) return;
    if (spOffline) {
      useEditorStore.getState().addToast('error', 'Ponto sem comunicação — comando bloqueado');
      setDraft(null);
      return;
    }
    setSending(via);
    const res = await onCommand(w.setpointDeviceId, w.setpointTag, value, w.priority);
    setSending(null);
    setDraft(null);
    if (!res.ok) useEditorStore.getState().addToast('error', res.error ?? 'Falha ao enviar comando');
  }

  function bump(dir: 1 | -1): void {
    if (spLive === null && draft === null) return;
    const base = draft ?? spLive ?? w.minValue;
    const next = Math.min(w.maxValue, Math.max(w.minValue, base + dir * (w.step || 1)));
    if (next !== base) void sendSetpoint(next, 'stepper');
  }

  async function togglePower(): Promise<void> {
    if (isEditor || staticRender || !onCommand || !pwBound || sending) return;
    if (pwOffline) {
      useEditorStore.getState().addToast('error', 'Ponto sem comunicação — comando bloqueado');
      return;
    }
    const value = isOn ? w.offValue : w.onValue;
    if (w.powerConfirm && !window.confirm(`Confirmar comando: ${value === w.offValue ? 'DESLIGAR' : 'LIGAR'} "${w.title}"?`)) return;
    setSending('power');
    const res = await onCommand(w.powerDeviceId, w.powerTag, value, w.priority);
    setSending(null);
    if (!res.ok) useEditorStore.getState().addToast('error', res.error ?? 'Falha ao enviar comando');
  }

  // ── Rodapé: última leitura + origem ──
  const reading = staticRender || !readingBound ? null : getReading?.(w.readingDeviceId, w.readingTag) ?? null;
  const lastSeen = relativeTime(reading?.timestamp);

  const panelStyle: React.CSSProperties = {
    backgroundColor: withAlpha('#94A3B8', 0.06),
    border: `1px solid ${w.borderColor}`,
    borderRadius: 10,
    padding: '10px 12px',
  };
  const sparkW = Math.max(50, Math.round(w.width * 0.3));
  const spValueText = spClamped === null ? null : spClamped.toLocaleString('pt-BR', { minimumFractionDigits: w.setpointDecimals, maximumFractionDigits: w.setpointDecimals });
  const spDisabled = isEditor || staticRender || !spBound || spOffline || (spLive === null && !staticRender);
  const pwDisabled = isEditor || staticRender || !pwBound || pwOffline || (!staticRender && Number.isNaN(pwNum)) || sending === 'power';

  const stepBtn = (dir: 1 | -1): React.ReactNode => (
    <button
      type="button" disabled={spDisabled} onClick={() => bump(dir)} aria-label={dir > 0 ? 'Aumentar' : 'Diminuir'}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        width: 34, height: 34, borderRadius: 8,
        backgroundColor: withAlpha('#94A3B8', 0.08), border: `1px solid ${w.borderColor}`,
        color: spDisabled ? w.mutedColor : w.textColor, cursor: spDisabled ? 'default' : 'pointer', padding: 0,
      }}
    >
      {dir > 0 ? <Plus style={{ width: 14, height: 14 }} strokeWidth={2} /> : <Minus style={{ width: 14, height: 14 }} strokeWidth={2} />}
    </button>
  );

  return (
    <div style={{ ...dashCardStyle(w), padding: '12px 14px', gap: 10 }}>
      <ClimateCardHeader title={w.title} subtitle={w.subtitle} status={status} textColor={w.textColor} mutedColor={w.mutedColor} />

      {/* Leitura principal */}
      <div style={{ ...panelStyle, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          {w.readingLabel && (
            <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: w.mutedColor, marginBottom: 4 }}>{w.readingLabel}</div>
          )}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            {readingText !== null ? (
              <>
                <span style={{ fontSize: 30, fontWeight: 700, lineHeight: 1, fontFamily: 'Roboto Mono, monospace', fontVariantNumeric: 'tabular-nums', color: w.accentColor }}>{readingText}</span>
                {w.readingUnit && <span style={{ fontSize: 12, fontWeight: 600, color: w.mutedColor }}>{w.readingUnit}</span>}
              </>
            ) : (
              <NoData color={w.mutedColor} />
            )}
          </div>
        </div>
        {w.showSparkline && (
          staticRender ? (
            <svg width={sparkW} height={34} style={{ opacity: 0.55 }}>
              {Array.from({ length: 14 }, (_, i) => { const f = 0.3 + 0.7 * Math.abs(Math.sin(i * 0.9)); const bw = sparkW / 14; return <rect key={i} x={i * bw + bw * 0.25} y={34 * (1 - f)} width={bw * 0.5} height={34 * f} rx={1.5} fill={w.sparkColor} />; })}
            </svg>
          ) : hist && hist.points.length >= 2 ? (
            <BarSparkline points={hist.points} color={w.sparkColor} width={sparkW} height={34} />
          ) : null
        )}
      </div>

      {/* Setpoint + slider */}
      <div style={{ ...panelStyle, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
          <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: w.mutedColor }}>{w.setpointLabel}</span>
          {spValueText !== null ? (
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
              <span style={{ fontSize: 15, fontWeight: 700, fontFamily: 'Roboto Mono, monospace', fontVariantNumeric: 'tabular-nums', color: w.textColor }}>
                {sending === 'setpoint' ? '…' : spValueText}
              </span>
              {w.setpointUnit && <span style={{ fontSize: 10, fontWeight: 600, color: w.mutedColor }}>{w.setpointUnit}</span>}
            </span>
          ) : (
            <NoData color={w.mutedColor} compact />
          )}
        </div>
        <input
          type="range" min={w.minValue} max={w.maxValue} step={w.step || 1}
          value={spClamped ?? w.minValue}
          disabled={spDisabled}
          onChange={(e) => setDraft(Number(e.target.value))}
          onPointerUp={() => { if (!isEditor && draft !== null) void sendSetpoint(draft, 'setpoint'); }}
          onKeyUp={() => { if (!isEditor && draft !== null) void sendSetpoint(draft, 'setpoint'); }}
          style={{
            width: '100%', accentColor: w.accentColor, height: 4, borderRadius: 4,
            appearance: 'none', WebkitAppearance: 'none',
            background: `linear-gradient(to right, ${w.accentColor} ${spPct}%, rgba(148,163,184,0.25) ${spPct}%)`,
            cursor: spDisabled ? 'default' : 'pointer',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: w.mutedColor }}>
          <span>{w.minValue}{w.setpointUnit ? '°' : ''}</span>
          <span>{w.maxValue}{w.setpointUnit ? '°' : ''}</span>
        </div>
      </div>

      {/* Stepper + liga/desliga */}
      <div style={{ display: 'flex', alignItems: 'stretch', gap: 8 }}>
        <div style={{ ...panelStyle, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '6px 8px' }}>
          {stepBtn(-1)}
          <span style={{ display: 'flex', alignItems: 'baseline', gap: 3 }}>
            {sending === 'stepper' ? (
              <Loader2 className="animate-spin" style={{ width: 14, height: 14, color: w.accentColor }} strokeWidth={2} />
            ) : spValueText !== null ? (
              <>
                <span style={{ fontSize: 17, fontWeight: 700, fontFamily: 'Roboto Mono, monospace', fontVariantNumeric: 'tabular-nums', color: w.textColor }}>{spValueText}</span>
                {w.setpointUnit && <span style={{ fontSize: 10, fontWeight: 600, color: w.mutedColor }}>{w.setpointUnit}</span>}
              </>
            ) : (
              <NoData color={w.mutedColor} compact />
            )}
          </span>
          {stepBtn(1)}
        </div>
        <button
          type="button" disabled={pwDisabled} onClick={() => void togglePower()}
          title={pwOffline ? 'Sem comunicação — comando bloqueado' : pwBound ? (isOn ? 'Desligar' : 'Ligar') : 'Vincule o ponto liga/desliga'}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            width: 48, borderRadius: 10, padding: 0,
            backgroundColor: isOn ? withAlpha('#34D399', 0.12) : withAlpha('#94A3B8', 0.08),
            border: `1px solid ${isOn ? withAlpha('#34D399', 0.5) : w.borderColor}`,
            color: isOn ? '#34D399' : w.mutedColor,
            boxShadow: isOn ? `0 0 10px ${withAlpha('#34D399', 0.3)}` : undefined,
            cursor: pwDisabled ? 'default' : 'pointer',
            transition: 'background-color 180ms, box-shadow 180ms, color 180ms',
          }}
        >
          {sending === 'power' ? <Loader2 className="animate-spin" style={{ width: 18, height: 18 }} strokeWidth={2} /> : <Power style={{ width: 18, height: 18 }} strokeWidth={2} />}
        </button>
      </div>

      {/* Rodapé */}
      {(w.footerText || !staticRender) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 9, color: w.mutedColor }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {staticRender ? 'Última leitura —' : lastSeen ? `Última leitura ${lastSeen}` : 'Sem leitura recente'}
          </span>
          {w.footerText && <span style={{ flexShrink: 0 }}>{w.footerText}</span>}
        </div>
      )}
    </div>
  );
}
