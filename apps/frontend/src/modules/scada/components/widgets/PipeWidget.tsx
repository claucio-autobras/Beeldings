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

interface PipePathSample {
  x: number;
  y: number;
}

export interface PipeArrowGeometry {
  start: PipePoint;
  tip: PipePoint;
  shaft: PipePoint[];
  wingA: PipePoint;
  wingB: PipePoint;
  /** Distância de arco do centro da seta no percurso. */
  distance: number;
}

function pushDistinctSample(samples: PipePathSample[], point: PipePathSample): void {
  const previous = samples[samples.length - 1];
  if (!previous || previous.x !== point.x || previous.y !== point.y) samples.push(point);
}

/**
 * Achata o mesmo caminho arredondado usado por buildPipePath. Isso permite
 * posicionar a seta pelo comprimento real do percurso, em vez de usar apenas
 * o centro do bounding box (que fica errado em tubulações em L ou em Z).
 */
function samplePipePath(pts: PipePoint[], cornerRadius: number): PipePathSample[] {
  if (pts.length < 2) return [];
  if (pts.length === 2 || cornerRadius <= 0) return pts.map((point) => ({ ...point }));

  const samples: PipePathSample[] = [{ ...pts[0] }];
  const curveSteps = 12;
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const next = pts[i + 1];
    const l1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const l2 = Math.hypot(next.x - cur.x, next.y - cur.y);
    const radius = Math.min(cornerRadius, l1 / 2, l2 / 2);
    if (radius < 0.5 || l1 === 0 || l2 === 0) {
      pushDistinctSample(samples, cur);
      continue;
    }

    const inPoint = {
      x: cur.x - ((cur.x - prev.x) / l1) * radius,
      y: cur.y - ((cur.y - prev.y) / l1) * radius,
    };
    const outPoint = {
      x: cur.x + ((next.x - cur.x) / l2) * radius,
      y: cur.y + ((next.y - cur.y) / l2) * radius,
    };
    pushDistinctSample(samples, inPoint);
    for (let step = 1; step <= curveSteps; step++) {
      const t = step / curveSteps;
      const oneMinusT = 1 - t;
      pushDistinctSample(samples, {
        x: oneMinusT * oneMinusT * inPoint.x + 2 * oneMinusT * t * cur.x + t * t * outPoint.x,
        y: oneMinusT * oneMinusT * inPoint.y + 2 * oneMinusT * t * cur.y + t * t * outPoint.y,
      });
    }
  }
  pushDistinctSample(samples, pts[pts.length - 1]);
  return samples;
}

function pipePathLength(samples: PipePathSample[]): number {
  let length = 0;
  for (let i = 1; i < samples.length; i++) {
    length += Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y);
  }
  return length;
}

function cumulativePipeDistances(samples: PipePathSample[]): number[] {
  const distances = [0];
  for (let i = 1; i < samples.length; i++) {
    distances.push(
      distances[i - 1] + Math.hypot(samples[i].x - samples[i - 1].x, samples[i].y - samples[i - 1].y),
    );
  }
  return distances;
}

function nearestPipeDistance(
  samples: PipePathSample[],
  distances: number[],
  target: PipePoint,
): number {
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < samples.length; i++) {
    const distance = Math.hypot(samples[i].x - target.x, samples[i].y - target.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = i;
    }
  }
  return distances[bestIndex] ?? 0;
}

function pointAtPipeDistance(samples: PipePathSample[], distance: number): PipePoint {
  if (samples.length === 0) return { x: 0, y: 0 };
  if (samples.length === 1) return { ...samples[0] };
  let remaining = Math.max(0, distance);
  for (let i = 1; i < samples.length; i++) {
    const previous = samples[i - 1];
    const current = samples[i];
    const segmentLength = Math.hypot(current.x - previous.x, current.y - previous.y);
    if (segmentLength === 0) continue;
    if (remaining <= segmentLength) {
      const ratio = remaining / segmentLength;
      return {
        x: previous.x + (current.x - previous.x) * ratio,
        y: previous.y + (current.y - previous.y) * ratio,
      };
    }
    remaining -= segmentLength;
  }
  return { ...samples[samples.length - 1] };
}

