'use client';

import type { LineWidget, ScadaAnimation, VisibilityOperator } from '../../types/scada.types';
import { toScadaNumber } from '../../types/scada.types';

interface Props {
  widget: LineWidget;
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  staticRender?: boolean;
}

const DASH_MAP = {
  solid: 'none',
  dashed: '12,6',
  dotted: '4,4',
};

function matchOp(v: number, op: VisibilityOperator, target: number): boolean {
  switch (op) {
    case 'eq': return v === target;
    case 'neq': return v !== target;
    case 'gt': return v > target;
    case 'lt': return v < target;
    case 'gte': return v >= target;
    case 'lte': return v <= target;
    default: return false;
  }
}

export function LineWidgetView({ widget, getValue, staticRender }: Props) {
  // Cor por estado (opcional): a 1ª regra que casar com o valor do ponto sobrepõe `color`.
  // No modo estático nada disso ocorre — só a cor base, sem regras nem fluxo.
  let color = widget.color;
  let animation: ScadaAnimation = 'none';
  const bound = !staticRender && Boolean(widget.deviceId && widget.tagStatus);
  if (bound) {
    const raw = getValue(widget.deviceId as string, widget.tagStatus as string);
    const value = toScadaNumber(raw);
    if (raw !== null && !Number.isNaN(value)) {
      for (const rule of widget.stateRules ?? []) {
        if (matchOp(value, rule.operator, rule.value)) { color = rule.color; animation = rule.animation; break; }
      }
    }
  }

  const flowActive =
    !staticRender &&
    widget.flowAnimation &&
    widget.flowDeviceId &&
    widget.flowTag
      ? Boolean(getValue(widget.flowDeviceId, widget.flowTag))
      : false;

  const isHorizontal = widget.width >= widget.height;
  const len = isHorizontal ? widget.width : widget.height;

  const x1 = isHorizontal ? 0 : widget.width / 2;
  const y1 = isHorizontal ? widget.height / 2 : 0;
  const x2 = isHorizontal ? len : widget.width / 2;
  const y2 = isHorizontal ? widget.height / 2 : len;

  const dashArray = DASH_MAP[widget.style];
  const animCss =
    animation === 'pulse' ? 'scada-pulse 1.6s ease-in-out infinite'
    : animation === 'blink' ? 'scada-blink 1s step-start infinite'
    : animation === 'fade' ? 'scada-fade 1.6s ease-in-out infinite'
    : undefined;

  return (
    <svg
      width="100%"
      height="100%"
      overflow="visible"
      style={{ position: 'absolute', top: 0, left: 0, animation: animCss }}
    >
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={widget.thickness}
        strokeDasharray={dashArray}
        strokeLinecap="round"
      />
      {flowActive && (
        <circle r={widget.thickness + 2} fill={color} opacity={0.9}>
          <animateMotion
            dur="1.5s"
            repeatCount="indefinite"
            path={`M${x1},${y1} L${x2},${y2}`}
          />
        </circle>
      )}
    </svg>
  );
}
