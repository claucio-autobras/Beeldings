'use client';

import { useRouter } from 'next/navigation';
import { Flame, CheckCircle2 } from 'lucide-react';
import { useT, getCurrentLanguage } from '@/lib/i18n';
import type { TopOffenderEntry } from '../services/dashboard.service';

/** Severidade → cor do ponto (mesma paleta dos demais cards). */
const SEVERITY_DOT: Record<TopOffenderEntry['severity'], string> = {
  HIGH: 'bg-red-500',
  MEDIUM: 'bg-orange-500',
  LOW: 'bg-cyan-600',
};

interface TopOffendersCardProps {
  offenders: TopOffenderEntry[] | null | undefined;
  /** Janela do período (ISO) para o deep-link da tela de alarmes. */
  from?: string;
  to?: string;
  periodLabel: string;
  isLoading?: boolean;
}

/**
 * "Top ofensores" (visão Cliente): equipamentos/regras com mais ativações de
 * alarme no período selecionado. Clicar numa linha abre a tela de Alarmes já
 * recortada à janela do período, com o evento mais recente da regra destacado.
 */
export function TopOffendersCard({ offenders, from, to, periodLabel, isLoading }: TopOffendersCardProps) {
  const t = useT();
  const router = useRouter();
  const rows = offenders ?? [];
  const isEn = getCurrentLanguage() === 'en';

  const openOffender = (o: TopOffenderEntry) => {
    const qs = new URLSearchParams();
    if (from) qs.set('from', from);
    if (to) qs.set('to', to);
    qs.set('highlight', o.lastEventId);
    router.push(`/alarms?${qs.toString()}`);
  };

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-border/60 p-4 pb-3">
        <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Flame size={15} strokeWidth={1.5} className="text-orange-500" />
          {t('Top ofensores')} ({periodLabel})
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {t('Equipamentos e regras que mais alarmaram no período')}
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-2 p-3 animate-pulse">
          <div className="h-10 rounded bg-muted" />
          <div className="h-10 rounded bg-muted" />
          <div className="h-10 rounded bg-muted" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 p-6 text-center">
          <CheckCircle2 size={26} strokeWidth={1.5} className="text-emerald-500" />
          <p className="text-sm font-medium text-foreground">{t('Nenhum alarme no período')}</p>
          <p className="text-xs text-muted-foreground">
            {t('Nenhum equipamento disparou alarmes na janela selecionada')}
          </p>
        </div>
      ) : (
        <div className="divide-y divide-border/60">
          {rows.map((o, i) => (
            <button
              key={o.ruleId}
              type="button"
              onClick={() => openOffender(o)}
              className="group flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-muted/50"
              title={isEn ? 'Open in the alarms screen' : 'Abrir na tela de alarmes'}
            >
              <span className="w-4 shrink-0 text-center text-xs font-semibold tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              <span className={`h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[o.severity]}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-foreground transition-colors group-hover:text-cyan-700">
                  {o.ruleName}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {o.deviceName}
                  {o.siteName ? ` · ${o.siteName}` : ''}
                </span>
              </span>
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold tabular-nums text-foreground">
                {o.count}×
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
