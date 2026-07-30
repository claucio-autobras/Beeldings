'use client';

import type { PointTableWidget } from '../../types/scada.types';
import { dashCardStyle, DashCardTitle, DashBadge, NoData, matchRule, fmtValue, withAlpha } from './dashCard';

interface Props {
  widget: PointTableWidget;
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  staticRender?: boolean;
}

/** Tabela de pontos — linhas ponto/valor/unidade/estado (chip via state rules). */
export function PointTableWidgetView({ widget: w, getValue, staticRender }: Props) {
  return (
    <div style={{ ...dashCardStyle(w), padding: '12px 14px', gap: 8 }}>
      <DashCardTitle text={w.title} color={w.mutedColor} />
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {w.rows.length === 0 && (
          <span style={{ fontSize: 10, fontStyle: 'italic', color: w.mutedColor }}>Adicione linhas nas propriedades</span>
        )}
        {w.rows.map((r, i) => {
          const bound = Boolean(r.deviceId && r.tag);
          const raw = staticRender || !bound ? null : getValue(r.deviceId, r.tag);
          const text = fmtValue(raw, r.decimals);
          const rule = staticRender ? (r.stateRules[0] ?? null) : matchRule(r.stateRules, raw);
          return (
            <div key={r.id} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              padding: '6px 0', borderBottom: i < w.rows.length - 1 ? `1px solid ${withAlpha(w.mutedColor, 0.15)}` : 'none',
              minHeight: 0,
            }}>
              <span style={{ fontSize: 11, fontWeight: 500, color: w.textColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                {r.label || r.tag || '—'}
              </span>
              {staticRender ? (
                <span style={{ fontSize: 11, fontFamily: 'Roboto Mono, monospace', color: w.mutedColor }}>––{r.unit ? ` ${r.unit}` : ''}</span>
              ) : text !== null ? (
                <span style={{ fontSize: 11, fontFamily: 'Roboto Mono, monospace', fontVariantNumeric: 'tabular-nums', color: w.textColor, whiteSpace: 'nowrap' }}>
                  {text}{r.unit ? ` ${r.unit}` : ''}
                </span>
              ) : (
                <NoData color={w.mutedColor} compact />
              )}
              {w.showState && (
                rule?.text
                  ? <DashBadge color={rule.color} text={rule.text} />
                  : <span style={{ width: 8, flexShrink: 0 }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
