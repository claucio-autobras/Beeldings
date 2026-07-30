'use client';

import Link from 'next/link';
import { Camera, Cpu, Gauge, MemoryStick, Timer, VideoOff } from 'lucide-react';
import { useT } from '@/lib/i18n';
import { ESTIMATED_UPTIME_HINT } from '@/modules/cftv/utils/telemetry-format';
import type { CftvKpi, CftvCameraEntry } from '../hooks/useCftvKpi';

interface CftvStatusCardProps {
  /** null quando o tenant não tem câmeras — o card não é exibido pelo chamador. */
  kpi: CftvKpi | null;
}

/** Até este nº de câmeras o card usa tiles ricos; acima vira lista densa. */
const MAX_TILES = 3;

/** Máximo de câmeras listadas no modo lista — o resto vira "+N câmeras". */
const MAX_ROWS = 5;

const DOT_CLASS: Record<CftvCameraEntry['health'], string> = {
  online: 'bg-emerald-500',
  offline: 'bg-red-500',
  unknown: 'bg-slate-400 dark:bg-slate-500',
};

const HEALTH_BADGE_CLASS: Record<CftvCameraEntry['health'], string> = {
  online:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400',
  offline:
    'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400',
  unknown:
    'border-border bg-muted/60 text-muted-foreground',
};

/** Barra segmentada online/offline/sem dados do cabeçalho. */
function HealthBar({ kpi, t }: { kpi: CftvKpi; t: (s: string) => string }) {
  if (kpi.total === 0) return null;
  const segs = [
    { n: kpi.online, cls: 'bg-emerald-500', label: `${kpi.online} ${t('Online')}` },
    { n: kpi.offline, cls: 'bg-red-500', label: `${kpi.offline} ${t('Offline')}` },
    {
      n: kpi.unknown,
      cls: 'bg-slate-300 dark:bg-slate-600',
      label: `${kpi.unknown} ${t('Sem dados')}`,
    },
  ].filter((s) => s.n > 0);
  return (
    <div
      className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="img"
      aria-label={segs.map((s) => s.label).join(', ')}
    >
      {segs.map((s, i) => (
        <div
          key={i}
          className={`${s.cls} h-full`}
          style={{ width: `${(s.n / kpi.total) * 100}%` }}
          title={s.label}
        />
      ))}
    </div>
  );
}

/** Mini-barra de percentual (CPU/memória) com cor por faixa de uso. */
function PctBar({ pct }: { pct: number }) {
  const cls =
    pct >= 90 ? 'bg-red-500' : pct >= 75 ? 'bg-amber-500' : 'bg-cyan-500';
  return (
    <span className="inline-block h-1 w-10 overflow-hidden rounded-full bg-muted align-middle">
      <span className={`block h-full rounded-full ${cls}`} style={{ width: `${pct}%` }} />
    </span>
  );
}

/**
 * "CFTV Status": resumo visual de saúde (barra segmentada + X/Y online) e,
 * com poucas câmeras (≤3), tiles ricos com métricas (latência, uptime,
 * CPU/memória quando existirem); com muitas, lista densa priorizando as com
 * problema. Leituras sem dado/não confiáveis aparecem como "—" ou "Sem dados"
 * — nunca números inventados.
 */
