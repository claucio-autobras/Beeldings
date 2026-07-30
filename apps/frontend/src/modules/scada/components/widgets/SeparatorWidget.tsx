'use client';

import type { SeparatorWidget } from '@/mocks/data/scada.mock';

const DASH: Record<string, string> = { solid: 'none', dashed: '8,4', dotted: '3,3' };

interface Props { widget: SeparatorWidget }

export function SeparatorWidgetView({ widget }: Props) {
  const isH = widget.orientation === 'horizontal';
  return (
    <svg width="100%" height="100%" overflow="visible" style={{ position: 'absolute', top: 0, left: 0 }}>
      <line
        x1={isH ? 0 : widget.width / 2}
        y1={isH ? widget.height / 2 : 0}
        x2={isH ? widget.width : widget.width / 2}
        y2={isH ? widget.height / 2 : widget.height}
        stroke={widget.color}
        strokeWidth={widget.thickness}
        strokeDasharray={DASH[widget.lineStyle]}
        strokeLinecap="round"
      />
    </svg>
  );
}
