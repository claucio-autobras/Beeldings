'use client';

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

// Resumo de saúde mais velho que isso é tratado como "sem dados" (mesma regra
// da tela de Gateways — heartbeat de 15s + margem).
const HEALTH_STALE_MS = 90_000;

function fmtRelative(iso?: string | null): string {
  if (!iso) return '—';
  const en = getCurrentLanguage() === 'en';
  const diff = Date.now() - new Date(iso).getTime();
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
  tenantNameById: Map<string, string>;
}

/**
 * "Saúde dos Gateways" (visão Admin): status ao vivo, métricas do canal de
 * health (uptime, fila store-and-forward, reconexões MQTT — o canal não reporta
 * CPU/mem/disco), versão vs disponível e último contato. Health ausente ou
 * >90s vira "Sem dados" — nunca inventamos métricas.
 */
export function GatewaysHealthTable({ tenantNameById }: GatewaysHealthTableProps) {
  const t = useT();
  const { data: gateways, isLoading } = useQuery({
    queryKey: ['gateways', 'all'],
    queryFn: () => getGateways(),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const rows: GatewayItem[] = gateways ?? [];

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-2 p-4 pb-2">
        <div>
          <h2 className="text-sm font-medium text-foreground">{t('Saúde dos Gateways')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('Conectividade e telemetria de saúde em tempo real')}
          </p>
        </div>
        <Link
          href="/admin/gateways"
          className="inline-flex items-center gap-0.5 text-xs font-medium text-cyan-700 transition-colors hover:text-cyan-800"
        >
          {t('Ver todos')} <ChevronRight size={14} />
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-2 p-4 animate-pulse">
          <div className="h-9 rounded bg-muted" />
          <div className="h-9 rounded bg-muted" />
          <div className="h-9 rounded bg-muted" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 p-8 text-center">
          <Server size={26} strokeWidth={1.5} className="text-muted-foreground/50" />
          <p className="text-sm font-medium text-foreground">{t('Nenhum gateway cadastrado')}</p>
          <p className="text-xs text-muted-foreground">{t('Cadastre gateways na tela de Gateways')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-y border-border bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">{t('Gateway')}</th>
                <th className="px-4 py-2.5 font-medium">{t('Status')}</th>
                <th className="px-4 py-2.5 font-medium">{t('Saúde')}</th>
                <th className="px-4 py-2.5 font-medium">{t('Versão')}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t('Último contato')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((gw) => {
                const online = gw.status === 'online';
                const health = gw.health ?? null;
                const healthFresh =
                  !!health && Date.now() - new Date(health.receivedAt).getTime() <= HEALTH_STALE_MS;
                const updateAvailable =
                  !!gw.latestVersion &&
                  !!gw.reportedVersion &&
                  compareVersions(gw.latestVersion, gw.reportedVersion) > 0;
                return (
                  <tr key={gw.id} className="transition-colors hover:bg-muted/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 font-medium text-foreground">
                        <Server size={15} className="shrink-0 text-muted-foreground" />
                        <span className="truncate">
                          {tenantNameById.get(gw.tenantId) ?? gw.tenantId}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {online ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                          <CheckCircle2 size={12} /> {t('Online')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs text-red-700">
                          <AlertTriangle size={12} /> {t('Offline')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {healthFresh && health ? (
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                          <span>
                            {t('Uptime')}{' '}
                            <span className="font-medium text-foreground">
                              {fmtUptime(health.uptimeSeconds)}
                            </span>
                          </span>
                          <span>
                            {t('Fila')}{' '}
                            <span
                              className={`font-medium ${
                                health.storeAndForward.pending > 0
                                  ? 'text-orange-600'
                                  : 'text-foreground'
                              }`}
                            >
                              {health.storeAndForward.pending}
                            </span>
                          </span>
                          <span>
                            {t('Reconexões')}{' '}
                            <span className="font-medium text-foreground">
                              {health.mqtt.reconnectCount ?? 0}
                            </span>
                          </span>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs italic text-muted-foreground/70">
                          <Clock size={12} /> {t('Sem dados')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {!gw.reportedVersion ? (
                        <span className="text-xs text-muted-foreground/70">—</span>
                      ) : updateAvailable ? (
                        <Link
                          href="/admin/gateways"
                          className="inline-flex items-center gap-1 text-xs text-orange-600 hover:underline"
                        >
                          <Download size={12} /> V{gw.latestVersion} {t('disp.')}
                        </Link>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Check size={12} className="text-emerald-600" /> {t('Atualizado')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                      {fmtRelative(health?.receivedAt ?? gw.lastSeen)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
