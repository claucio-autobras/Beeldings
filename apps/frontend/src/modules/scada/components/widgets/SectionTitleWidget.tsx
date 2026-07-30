'use client';

import type { SectionTitleWidget } from '@/mocks/data/scada.mock';

const WEIGHT_MAP = { normal: '400', medium: '500', semibold: '600', bold: '700' };

interface Props {
  widget: SectionTitleWidget;
  colorOverride?: string;
  textOverride?: string;
}

export function SectionTitleWidgetView({ widget, colorOverride, textOverride }: Props) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 4, userSelect: 'none' }}>
      <span style={{ fontFamily: 'Inter, sans-serif', fontSize: widget.fontSize, fontWeight: WEIGHT_MAP[widget.fontWeight], color: colorOverride ?? widget.color, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {textOverride ?? widget.text}
      </span>
      <div style={{ height: 1, backgroundColor: widget.lineColor, width: '100%', opacity: 0.6 }} />
    </div>
  );
}
