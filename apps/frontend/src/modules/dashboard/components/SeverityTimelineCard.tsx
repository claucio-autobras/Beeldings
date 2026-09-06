'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { AlertTriangle, TrendingUp } from 'lucide-react';
import { useT, getCurrentLanguage } from '@/lib/i18n';
import { usePortalContainer } from '@/hooks/usePortalContainer';
import type { AlarmEventItem, AlarmSeverity } from '@/modules/alarms/services/alarms-api.service';
import type { DashboardPeriod, OfflineOriginEntry, OverviewTrend } from '../services/dashboard.service';
import { useAlarmTimeline } from '../hooks/useDashboard';
import { PERIOD_WINDOW_MS, PeriodSelector } from './PeriodSelector';
import { resolveOfflineDropHref, resolveTopOfflineDropHref } from './offlineDropRouting';
import { DashboardPanel, DashboardSectionTitle } from './DashboardShared';

// ─── Config ───────────────────────────────────────────────────────────────────

const CHART_W = 900;
const CHART_H = 190;
const PAD = { top: 14, right: 12, bottom: 32, left: 12 };

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
  onPeriodChange: (period: DashboardPeriod) => void;
  tenantId?: string;
  siteId?: string;
  /**
   * Dados de quedas de comunicação (visão Admin global). Quando fornecido, o
   * card exibe as quedas como barra cinza pareada por janela e atualiza título,
   * legenda e tooltip. Ausente na visão escopada por cliente/site.
   */
  offlineTrend?: OverviewTrend | null;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * "Alarmes e quedas no período" (Admin) / "Alarmes ao longo do tempo" (Cliente):
 * barras EMPILHADAS por severidade sobre a janela do seletor de período. Quando
 * `offlineTrend` é fornecido (visão Admin), uma barra cinza de quedas offline é
 * exibida pareada a cada janela. Clicar num bucket de alarme abre a tela de
 * Alarmes já escopada àquela janela de tempo.
 *
 * Alinhamento dos buckets: os alarmes são agrupados em buckets calculados no
 * cliente ([now-window, now] / stepMs), enquanto a série de quedas vem do
 * endpoint de overview (janela calculada no servidor). As janelas diferem por
 * alguns milissegundos de rede/processamento. Por isso o índice de cada bucket
 * de queda é determinado por Math.round((offlineStart - alarmFrom) / stepMs),
 * tolerando essa diferença de forma determinística.
 */