function tangentAtPipeDistance(
  samples: PipePathSample[],
  distances: number[],
  distance: number,
  reverse: boolean,
): PipePoint {
  if (samples.length < 2) return { x: reverse ? -1 : 1, y: 0 };
  const target = Math.max(0, Math.min(distance, distances[distances.length - 1] ?? 0));
  let segment = 1;
  while (segment < distances.length - 1 && distances[segment] < target) segment++;
  const from = samples[segment - 1];
  let to = samples[segment];
  let dx = to.x - from.x;
  let dy = to.y - from.y;
  if (Math.hypot(dx, dy) === 0) {
    for (let i = segment + 1; i < samples.length; i++) {
      dx = samples[i].x - from.x;
      dy = samples[i].y - from.y;
      if (Math.hypot(dx, dy) > 0) {
        to = samples[i];
        break;
      }
    }
  }
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: reverse ? -1 : 1, y: 0 };
  const direction = reverse ? -1 : 1;
  return { x: direction * dx / length, y: direction * dy / length };
}

function pointsBetweenPipeDistances(
  samples: PipePathSample[],
  fromDistance: number,
  toDistance: number,
): PipePoint[] {
  const from = Math.min(fromDistance, toDistance);
  const to = Math.max(fromDistance, toDistance);
  const points: PipePoint[] = [pointAtPipeDistance(samples, from)];
  let traversed = 0;
  for (let i = 1; i < samples.length; i++) {
    const segmentLength = Math.hypot(
      samples[i].x - samples[i - 1].x,
      samples[i].y - samples[i - 1].y,
    );
    if (segmentLength === 0) continue;
    traversed += segmentLength;
    if (traversed > from && traversed < to) points.push({ ...samples[i] });
  }
  points.push(pointAtPipeDistance(samples, to));
  return points;
}

interface PipeDistanceInterval {
  start: number;
  end: number;
}

/**
 * Retorna as zonas onde uma seta pode ficar sem ocupar a curva de um joelho.
 * A folga é aplicada ao redor do trecho arredondado (ou do vértice, quando
 * radius=0), mantendo a seta em uma tangente local estável.
 */
function safePipeArrowIntervals(
  pts: PipePoint[],
  samples: PipePathSample[],
  distances: number[],
  totalLength: number,
  cornerRadius: number,
  arrowLength: number,
  thickness: number,
): PipeDistanceInterval[] {
  const edgeMargin = Math.max(thickness * 1.15, arrowLength * 0.58);
  const routeStart = edgeMargin;
  const routeEnd = totalLength - edgeMargin;
  if (routeEnd <= routeStart) return [];

  const blocked: PipeDistanceInterval[] = [];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const next = pts[i + 1];
    const l1 = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const l2 = Math.hypot(next.x - cur.x, next.y - cur.y);
    const radius = Math.min(cornerRadius, l1 / 2, l2 / 2);
    const bendStart = radius >= 0.5 && l1 > 0 && l2 > 0
      ? nearestPipeDistance(samples, distances, {
        x: cur.x - ((cur.x - prev.x) / l1) * radius,
        y: cur.y - ((cur.y - prev.y) / l1) * radius,
      })
      : nearestPipeDistance(samples, distances, cur);
    const bendEnd = radius >= 0.5 && l1 > 0 && l2 > 0
      ? nearestPipeDistance(samples, distances, {
        x: cur.x + ((next.x - cur.x) / l2) * radius,
        y: cur.y + ((next.y - cur.y) / l2) * radius,
      })
      : bendStart;
    const clearance = Math.max(thickness * 0.8, arrowLength * 0.36);
    blocked.push({
      start: Math.max(routeStart, Math.min(bendStart, bendEnd) - clearance),
      end: Math.min(routeEnd, Math.max(bendStart, bendEnd) + clearance),
    });
  }

  const merged = blocked
    .filter((interval) => interval.end > interval.start)
    .sort((a, b) => a.start - b.start)
    .reduce<PipeDistanceInterval[]>((result, interval) => {
      const previous = result[result.length - 1];
      if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
      else result.push({ ...interval });
      return result;
    }, []);
  const intervals: PipeDistanceInterval[] = [];
  let cursor = routeStart;
  for (const interval of merged) {
    if (interval.start > cursor) intervals.push({ start: cursor, end: interval.start });
    cursor = Math.max(cursor, interval.end);
  }
  if (cursor < routeEnd) intervals.push({ start: cursor, end: routeEnd });
  return intervals.filter((interval) => interval.end - interval.start >= Math.max(2, arrowLength * 0.55));
}

function distanceInPipeIntervals(intervals: PipeDistanceInterval[], distance: number): number {
  let remaining = distance;
  for (const interval of intervals) {
    const length = interval.end - interval.start;
    if (remaining <= length) return interval.start + remaining;
    remaining -= length;
  }
  return intervals[intervals.length - 1]?.end ?? 0;
}

/**
 * Calcula várias setas usando o comprimento de arco do caminho. O espaçamento
 * cresce com a espessura para que tubos pequenos não fiquem congestionados e
 * tubos longos mantenham uma leitura contínua do sentido.
 */
