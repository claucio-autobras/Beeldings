'use client';

import { useMemo, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { useT, getCurrentLanguage } from '@/lib/i18n';
import type { DashboardPeriod, OverviewTrend } from '../services/dashboard.service';

// Mesmo padrão do SeverityTimelineCard: SVG escalável só para as barras;
// rótulos de eixo e tooltip como overlays HTML (tamanho fixo legível).
const CHART_W = 900;
const CHART_H = 170;
const PAD = { top: 12, right: 10, bottom: 24, left: 10 };

function fmtDay(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fmtHour(ts: number): string {
  return `${String(new Date(ts).getHours()).padStart(2, '0')}h`;
}

interface AdminTrendCardProps {
  trend: OverviewTrend | null | undefined;
  period: DashboardPeriod;
  isLoading?: boolean;
}

/**
 * "Evolução no período" (visão Admin global): alarmes disparados e transições
 * para offline por bucket de tempo, agregados sobre os clientes ativos —
 * derivado de alarm_events/status_events já persistidos. Responde "estamos
 * melhorando ou piorando?" ao longo da janela selecionada.
 */
export function AdminTrendCard({ trend, period, isLoading }: AdminTrendCardProps) {
  const t = useT();
  const isEn = getCurrentLanguage() === 'en';
  const buckets = trend?.buckets ?? [];
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const totals = useMemo(
    () =>
      buckets.reduce(
        (acc, b) => ({
          activated: acc.activated + b.activated,
          offline: acc.offline + b.offlineTransitions,
        }),
        { activated: 0, offline: 0 },
      ),
    [buckets],
  );

  const n = buckets.length;
  const innerW = CHART_W - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top - PAD.bottom;
  const baseY = PAD.top + innerH;
  const slot = n > 0 ? innerW / n : innerW;
  const barW = Math.min(18, Math.max(2, slot * 0.32));
  const labelStep = Math.max(1, Math.ceil(n / 7));
  const maxCount = Math.max(1, ...buckets.map((b) => Math.max(b.activated, b.offlineTransitions)));
  const slotX = (i: number) => PAD.left + i * slot;

  const hovered = hoverIdx != null ? buckets[hoverIdx] : null;
  const tooltipPos = useMemo(() => {
    if (hoverIdx == null || n === 0) return null;
    const cx = ((slotX(hoverIdx) + slot / 2) / CHART_W) * 100;
    if (cx < 18) return { left: `${cx}%`, transform: 'translateX(0%)' };
    if (cx > 82) return { left: `${cx}%`, transform: 'translateX(-100%)' };
    return { left: `${cx}%`, transform: 'translateX(-50%)' };
    // slotX/slot derivam de n — dependências cobertas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverIdx, n, slot]);

  const empty = !isLoading && (n === 0 || (totals.activated === 0 && totals.offline === 0));
  const fmtAxis = period === '24h' ? fmtHour : fmtDay;
  const fmtWindowLabel = (startIso: string) => {
    const start = new Date(startIso).getTime();
    return period === '24h'
      ? `${fmtDay(start)} ${fmtHour(start)} – ${fmtHour(start + (trend?.bucketMs ?? 0))}`
      : fmtDay(start);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
            <TrendingUp size={15} strokeWidth={1.5} className="text-cyan-600" />
            {t('Evolução no período')}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('Alarmes disparados e quedas de comunicação ao longo do período (todos os clientes ativos)')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="h-2 w-2 rounded-sm bg-cyan-600" />
            {t('Alarmes disparados')}
            <span className="tabular-nums font-medium text-foreground">{totals.activated}</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="h-2 w-2 rounded-sm bg-slate-400" />
            {t('Quedas (offline)')}
            <span className="tabular-nums font-medium text-foreground">{totals.offline}</span>
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="h-[170px] animate-pulse rounded bg-muted" />
      ) : empty ? (
        <div className="flex h-[170px] flex-col items-center justify-center gap-2 text-center">
          <TrendingUp size={28} strokeWidth={1.5} className="text-muted-foreground/50" />
          <p className="text-sm font-medium text-foreground">{t('Nada registrado no período')}</p>
          <p className="text-xs text-muted-foreground">
            {t('Sem alarmes disparados nem quedas de comunicação na janela selecionada')}
          </p>
        </div>
      ) : (
        <div className="relative w-full" onMouseLeave={() => setHoverIdx(null)}>
          <svg
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            className="w-full"
            role="img"
            aria-label={t('Alarmes disparados e quedas de comunicação por bucket de tempo')}
          >
            <line
              x1={PAD.left}
              x2={CHART_W - PAD.right}
              y1={baseY}
              y2={baseY}
              stroke="var(--color-border)"
              strokeWidth="1"
            />
            {buckets.map((b, i) => {
              const x = slotX(i);
              const gap = Math.min(3, slot * 0.06);
              const cx = x + slot / 2;
              const hAct = (b.activated / maxCount) * innerH;
              const hOff = (b.offlineTransitions / maxCount) * innerH;
              const dim = hoverIdx !== null && hoverIdx !== i;
              return (
                <g key={b.start} onMouseEnter={() => setHoverIdx(i)}>
                  {b.activated > 0 && (
                    <rect
                      x={cx - gap / 2 - barW}
                      y={baseY - hAct}
                      width={barW}
                      height={hAct}
                      className="fill-cyan-600"
                      opacity={dim ? 0.4 : 0.85}
                    />
                  )}
                  {b.offlineTransitions > 0 && (
                    <rect
                      x={cx + gap / 2}
                      y={baseY - hOff}
                      width={barW}
                      height={hOff}
                      className="fill-slate-400"
                      opacity={dim ? 0.4 : 0.85}
                    />
                  )}
                  {/* Alvo de hover cobrindo o slot inteiro. */}
                  <rect x={x} y={PAD.top} width={slot} height={innerH} fill="transparent" />
                </g>
              );
            })}
          </svg>

          {hovered && tooltipPos && (
            <div
              className="pointer-events-none absolute z-20 rounded-lg border border-border bg-card px-3 py-2 shadow-md"
              style={{ left: tooltipPos.left, transform: tooltipPos.transform, bottom: '100%', marginBottom: 4 }}
            >
              <p className="mb-1 whitespace-nowrap text-xs text-muted-foreground">
                {fmtWindowLabel(hovered.start)}
              </p>
              <p className="flex items-center gap-1.5 whitespace-nowrap text-sm">
                <span className="inline-block h-2 w-2 rounded-full bg-cyan-600" />
                <span className="text-foreground">{t('Alarmes disparados')}:</span>
                <span className="tabular-nums font-semibold text-foreground">{hovered.activated}</span>
              </p>
              <p className="flex items-center gap-1.5 whitespace-nowrap text-sm">
                <span className="inline-block h-2 w-2 rounded-full bg-slate-400" />
                <span className="text-foreground">{t('Quedas (offline)')}:</span>
                <span className="tabular-nums font-semibold text-foreground">{hovered.offlineTransitions}</span>
              </p>
            </div>
          )}

          {/* Rótulos do eixo X fora do SVG escalável (legíveis em cards estreitos). */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0"
            style={{ height: `${(PAD.bottom / CHART_H) * 100}%` }}
          >
            {buckets.map((b, i) => {
              if (!(i % labelStep === 0 || i === n - 1)) return null;
              const cx = slotX(i) + slot / 2;
              return (
                <span
                  key={b.start}
                  className="absolute top-1 -translate-x-1/2 whitespace-nowrap text-[11px] leading-tight text-muted-foreground"
                  style={{ left: `${(cx / CHART_W) * 100}%` }}
                >
                  {fmtAxis(new Date(b.start).getTime())}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {!isLoading && !empty && (
        <p className="mt-2 text-xs text-muted-foreground">
          {isEn
            ? 'Alarm activations (alarm history) and offline transitions (communication drops) per time bucket.'
            : 'Ativações de alarme (histórico de alarmes) e transições para offline (quedas de comunicação) por janela de tempo.'}
        </p>
      )}
    </div>
  );
}
