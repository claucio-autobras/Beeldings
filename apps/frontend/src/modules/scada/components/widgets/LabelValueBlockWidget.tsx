'use client';

import type { LabelValueBlockWidget } from '@/mocks/data/scada.mock';
import { scadaBackgroundStyle } from '../../types/scada.types';

interface Props {
  widget: LabelValueBlockWidget;
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  colorOverride?: string;
  textOverride?: string;
  staticRender?: boolean;
}

export function LabelValueBlockWidgetView({ widget, getValue, colorOverride, textOverride, staticRender }: Props) {
  const raw = staticRender ? null : getValue(widget.deviceId, widget.tag);
  const isOffline = raw === null;

  const display = staticRender
    ? '––'
    : isOffline
      ? '—'
      : typeof raw === 'boolean'
        ? raw
          ? 'ON'
          : 'OFF'
        : typeof raw === 'number'
          ? raw.toFixed(widget.decimals)
          : String(raw);

  const valueColor = staticRender
    ? widget.colorNormal
    : colorOverride ?? (isOffline ? widget.colorOffline : widget.colorNormal);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        // Padding interno configurável; ausente = legado '8px 12px'.
        padding: widget.padding !== undefined ? Math.max(0, widget.padding) : '8px 12px',
        ...scadaBackgroundStyle(widget.backgroundColor),
        borderRadius: widget.borderRadius,
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      <span
        style={{
          fontSize: 11,
          color: '#94A3B8',
          fontFamily: 'Inter, sans-serif',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          marginBottom: 4,
        }}
      >
        {widget.label}
      </span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span
          style={{
            fontFamily: widget.fontFamily,
            fontSize: widget.fontSize,
            color: valueColor,
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1,
          }}
        >
          {textOverride ?? display}
        </span>
        {textOverride === undefined && widget.unit && !isOffline && (
          <span style={{ fontSize: widget.fontSize * 0.45, color: '#64748B' }}>
            {widget.unit}
          </span>
        )}
      </div>
    </div>
  );
}
