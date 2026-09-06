'use client';

import { X, Zap, Calendar, Repeat } from 'lucide-react';
import { useT } from '@/lib/i18n';
import type { Automation } from '@/modules/automation/types/automation.types';

interface AutomationsModalProps {
  open: boolean;
  onClose: () => void;
  automations: Automation[];
  /** Para exibir o nome do local de cada automação. */
  sites?: { id: string; name: string }[];
  isLoading?: boolean;
}

/** Resumo de uma linha: "Contínuo · reavalia a cada Xs" ou "Agenda · HH:mm". */
function summarize(a: Automation): string {
  if (a.mode === 'CONTINUOUS') {
    return `Contínuo · reavalia a cada ${a.evalSeconds}s`;
  }
  const first = a.triggerConfig?.entries?.[0];
  if (!first) return 'Agenda';
  return `Agenda · ${first.time}${first.endTime ? `–${first.endTime}` : ''}`;
}

/**
 * Modal somente leitura das automações do cliente. Sem qualquer ação de
 * criar/editar/excluir — o CLIENT só vê o que existe e se está ativa.
 */
export function AutomationsModal({
  open,
  onClose,
  automations,
  sites = [],
  isLoading,
}: AutomationsModalProps) {
  const t = useT();
  if (!open) return null;

  const siteName = (a: Automation): string => {
    if (!a.siteId) return t('Todos os locais');
    return sites.find((s) => s.id === a.siteId)?.name ?? t('Local');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('Automações do seu contrato')}
    >
      <div
        className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-50 dark:bg-cyan-950/50">
              <Zap className="h-4 w-4 text-cyan-700 dark:text-cyan-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">{t('Automações')}</h2>
              <p className="text-xs text-muted-foreground">
                {t('Regras configuradas para o seu contrato')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label={t('Fechar')}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          {isLoading ? (
            <>
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-14 animate-pulse rounded-lg bg-muted/40" />
              ))}
            </>
          ) : automations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Zap className="mb-3 h-10 w-10 text-muted-foreground/25" />
              <p className="text-sm text-muted-foreground">
                {t('Nenhuma automação configurada ainda.')}
              </p>
            </div>
          ) : (
            automations.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2.5"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/50">
                    {a.mode === 'CONTINUOUS' ? (
                      <Repeat className="h-4 w-4 text-cyan-700 dark:text-cyan-400" />
                    ) : (
                      <Calendar className="h-4 w-4 text-cyan-700 dark:text-cyan-400" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{a.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {siteName(a)} · {summarize(a)}
                    </div>
                  </div>
                </div>
                <span
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                    a.enabled
                      ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-900/50 dark:bg-green-950/40 dark:text-green-400'
                      : 'border-border bg-muted/50 text-muted-foreground'
                  }`}
                >
                  {a.enabled ? t('Ativa') : t('Inativa')}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
