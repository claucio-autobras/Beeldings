'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Zap, CheckCircle2, X } from 'lucide-react';
import { useT } from '@/lib/i18n';
import type { Automation } from '@/modules/automation/types/automation.types';
import type { PendingCommand } from '../types/dashboard.types';
import { AutomationsModal } from './AutomationsModal';

interface AutomationsCardProps {
  /** Nº de automações ativas no escopo; null quando indisponível. */
  activeAutomations: number | null;
  /** Comandos recentes reais; a taxa de sucesso só aparece quando há execuções. */
  recentCommands: PendingCommand[];
  /** Admin (visão global): mostra também o cliente de cada comando. */
  showTenant?: boolean;
  /** true quando o dashboard já está filtrado por um site — não repete o site por linha. */
  hideSite?: boolean;
  isLoading?: boolean;
  /**
   * CLIENT: "Ver automações" abre um modal somente leitura em vez de navegar
   * para /automation (página que exige papel administrativo).
   */
  useModal?: boolean;
  /** Automações do escopo atual (só usadas pelo modal do cliente). */
  automations?: Automation[];
  /** Nomes dos sites para o modal exibir o local de cada automação. */
  sites?: { id: string; name: string }[];
  automationsLoading?: boolean;
}

const TZ = 'America/Sao_Paulo';
const dateFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: TZ });
const timeFmt = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });

/** "Hoje 08:44" para o dia atual; senão "19/07 08:44" (fuso de São Paulo). */
function fmtCommandTime(iso: string, todayLabel: string): string {
  const d = new Date(iso);
  const day = dateFmt.format(d);
  const time = timeFmt.format(d);
  return day === dateFmt.format(new Date()) ? `${todayLabel} ${time}` : `${day} ${time}`;
}

/**
 * "Automações & Comandos": automações ativas (real) e, quando existir histórico
 * de comandos, taxa de sucesso + últimos comandos. Sem histórico, estado vazio
 * honesto — nada de números fictícios.
 */
export function AutomationsCard({
  activeAutomations,
  recentCommands,
  showTenant = false,
  hideSite = false,
  isLoading,
  useModal = false,
  automations = [],
  sites = [],
  automationsLoading,
}: AutomationsCardProps) {
  const t = useT();
  const [modalOpen, setModalOpen] = useState(false);
  const finished = recentCommands.filter((c) => c.status === 'done' || c.status === 'failed');
  const successRate =
    finished.length > 0
      ? Math.round((finished.filter((c) => c.status === 'done').length / finished.length) * 1000) / 10
      : null;
  const recent = recentCommands.slice(0, 3);

  return (
    <div className="flex flex-col rounded-lg border border-border bg-card p-4 shadow-sm">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
        <Zap size={15} strokeWidth={1.5} className="text-cyan-600" /> {t('Automações & Comandos')}
      </h2>

      {isLoading ? (
        <div className="h-20 animate-pulse rounded-lg bg-muted" />
      ) : (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
          <div>
            <p className="text-xs text-muted-foreground">{t('Automações ativas')}</p>
            <h4 className="text-2xl font-bold tabular-nums text-foreground">
              {activeAutomations === null ? '—' : activeAutomations}
            </h4>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">{t('Taxa de sucesso')}</p>
            <h4
              className={`text-xl font-semibold tabular-nums ${
                successRate === null ? 'text-muted-foreground' : 'text-emerald-600'
              }`}
              title={successRate === null ? t('Sem execuções registradas no período') : undefined}
            >
              {successRate === null ? '—' : `${successRate}%`}
            </h4>
          </div>
        </div>
      )}

      <div className="flex-1 space-y-2">
        {recent.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">{t('Nenhum comando recente')}</p>
        ) : (
          recent.map((c) => {
            // Contexto da linha: "Cliente · Site" (admin) ou só "Site" (cliente).
            // Com o dashboard já filtrado por site, o site não é repetido.
            const parts: string[] = [];
            if (showTenant && c.tenantName) parts.push(c.tenantName);
            if (!hideSite && c.siteName) parts.push(c.siteName);
            const context = parts.join(' · ');
            return (
              <div
                key={c.id}
                className={`flex items-center justify-between rounded p-2 text-xs ${
                  c.status === 'failed'
                    ? 'border border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-400'
                    : 'bg-muted/50 text-foreground'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {c.status === 'failed' ? (
                    <X size={12} className="shrink-0" />
                  ) : (
                    <CheckCircle2 size={12} className="shrink-0 text-emerald-600" />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate" title={`${c.command} — ${c.deviceName}`}>
                      {c.command} — {c.deviceName}
                    </span>
                    {context && (
                      <span
                        className={`block truncate text-[11px] ${
                          c.status === 'failed'
                            ? 'text-red-600/80 dark:text-red-400/80'
                            : 'text-muted-foreground'
                        }`}
                        title={context}
                      >
                        {context}
                      </span>
                    )}
                  </span>
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {fmtCommandTime(c.requestedAt, t('Hoje'))}
                </span>
              </div>
            );
          })
        )}
      </div>

      {useModal ? (
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="mt-3 self-start text-xs font-medium text-cyan-700 transition-colors hover:text-cyan-800"
        >
          {t('Ver automações →')}
        </button>
      ) : (
        <Link
          href="/automation"
          className="mt-3 self-start text-xs font-medium text-cyan-700 transition-colors hover:text-cyan-800"
        >
          {t('Ver automações →')}
        </Link>
      )}

      {useModal && (
        <AutomationsModal
          open={modalOpen}
          onClose={() => setModalOpen(false)}
          automations={automations}
          sites={sites}
          isLoading={automationsLoading}
        />
      )}
    </div>
  );
}
