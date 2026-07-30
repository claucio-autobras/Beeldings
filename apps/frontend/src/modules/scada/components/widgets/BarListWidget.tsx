'use client';

import type { BarListWidget } from '../../types/scada.types';
import { dashCardStyle, DashCardTitle, NoData, fmtValue, withAlpha } from './dashCard';
import { toScadaNumber } from '../../types/scada.types';

interface Props {
  widget: BarListWidget;
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  staticRender?: boolean;
}

/** Lista de barras percentuais — rótulo + barra + valor por linha (estilo "consumo por circuito"). */
export function BarListWidgetView({ widget: w, getValue, staticRender }: Props) {
  const rows = w.rows;
  return (
    <div style={{ ...dashCardStyle(w), padding: '12px 14px', gap: 10 }}>
      <DashCardTitle text={w.title} color={w.mutedColor} />
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {rows.length === 0 && (
          <span style={{ fontSize: 10, fontStyle: 'italic', color: w.mutedColor }}>Adicione linhas nas propriedades</span>
        )}
        {rows.map((r, idx) => {
          const bound = Boolean(r.deviceId && r.tag);
          const raw = staticRender || !bound ? null : getValue(r.deviceId, r.tag);
          const num = raw === null ? null : toScadaNumber(raw);
          const valid = num !== null && !Number.isNaN(num);
          const span = r.maxValue - r.minValue;
          const pct = valid && span > 0 ? Math.min(100, Math.max(0, ((num - r.minValue) / span) * 100)) : null;
          const staticPct = 70 - idx * 14; // render estático de projeto
          const text = valid ? fmtValue(num, r.decimals) : null;
          return (
            <div key={r.id} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 500, color: w.textColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label || r.tag || '—'}</span>
                {staticRender ? (
                  <span style={{ fontSize: 11, fontFamily: 'Roboto Mono, monospace', color: w.mutedColor }}>––</span>
                ) : text !== null && pct !== null ? (
                  <span style={{ fontSize: 11, fontFamily: 'Roboto Mono, monospace', fontVariantNumeric: 'tabular-nums', color: w.textColor, whiteSpace: 'nowrap' }}>
                    {text}{r.unit ? ` ${r.unit}` : ''} <span style={{ color: w.mutedColor }}>· {Math.round(pct)}%</span>
                  </span>
                ) : (
                  <NoData color={w.mutedColor} compact />
                )}
              </div>
              <div style={{ height: 6, borderRadius: 999, backgroundColor: withAlpha(w.mutedColor, 0.18), overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 999, backgroundColor: r.color,
                  width: `${staticRender ? Math.max(8, staticPct) : pct ?? 0}%`,
                  opacity: staticRender ? 0.55 : 1,
                  transition: 'width 300ms ease',
                }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