export function buildPipeArrowGeometries(
  pts: PipePoint[],
  cornerRadius: number,
  thickness: number,
  reverse: boolean,
): PipeArrowGeometry[] {
  const samples = samplePipePath(pts, cornerRadius);
  const distances = cumulativePipeDistances(samples);
  const totalLength = distances[distances.length - 1] ?? 0;
  if (samples.length < 2 || totalLength <= 0) return [];

  const arrowLength = Math.min(Math.max(10, thickness * 2.4), totalLength * 0.65);
  if (arrowLength <= 1) return [];
  const preferredSpacing = Math.max(thickness * 5.5, arrowLength * 2.25);
  const edgeMargin = Math.max(thickness * 1.15, arrowLength * 0.58);
  const available = Math.max(0, totalLength - edgeMargin * 2);
  // A primeira seta só aparece quando existe um intervalo completo adicional
  // para ela. Assim um trecho curto continua limpo, enquanto o crescimento é
  // linear para percursos longos.
  const requestedCount = available <= arrowLength
    ? 1
    : Math.min(12, Math.max(1, Math.floor(totalLength / preferredSpacing)));
  const safeIntervals = safePipeArrowIntervals(
    pts, samples, distances, totalLength, cornerRadius, arrowLength, thickness,
  );
  const safeLength = safeIntervals.reduce((sum, interval) => sum + interval.end - interval.start, 0);
  const minimumSpacing = Math.max(thickness * 4.5, arrowLength * 1.65);
  const capacity = safeIntervals.length > 0
    ? Math.max(1, Math.floor(safeLength / minimumSpacing) + 1)
    : 1;
  const count = Math.min(requestedCount, capacity);

  let centerDistances: number[];
  if (safeIntervals.length === 0) {
    centerDistances = [totalLength / 2];
  } else if (count === 1) {
    const longest = safeIntervals.reduce((best, interval) =>
      interval.end - interval.start > best.end - best.start ? interval : best,
    );
    centerDistances = [(longest.start + longest.end) / 2];
  } else {
    centerDistances = Array.from({ length: count }, (_, index) =>
      distanceInPipeIntervals(safeIntervals, (safeLength * index) / (count - 1)),
    );
  }

  return centerDistances.map((distance) => {
    const center = pointAtPipeDistance(samples, distance);
    const tangent = tangentAtPipeDistance(samples, distances, distance, reverse);
    const halfLength = arrowLength / 2;
    const start = { x: center.x - tangent.x * halfLength, y: center.y - tangent.y * halfLength };
    const tip = { x: center.x + tangent.x * halfLength, y: center.y + tangent.y * halfLength };
    const wingLength = Math.min(Math.max(4, thickness * 0.8), arrowLength * 0.28);
    const wingWidth = wingLength * 0.72;
    const baseX = tip.x - tangent.x * wingLength;
    const baseY = tip.y - tangent.y * wingLength;
    return {
      start,
      tip,
      shaft: [start, tip],
      wingA: { x: baseX + -tangent.y * wingWidth, y: baseY + tangent.x * wingWidth },
      wingB: { x: baseX - -tangent.y * wingWidth, y: baseY - tangent.x * wingWidth },
      distance,
    };
  });
}

/**
 * Retorna a geometria de uma seta fina, centralizada pelo comprimento do
 * caminho. Mantida como compatibilidade para consumidores antigos; o render
 * usa buildPipeArrowGeometries para distribuir todas as setas.
 */
export function buildPipeArrowGeometry(
  pts: PipePoint[],
  cornerRadius: number,
  thickness: number,
  reverse: boolean,
): PipeArrowGeometry | null {
  const samples = samplePipePath(pts, cornerRadius);
  const totalLength = pipePathLength(samples);
  if (samples.length < 2 || totalLength <= 0) return null;

  const arrowLength = Math.min(Math.max(10, thickness * 2.4), totalLength * 0.65);
  if (arrowLength <= 1) return null;
  const center = totalLength / 2;
  const direction = reverse ? -1 : 1;
  const startDistance = center - direction * arrowLength / 2;
  const tipDistance = center + direction * arrowLength / 2;
  const shaft = pointsBetweenPipeDistances(samples, startDistance, tipDistance);
  if (direction < 0) shaft.reverse();
  const start = shaft[0];
  const tip = shaft[shaft.length - 1];
  const previous = shaft[Math.max(0, shaft.length - 2)];
  const dx = tip.x - previous.x;
  const dy = tip.y - previous.y;
  const vectorLength = Math.hypot(dx, dy);
  if (vectorLength <= 0) return null;

  const ux = dx / vectorLength;
  const uy = dy / vectorLength;
  const wingLength = Math.min(Math.max(4, thickness * 0.8), vectorLength * 0.42);
  const wingWidth = wingLength * 0.72;
  const baseX = tip.x - ux * wingLength;
  const baseY = tip.y - uy * wingLength;
  return {
    start,
    tip,
    shaft,
    wingA: { x: baseX + -uy * wingWidth, y: baseY + ux * wingWidth },
    wingB: { x: baseX - -uy * wingWidth, y: baseY - ux * wingWidth },
    distance: center,
  };
}

