'use client';

import Link from 'next/link';

interface InfoKpiCardProps {
  title: string;
  /** Parcela em destaque (ex.: online/ativos). */
  value: number;
  /** Total do universo (barra de proporção value/total). */
  total: number;
  icon: React.ReactNode;
  href?: string;
  isLoading?: boolean;
}

/**
 * KPI informativo (Clientes / IOT-BMS / Câmeras / Gateways…): valor/total com
 * barra de proporção. Sem tendência — não há histórico real dessas contagens.
 */
export function InfoKpiCard({ title, value, total, icon, href, isLoading }: InfoKpiCardProps) {
  if (isLoading) {
    return (
      <div className="flex flex-col justify-between rounded-xl border border-border bg-card p-3 shadow-sm animate-pulse">
        <div className="h-4 w-4 rounded bg-muted" />
        <div className="mt-3 h-5 w-16 rounded bg-muted" />
        <div className="mt-3 h-1 rounded-full bg-muted" />
      </div>
    );
  }

  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;

  const inner = (
    <>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-cyan-600/80">{icon}</span>
      </div>
      <div>
        <h4 className="text-lg font-semibold tabular-nums text-foreground">
          {value}{' '}
          <span className="text-xs font-normal text-muted-foreground">/ {total}</span>
        </h4>
        <p className="mt-0.5 text-xs text-muted-foreground">{title}</p>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-cyan-500" style={{ width: `${pct}%` }} />
      </div>
    </>
  );

  const cls =
    'flex flex-col justify-between rounded-xl border border-border bg-card p-3 shadow-sm transition-colors';

  if (href) {
    return (
      <Link
        href={href}
        className={`${cls} hover:border-cyan-300 hover:bg-cyan-50/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500`}
      >
        {inner}
      </Link>
    );
  }
  return <div className={cls}>{inner}</div>;
}
