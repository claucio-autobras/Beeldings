'use client';

import type { ThermometerWidget } from '../../types/scada.types';

interface Props {
  widget: ThermometerWidget;
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  staticRender?: boolean;
}

export function ThermometerWidgetView({ widget, getValue, staticRender }: Props) {
  const raw = staticRender ? null : getValue(widget.deviceId, widget.tag);
  const isOffline = !staticRender && (raw === null || typeof raw !== 'number');
  const v = staticRender || isOffline ? widget.minValue : Math.min(Math.max(raw as number, widget.minValue), widget.maxValue);
  const range = widget.maxValue - widget.minValue;
  const pct = range > 0 ? (v - widget.minValue) / range : 0;
  const isAlarm = !staticRender && pct > 0.85;
  const color = staticRender
    ? widget.colorNormal
    : isOffline ? '#475569' : isAlarm ? widget.colorAlarm : widget.colorNormal;

  const W = widget.width;
  const H = widget.height;
  const uid = widget.id.replace(/[^a-zA-Z0-9]/g, '');
  const textH = widget.showValue ? Math.min(H * 0.16, 18) : 0;
  const tubeW = Math.min(W * 0.45, 22);
  const cx = W / 2;
  const bulbR = tubeW * 0.95;
  const top = textH + 6;
  const bulbCy = H - bulbR - 4;
  const colH = Math.max(bulbCy - top, 0);
  const liqTop = bulbCy - pct * colH;

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" style={{ userSelect: 'none' }}>
      <defs>
        <clipPath id={`thm${uid}`}>
          <rect x={cx - tubeW / 2} y={top} width={tubeW} height={colH} rx={tubeW / 2} />
        </clipPath>
      </defs>
      {/* Tubo (trilho) */}
      <rect x={cx - tubeW / 2} y={top} width={tubeW} height={colH} rx={tubeW / 2} fill="#1E293B" stroke="#334155" strokeWidth={1} />
      {/* Líquido */}
      {!isOffline && pct > 0 && (
        <rect clipPath={`url(#thm${uid})`} x={cx - tubeW / 2} y={liqTop} width={tubeW} height={bulbCy - liqTop} fill={color} />
      )}
      {/* Bulbo */}
      <circle cx={cx} cy={bulbCy} r={bulbR} fill={isOffline ? '#1E293B' : color} stroke="#334155" strokeWidth={1} />
      {/* Valor */}
      {widget.showValue && (
        <text x={cx} y={textH} textAnchor="middle" fill={!staticRender && isOffline ? '#475569' : '#F1F5F9'} fontSize={Math.min(W * 0.32, 13)} fontFamily="'Fira Code', monospace" fontWeight="600">
          {staticRender ? '––' : isOffline ? '—' : `${v.toFixed(1)}${widget.unit}`}
        </text>
      )}
    </svg>
  );
}
