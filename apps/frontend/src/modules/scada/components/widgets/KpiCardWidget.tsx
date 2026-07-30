'use client';

import type { KpiCardWidget } from '../../types/scada.types';
import { dashCardStyle, DashCardTitle, DashBadge, NoData, matchRule, fmtValue } from './dashCard';

interface Props {
  widget: KpiCardWidget;
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  staticRender?: boolean;
}

/** Card KPI — título + valor grande + unidade + badge de estado + subtexto. */
export function KpiCardWidgetView({ widget: w, getValue, staticRender }: Props) {
  const bound = Boolean(w.deviceId && w.tag);
  const raw = staticRender || !bound ? null : getValue(w.deviceId, w.tag);
  const text = fmtValue(raw, w.decimals);
  const rule = staticRender ? (w.badgeRules[0] ?? null) : matchRule(w.badgeRules, raw);

  return (
    <div style={{ ...dashCardStyle(w), padding: '12px 14px', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <DashCardTitle text={w.title} color={w.mutedColor} />
        {w.showBadge && rule?.text && <DashBadge color={rule.color} text={rule.text} />}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minHeight: 0 }}>
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
          <span style={{ fontSize: Math.max(10, Math.round(w.valueFontSize * 0.42)), fontWeight: 600, color: w.mutedColor }}>{w.unit}</span>
        )}
      </div>
      {w.subtext ? (
        <span style={{ fontSize: 10, color: w.mutedColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.subtext}</span>
      ) : <span />}
    </div>
  );
}
