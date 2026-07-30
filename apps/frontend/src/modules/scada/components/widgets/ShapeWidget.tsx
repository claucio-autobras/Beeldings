'use client';

import type { ShapeWidgetBase, ScadaAnimation, VisibilityOperator } from '../../types/scada.types';
import { toScadaNumber } from '../../types/scada.types';

interface Props {
  widget: ShapeWidgetBase & { type: 'rectangle' | 'square' | 'circle' | 'ellipse' | 'triangle' };
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  staticRender?: boolean;
}

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

function animationCss(a: ScadaAnimation): string | undefined {
  return a === 'pulse' ? 'scada-pulse 1.6s ease-in-out infinite'
    : a === 'spin' ? 'scada-spin 2.4s linear infinite'
    : a === 'blink' ? 'scada-blink 1s step-start infinite'
    : a === 'fade' ? 'scada-fade 1.6s ease-in-out infinite'
    : undefined;
}

/**
 * Forma básica (retângulo/quadrado/círculo/elipse/triângulo). Pode ser preenchida
 * ou apenas contorno. Quando há ponto vinculado, a 1ª regra que casar com o valor
 * define a cor principal (fundo no modo preenchido; linha no modo contorno).
 */
export function ShapeWidgetView({ widget, getValue, staticRender }: Props) {
  // Padding interno uniforme (px): a forma é desenhada inset dentro do widget.
  // Ausente/0 = ocupa toda a área (comportamento atual).
  const pad = Math.max(0, widget.padding ?? 0);
  const W = Math.max(widget.width - 2 * pad, 4);
  const H = Math.max(widget.height - 2 * pad, 4);
  const filled = widget.fillEnabled !== false;

  // No modo estático: fill/stroke base, sem regras de estado nem animação.
  const bound = !staticRender && Boolean(widget.deviceId && widget.tagStatus);
  const raw = bound ? getValue(widget.deviceId as string, widget.tagStatus as string) : null;
  const value = toScadaNumber(raw);

  // Cor principal: estática (fill/stroke) e, se houver regra que case, a da regra.
  let mainColor = filled ? widget.fillColor : widget.strokeColor;
  let animation: ScadaAnimation = 'none';
  if (bound && raw !== null && !Number.isNaN(value)) {
    for (const rule of widget.stateRules ?? []) {
      if (matchOp(value, rule.operator, rule.value)) {
        mainColor = rule.color;
        animation = rule.animation;
        break;
      }
    }
  }

  const fill = filled ? mainColor : 'none';
  const stroke = filled ? widget.strokeColor : mainColor;
  const sw = filled ? widget.strokeWidth : Math.max(widget.strokeWidth || 0, 2);
  const inset = sw / 2;

  let shapeEl: React.ReactNode;
  switch (widget.type) {
    case 'circle': {
      const r = Math.max(Math.min(W, H) / 2 - inset, 0);
      shapeEl = <circle cx={W / 2} cy={H / 2} r={r} fill={fill} stroke={stroke} strokeWidth={sw} />;
      break;
    }
    case 'ellipse':
      shapeEl = <ellipse cx={W / 2} cy={H / 2} rx={Math.max(W / 2 - inset, 0)} ry={Math.max(H / 2 - inset, 0)} fill={fill} stroke={stroke} strokeWidth={sw} />;
      break;
    case 'triangle':
      shapeEl = <polygon points={`${W / 2},${inset} ${W - inset},${H - inset} ${inset},${H - inset}`} fill={fill} stroke={stroke} strokeWidth={sw} strokeLinejoin="round" />;
      break;
    default: // rectangle, square
      shapeEl = <rect x={inset} y={inset} width={Math.max(W - sw, 0)} height={Math.max(H - sw, 0)} rx={widget.borderRadius} fill={fill} stroke={stroke} strokeWidth={sw} />;
  }

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      style={{ position: 'absolute', inset: pad, overflow: 'visible', animation: animationCss(animation), transformOrigin: 'center' }}
    >
      {shapeEl}
    </svg>
  );
}
