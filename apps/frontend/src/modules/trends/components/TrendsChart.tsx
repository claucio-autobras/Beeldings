'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
} from 'recharts';
import { TrendingUp, ZoomOut, ChevronLeft, ChevronRight } from 'lucide-react';
import type { SeriesType } from '../lib/trends-utils';

export interface ChartSeries {
  id: string;
  name: string;
  type: SeriesType;
  unit: string;
  color: string;
  points: { t: string; value: number }[];
}

interface TrendsChartProps {
  series: ChartSeries[];
  isLoading: boolean;
  /** Ref do wrapper para captura de imagem (PNG/PDF). */
  captureRef?: React.RefObject<HTMLDivElement | null>;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

type Row = Record<string, number>;

/** Une os pontos de várias séries por timestamp (ms) numa matriz densa. */
function mergeRows(series: ChartSeries[]): { rows: Row[]; min: number; max: number } {
  const byTs = new Map<number, Row>();
  let min = Infinity;
  let max = -Infinity;
  for (const s of series) {
    for (const p of s.points) {
      const ts = new Date(p.t).getTime();
      if (Number.isNaN(ts)) continue;
      if (ts < min) min = ts;
      if (ts > max) max = ts;
      let row = byTs.get(ts);
      if (!row) {
        row = { ts };
        byTs.set(ts, row);
      }
      row[s.id] = p.value;
    }
  }
  const rows = Array.from(byTs.values()).sort((a, b) => a.ts - b.ts);
  return { rows, min: min === Infinity ? 0 : min, max: max === -Infinity ? 0 : max };
}

/** Reduz a quantidade de pontos preservando início/fim (performance de render). */
function downsample(rows: Row[], maxPoints: number): Row[] {
  if (rows.length <= maxPoints) return rows;
  const step = Math.ceil(rows.length / maxPoints);
  return rows.filter((_, i) => i % step === 0 || i === rows.length - 1);
}

function formatXTick(ts: number): string {
  const d = new Date(ts);
  const sameDay = d.toLocaleDateString('pt-BR');
  return `${sameDay.slice(0, 5)} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

// Faixa visual ocupada por uma variável digital dentro da sua lane.
const DIGITAL_ON = 0.8;
const DIGITAL_OFF = 0.08;
// Largura comum dos eixos Y → alinha horizontalmente os gráficos empilhados
// (analógico em cima, digital embaixo) para correlação temporal correta.
// No mobile o eixo encolhe para sobrar espaço útil de plot.
const Y_WIDTH_DESKTOP = 110;
const Y_WIDTH_MOBILE = 64;

/** True em telas estreitas (<640px) — reage a rotação/resize. */
function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return narrow;
}

// ─── Tooltips ──────────────────────────────────────────────────────────────

interface TooltipPayloadItem {
  dataKey: string | number;
  value: number;
  color: string;
}
interface TooltipProps {
  active?: boolean;
  payload?: TooltipPayloadItem[];
  label?: number;
  seriesById: Map<string, ChartSeries>;
}

function AnalogTooltip({ active, payload, label, seriesById }: TooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const dt = label != null ? new Date(label) : null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md">
      {dt && (
        <p className="mb-1 text-xs text-muted-foreground">
          {dt.toLocaleDateString('pt-BR')} {dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}
      <div className="space-y-0.5">
        {payload.map((p) => {
          const s = seriesById.get(String(p.dataKey));
          if (!s) return null;
          const v = Number.isInteger(p.value) ? p.value : Math.round(p.value * 100) / 100;
          return (
            <p key={String(p.dataKey)} className="flex items-center gap-1.5 text-sm">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
              <span className="text-foreground">{s.name}:</span>
              <span className="font-tabular font-semibold text-foreground">{v}{s.unit ? ` ${s.unit}` : ''}</span>
            </p>
          );
        })}
      </div>
    </div>
  );
}

function DigitalTooltip({ active, payload, label, seriesById, lanes }: TooltipProps & { lanes: Map<string, number> }) {
  if (!active || !payload || payload.length === 0) return null;
  const dt = label != null ? new Date(label) : null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md">
      {dt && (
        <p className="mb-1 text-xs text-muted-foreground">
          {dt.toLocaleDateString('pt-BR')} {dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </p>
      )}
      <div className="space-y-0.5">
        {payload.map((p) => {
          const s = seriesById.get(String(p.dataKey));
          const lane = lanes.get(String(p.dataKey)) ?? 0;
          if (!s) return null;
          const on = p.value - lane >= (DIGITAL_ON + DIGITAL_OFF) / 2;
          return (
            <p key={String(p.dataKey)} className="flex items-center gap-1.5 text-sm">
              <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
              <span className="text-foreground">{s.name}:</span>
              <span className={`font-tabular font-semibold ${on ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                {on ? 'LIGADO' : 'DESLIGADO'}
              </span>
            </p>
          );
        })}
      </div>
    </div>
  );
}

