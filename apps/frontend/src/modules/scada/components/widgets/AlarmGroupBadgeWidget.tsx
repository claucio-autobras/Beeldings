'use client';

import { Bell, BellRing } from 'lucide-react';
import type { AlarmGroupBadgeWidget } from '../../types/scada.types';
import { ALARM_GROUP_SEVERITY_COLOR } from '../../types/scada.types';
import type { AlarmGroupAggregate } from '../../services/alarm-groups.service';

interface Props {
  widget: AlarmGroupBadgeWidget;
  /** Agregado ao vivo do grupo vinculado; null quando sem binding ou ainda carregando. */
  aggregate: AlarmGroupAggregate | null;
}

function formatCount(w: AlarmGroupBadgeWidget, agg: AlarmGroupAggregate): string {
  switch (w.format) {
    case 'active-only': return String(agg.active);
    case 'total-only': return String(agg.total);
    case 'fraction':
    default: return `${agg.active}/${agg.total}`;
  }
}

export function AlarmGroupBadgeWidgetView({ widget, aggregate }: Props) {
  const active = aggregate ? aggregate.active > 0 : false;
  const accent = active
    ? (widget.useSeverityColor && aggregate?.severity
        ? ALARM_GROUP_SEVERITY_COLOR[aggregate.severity]
        : widget.colorAlarm)
    : widget.colorOk;

  const countText = aggregate ? formatCount(widget, aggregate) : '—';
  const Icon = active ? BellRing : Bell;
  const iconSize = Math.max(14, Math.min(widget.height * 0.4, widget.fontSize));

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '0 10px',
        boxSizing: 'border-box',
        backgroundColor: widget.backgroundColor,
        border: `1px solid ${accent}`,
        borderRadius: widget.borderRadius,
        color: widget.textColor,
        overflow: 'hidden',
        animation: active ? 'scada-pulse 1.6s ease-in-out infinite' : undefined,
      }}
    >
      <Icon
        style={{ width: iconSize, height: iconSize, color: accent, flexShrink: 0 }}
        strokeWidth={2}
      />
      <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', lineHeight: 1.15 }}>
        {widget.showLabel && (
          <span
            style={{
              fontSize: Math.max(9, widget.fontSize * 0.42),
              color: widget.textColor,
              opacity: 0.7,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {widget.label}
          </span>
        )}
        <span
          style={{
            fontSize: widget.fontSize,
            fontWeight: 600,
            color: accent,
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          {countText}
        </span>
      </div>
    </div>
  );
}
