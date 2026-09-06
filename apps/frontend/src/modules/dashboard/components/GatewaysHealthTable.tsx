'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Server, CheckCircle2, AlertTriangle, Clock, ChevronRight, Check, Download,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useT, getCurrentLanguage } from '@/lib/i18n';
import {
  getGateways,
  compareVersions,
  type GatewayItem,
} from '@/modules/gateways/services/gateways.service';
import { DashboardPanel, DashboardSectionTitle } from './DashboardShared';
import { gatewayDetailsHref, prioritizeGateways } from './gatewaysHealthTable.logic';

// Resumo de saúde mais velho que isso é tratado como "sem dados" (mesma regra
// da tela de Gateways — heartbeat de 15s + margem).
const HEALTH_STALE_MS = 90_000;

function fmtRelative(iso: string | null | undefined, now: number | null): string {
  if (!iso || now === null) return '—';
  const en = getCurrentLanguage() === 'en';
  const diff = now - new Date(iso).getTime();
  if (diff < 60_000) return en ? 'now' : 'agora';
  const min = Math.floor(diff / 60_000);
  if (min < 60) return en ? `${min} min ago` : `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return en ? `${h} h ago` : `há ${h} h`;
  return en ? `${Math.floor(h / 24)} d ago` : `há ${Math.floor(h / 24)} d`;
}

function fmtUptime(seconds: number): string {
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86_400)}d`;
}

/** Nome do tenant para exibição, resolvido pelo chamador (id → nome). */
interface GatewaysHealthTableProps {
  /** Escopo efetivo; ausente somente na visão admin global. */
  tenantId?: string;
  /** Nomes são necessários apenas na tabela cross-tenant do admin global. */
  tenantNameById?: Map<string, string>;
  /** Clientes não têm a rota administrativa de gateways. */
  isAdminView?: boolean;
  /** Contexto já selecionado no dashboard; não altera o escopo da consulta. */
  tenantName?: string;
  siteName?: string;
}

/**
 * "Saúde dos Gateways" (visão Admin): status ao vivo, métricas do canal de
 * health (uptime, fila store-and-forward, reconexões MQTT — o canal não reporta
 * CPU/mem/disco), versão vs disponível e último contato. Health ausente ou
 * >90s vira "Sem dados" — nunca inventamos métricas.
 */
