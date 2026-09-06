'use client';

import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Plus,
  RefreshCw,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { useT } from '@/lib/i18n';
import { useInfraspeakRequests } from '../hooks/useInfraspeakRequests';
import { InfraspeakRequestsTable } from '../components/InfraspeakRequestsTable';
import { CreateInfraspeakRequestModal } from '../components/CreateInfraspeakRequestModal';
import { PRIORITY_FILTER_OPTIONS, STATE_FILTER_OPTIONS } from '../infraspeak.labels';

type StateFilter = string | 'all';
type PriorityFilter = number | 'all';

/** Chamados exibidos por página na tabela (paginação local). */
const PAGE_SIZE = 30;

/**
 * Traduz o erro técnico da integração em uma mensagem acionável para o usuário.
 * Os casos vêm do backend: 503 (não configurada/indisponível), 401 da
 * Infraspeak (token), 429 (rate limit), 504 (timeout).
 */
function errorInfo(err: unknown): { title: string; detail: string } {
  const message = err instanceof Error ? err.message : String(err);
  if (/não configurad/i.test(message)) {
    return {
      title: 'Integração não configurada',
      detail:
        'A integração com a Infraspeak ainda não foi configurada neste servidor. Defina as variáveis de ambiente da Infraspeak e tente novamente.',
    };
  }
  if (/Infraspeak 401|autenticação inválida|token revogado/i.test(message)) {
    return {
      title: 'Falha de autenticação na Infraspeak',
      detail:
        'A Infraspeak recusou o token de acesso (inválido, expirado ou revogado). Verifique o token configurado no servidor.',
    };
  }
  if (err instanceof ApiError && /rate limit/i.test(message)) {
    return {
      title: 'Limite de requisições atingido',
      detail:
        'A Infraspeak limitou temporariamente as consultas (rate limit). Aguarde alguns instantes e tente novamente.',
    };
  }
  if (/timeout/i.test(message)) {
    return {
      title: 'Infraspeak demorou para responder',
      detail: 'A consulta excedeu o tempo limite. Tente novamente em instantes.',
    };
  }
  return {
    title: 'Não foi possível carregar os chamados',
    detail: message,
  };
}