export function SeverityTimelineCard({
  period,
  onPeriodChange,
  tenantId,
  siteId,
  offlineTrend,
}: SeverityTimelineCardProps) {
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
  const hasOffline = Boolean(offlineTrend && offlineTrend.buckets.length > 0);

  // ── Alarm buckets ─────────────────────────────────────────────────────────

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

  const n = buckets.length;

  // ── Offline series aligned to alarm bucket grid ───────────────────────────
  //
  // The overview API computes its time window server-side; useAlarmTimeline
  // computes it client-side. Their exact millisecond starts differ by network
  // latency / processing time. We snap each offline bucket to the nearest alarm
  // bucket index via Math.round so the two series always align visually.

  const offlineCounts = useMemo<number[]>(() => {
    if (!data || !offlineTrend || n === 0) return Array(n).fill(0);
    const alarmFrom = data.from.getTime();
    const counts = Array<number>(n).fill(0);
    for (const b of offlineTrend.buckets) {
      const bStart = new Date(b.start).getTime();
      const idx = Math.round((bStart - alarmFrom) / stepMs);
      if (idx >= 0 && idx < n) {
        counts[idx] += b.offlineTransitions;
      }
    }
    return counts;
  }, [data, offlineTrend, n, stepMs]);

  const totalOffline = useMemo(() => offlineCounts.reduce((s, v) => s + v, 0), [offlineCounts]);

  /**
   * Quebra por cliente/dispositivo das quedas, alinhada ao mesmo grid de
   * buckets (mesmo snap por Math.round de offlineCounts). Flapping da mesma
   * entidade dentro de um bucket soma no MESMO item em vez de duplicar linhas.
   */
  const offlineBreakdowns = useMemo<OfflineOriginEntry[][]>(() => {
    if (!data || !offlineTrend || n === 0) return Array.from({ length: n }, () => []);
    const alarmFrom = data.from.getTime();
    const maps = Array.from({ length: n }, () => new Map<string, OfflineOriginEntry>());
    for (const b of offlineTrend.buckets) {
      const bStart = new Date(b.start).getTime();
      const idx = Math.round((bStart - alarmFrom) / stepMs);
      if (idx < 0 || idx >= n) continue;
      for (const entry of b.offlineBreakdown ?? []) {
        const key = `${entry.entityType}:${entry.entityId}`;
        const existing = maps[idx].get(key);
        if (existing) existing.count += entry.count;
        else maps[idx].set(key, { ...entry });
      }
    }
    return maps.map((m) => [...m.values()].sort((a, b) => b.count - a.count));
  }, [data, offlineTrend, n, stepMs]);

  const total = events.length;
  const totalsBySeverity = useMemo(() => {
    const acc: Record<AlarmSeverity, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    for (const e of events) acc[e.severity] += 1;
    return acc;
  }, [events]);

  const isEn = getCurrentLanguage() === 'en';

  // ── Chart geometry ────────────────────────────────────────────────────────

  // Escala Y considera o máximo entre os dois tipos de série.
  const maxCount = useMemo(() => {
    let m = 1;
    for (const b of buckets) m = Math.max(m, b.total);
    for (const v of offlineCounts) m = Math.max(m, v);
    return m;
  }, [buckets, offlineCounts]);

  const innerW = CHART_W - PAD.left - PAD.right;
  const innerH = CHART_H - PAD.top - PAD.bottom;
  const baseY = PAD.top + innerH;
  const slot = n > 0 ? innerW / n : innerW;

  // Para 30d as barras precisam usar uma fração maior do slot para ficarem
  // visivelmente largas. Usamos frações maiores e limitamos ao slot menos gap.
  const is30d = period === '30d';

  const alarmBarW = hasOffline
    ? Math.min(slot * 0.9 * 0.52, Math.max(3, slot * (is30d ? 0.42 : 0.32)))
    : Math.min(slot * 0.88, Math.max(3, slot * (is30d ? 0.72 : 0.55)));
  const offlineBarW = Math.min(slot * 0.9 * 0.36, Math.max(2, slot * (is30d ? 0.30 : 0.22)));
  // Gap menor em 30d para cabir os dois sem comprimir demais.
  const pairGap = is30d ? Math.min(2, slot * 0.04) : Math.min(3, slot * 0.04);

  // Densidade de rótulos: 7d mostra todo dia, 30d mostra semanal (cada 7),
  // 24h mantém a cada 4h (fórmula original).
  const labelStep =
    period === '30d' ? 7 : period === '7d' ? 1 : Math.max(1, Math.ceil(n / 7));

  // Centro da barra de alarme dentro do slot (ligeiramente à esquerda quando pareada).
  const alarmBarX = (i: number) => {
    const slotLeft = PAD.left + i * slot;
    if (hasOffline) {
      const cx = slotLeft + slot / 2;
      return cx - pairGap / 2 - alarmBarW;
    }
    return slotLeft + (slot - alarmBarW) / 2;
  };

  const offlineBarX = (i: number) => {
    const cx = PAD.left + i * slot + slot / 2;
    return cx + pairGap / 2;
  };

  // ── Tooltip HTML (overlay fora do SVG escalável) ──────────────────────────

  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const portalContainer = usePortalContainer();
  const [tooltipAnchor, setTooltipAnchor] = useState<{ left: number; top: number } | null>(null);
  const tooltipHideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovered = hoverIdx != null ? buckets[hoverIdx] : null;
  const hoveredOffline = hoverIdx != null ? (offlineCounts[hoverIdx] ?? 0) : 0;
  const hoveredOfflineBreakdown = hoverIdx != null ? (offlineBreakdowns[hoverIdx] ?? []) : [];

  const cancelTooltipHide = () => {
    if (tooltipHideTimer.current !== null) {
      clearTimeout(tooltipHideTimer.current);
      tooltipHideTimer.current = null;
    }
  };

  const scheduleTooltipHide = () => {
    cancelTooltipHide();
    tooltipHideTimer.current = setTimeout(() => {
      setHoverIdx(null);
      setTooltipAnchor(null);
      tooltipHideTimer.current = null;
    }, 150);
  };

  useEffect(() => {
    return () => {
      if (tooltipHideTimer.current !== null) clearTimeout(tooltipHideTimer.current);
    };
  }, []);

  const goToBucket = (start: number) => {
    const qs = new URLSearchParams({
      from: new Date(start).toISOString(),
      to: new Date(start + stepMs).toISOString(),
    }).toString();
    router.push(`/alarms?${qs}`);
  };

  /**
   * Clique na barra/área de quedas: navega para a tela do cliente/categoria
   * dono da origem com maior contagem no bucket (Dispositivos, CFTV ou SCA).
   * Itens específicos do tooltip permitem desambiguar quando há mais de uma
   * origem na mesma janela; o clique na barra de alarme continua indo para
   * Alarmes (goToBucket, inalterado).
   */
  const goToOfflineBucket = (i: number) => {
    const href = resolveTopOfflineDropHref(offlineBreakdowns[i] ?? []);
    if (href) router.push(href);
    else if (buckets[i]) goToBucket(buckets[i].start);
  };

  /** Posição horizontal do tooltip em % do wrapper, presa às bordas. */
  const tooltipPos = useMemo(() => {
    if (hoverIdx == null || n === 0) return null;
    const cx = ((alarmBarX(hoverIdx) + alarmBarW / 2) / CHART_W) * 100;
    // Perto das bordas, ancora o tooltip para dentro em vez de centralizar.
    if (cx < 18) return { left: `${cx}%`, transform: 'translateX(0%)' };
    if (cx > 82) return { left: `${cx}%`, transform: 'translateX(-100%)' };
    return { left: `${cx}%`, transform: 'translateX(-50%)' };
    // alarmBarX/alarmBarW derivam de n e hoverIdx — dependências cobertas.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hoverIdx, n, slot, alarmBarW, hasOffline, pairGap]);

  /**
   * O tooltip é renderizado fora do shell com portal porque o Dashboard usa
   * overflow-hidden para manter o scroll interno. A posição é recalculada em
   * resize e scroll para acompanhar o gráfico.
   */
  useEffect(() => {
    if (hoverIdx == null || !tooltipPos) return;

    const updateTooltipAnchor = () => {
      const rect = wrapRef.current?.getBoundingClientRect();
      if (!rect) return;
      const leftPercent = Number.parseFloat(tooltipPos.left);
      setTooltipAnchor({
        left: rect.left + (leftPercent / 100) * rect.width,
        top: rect.top - 4,
      });
    };

    updateTooltipAnchor();
    window.addEventListener('resize', updateTooltipAnchor);
    window.addEventListener('scroll', updateTooltipAnchor, true);
    return () => {
      window.removeEventListener('resize', updateTooltipAnchor);
      window.removeEventListener('scroll', updateTooltipAnchor, true);
    };
  }, [hoverIdx, tooltipPos]);

  const originRows = useMemo(() => {
    if (!hovered) return [];
    return Array.from(hovered.byOrigin.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [hovered]);
  const originOverflow = hovered ? hovered.byOrigin.size - originRows.length : 0;

  const offlineOriginRows = useMemo(() => hoveredOfflineBreakdown.slice(0, 6), [hoveredOfflineBreakdown]);
  const offlineOriginOverflow = Math.max(0, hoveredOfflineBreakdown.length - offlineOriginRows.length);

  // Estado vazio: sem alarmes E sem quedas (quando série presente).
  const isEmpty = total === 0 && (!hasOffline || totalOffline === 0);

  return (
    <DashboardPanel className="p-5" accent>
      <div className="mb-3 w-full">
        <DashboardSectionTitle
          eyebrow={`Ritmo operacional · ${period}`}
          title={hasOffline ? t('Alarmes e quedas no período') : t('Alarmes ao longo do tempo')}
          detail={hasOffline
              ? t('Alarmes por severidade e quedas de comunicação')
              : t('Distribuição por severidade no período selecionado')}
          action={
            <div className="flex shrink-0 items-center gap-2">
              <PeriodSelector value={period} onChange={onPeriodChange} />
              <TrendingUp className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
            </div>
          }
        />
      </div>
      <div className="mb-3 flex flex-wrap items-center justify-start gap-3">
        {SEVERITY_STACK.slice().reverse().map(({ key, label, dotClass }) => (
          <span key={key} className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className={`h-2 w-2 rounded-sm ${dotClass}`} />
            {t(label)}
            <span className="tabular-nums font-medium text-foreground">{totalsBySeverity[key]}</span>
          </span>
        ))}
        {hasOffline && (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="h-2 w-2 rounded-sm bg-slate-400" />
            {t('Quedas (offline)')}
            <span className="tabular-nums font-medium text-foreground">{totalOffline}</span>
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="h-[190px] animate-pulse rounded bg-muted" />
      ) : isEmpty ? (
        <div className="flex h-[190px] flex-col items-center justify-center gap-2 text-center">
          <AlertTriangle size={28} strokeWidth={1.5} className="text-muted-foreground/50" />
          <p className="text-sm font-medium text-foreground">
            {hasOffline
              ? t('Nenhum alarme nem queda de comunicação no período')
              : t('Nenhum alarme disparado no período')}
          </p>
          <p className="text-xs text-muted-foreground">{t('Nada registrado na janela selecionada')}</p>
        </div>
      ) : (
        <div ref={wrapRef} className="relative w-full" onMouseLeave={scheduleTooltipHide}>
          <svg
            viewBox={`0 0 ${CHART_W} ${CHART_H}`}
            className="w-full"
            role="img"
            aria-label={
              hasOffline
                ? t('Alarmes por severidade e quedas de comunicação ao longo do tempo')
                : t('Alarmes por severidade ao longo do tempo')
            }
          >
            {/* Realce do slot sob o cursor */}
            {hoverIdx != null && (
              <rect
                x={PAD.left + hoverIdx * slot}
                y={PAD.top}
                width={slot}
                height={innerH}
                fill="currentColor"
                className="text-muted-foreground/10"
                rx={2}
              />
            )}

            {/* Linha base do eixo X */}
            <line
              x1={PAD.left}
              x2={CHART_W - PAD.right}
              y1={baseY}
              y2={baseY}
              stroke="var(--color-border)"
              strokeWidth="1"
            />

            {/* Ticks de dia/hora abaixo da linha base — um por bucket */}
            {buckets.map((b, i) => {
              const cx = PAD.left + i * slot + slot / 2;
              // Tick maior nas posições com rótulo, menor nos demais.
              const isLabeled = i % labelStep === 0 || i === n - 1;
              const tickH = isLabeled ? 5 : 3;
              return (
                <line
                  key={`tick-${b.start}`}
                  x1={cx}
                  x2={cx}
                  y1={baseY}
                  y2={baseY + tickH}
                  stroke="var(--color-border)"
                  strokeWidth={isLabeled ? 1.5 : 1}
                />
              );
            })}

            {buckets.map((b, i) => {
              const offlineCount = offlineCounts[i] ?? 0;
              const hasAny = b.total > 0 || offlineCount > 0;
              if (!hasAny) return null;
              const x = alarmBarX(i);
              let yCursor = baseY;
              const totalH = (b.total / maxCount) * innerH;
              const offlineH = (offlineCount / maxCount) * innerH;
              const slotLeft = PAD.left + i * slot;
              // Só existe "lado das quedas" para clique quando esta janela TEM
              // queda — senão o slot inteiro clica em Alarmes (igual antes).
              const hasOfflineHere = hasOffline && offlineCount > 0;
              const splitX = slotLeft + slot / 2;
              return (
                <g key={b.start} onMouseEnter={() => setHoverIdx(i)}>
                  {/* Barras de alarme empilhadas por severidade */}
                  {b.total > 0 && SEVERITY_STACK.map(({ key, fillClass }) => {
                    const h = (b.bySeverity[key] / b.total) * totalH;
                    if (h <= 0) return null;
                    yCursor -= h;
                    return (
                      <rect
                        key={key}
                        x={x}
                        y={yCursor}
                        width={alarmBarW}
                        height={h}
                        className={fillClass}
                        rx={alarmBarW > 6 ? 1.5 : 0}
                        opacity={hoverIdx === null || hoverIdx === i ? 0.9 : 0.35}
                      />
                    );
                  })}
                  {/* Barra de quedas offline (cinza, à direita do par) */}
                  {hasOffline && offlineCount > 0 && (
                    <rect
                      x={offlineBarX(i)}
                      y={baseY - offlineH}
                      width={offlineBarW}
                      height={offlineH}
                      className="fill-slate-400"
                      rx={offlineBarW > 6 ? 1.5 : 0}
                      opacity={hoverIdx === null || hoverIdx === i ? 0.85 : 0.35}
                    />
                  )}
                  {/*
                    Alvo de clique dividido ao meio do slot: lado do alarme
                    sempre abre a tela de Alarmes (inalterado); lado das
                    quedas — só quando há queda na janela — roteia para o
                    cliente/categoria dono do dispositivo/gateway.
                  */}
                  <rect
                    x={slotLeft}
                    y={PAD.top}
                    width={hasOfflineHere ? splitX - slotLeft : slot}
                    height={innerH}
                    fill="transparent"
                    className="cursor-pointer"
                    onClick={() => goToBucket(b.start)}
                  />
                  {hasOfflineHere && (
                    <rect
                      x={splitX}
                      y={PAD.top}
                      width={slotLeft + slot - splitX}
                      height={innerH}
                      fill="transparent"
                      className="cursor-pointer"
                      onClick={() => goToOfflineBucket(i)}
                    />
                  )}
                </g>
              );
            })}

            {/* Slots vazios também capturavam o hover */}
            {buckets.map((b, i) => {
              const offlineCount = offlineCounts[i] ?? 0;
              const hasAny = b.total > 0 || offlineCount > 0;
              if (hasAny) return null;
              return (
                <rect
                  key={`hover-empty-${b.start}`}
                  x={PAD.left + i * slot}
                  y={PAD.top}
                  width={slot}
                  height={innerH}
                  fill="transparent"
                  className="cursor-pointer"
                  onMouseEnter={() => setHoverIdx(i)}
                  onClick={() => goToBucket(b.start)}
                />
              );
            })}
          </svg>

          {/* Tooltip rico em HTML (padrão visual do Trends) — fora do SVG escalável. */}
          {portalContainer &&
            hovered &&
            (hovered.total > 0 || hoveredOffline > 0) &&
            tooltipPos &&
            tooltipAnchor &&
            createPortal(
              <div
                className="pointer-events-auto fixed z-[110] max-w-[300px] rounded-lg border border-border bg-card px-3 py-2 shadow-md"
                onMouseEnter={cancelTooltipHide}
                onMouseLeave={scheduleTooltipHide}
                style={{
                  left: tooltipAnchor.left,
                  top: tooltipAnchor.top,
                  transform: `${tooltipPos.transform} translateY(-100%)`,
                }}
              >
              <p className="mb-1 whitespace-nowrap text-xs text-muted-foreground">
                {fmtWindow(period, hovered.start, stepMs)}
                {hovered.total > 0 && (
                  <>
                    {' · '}
                    <span className="font-semibold text-foreground">{hovered.total}</span>{' '}
                    {hovered.total === 1 ? (isEn ? 'alarm' : 'alarme') : t('alarmes')}
                  </>
                )}
              </p>
              {hovered.total > 0 && (
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
              )}
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
              {hasOffline && (
                <p
                  className={`flex items-center gap-1.5 text-sm ${
                    hovered.total > 0 || originRows.length > 0 ? 'mt-1.5' : ''
                  }`}
                >
                  <span className="inline-block h-2 w-2 rounded-full bg-slate-400" />
                  <span className="text-foreground">{t('Quedas (offline)')}:</span>
                  <span className="tabular-nums font-semibold text-foreground">{hoveredOffline}</span>
                </p>
              )}
              {/* Quebra por cliente/dispositivo das quedas — cada linha é clicável e
                  leva direto ao cadastro do equipamento, já filtrado pelo cliente. */}
              {offlineOriginRows.length > 0 && (
                <div className="pointer-events-auto mt-1 space-y-0.5 border-t border-border/60 pt-1.5">
                  {offlineOriginRows.map((entry) => (
                    <button
                      key={`${entry.entityType}:${entry.entityId}`}
                      type="button"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        router.push(resolveOfflineDropHref(entry));
                      }}
                      className="dashboard-clickable flex w-full items-baseline justify-between gap-3 rounded text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
                    >
                      <span className="truncate">
                        {entry.tenantName} — {entry.entityName}
                      </span>
                      <span className="tabular-nums font-medium text-foreground">
                        {entry.count} {entry.count === 1 ? (isEn ? 'drop' : 'queda') : t('quedas')}
                      </span>
                    </button>
                  ))}
                  {offlineOriginOverflow > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      +{offlineOriginOverflow}{' '}
                      {isEn ? 'more' : offlineOriginOverflow === 1 ? 'outra origem' : 'outras origens'}
                    </p>
                  )}
                </div>
              )}
              <p className="mt-1.5 text-[11px] text-muted-foreground">{t('clique para ver')}</p>
              </div>,
              portalContainer
            )}

          {/* Rótulos do eixo X fora do SVG escalável (tamanho legível em cards estreitos).
              30d: rótulos semanais (a cada 7 dias) com a data do dia.
              7d: rótulo em todo dia.
              24h: a cada 4h. */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0"
            style={{ height: `${(PAD.bottom / CHART_H) * 100}%` }}
          >
            {buckets.map((b, i) => {
              if (!(i % labelStep === 0 || i === n - 1)) return null;
              const cx = PAD.left + i * slot + slot / 2;
              const fmtAxis = period === '24h' ? fmtHour : fmtDay;
              return (
                <span
                  key={b.start}
                  className="absolute top-[7px] -translate-x-1/2 whitespace-nowrap text-[11px] leading-tight text-muted-foreground"
                  style={{ left: `${(cx / CHART_W) * 100}%` }}
                >
                  {fmtAxis(b.start)}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {(total > 0 || (hasOffline && totalOffline > 0)) && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          {hasOffline ? (
            <>
              <span className="font-semibold text-foreground">{total}</span>{' '}
              {total === 1 ? (isEn ? 'alarm triggered' : 'alarme disparado') : isEn ? 'alarms triggered' : 'alarmes disparados'}{' '}
              {isEn ? 'and' : 'e'}{' '}
              <span className="font-semibold text-foreground">{totalOffline}</span>{' '}
              {isEn
                ? 'communication drops in the period — click an alarm bar to open the alarms, or a drop bar to open the affected client/equipment'
                : 'quedas de comunicação no período — clique na barra de alarme para ver os alarmes, ou na de quedas para abrir o cliente/equipamento afetado'}
            </>
          ) : (
            <>
              <span className="font-semibold text-foreground">{total}</span>{' '}
              {total === 1
                ? isEn ? 'alarm triggered' : 'alarme disparado'
                : isEn ? 'alarms triggered' : 'alarmes disparados'}{' '}
              {isEn
                ? 'in the period — click a bar to open the alarms for that window'
                : 'no período — clique numa barra para abrir os alarmes daquela janela'}
            </>
          )}
        </p>
      )}
    </DashboardPanel>
  );
}
