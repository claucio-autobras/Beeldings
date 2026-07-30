'use client';

import type { TrafficLightWidget } from '@/mocks/data/scada.mock';

interface Props {
  widget: TrafficLightWidget;
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  staticRender?: boolean;
}

export function TrafficLightWidgetView({ widget, getValue, staticRender }: Props) {
  const raw = staticRender ? null : getValue(widget.deviceId, widget.tag);
  const v = staticRender || raw === null ? null : Number(raw);

  const isRed = v !== null && v === widget.valueRed;
  const isYellow = v !== null && v === widget.valueYellow;
  const isGreen = v !== null && v === widget.valueGreen;

  const circleSize = Math.min(widget.width * 0.7, (widget.height - 16) / 3);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-evenly', padding: 4, backgroundColor: '#0F172A', borderRadius: 8, border: '1px solid #1E293B', userSelect: 'none' }}>
      {[
        { active: isRed, color: '#EF4444', offColor: '#4B1616' },
        { active: isYellow, color: '#F59E0B', offColor: '#4B3B0E' },
        { active: isGreen, color: '#22C55E', offColor: '#0D3B1B' },
      ].map((light, i) => (
        <div key={i} style={{ width: circleSize, height: circleSize, borderRadius: '50%', backgroundColor: light.active ? light.color : light.offColor, boxShadow: light.active ? `0 0 ${circleSize * 0.5}px ${light.color}80` : undefined, transition: 'background-color 200ms' }} />
      ))}
    </div>
  );
}
