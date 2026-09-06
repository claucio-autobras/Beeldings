'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n';
import type { InfraspeakRequestItem } from '../services/infraspeak-api.service';
import { STATE_LABELS, PRIORITY_LABELS } from '../infraspeak.labels';
import { formatDate, isSlaOverdue, priorityBadgeClass, stateBadgeClass } from '../infraspeak.format';
import { InfraspeakRequestDetail } from './InfraspeakRequestDetail';

interface Props {
  items: InfraspeakRequestItem[];
}

export function InfraspeakRequestsTable({ items }: Props) {
  const t = useT();
  const [selected, setSelected] = useState<InfraspeakRequestItem | null>(null);

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        {t('Nenhum chamado encontrado com os filtros atuais.')}
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2.5">#</th>
              <th className="px-3 py-2.5">{t('Estado')}</th>
              <th className="px-3 py-2.5">{t('Prioridade')}</th>
              <th className="px-3 py-2.5">{t('Problema')}</th>
              <th className="px-3 py-2.5">{t('Cliente')}</th>
              <th className="px-3 py-2.5">{t('Local')}</th>
              <th className="px-3 py-2.5">{t('Aberto em')}</th>
              <th className="px-3 py-2.5">{t('Última atualização')}</th>
              <th className="px-3 py-2.5">{t('Prazo (SLA)')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const overdue = isSlaOverdue(item);
              return (
                <tr
                  key={item.uuid ?? String(item.id)}
                  onClick={() => setSelected(item)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setSelected(item);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={t('Ver detalhes do chamado') + ` #${item.id ?? ''}`}
                  className="cursor-pointer border-b border-border/60 last:border-0 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                >
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                    {item.id ?? '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${stateBadgeClass(item.state)}`}
                    >
                      {t(STATE_LABELS[item.state ?? ''] ?? item.state ?? '—')}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${priorityBadgeClass(item.priority)}`}
                    >
                      {t(PRIORITY_LABELS[item.priorityText ?? ''] ?? item.priorityText ?? '—')}
                    </span>
                  </td>
                  <td className="max-w-[22rem] px-3 py-2.5">
                    <p className="truncate font-medium text-foreground" title={item.problemName ?? undefined}>
                      {item.problemName ?? '—'}
                    </p>
                    {item.description && (
                      <p className="truncate text-xs text-muted-foreground" title={item.description}>
                        {item.description}
                      </p>
                    )}
                  </td>
                  <td className="max-w-[14rem] truncate px-3 py-2.5 text-muted-foreground" title={item.clientName ?? undefined}>
                    {item.clientName ?? '—'}
                  </td>
                  <td className="max-w-[16rem] truncate px-3 py-2.5 text-muted-foreground" title={item.localName ?? undefined}>
                    {item.localName ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                    {formatDate(item.reportDate ?? item.createdAt)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">
                    {formatDate(item.lastStatusChangeDate ?? item.updatedAt)}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-2.5 ${overdue ? 'font-medium text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}
                  >
                    {formatDate(item.nextSlaDate)}
                    {overdue && (
                      <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-700 dark:bg-red-500/15 dark:text-red-400">
                        {t('vencido')}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected && (
        <InfraspeakRequestDetail
          item={selected}
          onClose={() => setSelected(null)}
          onOpenReference={(failureId) => {
            // Abre o chamado de referência citado pela análise, se estiver na lista atual.
            const ref = items.find((i) => i.id === failureId);
            if (ref) setSelected(ref);
          }}
        />
      )}
    </>
  );
}