export function GatewaysHealthTable({
  tenantId,
  tenantNameById = new Map(),
  isAdminView = true,
  tenantName,
  siteName,
}: GatewaysHealthTableProps) {
  const t = useT();
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const updateNow = () => setNow(Date.now());
    updateNow();
    const timer = window.setInterval(updateNow, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const { data: gateways, isLoading } = useQuery({
    queryKey: ['gateways', tenantId ?? 'all'],
    queryFn: () => getGateways(tenantId),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const rows: GatewayItem[] = prioritizeGateways(gateways ?? []);
  const showTenantContext = isAdminView && !tenantId;
  const openGateway = (gatewayId: string) => {
    if (isAdminView) router.push(gatewayDetailsHref(gatewayId));
  };

  type HealthState = 'online' | 'unstable' | 'offline' | 'no-data';
  const getHealthState = (
    online: boolean,
    healthFresh: boolean,
    health: GatewayItem['health'],
  ): HealthState => {
    if (!online) return 'offline';
    if (!healthFresh || !health) return 'no-data';
    if (!online) return 'offline';
    if (!health.mqtt.connected || health.storeAndForward.pending > 0 || (health.mqtt.reconnectCount ?? 0) > 0) {
      return 'unstable';
    }
    return 'online';
  };

  const stateLabel: Record<HealthState, string> = {
    online: t('Online'),
    unstable: t('Instável'),
    offline: t('Offline'),
    'no-data': t('Sem dados'),
  };

  const stateMarkerClass: Record<HealthState, string> = {
    online: 'bg-emerald-500',
    unstable: 'bg-orange-400',
    offline: 'bg-red-500',
    'no-data': 'bg-muted-foreground/30',
  };

  return (
    <DashboardPanel className="p-5" accent>
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border pb-4">
        <DashboardSectionTitle
          eyebrow={t('Infraestrutura')}
          title={t('Saúde dos gateways')}
          detail={isAdminView ? t('Conectividade da malha global') : t('Conectividade do site selecionado')}
        />
        {isAdminView && (
          <Link
            href="/admin/gateways"
            className="dashboard-clickable flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-1 font-mono text-[10px] font-bold uppercase text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {t('Ver todos')} <ChevronRight size={14} />
          </Link>
        )}
      </div>

      <div data-testid="dashboard-gateway-health-scroll" className="min-h-[250px] flex-1">
        {isLoading ? (
          <div className="space-y-2 pt-4 animate-pulse">
            <div className="h-9 rounded bg-muted" />
            <div className="h-9 rounded bg-muted" />
            <div className="h-9 rounded bg-muted" />
          </div>
        ) : rows.length === 0 ? (
          <div className="flex min-h-full flex-col items-center justify-center gap-2 p-8 text-center">
            <Server size={26} strokeWidth={1.5} className="text-muted-foreground/50" />
            <p className="text-sm font-medium text-foreground">{t('Nenhum gateway cadastrado')}</p>
            <p className="text-xs text-muted-foreground">{t('Cadastre gateways na tela de Gateways')}</p>
          </div>
        ) : (
          <table className="w-full table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[28%]" />
              <col className="w-[16%]" />
              <col className="w-[23%]" />
              <col className="w-[11%]" />
              <col className="w-[10%]" />
              <col className="w-[12%]" />
            </colgroup>
            <thead className="sticky top-0 z-10 border-b border-border bg-card font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-2 py-2.5 font-medium sm:px-3">{t('Gateway')}</th>
                <th className="px-2 py-2.5 font-medium sm:px-3">{t('Status')}</th>
                <th className="px-2 py-2.5 font-medium sm:px-3">{t('Tempo ligado')}</th>
                <th className="px-2 py-2.5 text-right font-medium sm:px-3">{t('Fila S&F')}</th>
                <th className="px-2 py-2.5 text-right font-medium sm:px-3">{t('Reconexões')}</th>
                <th className="px-2 py-2.5 font-medium sm:px-3">{t('Versão')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((gw) => {
                const online = gw.status === 'online';
                const health = gw.health ?? null;
                const healthFresh =
                  !!health &&
                  now !== null &&
                  now - new Date(health.receivedAt).getTime() <= HEALTH_STALE_MS;
                const healthState = getHealthState(online, healthFresh, health);
                const uptimePercent =
                  health && typeof health.uptimePercent === 'number' &&
                  Number.isFinite(health.uptimePercent) &&
                  health.uptimePercent >= 0 && health.uptimePercent <= 100
                    ? health.uptimePercent
                    : null;
                const updateAvailable =
                  !!gw.latestVersion &&
                  !!gw.reportedVersion &&
                  compareVersions(gw.latestVersion, gw.reportedVersion) > 0;
                return (
                  <tr
                    key={gw.id}
                     className={`gateway-health-row ${isAdminView ? 'dashboard-clickable ' : ''}${
                      isAdminView
                        ? 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cyan-500'
                        : ''
                    }`}
                    onClick={() => openGateway(gw.id)}
                    onKeyDown={(event) => {
                      if (!isAdminView || (event.key !== 'Enter' && event.key !== ' ')) return;
                      event.preventDefault();
                      openGateway(gw.id);
                    }}
                    tabIndex={isAdminView ? 0 : undefined}
                    role={isAdminView ? 'link' : undefined}
                    aria-label={isAdminView ? `${t('Gateway')} ${gw.id}` : undefined}
                  >
                    <td className="min-w-0 px-2 py-2.5 sm:px-3">
                      <div className="flex min-w-0 items-start gap-1.5 font-medium text-foreground">
                        <Server size={13} className="mt-0.5 shrink-0 text-muted-foreground" />
                        <span className="min-w-0">
                          <span className="block truncate font-mono text-[13px] font-semibold sm:text-sm">{gw.id}</span>
                          <span className="block truncate text-xs font-normal text-muted-foreground">
                            {[
                              gw.tenantName ??
                                (showTenantContext
                                  ? tenantNameById.get(gw.tenantId) ?? gw.tenantId
                                  : tenantName),
                              siteName ?? gw.siteNames?.join(', '),
                            ].filter(Boolean).join(' — ') || t('Sem site/cliente')}
                          </span>
                        </span>
                      </div>
                    </td>
                    <td className="min-w-0 px-2 py-2.5 sm:px-3">
                      <div className="flex min-h-6 items-center">
                        {online ? (
                            <span className={`inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-1 text-xs ${
                              healthState === 'unstable'
                                ? 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900/60 dark:bg-orange-950/30 dark:text-orange-300'
                                : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                            }`}>
                              {healthState === 'unstable' ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
                             <span className="truncate">{healthState === 'unstable' ? t('Instável') : t('Online')}</span>
                           </span>
                         ) : (
                              <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300">
                              <AlertTriangle size={12} /> <span className="truncate">{t('Offline')}</span>
                           </span>
                         )}
                      </div>
                      <span className="mt-1 block h-3 truncate text-[11px] leading-3 text-muted-foreground" title={fmtRelative(health?.receivedAt ?? gw.lastSeen, now)}>
                       {fmtRelative(health?.receivedAt ?? gw.lastSeen, now)}
                      </span>
                    </td>
                    <td className="min-w-0 px-2 py-2.5 sm:px-3">
                      {healthFresh && health ? (
                        <div className="min-w-0">
                          <div className="flex min-h-6 min-w-0 items-center gap-1">
                            <span className="text-sm font-semibold tabular-nums text-foreground">
                              <span
                                title={uptimePercent != null
                                  ? t('Percentual de uptime informado pelo gateway')
                                  : t('Percentual de uptime não informado pelo gateway')}
                              >
                                {uptimePercent != null ? `${uptimePercent.toFixed(1)}%` : '—'}
                              </span>
                            </span>
                            <span className="truncate text-xs text-muted-foreground" title={t('Tempo ligado desde a inicialização')}>
                              {fmtUptime(health.uptimeSeconds)}
                            </span>
                          </div>
                          <div
                            className="mt-1 flex h-3 items-center gap-0.5"
                            aria-label={`${t('Estado de saúde')}: ${stateLabel[healthState]}`}
                            title={`${t('Estado de saúde')}: ${stateLabel[healthState]}`}
                          >
                            {Array.from({ length: 5 }, (_, index) => (
                              <span
                                key={index}
                                 className={`h-2.5 w-2.5 rounded-full ${stateMarkerClass[healthState]}`}
                                aria-hidden="true"
                              />
                            ))}
                          </div>
                        </div>
                      ) : (
                        <span className="inline-flex min-w-0 items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground">
                          <Clock size={12} /> <span className="truncate">{t('Sem dados')}</span>
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right sm:px-3">
                       <span className={`break-all text-sm font-semibold tabular-nums ${
                        healthFresh && health && health.storeAndForward.pending > 0
                          ? 'text-orange-600 dark:text-orange-400'
                          : 'text-foreground'
                      }`}>
                        {healthFresh && health ? health.storeAndForward.pending : '—'}
                      </span>
                    </td>
                    <td className="px-2 py-2.5 text-right sm:px-3">
                       <span className="break-all text-sm font-semibold tabular-nums text-foreground">
                        {healthFresh && health ? health.mqtt.reconnectCount ?? 0 : '—'}
                      </span>
                    </td>
                    <td className="min-w-0 px-2 py-2.5 sm:px-3">
                      {!gw.reportedVersion ? (
                         <span className="text-xs text-muted-foreground/70" title={t('Versão ausente')}>—</span>
                      ) : updateAvailable && isAdminView ? (
                        <Link
                          href="/admin/gateways"
                          onClick={(event) => event.stopPropagation()}
                            className="dashboard-clickable inline-flex max-w-full items-center gap-1 text-xs text-orange-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500"
                        >
                           <Download size={12} /> <span className="truncate font-mono">v{gw.reportedVersion}</span>
                        </Link>
                      ) : updateAvailable ? (
                         <span className="inline-flex max-w-full items-center gap-1 text-xs text-orange-600" title={`${t('Disponível')}: v${gw.latestVersion}`}>
                           <Download size={12} /> <span className="truncate font-mono">v{gw.reportedVersion}</span>
                        </span>
                      ) : (
                         <span className="inline-flex max-w-full items-center gap-1 text-xs text-muted-foreground">
                           <Check size={12} className="text-emerald-600" /> <span className="truncate font-mono">v{gw.reportedVersion}</span>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </DashboardPanel>
  );
}