export function CftvStatusCard({ kpi }: CftvStatusCardProps) {
  const t = useT();
  if (!kpi) return null;
  const problems = kpi.total - kpi.online;

  const healthLabel = (h: CftvCameraEntry['health']) =>
    h === 'online' ? t('Online') : h === 'offline' ? t('Offline') : t('Sem dados');

  const seeCameras = (
    <Link
      href="/cftv"
      className="mt-3 block w-full rounded-md border border-border bg-muted/40 py-1.5 text-center text-xs font-medium text-foreground transition-colors hover:bg-muted"
    >
      {t('Ver Câmeras')}
    </Link>
  );

  // Escopo sem câmeras (site sem câmeras em tenant que tem CFTV).
  if (kpi.total === 0) {
    return (
      <div className="flex flex-col rounded-lg border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
          <Camera size={15} strokeWidth={1.5} className="text-cyan-600" /> {t('CFTV Status')}
        </h2>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-6 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <VideoOff size={18} strokeWidth={1.5} className="text-muted-foreground" />
          </span>
          <p className="text-xs text-muted-foreground">
            {t('Nenhuma câmera neste escopo')}
          </p>
        </div>
        {seeCameras}
      </div>
    );
  }

  const uptimeCell = (cam: CftvCameraEntry) =>
    cam.uptime ? `${cam.uptime}${cam.uptimeEstimated ? '*' : ''}` : '—';

  return (
    <div className="flex flex-col rounded-lg border border-border bg-card p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Camera size={15} strokeWidth={1.5} className="text-cyan-600" /> {t('CFTV Status')}
        </h2>
        <span className="flex items-center gap-2">
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700 tabular-nums dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400">
            {kpi.online}/{kpi.total} {t('online')}
          </span>
          {problems > 0 && (
            <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-700 tabular-nums dark:border-red-900 dark:bg-red-950 dark:text-red-400">
              {problems} {t('c/ problema')}
            </span>
          )}
        </span>
      </div>

      <div className="mb-3">
        <HealthBar kpi={kpi} t={t} />
      </div>

      {kpi.cameras.length <= MAX_TILES ? (
        // ── Poucas câmeras: tiles ricos com métricas ──
        <div className="flex flex-1 flex-col gap-2">
          {kpi.cameras.map((cam) => (
            <div
              key={cam.id}
              className="flex flex-1 flex-col justify-center rounded-md border border-border/70 bg-muted/20 p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div
                    className="truncate text-xs font-medium text-foreground"
                    title={cam.name}
                  >
                    {cam.name}
                  </div>
                  {kpi.multiSite && (
                    <div
                      className="truncate text-[11px] text-muted-foreground"
                      title={cam.site}
                    >
                      {cam.site}
                    </div>
                  )}
                </div>
                <span
                  className={`flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${HEALTH_BADGE_CLASS[cam.health]}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${DOT_CLASS[cam.health]}`} />
                  {healthLabel(cam.health)}
                </span>
              </div>

              {cam.health === 'online' && (
                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px] tabular-nums text-muted-foreground">
                  <span className="flex items-center gap-1.5" title={t('Latência')}>
                    <Gauge size={12} strokeWidth={1.5} className="shrink-0 text-cyan-600" />
                    {cam.latency ?? '—'}
                  </span>
                  <span
                    className="flex items-center gap-1.5"
                    title={cam.uptimeEstimated ? t(ESTIMATED_UPTIME_HINT) : t('Tempo ligada')}
                  >
                    <Timer size={12} strokeWidth={1.5} className="shrink-0 text-cyan-600" />
                    {uptimeCell(cam)}
                  </span>
                  {cam.cpu !== null && (
                    <span className="flex items-center gap-1.5" title={t('CPU')}>
                      <Cpu size={12} strokeWidth={1.5} className="shrink-0 text-cyan-600" />
                      {cam.cpu}
                      {cam.cpuPct !== null && <PctBar pct={cam.cpuPct} />}
                    </span>
                  )}
                  {cam.memory !== null && (
                    <span className="flex items-center gap-1.5" title={t('Memória')}>
                      <MemoryStick
                        size={12}
                        strokeWidth={1.5}
                        className="shrink-0 text-cyan-600"
                      />
                      {cam.memory}
                      {cam.memoryPct !== null && <PctBar pct={cam.memoryPct} />}
                    </span>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        // ── Muitas câmeras: lista densa, problemas primeiro ──
        <>
          <ul className="flex-1 divide-y divide-border/60">
            {kpi.cameras.slice(0, MAX_ROWS).map((cam) => (
              <li key={cam.id} className="flex items-center gap-2 py-1.5 first:pt-0 last:pb-0">
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${DOT_CLASS[cam.health]}`}
                  title={healthLabel(cam.health)}
                />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium text-foreground" title={cam.name}>
                    {cam.name}
                  </div>
                  {kpi.multiSite && (
                    <div className="truncate text-[11px] text-muted-foreground" title={cam.site}>
                      {cam.site}
                    </div>
                  )}
                </div>
                {cam.health === 'online' ? (
                  <div className="flex shrink-0 items-center gap-3 text-[11px] tabular-nums text-muted-foreground">
                    <span title={t('Latência')}>{cam.latency ?? '—'}</span>
                    <span
                      title={cam.uptimeEstimated ? t(ESTIMATED_UPTIME_HINT) : t('Tempo ligada')}
                    >
                      {uptimeCell(cam)}
                    </span>
                  </div>
                ) : (
                  <span
                    className={`shrink-0 text-[11px] font-medium ${
                      cam.health === 'offline'
                        ? 'text-red-600 dark:text-red-400'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {healthLabel(cam.health)}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {kpi.cameras.length > MAX_ROWS && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              +{kpi.cameras.length - MAX_ROWS} {t('câmeras')}
            </p>
          )}
        </>
      )}

      {seeCameras}
    </div>
  );
}
