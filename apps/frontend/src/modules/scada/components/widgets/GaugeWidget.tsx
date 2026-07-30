'use client';

import type { GaugeWidget } from '@/mocks/data/scada.mock';

interface Props {
  widget: GaugeWidget;
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  staticRender?: boolean;
}

export function GaugeWidgetView({ widget, getValue, staticRender }: Props) {
  const raw = staticRender ? null : getValue(widget.deviceId, widget.tag);
  const isOffline = !staticRender && (raw === null || typeof raw !== 'number');
  const value = staticRender || isOffline ? 0 : Math.min(Math.max(raw as number, widget.minValue), widget.maxValue);

  const range = widget.maxValue - widget.minValue;
  const pct = range > 0 ? (value - widget.minValue) / range : 0;

  // Arc from 225° to -45° (270° sweep) — SVG path
  const SIZE = Math.min(widget.width, widget.height);
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const r = SIZE * 0.38;
  const strokeWidth = SIZE * 0.08;

  const startAngle = 225;
  const sweep = 270;
  const endAngle = startAngle - sweep * pct;

  function polarToXY(angle: number, radius: number) {
    const rad = ((angle - 90) * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
  }

  function arcPath(from: number, to: number, radius: number) {
    const start = polarToXY(from, radius);
    const end = polarToXY(to, radius);
    const large = Math.abs(from - to) > 180 ? 1 : 0;
    const dir = from > to ? 0 : 1; // CCW or CW
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${large} ${dir} ${end.x} ${end.y}`;
  }

  const trackEnd = startAngle - sweep;
  const isAlarm = !staticRender && pct > 0.85;
  const color = staticRender
    ? widget.colorNormal
    : isOffline ? '#475569' : isAlarm ? widget.colorAlarm : widget.colorNormal;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        userSelect: 'none',
      }}
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        {/* Track */}
        <path
          d={arcPath(startAngle, trackEnd, r)}
          fill="none"
          stroke="#1E293B"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* Value arc */}
        {!isOffline && pct > 0 && (
          <path
            d={arcPath(startAngle, endAngle, r)}
            fill="none"
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
          />
        )}
        {/* Center label */}
        {widget.showValue && (
          <>
            <text
              x={cx}
              y={cy + SIZE * 0.05}
              textAnchor="middle"
              fill={!staticRender && isOffline ? '#475569' : '#F1F5F9'}
              fontSize={SIZE * 0.16}
              fontFamily="'Fira Code', monospace"
              fontWeight="600"
            >
              {staticRender ? '––' : isOffline ? '—' : value.toFixed(1)}
            </text>
            {widget.unit && (
              <text
                x={cx}
                y={cy + SIZE * 0.22}
                textAnchor="middle"
                fill="#64748B"
                fontSize={SIZE * 0.09}
                fontFamily="Inter, sans-serif"
              >
                {widget.unit}
              </text>
            )}
          </>
        )}
      </svg>
    </div>
  );
}
