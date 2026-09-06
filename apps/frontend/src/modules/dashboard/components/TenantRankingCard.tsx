'use client';

import { useRouter } from 'next/navigation';
import { CheckCircle2, ChevronRight, Users } from 'lucide-react';
import { setGlobalTenant } from '@/hooks/useTenantFilter';
import { setGlobalSite } from '@/hooks/useSiteFilter';
import { useT, getCurrentLanguage } from '@/lib/i18n';
import type { TenantRankingEntry } from '../services/dashboard.service';
import { DashboardPanel, DashboardSectionTitle } from './DashboardShared';

interface TenantRankingCardProps {
  ranking: TenantRankingEntry[] | null;
  isLoading?: boolean;
}

/**
 * "Atenção por Cliente" (visão Admin): ranking por score composto — ativos
 * críticos em falha, gateways offline, alarmes ativos, dispositivos offline e
 * backlog de reconhecimento. Os fatores que puxaram a posição aparecem como chips.
 * Clicar escopa o filtro global de cliente e permanece no dashboard.
 */
export function TenantRankingCard({ ranking, isLoading }: TenantRankingCardProps) {
  const t = useT();
  const router = useRouter();
  const rows = ranking ?? [];
  const isEn = getCurrentLanguage() === 'en';

  const openTenant = (tenantId: string, tenantName: string) => {
    setGlobalTenant(tenantId, tenantName);
    setGlobalSite(null);
  };

  const priorityBarClass = (entry: TenantRankingEntry) => {
    if (entry.criticalFaults > 0) return 'bg-rose-500';
    if (entry.activeAlarms > 0) return 'bg-orange-500';
    if (entry.offlineDevices > 0 || entry.offlineGateways > 0) return 'bg-emerald-500';
    return 'bg-cyan-500';
  };

  const offlineTotal = (entry: TenantRankingEntry) => entry.offlineDevices + entry.offlineGateways;

  return (
    <DashboardPanel className="p-5" accent>
      <DashboardSectionTitle
        eyebrow={t('Priorização global')}
        title={t('Atenção por cliente')}
        detail={t('Clientes com maior volume de ocorrências')}
        action={<Users className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />}
      />

      <div className="mt-4 grid min-h-0 flex-1 gap-2.5 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-2.5 animate-pulse">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-[62px] rounded-xl border border-border bg-muted/60" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <CheckCircle2 size={26} strokeWidth={1.5} className="text-emerald-500" />
            <p className="text-sm font-medium text-foreground">{t('Tudo em ordem')}</p>
            <p className="text-xs text-muted-foreground">
              {t('Nenhum cliente com alarmes ativos ou dispositivos offline')}
            </p>
          </div>
        ) : (
          rows.map((entry, index) => (
            <button
              key={entry.tenantId}
              type="button"
              onClick={() => openTenant(entry.tenantId, entry.tenantName)}
              className="dashboard-clickable group flex min-h-[62px] items-center gap-3 rounded-xl border border-border bg-muted/50 px-3.5 py-2.5 text-left transition-[background-color,border-color,box-shadow,transform] duration-200 hover:-translate-y-px hover:border-cyan-500/40 hover:bg-background hover:shadow-sm dark:bg-muted"
              title={`${isEn ? 'View dashboard of' : 'Ver dashboard de'} ${entry.tenantName}`}
            >
              <span
                className={`h-9 w-1 shrink-0 rounded-full ${priorityBarClass(entry)}`}
                aria-hidden="true"
              />
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="font-mono text-[10px] text-muted-foreground/70">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="truncate text-[13px] font-bold text-foreground">
                  {entry.tenantName}
                </span>
              </span>
              <span className="shrink-0 text-right font-mono">
                <b className="block text-xs font-bold leading-4 text-red-600 dark:text-red-400">
                  {entry.activeAlarms} {isEn ? 'alarms' : 'alarmes'}
                </b>
                <span className="block text-xs leading-4 text-muted-foreground">
                  {offlineTotal(entry)} {isEn ? 'offline' : 'offline'}
                </span>
              </span>
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-cyan-500" />
            </button>
          ))
        )}
      </div>

      <button
        onClick={() => router.push('/admin/clients')}
        className="dashboard-clickable mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border py-2 font-mono text-[10px] font-bold uppercase text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        {t('explorar todos os clientes')} <ChevronRight className="h-3.5 w-3.5" />
      </button>
    </DashboardPanel>
  );
}