// ─── Empty / loading states ──────────────────────────────────────────────────

function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="flex h-72 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/10">
      <div className="flex h-14 w-14 items-center justify-center rounded-full border border-cyan-100 bg-cyan-50">
        <TrendingUp size={28} strokeWidth={1.5} className="text-cyan-400" />
      </div>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-4">
      <div className="h-4 w-48 animate-pulse rounded bg-muted" />
      <div className="mt-4 h-64 animate-pulse rounded-md bg-muted/40" />
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TrendsChart({ series, isLoading, captureRef }: TrendsChartProps) {
  const isNarrow = useIsNarrow();
  const yWidth = isNarrow ? Y_WIDTH_MOBILE : Y_WIDTH_DESKTOP;
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [domain, setDomain] = useState<[number, number] | null>(null);
  const [refLeft, setRefLeft] = useState<number | null>(null);
  const [refRight, setRefRight] = useState<number | null>(null);
  const plotWidthRef = useRef<number>(0);
  const panRef = useRef<{ startX: number; startDomain: [number, number] } | null>(null);

  const visible = useMemo(() => series.filter((s) => !hidden.has(s.id)), [series, hidden]);
  const analog = useMemo(() => visible.filter((s) => s.type === 'analog'), [visible]);
  const digital = useMemo(() => visible.filter((s) => s.type === 'digital'), [visible]);
  const seriesById = useMemo(() => new Map(series.map((s) => [s.id, s])), [series]);

  const analogMerged = useMemo(() => mergeRows(analog), [analog]);
  const analogRows = useMemo(() => downsample(analogMerged.rows, 600), [analogMerged.rows]);

  // Lanes digitais: cada série ocupa uma faixa vertical própria (0,1,2…).
  const lanes = useMemo(() => new Map(digital.map((s, i) => [s.id, i])), [digital]);
  const digitalRows = useMemo(() => {
    const { rows } = mergeRows(digital);
    return downsample(rows, 600).map((r) => {
      const out: Row = { ts: r.ts };
      for (const s of digital) {
        const lane = lanes.get(s.id) ?? 0;
        const raw = r[s.id];
        if (raw !== undefined) out[s.id] = lane + (raw >= 0.5 ? DIGITAL_ON : DIGITAL_OFF);
      }
      return out;
    });
  }, [digital, lanes]);

  // Extensão completa do eixo X (ms) considerando analógicas e digitais.
  const fullExtent = useMemo<[number, number]>(() => {
    const mins = [analogMerged.min, ...digital.flatMap((s) => s.points.map((p) => new Date(p.t).getTime()))].filter(
      (n) => Number.isFinite(n) && n > 0,
    );
    const maxs = [analogMerged.max, ...digital.flatMap((s) => s.points.map((p) => new Date(p.t).getTime()))].filter(
      (n) => Number.isFinite(n) && n > 0,
    );
    const lo = mins.length ? Math.min(...mins) : 0;
    const hi = maxs.length ? Math.max(...maxs) : 1;
    return [lo, hi === lo ? lo + 1 : hi];
  }, [analogMerged, digital]);

  const xDomain: [number, number] = domain ?? fullExtent;

  if (isLoading) return <ChartSkeleton />;
  if (series.length === 0) return <ChartEmpty message="Selecione uma ou mais variáveis à esquerda." />;
  if (visible.length === 0) return <ChartEmpty message="Todas as séries estão ocultas — reative na legenda." />;

  // ── Zoom / Pan ──────────────────────────────────────────────────────────
  function applyArea() {
    if (refLeft == null || refRight == null || refLeft === refRight) {
      setRefLeft(null);
      setRefRight(null);
      return;
    }
    setDomain([Math.min(refLeft, refRight), Math.max(refLeft, refRight)]);
    setRefLeft(null);
    setRefRight(null);
  }

  function zoomBy(factor: number, pivotRatio: number) {
    const [lo, hi] = xDomain;
    const span = hi - lo;
    const pivot = lo + span * pivotRatio;
    const newSpan = Math.max(60_000, Math.min(span * factor, fullExtent[1] - fullExtent[0]));
    let nlo = pivot - newSpan * pivotRatio;
    let nhi = pivot + newSpan * (1 - pivotRatio);
    if (nlo < fullExtent[0]) { nhi += fullExtent[0] - nlo; nlo = fullExtent[0]; }
    if (nhi > fullExtent[1]) { nlo -= nhi - fullExtent[1]; nhi = fullExtent[1]; }
    nlo = Math.max(fullExtent[0], nlo);
    nhi = Math.min(fullExtent[1], nhi);
    setDomain([nlo, nhi]);
  }

  function handleWheel(e: React.WheelEvent<HTMLDivElement>) {
    if (e.deltaY === 0) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    zoomBy(e.deltaY > 0 ? 1.25 : 0.8, ratio);
  }

  function panByRatio(ratio: number) {
    const [lo, hi] = xDomain;
    const span = hi - lo;
    let nlo = lo + span * ratio;
    let nhi = hi + span * ratio;
    if (nlo < fullExtent[0]) { nhi += fullExtent[0] - nlo; nlo = fullExtent[0]; }
    if (nhi > fullExtent[1]) { nlo -= nhi - fullExtent[1]; nhi = fullExtent[1]; }
    setDomain([Math.max(fullExtent[0], nlo), Math.min(fullExtent[1], nhi)]);
  }

  interface ChartMouseState { activeLabel?: string | number; chartX?: number }
  function onMouseDown(state: ChartMouseState, e: React.MouseEvent) {
    if (state?.activeLabel == null) return;
    const label = Number(state.activeLabel);
    if (Number.isNaN(label)) return;
    if (e.shiftKey && domain) {
      panRef.current = { startX: state.chartX ?? 0, startDomain: [...xDomain] as [number, number] };
    } else {
      setRefLeft(label);
      setRefRight(label);
    }
  }
  function onMouseMove(state: ChartMouseState) {
    if (panRef.current && state?.chartX != null && plotWidthRef.current > 0) {
      const [slo, shi] = panRef.current.startDomain;
      const span = shi - slo;
      const dxRatio = (panRef.current.startX - state.chartX) / plotWidthRef.current;
      let nlo = slo + span * dxRatio;
      let nhi = shi + span * dxRatio;
      if (nlo < fullExtent[0]) { nhi += fullExtent[0] - nlo; nlo = fullExtent[0]; }
      if (nhi > fullExtent[1]) { nlo -= nhi - fullExtent[1]; nhi = fullExtent[1]; }
      setDomain([Math.max(fullExtent[0], nlo), Math.min(fullExtent[1], nhi)]);
      return;
    }
    if (refLeft != null && state?.activeLabel != null) {
      const label = Number(state.activeLabel);
      if (!Number.isNaN(label)) setRefRight(label);
    }
  }
  function onMouseUp() {
    if (panRef.current) { panRef.current = null; return; }
    applyArea();
  }

  function toggleHidden(id: string) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const zoomed = domain != null;
  const digitalHeight = Math.max(120, digital.length * 46 + 36);
  const sharedAxis = {
    dataKey: 'ts',
    type: 'number' as const,
    domain: xDomain,
    allowDataOverflow: true,
    scale: 'time' as const,
    tickFormatter: formatXTick,
    tick: { fontSize: 11, fill: '#94a3b8' },
    tickLine: false,
    axisLine: false,
    minTickGap: 56,
  };
  const captureWidth = () => {
    // Aproxima a largura do plot: largura do wrapper − padding − eixo Y − margem direita.
    if (captureRef?.current) plotWidthRef.current = Math.max(1, captureRef.current.clientWidth - 32 - yWidth - 16);
  };

  return (
    <div
      ref={captureRef}
      className="rounded-lg border border-border bg-card p-3 sm:p-4"
      style={{ touchAction: 'pan-y' }}
      onWheel={handleWheel}
      onMouseEnter={captureWidth}
    >
      {/* Header + legenda interativa + controles de zoom */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {series.map((s) => {
            const off = hidden.has(s.id);
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggleHidden(s.id)}
                title={off ? 'Mostrar série' : 'Ocultar série'}
                className={`flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs transition-opacity ${off ? 'opacity-40' : ''}`}
              >
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: s.color, outline: off ? '1px solid #cbd5e1' : 'none' }}
                />
                <span className={`${off ? 'line-through' : ''} text-foreground`}>{s.name}</span>
                <span className="text-muted-foreground">{s.type === 'digital' ? '(estado)' : s.unit ? `(${s.unit})` : ''}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => panByRatio(-0.25)} disabled={!zoomed} title="Voltar"
            className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted/50 disabled:opacity-40">
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => panByRatio(0.25)} disabled={!zoomed} title="Avançar"
            className="rounded-md border border-border p-1.5 text-muted-foreground hover:bg-muted/50 disabled:opacity-40">
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => setDomain(null)} disabled={!zoomed} title="Resetar zoom"
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted/50 disabled:opacity-40">
            <ZoomOut className="h-3.5 w-3.5" /> Reset
          </button>
        </div>
      </div>

      <p className="mb-2 hidden text-[11px] text-muted-foreground sm:block">
        Arraste para zoom · scroll para aproximar · Shift+arraste para mover · clique na legenda para ocultar
      </p>
      <p className="mb-2 text-[11px] text-muted-foreground sm:hidden">
        Toque na legenda para ocultar uma série
      </p>

      {/* Analógicas — linhas */}
      {analog.length > 0 && (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart
            data={analogRows}
            margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
            syncId="trends"
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis {...sharedAxis} />
            <YAxis tick={{ fontSize: isNarrow ? 10 : 11, fill: '#94a3b8', fontFamily: 'monospace' }} tickLine={false} axisLine={false} width={yWidth} domain={['auto', 'auto']} />
            <Tooltip content={<AnalogTooltip seriesById={seriesById} />} isAnimationActive={false} />
            {analog.map((s) => (
              <Line key={s.id} type="monotone" dataKey={s.id} stroke={s.color} strokeWidth={1.6}
                dot={false} activeDot={{ r: 3.5, strokeWidth: 0 }} connectNulls animationDuration={300} />
            ))}
            {refLeft != null && refRight != null && (
              <ReferenceArea x1={refLeft} x2={refRight} strokeOpacity={0.3} fill="#0e7490" fillOpacity={0.08} />
            )}
          </LineChart>
        </ResponsiveContainer>
      )}

      {/* Digitais — gráfico de estado (degrau) por lane */}
      {digital.length > 0 && (
        <div className={analog.length > 0 ? 'mt-1 border-t border-border/60 pt-1' : ''}>
          <ResponsiveContainer width="100%" height={digitalHeight}>
            <LineChart
              data={digitalRows}
              margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
              syncId="trends"
              onMouseDown={onMouseDown}
              onMouseMove={onMouseMove}
              onMouseUp={onMouseUp}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis {...sharedAxis} hide={analog.length > 0} />
              <YAxis
                type="number"
                domain={[-0.2, Math.max(1, digital.length) - 1 + 1.0]}
                ticks={digital.map((_, i) => i + DIGITAL_ON / 2)}
                tickFormatter={(v: number) => {
                  const name = digital[Math.round(v - DIGITAL_ON / 2)]?.name ?? '';
                  return isNarrow && name.length > 9 ? `${name.slice(0, 8)}…` : name;
                }}
                tick={{ fontSize: isNarrow ? 9 : 10, fill: '#64748b' }}
                tickLine={false}
                axisLine={false}
                width={yWidth}
              />
              <Tooltip content={<DigitalTooltip seriesById={seriesById} lanes={lanes} />} isAnimationActive={false} />
              {digital.map((s) => (
                <Line key={s.id} type="stepAfter" dataKey={s.id} stroke={s.color} strokeWidth={2}
                  dot={false} activeDot={{ r: 3.5, strokeWidth: 0 }} connectNulls animationDuration={300} />
              ))}
              {refLeft != null && refRight != null && (
                <ReferenceArea x1={refLeft} x2={refRight} strokeOpacity={0.3} fill="#0e7490" fillOpacity={0.08} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