function arrowPath(geometry: PipeArrowGeometry): string {
  const point = (p: PipePoint) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
  return `M ${geometry.shaft.map(point).join(' L ')} M ${point(geometry.wingA)} L ${point(geometry.tip)} L ${point(geometry.wingB)}`;
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
  d, stroke, strokeWidth, dashLen, gapLen, animate, durationS, reverse, layer,
}: {
  d: string;
  stroke: string;
  strokeWidth: number;
  dashLen: number;
  gapLen: number;
  animate: boolean;
  durationS: number;
  reverse: boolean;
  layer: 'trace';
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
      data-scada-pipe-layer={layer}
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
  // Padrão do tracejado: período (traço+vão) proporcional à espessura.
  const dashLen = thickness * 1.8;
  const gapLen = thickness * 1.4;
  const period = dashLen + gapLen;
  // Velocidade constante em px/s independente da espessura.
  const durationS = period / (56 * speed);

  const animate = !staticRender && flowing && widget.animateFlow !== false;

  const showTube = !isTransparentColor(widget.pipeColor);
  const showFlow = !isTransparentColor(flowColor);
  const liquidW = Math.max(2, thickness - Math.max(3, thickness * 0.34));
  const showStopped = !isTransparentColor(widget.stoppedColor);
  // A ausência de pipeStyle em telas muito antigas é lida como dash. O campo
  // showDirectionArrow também é legado e não pode reintroduzir combinações.
  const pipeStyle = widget.pipeStyle === 'arrow' || widget.pipeStyle === 'water'
    ? widget.pipeStyle
    : 'dash';
  const arrows = flowing && showFlow && pipeStyle === 'arrow'
    ? buildPipeArrowGeometries(pts, widget.cornerRadius ?? thickness, thickness, Boolean(widget.reverse))
    : [];
  const traceWidth = Math.max(1.5, Math.min(liquidW * 0.72, thickness * 0.34));
  const traceOpacity = 0.9;

  return (
    <svg data-scada-pipe="true" data-scada-hover-border-surface="true" width="100%" height="100%" overflow="visible" style={{ position: 'absolute', top: 0, left: 0, display: 'block' }}>
      {/* Parede do tubo — pontas retas (encaixe limpo em válvulas/bombas). */}
      {showTube && (
        <path d={d} fill="none" stroke={widget.pipeColor} strokeWidth={thickness} strokeLinecap="butt" strokeLinejoin="round" />
      )}
      {/* O estado parado é sempre uma faixa estática, sem sugerir movimento. */}
      {!flowing && showStopped && (
        <path
          data-scada-pipe-layer="stopped"
          d={d}
          fill="none"
          stroke={widget.stoppedColor}
          strokeWidth={liquidW}
          strokeLinecap="butt"
          strokeLinejoin="round"
          opacity={0.82}
        />
      )}
      {/* Exatamente uma camada ativa é escolhida pelo estilo. */}
      {flowing && showFlow && pipeStyle === 'water' && (
        <path
          data-scada-pipe-layer="water"
          d={d}
          fill="none"
          stroke={flowColor}
          strokeWidth={liquidW}
          strokeLinecap="butt"
          strokeLinejoin="round"
        />
      )}
      {flowing && showFlow && pipeStyle === 'dash' && (
        <FlowPath
          d={d}
          stroke={flowColor}
          strokeWidth={traceWidth}
          dashLen={dashLen}
          gapLen={gapLen}
          animate={animate}
          durationS={durationS}
          reverse={Boolean(widget.reverse)}
          layer="trace"
        />
      )}
      {arrows.map((arrow, index) => (
        <path
          key={`${arrow.distance.toFixed(2)}-${index}`}
          data-scada-pipe-arrow="true"
          data-scada-pipe-layer="direction"
          d={arrowPath(arrow)}
          fill="none"
          stroke={flowColor}
          strokeWidth={Math.max(1.25, Math.min(2.5, thickness * 0.18))}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={traceOpacity}
          pointerEvents="none"
        />
      ))}
    </svg>
  );
}
