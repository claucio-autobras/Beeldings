'use client';

import { useRouter } from 'next/navigation';
import { ChevronRight, CheckCircle2 } from 'lucide-react';
import { setGlobalTenant } from '@/hooks/useTenantFilter';
import { setGlobalSite } from '@/hooks/useSiteFilter';
import { useT, getCurrentLanguage } from '@/lib/i18n';
import type { TenantRankingEntry } from '../services/dashboard.service';

interface TenantRankingCardProps {
  ranking: TenantRankingEntry[] | null;
  isLoading?: boolean;
}

/**
 * "Atenção por Cliente" (visão Admin): clientes com mais alarmes ativos e
 * dispositivos offline AGORA. Clicar escopa o filtro global de cliente e
 * permanece no dashboard (visão do cliente).
 */
export function TenantRankingCard({ ranking, isLoading }: TenantRankingCardProps) {
  const t = useT();
  const router = useRouter();
  const rows = ranking ?? [];

  const openTenant = (tenantId: string) => {
    setGlobalTenant(tenantId);
    setGlobalSite(null);
  };

  return (
    <div className="flex h-[400px] flex-col rounded-lg border border-border bg-card shadow-sm">
      <div className="border-b border-border/60 p-4 pb-3">
        <h2 className="text-sm font-medium text-foreground">{t('Atenção por Cliente')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('Clientes com mais anomalias ativas')}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? (
          <div className="space-y-2 p-3 animate-pulse">
            <div className="h-12 rounded bg-muted" />
            <div className="h-12 rounded bg-muted" />
            <div className="h-12 rounded bg-muted" />
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
          <div className="divide-y divide-border/60">
            {rows.map((t) => (
              <button
                key={t.tenantId}
                type="button"
                onClick={() => openTenant(t.tenantId)}
                className="group block w-full p-3 text-left transition-colors hover:bg-muted/50"
                title={`${getCurrentLanguage() === 'en' ? 'View dashboard of' : 'Ver dashboard de'} ${t.tenantName}`}
              >
                <div className="mb-1.5 flex items-start justify-between gap-2">
                  <h4 className="truncate text-sm font-medium text-foreground transition-colors group-hover:text-cyan-700">
                    {t.tenantName}
                  </h4>
                  <ChevronRight
                    size={15}
                    className="shrink-0 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </div>
                <div className="flex gap-4 text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                    <span className="tabular-nums font-medium text-foreground">{t.activeAlarms}</span>
                    <span className="text-muted-foreground">{getCurrentLanguage() === 'en' ? 'alarms' : 'alarmes'}</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
                    <span className="tabular-nums font-medium text-foreground">{t.offlineDevices}</span>
                    <span className="text-muted-foreground">offline</span>
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-border/60 p-3">
        <button
          type="button"
          onClick={() => router.push('/admin/clients')}
          className="w-full rounded-md border border-border py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {t('Explorar todos os clientes')}
        </button>
      </div>
    </div>
  );
}
