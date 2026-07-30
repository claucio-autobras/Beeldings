'use client';

import type { LedStatusWidget } from '@/mocks/data/scada.mock';
import { scadaColorWithAlpha, isTransparentColor } from '../../types/scada.types';

interface Props {
  widget: LedStatusWidget;
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  staticRender?: boolean;
}

export function LedStatusWidgetView({ widget, getValue, staticRender }: Props) {
  const raw = staticRender ? null : getValue(widget.deviceId, widget.tag);
  const isOffline = !staticRender && raw === null;
  const isOn = !staticRender && !isOffline && Boolean(raw);

  const color = staticRender
    ? widget.colorOff
    : isOffline
      ? widget.colorOffline
      : isOn
        ? widget.colorOn
        : widget.colorOff;

  const shouldPulse = !staticRender && widget.pulseOnAlarm && isOn && !isOffline;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: widget.size,
          height: widget.size,
          borderRadius: '50%',
          backgroundColor: color,
          boxShadow: isOn && !isOffline && !isTransparentColor(color) ? `0 0 ${widget.size * 0.5}px ${scadaColorWithAlpha(color, '60')}` : undefined,
          animation: shouldPulse ? 'scada-pulse 1.5s ease-in-out infinite' : undefined,
        }}
      />
    </div>
  );
}
