'use client';

import type { ValueDynamicWidget } from '@/mocks/data/scada.mock';

interface Props {
  widget: ValueDynamicWidget;
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  colorOverride?: string;
  textOverride?: string;
  staticRender?: boolean;
}

export function ValueDynamicWidgetView({ widget, getValue, colorOverride, textOverride, staticRender }: Props) {
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

  // Cor base única do texto (telas antigas gravaram em colorNormal; colorAlarm é ignorada).
  const baseColor = widget.colorNormal;
  const color = staticRender
    ? baseColor
    : colorOverride ?? (isOffline ? widget.colorOffline : baseColor);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        fontFamily: widget.fontFamily,
        fontSize: widget.fontSize,
        color,
        fontVariantNumeric: 'tabular-nums',
        userSelect: 'none',
      }}
    >
      {textOverride ?? display}
      {textOverride === undefined && widget.unit && !isOffline && (
        <span style={{ fontSize: widget.fontSize * 0.55, marginLeft: 4, opacity: 0.7 }}>
          {widget.unit}
        </span>
      )}
    </div>
  );
}
