'use client';

import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useT } from '@/lib/i18n';
import type { InfraspeakRequestItem } from '../services/infraspeak-api.service';
import { STATE_LABELS, PRIORITY_LABELS } from '../infraspeak.labels';
import {
  formatDate,
  isSlaOverdue,
  priorityBadgeClass,
  rawNumber,
  rawString,
  stateBadgeClass,
} from '../infraspeak.format';

interface Props {
  item: InfraspeakRequestItem;
  onClose: () => void;
}

/** Formata duração em minutos (ex.: manpower_duration) como "2h 30min". */
function formatDuration(minutes: number | null): string | null {
  if (minutes === null) return null;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h ${m}min`;
}

/** Formata custo numérico como moeda BRL (valor vem sem moeda da Infraspeak). */
function formatCost(value: number | null): string | null {
  if (value === null) return null;
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function Field({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm text-foreground">{value ?? '—'}</dd>
    </div>
  );
}

/**
 * Painel de detalhes de um chamado da Infraspeak. Mostra todos os campos
 * mapeados (InfraspeakRequestItem) e campos adicionais confirmados do payload
 * bruto (SLA percentual, custos e duração de mão de obra, mensagens).
 */
export function InfraspeakRequestDetail({ item, onClose }: Props) {
  const t = useT();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const overdue = isSlaOverdue(item);
  const slaPercentage = rawNumber(item, 'next_sla_percentage');
  const manpowerCost = formatCost(rawNumber(item, 'manpower_cost'));
  const manpowerDuration = formatDuration(rawNumber(item, 'manpower_duration'));
  const messageCount = rawNumber(item, 'message_count');
  const externalId = rawString(item, 'external_id');

  const lifecycle: { label: string; value: string | null }[] = [
    { label: 'Aberto em', value: item.reportDate ?? item.createdAt },
    { label: 'Iniciado em', value: item.startedDate },
    { label: 'Pausado em', value: item.pausedDate },
    { label: 'Concluído em', value: item.completedDate },
    { label: 'Aprovado em', value: item.approvedDate },
    { label: 'Última mudança de estado', value: item.lastStatusChangeDate },
    { label: 'Atualizado em', value: item.updatedAt },
  ];

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t('Detalhes do chamado')}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-border bg-card px-5 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-muted-foreground">#{item.id ?? '—'}</span>
              <span
                className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${stateBadgeClass(item.state)}`}
              >
                {t(STATE_LABELS[item.state ?? ''] ?? item.state ?? '—')}
              </span>
              <span
                className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${priorityBadgeClass(item.priority)}`}
              >
                {t(PRIORITY_LABELS[item.priorityText ?? ''] ?? item.priorityText ?? '—')}
              </span>
              {item.solved && (
                <span className="inline-block rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400">
                  {t('Resolvido')}
                </span>
              )}
            </div>
            <h2 className="mt-1.5 text-base font-semibold text-foreground">
              {item.problemName ?? t('Chamado sem categoria')}
            </h2>
            {item.stateDescription && (
              <p className="mt-0.5 text-xs text-muted-foreground">{item.stateDescription}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Fechar')}
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {/* Descrição e observações */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('Descrição')}
            </h3>
            <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">
              {item.description ?? '—'}
            </p>
            {item.observations && (
              <>
                <h3 className="mt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('Observações')}
                </h3>
                <p className="mt-1 whitespace-pre-wrap text-sm text-foreground">{item.observations}</p>
              </>
            )}
          </section>

          {/* Cliente e local */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('Cliente e local')}
            </h3>
            <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field
                label={t('Cliente')}
                value={
                  item.clientName
                    ? `${item.clientName}${item.clientCode ? ` (${item.clientCode})` : ''}`
                    : null
                }
              />
              <Field
                label={t('Local')}
                value={
                  item.localName
                    ? `${item.localName}${item.localCode ? ` (${item.localCode})` : ''}`
                    : null
                }
              />
            </dl>
          </section>

          {/* Ciclo de vida */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('Ciclo de vida')}
            </h3>
            <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              {lifecycle.map((f) => (
                <Field key={f.label} label={t(f.label)} value={formatDate(f.value)} />
              ))}
            </dl>
          </section>

          {/* SLA */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('Prazo (SLA)')}
            </h3>
            <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field
                label={t('Data-limite')}
                value={
                  item.nextSlaDate ? (
                    <span className={overdue ? 'font-medium text-red-600 dark:text-red-400' : undefined}>
                      {formatDate(item.nextSlaDate)}
                      {overdue && (
                        <span className="ml-1.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-red-700 dark:bg-red-500/15 dark:text-red-400">
                          {t('vencido')}
                        </span>
                      )}
                    </span>
                  ) : null
                }
              />
              <Field
                label={t('SLA consumido')}
                value={
                  slaPercentage !== null ? (
                    <span className="flex items-center gap-2">
                      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                        <span
                          className={`block h-full rounded-full ${
                            slaPercentage >= 100
                              ? 'bg-red-500'
                              : slaPercentage >= 75
                                ? 'bg-amber-500'
                                : 'bg-emerald-500'
                          }`}
                          style={{ width: `${Math.min(100, Math.max(0, slaPercentage))}%` }}
                        />
                      </span>
                      {Math.round(slaPercentage)}%
                    </span>
                  ) : null
                }
              />
            </dl>
          </section>

          {/* Custos e execução */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('Custos e execução')}
            </h3>
            <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field label={t('Custo de mão de obra')} value={manpowerCost} />
              <Field label={t('Duração de mão de obra')} value={manpowerDuration} />
              <Field
                label={t('Confirmado')}
                value={item.confirmed === null ? null : item.confirmed ? t('Sim') : t('Não')}
              />
              <Field
                label={t('Mensagens')}
                value={messageCount !== null ? String(messageCount) : null}
              />
            </dl>
          </section>

          {/* Identificadores */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {t('Identificadores')}
            </h3>
            <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Field label="UUID" value={item.uuid ? <span className="font-mono text-xs">{item.uuid}</span> : null} />
              <Field
                label={t('ID externo')}
                value={externalId ? <span className="font-mono text-xs">{externalId}</span> : null}
              />
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
