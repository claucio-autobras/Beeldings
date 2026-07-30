'use client';

import Link from 'next/link';
import { AlertTriangle, Clock, CheckCircle2, Activity } from 'lucide-react';
import { useT } from '@/lib/i18n';

interface OperationalSummaryCardProps {
  /** Alarmes ativos de severidade alta AGORA. */
  criticalActive: number;
  /** Normalizados aguardando reconhecimento AGORA. */
  pendingAck: number;
  /** Alarmes normalizados (resolvidos) no período selecionado; null enquanto carrega. */
  resolvedInPeriod: number | null;
  periodLabel: string;
  /** Dispositivos online/total do escopo, para a disponibilidade. */
  devicesOnline: number;
  devicesTotal: number;
}

/**
 * "Resumo Operacional" (visão Cliente): críticos ativos, aguardando ACK,
 * resolvidos no período e disponibilidade (dispositivos online/total).
 */
export function OperationalSummaryCard({
  criticalActive,
  pendingAck,
  resolvedInPeriod,
  periodLabel,
  devicesOnline,
  devicesTotal,
}: OperationalSummaryCardProps) {
  const t = useT();
  const availability =
    devicesTotal > 0 ? Math.round((devicesOnline / devicesTotal) * 1000) / 10 : null;

  const rowCls =
    'flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3 transition-colors hover:bg-muted/60';

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-border/60 p-4 pb-3">
        <h2 className="text-sm font-medium text-foreground">{t('Resumo Operacional')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('Visão geral do período')}</p>
      </div>
      <div className="space-y-3 p-4">
        <Link href="/alarms?severity=HIGH&state=open" className={rowCls}>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <AlertTriangle size={15} className="text-red-500" /> {t('Alarmes críticos ativos')}
          </span>
          <span className="text-sm font-medium tabular-nums text-foreground">{criticalActive}</span>
        </Link>
        <Link href="/alarms?state=NORMALIZED_UNACK" className={rowCls}>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock size={15} className="text-orange-500" /> {t('Aguardando ACK')}
          </span>
          <span className="text-sm font-medium tabular-nums text-foreground">{pendingAck}</span>
        </Link>
        <div className={rowCls}>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 size={15} className="text-emerald-500" /> {t('Resolvidos')} ({periodLabel})
          </span>
          <span className="text-sm font-medium tabular-nums text-foreground">
            {resolvedInPeriod === null ? '—' : resolvedInPeriod}
          </span>
        </div>
        <div className={rowCls} title={t('Dispositivos online / total do escopo')}>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Activity size={15} className="text-cyan-500" /> {t('Disponibilidade')}
          </span>
          <span
            className={`text-sm font-medium tabular-nums ${
              availability === null
                ? 'text-muted-foreground'
                : availability >= 99
                  ? 'text-emerald-600'
                  : 'text-foreground'
            }`}
          >
            {availability === null ? '—' : `${availability}%`}
          </span>
        </div>
      </div>
    </div>
  );
}
