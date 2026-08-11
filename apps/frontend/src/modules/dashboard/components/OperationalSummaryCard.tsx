'use client';

import Link from 'next/link';
import { AlertTriangle, Clock, CheckCircle2, Activity } from 'lucide-react';
import { useT } from '@/lib/i18n';
import type { OverviewAvailability } from '../services/dashboard.service';

interface OperationalSummaryCardProps {
  /** Alarmes ativos de severidade alta AGORA. */
  criticalActive: number;
  /** Normalizados aguardando reconhecimento AGORA. */
  pendingAck: number;
  /** Alarmes normalizados (resolvidos) no período selecionado; null enquanto carrega. */
  resolvedInPeriod: number | null;
  periodLabel: string;
  /**
   * Disponibilidade REAL do período (mesma base do relatório de
   * disponibilidade — status_events); undefined enquanto carrega, avgUptimePct
   * null = sem cobertura de dados ("Sem dados", nunca 0%/100% fake).
   */
  availability: OverviewAvailability | null | undefined;
}

/**
 * "Resumo Operacional" (visão Cliente): críticos ativos, aguardando ACK,
 * resolvidos no período e disponibilidade real do período.
 */
export function OperationalSummaryCard({
  criticalActive,
  pendingAck,
  resolvedInPeriod,
  periodLabel,
  availability,
}: OperationalSummaryCardProps) {
  const t = useT();
  const availabilityPct = availability?.avgUptimePct ?? null;
  const availabilityLoading = availability === undefined;

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
        <div
          className={rowCls}
          title={t('Disponibilidade média dos equipamentos no período (mesma base do relatório de disponibilidade)')}
        >
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <Activity size={15} className="text-cyan-500" /> {t('Disponibilidade')} ({periodLabel})
          </span>
          <span
            className={`text-sm font-medium tabular-nums ${
              availabilityLoading || availabilityPct === null
                ? 'text-muted-foreground'
                : availabilityPct >= 99
                  ? 'text-emerald-600'
                  : 'text-foreground'
            }`}
          >
            {availabilityLoading
              ? '—'
              : availabilityPct === null
                ? t('Sem dados')
                : `${availabilityPct}%`}
          </span>
        </div>
      </div>
    </div>
  );
}
