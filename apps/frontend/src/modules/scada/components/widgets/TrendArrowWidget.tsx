'use client';

import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { TrendArrowWidget } from '@/mocks/data/scada.mock';

interface Props {
  widget: TrendArrowWidget;
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  staticRender?: boolean;
}

export function TrendArrowWidgetView({ widget, getValue, staticRender }: Props) {
  const raw = staticRender ? null : getValue(widget.deviceId, widget.tag);
  const isOffline = !staticRender && raw === null;
  const v = staticRender || isOffline ? null : Number(raw);

  const isUp = v !== null && v > widget.threshold;
  const isDown = v !== null && v < widget.threshold;

  const size = Math.min(widget.width, widget.height) * 0.65;
  const color = staticRender
    ? '#94A3B8'
    : isOffline ? '#64748B' : isUp ? widget.colorUp : isDown ? widget.colorDown : '#94A3B8';

  const Icon = staticRender ? Minus : isUp ? TrendingUp : isDown ? TrendingDown : Minus;

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', userSelect: 'none' }}>
      <Icon style={{ width: size, height: size, color }} strokeWidth={2} />
    </div>
  );
}
