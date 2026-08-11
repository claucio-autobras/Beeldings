'use client';

import type { SetpointRingWidget } from '../../types/scada.types';
import { toScadaNumber, isTransparentColor, scadaColorWithAlpha, scadaBackgroundStyle } from '../../types/scada.types';

interface Props {
  widget: SetpointRingWidget;
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  staticRender?: boolean;
}

/**
 * Anel de setpoint — arco circular de progresso (270°) com valor grande no
 * centro, unidade e rótulo abaixo (ex.: "AMBIENTE"). Somente leitura; sem
 * dado ao vivo mostra "—" e o anel apagado (offline cinza é aplicado pelo
 * renderer). Render estático mostra a aparência de projeto (arco ~62%).
 */
export function SetpointRingWidgetView({ widget: w, getValue, staticRender }: Props) {
  const bound = Boolean(w.deviceId && w.tag);
  const raw = staticRender || !bound ? null : getValue(w.deviceId, w.tag);
  const num = raw === null ? NaN : toScadaNumber(raw);
  const live = Number.isNaN(num) ? null : num;

  const range = w.maxValue - w.minValue;
  const pct = staticRender
    ? 0.62
    : live === null || range <= 0 ? 0 : Math.min(1, Math.max(0, (live - w.minValue) / range));

  // Reserva espaço para o rótulo abaixo do anel quando presente.
  const labelH = w.showLabel && w.label ? 22 : 0;
  const SIZE = Math.max(40, Math.min(w.width, w.height - labelH));
  const cx = SIZE / 2, cy = SIZE / 2;
  const strokeWidth = Math.max(6, SIZE * 0.07);
  const r = SIZE / 2 - strokeWidth;

  const startAngle = 225, sweep = 270;
  const endAngle = startAngle - sweep * pct;

  function polarToXY(angle: number, radius: number) {
    const rad = ((angle - 90) * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  }
  function arcPath(from: number, to: number, radius: number) {
    const start = polarToXY(from, radius);
    const end = polarToXY(to, radius);
    const large = Math.abs(from - to) > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${large} ${from > to ? 0 : 1} ${end.x} ${end.y}`;
  }

  const valueText = staticRender
    ? '––'
    : live === null ? '—' : live.toLocaleString('pt-BR', { minimumFractionDigits: w.decimals, maximumFractionDigits: w.decimals });

  return (
    <div style={{
      width: '100%', height: '100%', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      ...(isTransparentColor(w.backgroundColor) ? { backgroundColor: 'transparent' } : scadaBackgroundStyle(w.backgroundColor)),
      borderRadius: w.borderRadius,
      userSelect: 'none',
    }}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/* Trilha */}
        <path d={arcPath(startAngle, startAngle - sweep, r)} fill="none" stroke={w.trackColor} strokeWidth={strokeWidth} strokeLinecap="round" />
        {/* Progresso (com brilho suave, estilo neon) */}
        {pct > 0 && (
          <path
            d={arcPath(startAngle, endAngle, r)}
            fill="none" stroke={w.ringColor} strokeWidth={strokeWidth} strokeLinecap="round"
            style={{ filter: `drop-shadow(0 0 ${strokeWidth * 0.6}px ${scadaColorWithAlpha(w.ringColor, '66')})` }}
          />
        )}
        {/* Valor central + unidade */}
        <text x={cx} y={cy + SIZE * 0.04} textAnchor="middle"
          fill={live === null && !staticRender ? w.mutedColor : w.ringColor}
          fontSize={SIZE * 0.22} fontWeight={700}
          fontFamily="'Roboto Mono', monospace" style={{ fontVariantNumeric: 'tabular-nums' }}>
          {valueText}
        </text>
        {w.unit && (
          <text x={cx + SIZE * 0.22 + valueText.length * SIZE * 0.055} y={cy - SIZE * 0.06} textAnchor="middle" fill={w.mutedColor} fontSize={SIZE * 0.08} fontWeight={600} fontFamily="Inter, sans-serif">
            {w.unit}
          </text>
        )}
        {w.showLabel && w.label && (
          <text x={cx} y={cy + SIZE * 0.17} textAnchor="middle" fill={w.mutedColor} fontSize={SIZE * 0.065} fontWeight={600} letterSpacing="0.14em" fontFamily="Inter, sans-serif">
            {w.label.toUpperCase()}
          </text>
        )}
      </svg>
      {!bound && !staticRender && (
        <span style={{ fontSize: 10, fontStyle: 'italic', color: w.mutedColor }}>vincule um ponto</span>
      )}
    </div>
  );
}
