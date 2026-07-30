'use client';

import Link from 'next/link';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { useT } from '@/lib/i18n';

// ─── Sparkline ────────────────────────────────────────────────────────────────

/** Mini-série do card (derivada de dados reais); omitida quando não há histórico. */
function Sparkline({ data, strokeClass }: { data: number[]; strokeClass: string }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const height = 24;
  const width = 60;
  const points = data
    .map((d, i) => {
      const x = (i / Math.max(1, data.length - 1)) * width;
      const y = height - ((d - min) / range) * height;
      return `${x},${y}`;
    })
    .join(' ');
  return (
    <svg width={width} height={height} className="overflow-visible" aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        className={strokeClass}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

export type ActionKpiStatus = 'critical' | 'warning';

interface ActionKpiCardProps {
  title: string;
  value: number;
  status: ActionKpiStatus;
  icon: React.ReactNode;
  href: string;
  /** Série real para a sparkline; omitida quando ausente/curta. */
  spark?: number[];
  /** Variação vs período anterior (ex.: "+12%"); com o sinal de tendência. */
  trend?: { label: string; isUp: boolean } | null;
  isLoading?: boolean;
}

const STATUS_STYLES: Record<ActionKpiStatus, { bar: string; icon: string; spark: string }> = {
  critical: { bar: 'bg-red-500', icon: 'bg-red-100 text-red-600', spark: 'text-red-500' },
  warning: { bar: 'bg-orange-500', icon: 'bg-orange-100 text-orange-600', spark: 'text-orange-500' },
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * KPI de ação (Alarmes Ativos / Aguard. ACK / Disp. Offline): barra de status,
 * valor grande e, quando há histórico real, sparkline + tendência vs período
 * anterior. Clique navega para a tela correspondente.
 */
export function ActionKpiCard({ title, value, status, icon, href, spark, trend, isLoading }: ActionKpiCardProps) {
  const t = useT();
  const styles = STATUS_STYLES[status];
  const showSpark = !!spark && spark.length >= 2 && spark.some((v) => v !== spark[0]);

  if (isLoading) {
    return (
      <div className="relative overflow-hidden rounded-lg border border-border bg-card p-4 shadow-sm animate-pulse">
        <div className="h-3 w-20 rounded bg-muted" />
        <div className="mt-4 h-8 w-14 rounded bg-muted" />
      </div>
    );
  }

  return (
    <Link
      href={href}
      className="group relative block overflow-hidden rounded-lg border border-border bg-card p-4 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-cyan-300 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
    >
      <span className={`absolute inset-x-0 top-0 h-1 ${styles.bar}`} aria-hidden="true" />
      <div className="mb-2 flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground xl:text-sm">{title}</p>
        <div className={`rounded-md p-1.5 ${styles.icon}`}>{icon}</div>
      </div>
      <div className="flex items-end justify-between gap-2">
        <h3 className="text-2xl font-bold tabular-nums text-foreground xl:text-3xl">{value}</h3>
        {(showSpark || trend) && (
          <div className="flex flex-col items-end">
            {showSpark && <Sparkline data={spark!} strokeClass={styles.spark} />}
            {trend && (
              <span
                className={`mt-1 flex items-center gap-0.5 text-xs font-medium ${
                  trend.isUp ? 'text-red-600' : 'text-emerald-600'
                }`}
                title={t('Variação vs período anterior')}
              >
                {trend.isUp ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                {trend.label}
              </span>
            )}
          </div>
        )}
      </div>
    </Link>
  );
}
