'use client';

import { useEffect, useRef } from 'react';
import type { PipeWidget, PipePoint } from '../../types/scada.types';
import { isTransparentColor, matchOperator, toScadaNumber } from '../../types/scada.types';

interface Props {
  widget: PipeWidget;
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  staticRender?: boolean;
}

/** Escala os vértices normalizados para o tamanho atual do widget. */
export function scalePipePoints(widget: PipeWidget): PipePoint[] {
  const pts = widget.points ?? [];
  if (pts.length < 2) return pts;
  const natW = Math.max(...pts.map((p) => p.x));
  const natH = Math.max(...pts.map((p) => p.y));
  const sx = natW > 0 ? widget.width / natW : 1;
  const sy = natH > 0 ? widget.height / natH : 1;
  return pts.map((p) => ({ x: p.x * sx, y: p.y * sy }));
}

/**
 * Path SVG multi-segmento com cantos arredondados nos joelhos. O raio é
 * limitado à metade do menor segmento adjacente para nunca "engolir" o traçado.
 */
export function buildPipePath(pts: PipePoint[], cornerRadius: number): string {
  if (pts.length < 2) return '';
  if (pts.length === 2 || cornerRadius <= 0) {
    return `M ${pts[0].x} ${pts[0].y} ` + pts.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ');
  }
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const next = pts[i + 1];
    const l1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const l2 = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(cornerRadius, l1 / 2, l2 / 2);
    if (r < 0.5 || l1 === 0 || l2 === 0) { d += ` L ${cur.x} ${cur.y}`; continue; }
    const inX = cur.x - ((cur.x - prev.x) / l1) * r;
    const inY = cur.y - ((cur.y - prev.y) / l1) * r;
    const outX = cur.x + ((next.x - cur.x) / l2) * r;
    const outY = cur.y + ((next.y - cur.y) / l2) * r;
    d += ` L ${inX} ${inY} Q ${cur.x} ${cur.y} ${outX} ${outY}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

/** Estado de fluxo resolvido a partir do binding + regras (ou modo decorativo). */
export function resolvePipeFlow(
  widget: PipeWidget,
  getValue: Props['getValue'],
): { flowing: boolean; flowColor: string } {
  const bound = Boolean(widget.deviceId && widget.tagStatus);
  // Sem ponto vinculado: modo decorativo — fluxo sempre ligado.
  if (!bound) return { flowing: true, flowColor: widget.flowColor };
  const raw = getValue(widget.deviceId as string, widget.tagStatus as string);
  const v = toScadaNumber(raw);
  if (raw === null || raw === undefined || Number.isNaN(v)) {
    return { flowing: false, flowColor: widget.flowColor };
  }
  for (const rule of widget.flowRules ?? []) {
    if (matchOperator(v, rule.operator, rule.value)) {
      return {
        flowing: rule.flowing,
        flowColor: rule.flowColor?.trim() ? rule.flowColor : widget.flowColor,
      };
    }
  }
  return { flowing: false, flowColor: widget.flowColor };
}

/**
 * Path tracejado do fluxo, animado via Web Animations API (element.animate)
 * em vez de @keyframes CSS. Motivo: o keyframe anterior dependia de
 * `var(--pipe-period)` DENTRO do @keyframes, cuja resolução falha em algumas
 * composições/navegadores — o tracejado aparecia congelado. A animação WAAPI
 * também sobrevive a re-renders do React (só reinicia quando os parâmetros
 * mudam), evitando o "reinício a cada tick de telemetria".
 * O loop desliza exatamente um período (traço+vão) por ciclo → sem "pulo".
 */
function FlowPath({
  d, stroke, strokeWidth, dashLen, gapLen, animate, durationS, reverse,
}: {
  d: string;
  stroke: string;
  strokeWidth: number;
  dashLen: number;
  gapLen: number;
  animate: boolean;
  durationS: number;
  reverse: boolean;
}) {
  const ref = useRef<SVGPathElement>(null);
  const period = dashLen + gapLen;

  useEffect(() => {
    const el = ref.current;
    if (!animate || !el || typeof el.animate !== 'function') return;
    // Respeita a preferência do usuário por menos movimento.
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    const anim = el.animate(
      [{ strokeDashoffset: `${period}px` }, { strokeDashoffset: '0px' }],
      {
        duration: Math.max(50, durationS * 1000),
        iterations: Infinity,
        easing: 'linear',
        direction: reverse ? 'reverse' : 'normal',
      },
    );
    return () => anim.cancel();
  }, [animate, period, durationS, reverse, d]);

  return (
    <path
      ref={ref}
      d={d}
      fill="none"
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={`${dashLen} ${gapLen}`}
    />
  );
}

export function PipeWidgetView({ widget, getValue, staticRender }: Props) {
  const pts = scalePipePoints(widget);
  if (pts.length < 2) return null;

  const thickness = Math.max(2, widget.thickness);
  const d = buildPipePath(pts, widget.cornerRadius ?? thickness);

  // Estado de fluxo: no render estático (edição) mostra o visual de projeto —
  // aparência "fluindo" porém com a animação PARADA (sem rodar descontrolada).
  const { flowing, flowColor } = staticRender
    ? { flowing: true, flowColor: widget.flowColor }
    : resolvePipeFlow(widget, getValue);

  const speed = Math.min(4, Math.max(0.25, widget.speed || 1));
  const isWater = widget.pipeStyle === 'water';

  // Padrão do tracejado: período (traço+vão) proporcional à espessura.
  const dashLen = isWater ? thickness * 2.4 : thickness * 1.8;
  const gapLen = isWater ? thickness * 4.2 : thickness * 1.4;
  const period = dashLen + gapLen;
  // Velocidade constante em px/s independente da espessura.
  const durationS = period / (56 * speed);

  const animate = !staticRender && flowing;

  const showTube = !isTransparentColor(widget.pipeColor);
  const showFlow = !isTransparentColor(flowColor);
  const liquidW = Math.max(2, thickness - Math.max(3, thickness * 0.34));

  return (
    <svg width="100%" height="100%" overflow="visible" style={{ position: 'absolute', top: 0, left: 0, display: 'block' }}>
      {/* Parede do tubo — pontas retas (encaixe limpo em válvulas/bombas). */}
      {showTube && (
        <path d={d} fill="none" stroke={widget.pipeColor} strokeWidth={thickness} strokeLinecap="butt" strokeLinejoin="round" />
      )}
      {isWater ? (
        <>
          {/* Conteúdo líquido contínuo: cor de fluxo quando fluindo, cor "parado" quando não. */}
          {(flowing ? showFlow : !isTransparentColor(widget.stoppedColor)) && (
            <path
              d={d}
              fill="none"
              stroke={flowing ? flowColor : widget.stoppedColor}
              strokeWidth={liquidW}
              strokeLinecap="butt"
              strokeLinejoin="round"
            />
          )}
          {/* Brilho deslizante (aparência líquida em movimento). */}
          {flowing && showFlow && (
            <FlowPath
              d={d}
              stroke="rgba(255,255,255,0.55)"
              strokeWidth={Math.max(1.5, liquidW * 0.42)}
              dashLen={dashLen}
              gapLen={gapLen}
              animate={animate}
              durationS={durationS}
              reverse={Boolean(widget.reverse)}
            />
          )}
        </>
      ) : (
        flowing && showFlow && (
          <FlowPath
            d={d}
            stroke={flowColor}
            strokeWidth={liquidW}
            dashLen={dashLen}
            gapLen={gapLen}
            animate={animate}
            durationS={durationS}
            reverse={Boolean(widget.reverse)}
          />
        )
      )}
    </svg>
  );
}
