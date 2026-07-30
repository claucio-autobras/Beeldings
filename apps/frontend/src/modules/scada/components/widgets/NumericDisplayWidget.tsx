'use client';

import type { NumericDisplayWidget } from '@/mocks/data/scada.mock';
import { scadaColorWithAlpha, isTransparentColor } from '../../types/scada.types';

interface Props {
  widget: NumericDisplayWidget;
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  colorOverride?: string;
  textOverride?: string;
  staticRender?: boolean;
}

export function NumericDisplayWidgetView({ widget, getValue, colorOverride, textOverride, staticRender }: Props) {
  const raw = staticRender ? null : getValue(widget.deviceId, widget.tag);
  const isOffline = !staticRender && raw === null;
  const display = staticRender
    ? '––'
    : isOffline ? '---' : typeof raw === 'number' ? raw.toFixed(widget.decimals) : String(raw);

  const fontSize = Math.min(widget.height * 0.52, widget.width * 0.16);
  const color = staticRender
    ? widget.color
    : colorOverride ?? (isOffline ? '#475569' : widget.color);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0A0F1E', borderRadius: 6, border: '1px solid rgba(6,182,212,0.2)', userSelect: 'none', overflow: 'hidden' }}>
      <div style={{ fontFamily: "'Fira Code', 'Courier New', monospace", fontSize, fontWeight: 700, color, letterSpacing: '0.08em', fontVariantNumeric: 'tabular-nums', textShadow: isOffline || isTransparentColor(widget.color) ? 'none' : `0 0 12px ${scadaColorWithAlpha(widget.color, '60')}`, lineHeight: 1 }}>
        {textOverride ?? display}
      </div>
      {textOverride === undefined && widget.unit && !isOffline && (
        <span style={{ fontSize: fontSize * 0.35, color: '#64748B', fontFamily: 'Inter, sans-serif', marginTop: 4 }}>
          {widget.unit}
        </span>
      )}
    </div>
  );
}
