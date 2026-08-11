'use client';

import type { LabelStaticWidget } from '@/mocks/data/scada.mock';
import { scadaBackgroundStyle } from '../../types/scada.types';

const WEIGHT_MAP = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
};

interface Props {
  widget: LabelStaticWidget;
  colorOverride?: string;
  textOverride?: string;
}

export function LabelStaticWidgetView({ widget, colorOverride, textOverride }: Props) {
  const bg = widget.backgroundColor;
  const hasBg = bg !== undefined && bg !== 'transparent' && bg !== '';
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent:
          widget.align === 'center'
            ? 'center'
            : widget.align === 'right'
              ? 'flex-end'
              : 'flex-start',
        fontFamily: widget.fontFamily,
        fontSize: widget.fontSize,
        fontWeight: WEIGHT_MAP[widget.fontWeight],
        fontStyle: widget.fontStyle,
        color: colorOverride ?? widget.color,
        ...(hasBg ? scadaBackgroundStyle(bg) : {}),
        borderRadius: widget.borderRadius ?? 0,
        padding: hasBg ? '4px 8px' : undefined,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        overflow: 'hidden',
        boxSizing: 'border-box',
        userSelect: 'none',
      }}
    >
      {textOverride ?? widget.text}
    </div>
  );
}
