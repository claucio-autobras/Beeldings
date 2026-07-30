'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LineChart, AlertTriangle } from 'lucide-react';
import { useT, getCurrentLanguage } from '@/lib/i18n';
import type { AlarmEventItem, AlarmSeverity } from '@/modules/alarms/services/alarms-api.service';
import type { DashboardPeriod } from '../services/dashboard.service';
import { useAlarmTimeline } from '../hooks/useDashboard';
import { PERIOD_WINDOW_MS } from './PeriodSelector';

// ─── Config ───────────────────────────────────────────────────────────────────

const CHART_W = 900;
const CHART_H = 190;
const PAD = { top: 14, right: 12, bottom: 26, left: 12 };

/** Severidade → cor da fatia empilhada (mesma paleta dos demais cards). */
const SEVERITY_STACK: Array<{ key: AlarmSeverity; label: string; dotClass: string; fillClass: string }> = [
  { key: 'LOW', label: 'Baixa', dotClass: 'bg-cyan-600', fillClass: 'fill-cyan-600' },
  { key: 'MEDIUM', label: 'Média', dotClass: 'bg-orange-500', fillClass: 'fill-orange-500' },
  { key: 'HIGH', label: 'Alta', dotClass: 'bg-red-500', fillClass: 'fill-red-500' },
];

interface Bucket {
  start: number;
  bySeverity: Record<AlarmSeverity, number>;
  /** Quebra por origem (cliente — site, ou só site no dashboard escopado). */
  byOrigin: Map<string, number>;
  total: number;
}

const stepMsFor = (period: DashboardPeriod): number =>
  period === '24h' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;