export default function InfraspeakPage() {
  const t = useT();
  const [stateFilter, setStateFilter] = useState<StateFilter>('all');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [page, setPage] = useState(1);

  const { data, dataUpdatedAt, isLoading, isFetching, error, refetch } = useInfraspeakRequests({
    state: stateFilter === 'all' ? undefined : stateFilter,
    priority: priorityFilter === 'all' ? undefined : priorityFilter,
  });

  const items = useMemo(() => data?.data ?? [], [data]);

  // Paginação local: a lista completa já vem do backend; aqui só fatiamos a
  // exibição. Os cartões de resumo continuam calculados sobre o total.
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageItems = useMemo(
    () => items.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [items, currentPage],
  );

  const openCount = items.filter((i) => !i.completedDate && !i.solved).length;
  // "SLA vencido" comparado ao instante da última atualização dos dados
  // (dataUpdatedAt): valor estável entre renders, atualizado a cada refetch.
  const overdueCount = items.filter((i) => {
    if (!i.nextSlaDate || i.completedDate || i.solved) return false;
    const d = new Date(i.nextSlaDate.replace(' ', 'T'));
    return !Number.isNaN(d.getTime()) && d.getTime() < dataUpdatedAt;
  }).length;

  const cards = [
    { label: t('Total'), value: data?.total ?? 0, icon: ClipboardList, cls: 'text-foreground' },
    { label: t('Em aberto'), value: openCount, icon: Wrench, cls: 'text-amber-600' },
    { label: t('SLA vencido'), value: overdueCount, icon: Clock, cls: 'text-red-600' },
    {
      label: t('Concluídos'),
      value: items.length - openCount,
      icon: CheckCircle2,
      cls: 'text-emerald-600',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{t('Chamados (Infraspeak)')}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t('Chamados de manutenção sincronizados da Infraspeak')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
          >
            <RefreshCw size={13} className={isFetching ? 'animate-spin' : undefined} />
            {t('Atualizar')}
          </button>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus size={13} />
            {t('Abrir chamado')}
          </button>
        </div>
      </div>

      {showCreateModal && (
        <CreateInfraspeakRequestModal
          onClose={() => setShowCreateModal(false)}
          onCreated={() => void refetch()}
        />
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-border bg-card p-4">
            <div className="flex items-center gap-2">
              <c.icon size={16} className={c.cls} strokeWidth={2} />
              <span className="text-xs font-medium text-muted-foreground">{c.label}</span>
            </div>
            <p className={`mt-1 text-2xl font-semibold ${c.cls}`}>{error ? '—' : c.value}</p>
          </div>
        ))}
      </div>

      {/* Filtros — repassados como JQL (s_state / s_priority) à Infraspeak */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t('Estado:')}</span>
          <button
            type="button"
            onClick={() => {
              setStateFilter('all');
              setPage(1);
            }}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
              stateFilter === 'all'
                ? 'border-cyan-600 bg-cyan-50 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-400'
                : 'border-border text-muted-foreground hover:bg-muted/50'
            }`}
          >
            {t('Todos')}
          </button>
          {STATE_FILTER_OPTIONS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => {
                setStateFilter(f.value);
                setPage(1);
              }}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                stateFilter === f.value
                  ? 'border-cyan-600 bg-cyan-50 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-400'
                  : 'border-border text-muted-foreground hover:bg-muted/50'
              }`}
            >
              {t(f.label)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">{t('Prioridade:')}</span>
          <button
            type="button"
            onClick={() => {
              setPriorityFilter('all');
              setPage(1);
            }}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
              priorityFilter === 'all'
                ? 'border-cyan-600 bg-cyan-50 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-400'
                : 'border-border text-muted-foreground hover:bg-muted/50'
            }`}
          >
            {t('Todas')}
          </button>
          {PRIORITY_FILTER_OPTIONS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => {
                setPriorityFilter(f.value);
                setPage(1);
              }}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                priorityFilter === f.value
                  ? 'border-cyan-600 bg-cyan-50 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-400'
                  : 'border-border text-muted-foreground hover:bg-muted/50'
              }`}
            >
              {t(f.label)}
            </button>
          ))}
        </div>
      </div>

      {/* Conteúdo */}
      {error ? (
        (() => {
          const info = errorInfo(error);
          return (
            <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10">
              <TriangleAlert size={18} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
              <div>
                <p className="text-sm font-semibold text-red-700 dark:text-red-400">{t(info.title)}</p>
                <p className="mt-0.5 text-sm text-red-700/80 dark:text-red-400/80">{t(info.detail)}</p>
                <button
                  type="button"
                  onClick={() => void refetch()}
                  className="mt-2 rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 transition-colors hover:bg-red-100 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10"
                >
                  {t('Tentar novamente')}
                </button>
              </div>
            </div>
          );
        })()
      ) : isLoading ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {t('Consultando chamados na Infraspeak…')}
        </div>
      ) : (
        <>
          <InfraspeakRequestsTable items={pageItems} />
          {items.length > PAGE_SIZE && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {t('Mostrando')} {(currentPage - 1) * PAGE_SIZE + 1}–
                {Math.min(currentPage * PAGE_SIZE, items.length)} {t('de')} {items.length}{' '}
                {t('chamados')}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage <= 1}
                  className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft size={13} />
                  {t('Anterior')}
                </button>
                <span className="text-xs font-medium text-muted-foreground">
                  {t('Página')} {currentPage} {t('de')} {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage >= totalPages}
                  className="flex items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {t('Próxima')}
                  <ChevronRight size={13} />
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
