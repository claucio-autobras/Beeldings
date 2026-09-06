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
      <div className="chamfer bg-border p-px animate-pulse">
        <div className="chamfer-in flex min-h-full flex-col justify-between overflow-hidden bg-card p-3">
          <div className="h-4 w-4 rounded bg-muted" />
          <div className="mt-3 h-5 w-16 rounded bg-muted" />
          <div className="mt-3 h-1 rounded-full bg-muted" />
        </div>
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

  const frameCls =
    'chamfer chamfer-clickable group bg-border p-px';
  const contentCls =
    'chamfer-in chamfer-hover-content flex flex-col justify-between overflow-hidden bg-card p-3';

  if (href) {
    return (
      <div className={frameCls}>
        <Link
          href={href}
          className={`${contentCls} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500`}
        >
          {inner}
        </Link>
      </div>
    );
  }
  return (
    <div className="chamfer bg-border p-px">
      <div className={contentCls}>{inner}</div>
    </div>
  );
}
