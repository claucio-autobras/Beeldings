'use client';

import { AlertTriangle } from 'lucide-react';
import type { AlarmIndicatorWidget } from '@/mocks/data/scada.mock';

interface Props {
  widget: AlarmIndicatorWidget;
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  staticRender?: boolean;
}

export function AlarmIndicatorWidgetView({ widget, getValue, staticRender }: Props) {
  const raw = staticRender ? null : getValue(widget.deviceId, widget.tag);
  const isAlarm = !staticRender && raw !== null && Boolean(raw);

  // No modo estático o widget não fica invisível (como aconteceria sem alarme
  // no runtime): mostra um ícone neutro/cinza, sem piscar, para poder editá-lo.
  if (!staticRender && !isAlarm) return null;

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: staticRender ? undefined : 'scada-blink 1s step-start infinite',
      }}
    >
      <AlertTriangle
        style={{
          width: Math.min(widget.width, widget.height) * 0.6,
          height: Math.min(widget.width, widget.height) * 0.6,
          color: staticRender ? '#94A3B8' : '#EF4444',
        }}
        strokeWidth={2}
      />
    </div>
  );
}
