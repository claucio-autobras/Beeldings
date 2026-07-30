'use client';

import { useMemo } from 'react';
import type { SensorCardWidget } from '../../types/scada.types';
import { dashCardStyle, DashCardTitle, DashBadge, NoData, matchRule, fmtValue, withAlpha } from './dashCard';
import { usePointHistory, pointKey } from '../../hooks/usePointHistory';

interface Props {
  widget: SensorCardWidget;
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  staticRender?: boolean;
}

/** Sparkline SVG (linha + área suave). Sem dado suficiente → null. */
function Sparkline({ points, color, width, height }: { points: { t: number; value: number }[]; color: string; width: number; height: number }) {
  const d = useMemo(() => {
    if (points.length < 2) return null;
    const xs = points.map((p) => p.t), ys = points.map((p) => p.value);
    const x0 = Math.min(...xs), x1 = Math.max(...xs);
    const y0 = Math.min(...ys), y1 = Math.max(...ys);
    const spanX = x1 - x0 || 1, spanY = y1 - y0 || 1;
    const pad = height * 0.12;
    const px = (t: number) => ((t - x0) / spanX) * width;
    const py = (v: number) => height - pad - ((v - y0) / spanY) * (height - pad * 2);
    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.t).toFixed(1)},${py(p.value).toFixed(1)}`).join(' ');
    const area = `${line} L${width},${height} L0,${height} Z`;
    return { line, area };
  }, [points, width, height]);
  if (!d) return null;
  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <path d={d.area} fill={withAlpha(color, 0.12)} stroke="none" />
      <path d={d.line} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** Card de sensor — valor grande + sparkline das leituras recentes (trends). */
export function SensorCardWidgetView({ widget: w, getValue, staticRender }: Props) {
  const bound = Boolean(w.deviceId && w.tag);
  const refs = useMemo(() => [{ deviceId: w.deviceId, tag: w.tag }], [w.deviceId, w.tag]);
  const { series } = usePointHistory(refs, w.periodHours, !staticRender && bound);
  const hist = bound ? series[pointKey({ deviceId: w.deviceId, tag: w.tag })] ?? null : null;

  const raw = staticRender || !bound ? null : getValue(w.deviceId, w.tag);
  const text = fmtValue(raw, w.decimals);
  const rule = staticRender ? (w.badgeRules[0] ?? null) : matchRule(w.badgeRules, raw);

  const sparkW = Math.max(40, w.width - 28);
  const sparkH = Math.max(20, Math.round(w.height * 0.3));

  return (
    <div style={{ ...dashCardStyle(w), padding: '12px 14px', justifyContent: 'space-between', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <DashCardTitle text={w.title} color={w.mutedColor} />
        {w.showBadge && rule?.text && <DashBadge color={rule.color} text={rule.text} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        {staticRender ? (
          <span style={{ fontSize: w.valueFontSize, fontWeight: 700, fontFamily: 'Roboto Mono, monospace', color: w.textColor }}>––</span>
        ) : text !== null ? (
          <span style={{ fontSize: w.valueFontSize, fontWeight: 700, fontFamily: 'Roboto Mono, monospace', fontVariantNumeric: 'tabular-nums', color: w.textColor, lineHeight: 1.05 }}>
            {text}
          </span>
        ) : (
          <NoData color={w.mutedColor} />
        )}
        {w.unit && (text !== null || staticRender) && (
          <span style={{ fontSize: Math.max(10, Math.round(w.valueFontSize * 0.45)), fontWeight: 600, color: w.mutedColor }}>{w.unit}</span>
        )}
      </div>
      <div style={{ height: sparkH, display: 'flex', alignItems: 'flex-end' }}>
        {staticRender ? (
          // Render estático: onda de projeto (sem telemetria)
          <svg width={sparkW} height={sparkH} style={{ display: 'block', opacity: 0.55 }}>
            <path d={`M0,${sparkH * 0.7} Q ${sparkW * 0.2},${sparkH * 0.2} ${sparkW * 0.4},${sparkH * 0.55} T ${sparkW * 0.75},${sparkH * 0.45} T ${sparkW},${sparkH * 0.6}`}
              fill="none" stroke={w.sparkColor} strokeWidth={1.6} strokeDasharray="4 3" />
          </svg>
        ) : hist && hist.points.length >= 2 ? (
          <Sparkline points={hist.points} color={w.sparkColor} width={sparkW} height={sparkH} />
        ) : (
          <NoData color={w.mutedColor} compact />
        )}
      </div>
    </div>
  );
}
