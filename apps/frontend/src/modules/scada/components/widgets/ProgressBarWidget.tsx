'use client';

import type { ProgressBarWidget } from '../../types/scada.types';

interface Props {
  widget: ProgressBarWidget;
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  staticRender?: boolean;
}

export function ProgressBarWidgetView({ widget, getValue, staticRender }: Props) {
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
  const pad = 1;
  const barH = Math.min(H, 28);
  const y = (H - barH) / 2;
  const trackW = W - pad * 2;
  const fillW = Math.max(0, Math.min(trackW, trackW * pct));
  const fontSize = Math.min(barH * 0.55, 13);

  return (
    <svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ userSelect: 'none' }}>
      <defs>
        <clipPath id={`pb${uid}`}>
          <rect x={pad} y={y} width={trackW} height={barH} rx={barH / 2} />
        </clipPath>
      </defs>
      {/* Trilho */}
      <rect x={pad} y={y} width={trackW} height={barH} rx={barH / 2} fill="#1E293B" stroke="#334155" strokeWidth={1} />
      {/* Preenchimento */}
      {!isOffline && pct > 0 && (
        <rect clipPath={`url(#pb${uid})`} x={pad} y={y} width={fillW} height={barH} fill={color} />
      )}
      {/* Valor */}
      {widget.showValue && (
        <text x={W / 2} y={H / 2} dominantBaseline="central" textAnchor="middle" fill="#F1F5F9" fontSize={fontSize} fontFamily="'Fira Code', monospace" fontWeight="600" style={{ paintOrder: 'stroke' }} stroke="rgba(2,6,23,0.5)" strokeWidth={2}>
          {staticRender ? '––' : isOffline ? '—' : `${v.toFixed(1)}${widget.unit}`}
        </text>
      )}
    </svg>
  );
}
