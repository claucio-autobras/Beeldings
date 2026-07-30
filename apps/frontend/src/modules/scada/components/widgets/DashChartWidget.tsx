'use client';

import { useMemo } from 'react';
import type { DashChartWidget } from '../../types/scada.types';
import { dashCardStyle, DashCardTitle, NoData, withAlpha } from './dashCard';
import { usePointHistory, pointKey } from '../../hooks/usePointHistory';

interface Props {
  widget: DashChartWidget;
  staticRender?: boolean;
}

const PERIOD_LABEL: Record<number, string> = { 1: '1 h', 6: '6 h', 24: '24 h', 72: '3 d', 168: '7 d' };

/**
 * Gráfico de tendência multi-série (até 4 pontos) com legenda e linha de limite
 * tracejada opcional. Dados via trends (rollup); rótulos como HTML (não SVG text).
 */
export function DashChartWidgetView({ widget: w, staticRender }: Props) {
  const boundSeries = w.series.filter((s) => s.deviceId && s.tag).slice(0, 4);
  // Refs memoizados por w.series — o usePointHistory já deduplica o refetch
  // internamente por chave estável (refsKey), então identidade nova é barata.
  const refs = useMemo(
    () => w.series
      .filter((s) => s.deviceId && s.tag)
      .slice(0, 4)
      .map((s) => ({ deviceId: s.deviceId, tag: s.tag })),
    [w.series],
  );
  const { series: hist } = usePointHistory(refs, w.periodHours, !staticRender && boundSeries.length > 0);

  const headerH = 34;
  const legendH = w.showLegend && boundSeries.length > 0 ? 22 : 0;
  const padL = 42, padR = 10, padT = 8, padB = 20;
  const chartW = Math.max(60, w.width - 2);
  const chartH = Math.max(50, w.height - headerH - legendH - 2);
  const plotW = chartW - padL - padR;
  const plotH = chartH - padT - padB;

  const data = boundSeries.map((s) => ({ def: s, points: hist[pointKey(s)]?.points ?? [] }));
  const hasData = !staticRender && data.some((d) => d.points.length >= 2);

  const domain = useMemo(() => {
    if (!hasData) return null;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const d of data) for (const p of d.points) {
      if (p.t < x0) x0 = p.t; if (p.t > x1) x1 = p.t;
      if (p.value < y0) y0 = p.value; if (p.value > y1) y1 = p.value;
    }
    if (w.limitEnabled) { y0 = Math.min(y0, w.limitValue); y1 = Math.max(y1, w.limitValue); }
    if (y1 === y0) { y0 -= 1; y1 += 1; }
    const padY = (y1 - y0) * 0.08;
    return { x0, x1: x1 === x0 ? x0 + 1 : x1, y0: y0 - padY, y1: y1 + padY };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasData, hist, w.limitEnabled, w.limitValue]);

  const px = (t: number) => domain ? padL + ((t - domain.x0) / (domain.x1 - domain.x0)) * plotW : 0;
  const py = (v: number) => domain ? padT + (1 - (v - domain.y0) / (domain.y1 - domain.y0)) * plotH : 0;

  const yTicks = domain
    ? [domain.y0 + (domain.y1 - domain.y0) * 0.08, (domain.y0 + domain.y1) / 2, domain.y1 - (domain.y1 - domain.y0) * 0.08]
    : [];

  const fmtTime = (t: number) => {
    const d = new Date(t);
    return w.periodHours > 24
      ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })
      : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  };
  const fmtVal = (v: number) => Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1);

  return (
    <div style={dashCardStyle(w)}>
      <div style={{ height: headerH, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 14px', borderBottom: `1px solid ${w.borderColor}`, flexShrink: 0 }}>
        <DashCardTitle text={w.title} color={w.mutedColor} />
        <span style={{ fontSize: 9, fontWeight: 600, letterSpacing: '0.08em', color: w.mutedColor, textTransform: 'uppercase' }}>
          {PERIOD_LABEL[w.periodHours] ?? `${w.periodHours} h`}
        </span>
      </div>
      <div style={{ position: 'relative', flex: 1, minHeight: 0 }}>
        {staticRender ? (
          <svg width={chartW} height={chartH} style={{ display: 'block', opacity: 0.55 }}>
            {(boundSeries.length > 0 ? boundSeries : [{ id: 'a', color: '#3B82F6' }, { id: 'b', color: '#22C55E' }]).slice(0, 3).map((s, i) => (
              <path key={s.id}
                d={`M${padL},${padT + plotH * (0.65 - i * 0.15)} Q ${padL + plotW * 0.3},${padT + plotH * (0.25 + i * 0.1)} ${padL + plotW * 0.55},${padT + plotH * (0.5 - i * 0.08)} T ${padL + plotW},${padT + plotH * (0.4 + i * 0.12)}`}
                fill="none" stroke={('color' in s ? s.color : '#3B82F6')} strokeWidth={1.8} strokeDasharray="5 4" />
            ))}
            {w.limitEnabled && <line x1={padL} x2={padL + plotW} y1={padT + plotH * 0.2} y2={padT + plotH * 0.2} stroke={w.limitColor} strokeWidth={1.2} strokeDasharray="5 4" />}
          </svg>
        ) : hasData && domain ? (
          <>
            <svg width={chartW} height={chartH} style={{ display: 'block' }}>
              {yTicks.map((v, i) => (
                <line key={i} x1={padL} x2={padL + plotW} y1={py(v)} y2={py(v)} stroke={withAlpha(w.mutedColor, 0.18)} strokeWidth={1} />
              ))}
              {data.map((d) => d.points.length >= 2 && (
                <path key={d.def.id}
                  d={d.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${px(p.t).toFixed(1)},${py(p.value).toFixed(1)}`).join(' ')}
                  fill="none" stroke={d.def.color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
              ))}
              {w.limitEnabled && (
                <line x1={padL} x2={padL + plotW} y1={py(w.limitValue)} y2={py(w.limitValue)} stroke={w.limitColor} strokeWidth={1.4} strokeDasharray="6 4" />
              )}
            </svg>
            {/* Rótulos como HTML (nunca <text> escalado) */}
            {yTicks.map((v, i) => (
              <span key={i} style={{ position: 'absolute', left: 4, top: py(v) - 7, fontSize: 9, color: w.mutedColor, fontVariantNumeric: 'tabular-nums' }}>{fmtVal(v)}</span>
            ))}
            <span style={{ position: 'absolute', left: padL, bottom: 3, fontSize: 9, color: w.mutedColor }}>{fmtTime(domain.x0)}</span>
            <span style={{ position: 'absolute', right: padR, bottom: 3, fontSize: 9, color: w.mutedColor }}>{fmtTime(domain.x1)}</span>
            {w.limitEnabled && w.limitLabel && (
              <span style={{ position: 'absolute', right: padR + 2, top: Math.max(2, py(w.limitValue) - 14), fontSize: 9, fontWeight: 600, color: w.limitColor }}>
                {w.limitLabel}
              </span>
            )}
          </>
        ) : (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <NoData color={w.mutedColor} />
          </div>
        )}
      </div>
      {legendH > 0 && (
        <div style={{ height: legendH, display: 'flex', alignItems: 'center', gap: 12, padding: '0 14px', flexShrink: 0 }}>
          {boundSeries.map((s) => (
            <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, color: w.mutedColor, overflow: 'hidden', whiteSpace: 'nowrap' }}>
              <span style={{ width: 10, height: 3, borderRadius: 2, backgroundColor: s.color, flexShrink: 0 }} />
              {s.label || s.tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