function fmtDay(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function fmtHour(ts: number): string {
  return `${String(new Date(ts).getHours()).padStart(2, '0')}h`;
}

/** Janela do bucket para o cabeçalho do tooltip: "14/07 10h – 11h" ou "14/07 – 15/07". */
function fmtWindow(period: DashboardPeriod, start: number, stepMs: number): string {
  if (period === '24h') return `${fmtDay(start)} ${fmtHour(start)} – ${fmtHour(start + stepMs)}`;
  return fmtDay(start);
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface SeverityTimelineCardProps {
  period: DashboardPeriod;
  tenantId?: string;
  siteId?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * "Alarmes ao longo do tempo" — barras EMPILHADAS por severidade sobre a janela
 * do seletor de período do topo. Clicar num bucket abre a tela de Alarmes já
 * escopada àquela janela de tempo (mesmo padrão de deep-link dos demais cards).
 * Rótulos de eixo/valor em HTML posicionado por % (fora do SVG escalável), e o
 * tooltip rico também é overlay HTML (padrão visual do módulo Trends).
 */
export function SeverityTimelineCard({ period, tenantId, siteId }: SeverityTimelineCardProps) {
  const t = useT();
  const router = useRouter();
  const { data, isLoading } = useAlarmTimeline({
    tenantId,
    siteId,
    period,
    windowMs: PERIOD_WINDOW_MS[period],
  });

  const events: AlarmEventItem[] = data?.events ?? [];
  const stepMs = stepMsFor(period);
  const scopedToTenant = Boolean(tenantId);

  const buckets: Bucket[] = useMemo(() => {
    if (!data) return [];
    const start = data.from.getTime();
    const end = data.to.getTime();
    const count = Math.max(1, Math.ceil((end - start) / stepMs));
    const out: Bucket[] = Array.from({ length: count }, (_, i) => ({
      start: start + i * stepMs,
      bySeverity: { HIGH: 0, MEDIUM: 0, LOW: 0 },
      byOrigin: new Map<string, number>(),
      total: 0,
    }));
    for (const e of events) {
      const ts = new Date(e.activatedAt).getTime();
      if (ts < start || ts > end) continue;
      const idx = Math.min(count - 1, Math.floor((ts - start) / stepMs));
      out[idx].bySeverity[e.severity] += 1;
      out[idx].total += 1;
      // Escopado a um cliente, o nome do cliente é redundante → só o site.
      const site = e.siteName ?? t('Sem site');
      const origin = scopedToTenant ? site : `${e.tenantName} — ${site}`;
      out[idx].byOrigin.set(origin, (out[idx].byOrigin.get(origin) ?? 0) + 1);
    }
    return out;
  }, [data, events, stepMs, scopedToTenant, t]);

  const total = events.length;
  const totalsBySeverity = useMemo(() => {
    const acc: Record<AlarmSeverity, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const e of events) acc[e.severity] += 1;
    return acc;
  }, [events]);

  const maxCount = Math.max(1, ...buckets.map((b) => b.total));
  const innerW = CHART_W - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top - PAD.bottom;
  const baseY = PAD.top + innerH;
  const n = buckets.length;
  const slot = n > 0 ? innerW / n : innerW;
  const barW = Math.min(44, Math.max(3, slot * 0.55));
  const labelStep = Math.max(1, Math.ceil(n / 7));
  const barX = (i: number) => PAD.left + i * slot + (slot - barW) / 2;

  // ── Tooltip HTML (overlay fora do SVG escalável) ─────────────────────────
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hovered = hoverIdx != null ? buckets[hoverIdx] : null;

  const goToBucket = (start: number) => {
    const qs = new URLSearchParams({
      from: new Date(start).toISOString(),
      to: new Date(start + stepMs).toISOString(),
    }).toString();
    router.push(`/alarms?${qs}`);
  };

  /** Posição horizontal do tooltip em % do wrapper, presa às bordas. */
  const tooltipPos = useMemo(() => {
    if (hoverIdx == null || n === 0) return null;
    const cx = ((barX(hoverIdx) + barW / 2) / CHART_W) * 100;
    // Perto das bordas, ancora o tooltip para dentro em vez de centralizar.
    if (cx < 18) return { left: `${cx}%`, transform: 'translateX(0%)' };
    if (cx > 82) return { left: `${cx}%`, transform: 'translateX(-100%)' };
    return { left: `${cx}%`, transform: 'translateX(-50%)' };
    // barX/barW derivam de n e hoverIdx — dependências cobertas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverIdx, n, slot, barW]);

  const originRows = useMemo(() => {
    if (!hovered) return [];
    return Array.from(hovered.byOrigin.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [hovered]);
  const originOverflow = hovered ? hovered.byOrigin.size - originRows.length : 0;

  const isEn = getCurrentLanguage() === 'en';

  return (
    <div className="flex h-full flex-col rounded-lg border border-border bg-card p-5 shadow-sm">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
            <LineChart size={15} strokeWidth={1.5} className="text-cyan-600" />
            {t('Alarmes ao longo do tempo')}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('Distribuição por severidade no período selecionado')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {SEVERITY_STACK.slice().reverse().map(({ key, label, dotClass }) => (
            <span key={key} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={`h-2 w-2 rounded-sm ${dotClass}`} />
              {t(label)}
              <span className="tabular-nums font-medium text-foreground">{totalsBySeverity[key]}</span>
            </span>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="h-[190px] animate-pulse rounded bg-muted" />
      ) : total === 0 ? (
        <div className="flex h-[190px] flex-col items-center justify-center gap-2 text-center">
          <AlertTriangle size={28} strokeWidth={1.5} className="text-muted-foreground/50" />
          <p className="text-sm font-medium text-foreground">{t('Nenhum alarme disparado no período')}</p>
          <p className="text-xs text-muted-foreground">{t('Nada registrado na janela selecionada')}</p>
        </div>
      ) : (
        <div ref={wrapRef} className="relative w-full" onMouseLeave={() => setHoverIdx(null)}>
          <svg
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            className="w-full"
            role="img"
            aria-label={t('Alarmes por severidade ao longo do tempo')}
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
              if (b.total === 0) return null;
              const x = barX(i);
              let yCursor = baseY;
              const totalH = (b.total / maxCount) * innerH;
              return (
                <g
                  key={b.start}
                  className="cursor-pointer"
                  onClick={() => goToBucket(b.start)}
                  onMouseEnter={() => setHoverIdx(i)}
                >
                  {SEVERITY_STACK.map(({ key, fillClass }) => {
                    const h = b.total > 0 ? (b.bySeverity[key] / b.total) * totalH : 0;
                    if (h <= 0) return null;
                    yCursor -= h;
                    return (
                      <rect
                        key={key}
                        x={x}
                        y={yCursor}
                        width={barW}
                        height={h}
                        className={fillClass}
                        opacity={hoverIdx === null || hoverIdx === i ? 0.85 : 0.45}
                      />
                    );
                  })}
                  {/* Alvo de hover/clique cobrindo o slot inteiro (mais fácil de acertar). */}
                  <rect
                    x={PAD.left + i * slot}
                    y={PAD.top}
                    width={slot}
                    height={innerH}
                    fill="transparent"
                  />
                </g>
              );
            })}
          </svg>

          {/* Tooltip rico em HTML (padrão visual do Trends) — fora do SVG escalável. */}
          {hovered && hovered.total > 0 && tooltipPos && (
            <div
              className="pointer-events-none absolute z-20 max-w-[280px] rounded-lg border border-border bg-card px-3 py-2 shadow-md"
              style={{ left: tooltipPos.left, transform: tooltipPos.transform, bottom: '100%', marginBottom: 4 }}
            >
              <p className="mb-1 whitespace-nowrap text-xs text-muted-foreground">
                {fmtWindow(period, hovered.start, stepMs)}
                {' · '}
                <span className="font-semibold text-foreground">{hovered.total}</span>{' '}
                {hovered.total === 1 ? (isEn ? 'alarm' : 'alarme') : t('alarmes')}
              </p>
              <div className="space-y-0.5">
                {SEVERITY_STACK.slice().reverse().map(({ key, label, dotClass }) => {
                  const c = hovered.bySeverity[key];
                  if (c === 0) return null;
                  return (
                    <p key={key} className="flex items-center gap-1.5 text-sm">
                      <span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} />
                      <span className="text-foreground">{t(label)}:</span>
                      <span className="tabular-nums font-semibold text-foreground">{c}</span>
                    </p>
                  );
                })}
              </div>
              {originRows.length > 0 && (
                <div className="mt-1.5 space-y-0.5 border-t border-border/60 pt-1.5">
                  {originRows.map(([origin, count]) => (
                    <p key={origin} className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="truncate text-muted-foreground">{origin}</span>
                      <span className="tabular-nums font-medium text-foreground">
                        {count} {count === 1 ? (isEn ? 'alarm' : 'alarme') : t('alarmes')}
                      </span>
                    </p>
                  ))}
                  {originOverflow > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      +{originOverflow} {isEn ? 'more origins' : originOverflow === 1 ? 'outra origem' : 'outras origens'}
                    </p>
                  )}
                </div>
              )}
              <p className="mt-1.5 text-[11px] text-muted-foreground">{t('clique para ver')}</p>
            </div>
          )}

          {/* Rótulos do eixo X fora do SVG escalável (tamanho legível em cards estreitos). */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0"
            style={{ height: `${(PAD.bottom / CHART_H) * 100}%` }}
          >
            {buckets.map((b, i) => {
              if (!(i % labelStep === 0 || i === n - 1)) return null;
              const cx = barX(i) + barW / 2;
              const fmtAxis = period === '24h' ? fmtHour : fmtDay;
              return (
                <span
                  key={b.start}
                  className="absolute top-1 -translate-x-1/2 whitespace-nowrap text-[11px] leading-tight text-muted-foreground"
                  style={{ left: `${(cx / CHART_W) * 100}%` }}
                >
                  {fmtAxis(b.start)}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {total > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          <span className="font-semibold text-foreground">{total}</span>{' '}
          {total === 1
            ? isEn ? 'alarm triggered' : 'alarme disparado'
            : isEn ? 'alarms triggered' : 'alarmes disparados'}{' '}
          {isEn
            ? 'in the period — click a bar to open the alarms for that window'
            : 'no período — clique numa barra para abrir os alarmes daquela janela'}
        </p>
      )}
    </div>
  );
}
