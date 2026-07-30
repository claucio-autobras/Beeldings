'use client';

import { useState } from 'react';
import {
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  History,
  Repeat,
  TimerOff,
} from 'lucide-react';
import { useAutomationRuns } from '../hooks/useAutomations';
import type {
  Automation,
  AutomationRun,
  AutomationRunResult,
} from '../types/automation.types';

interface Props {
  tenantId?: string;
  siteId?: string;
  automations: Automation[];
  /** Filtro inicial vindo do atalho no card ("ver histórico desta regra"). */
  automationId: string;
  onAutomationChange: (id: string) => void;
}

const PAGE_SIZE = 20;

const RESULT_META: Record<AutomationRunResult, { label: string; cls: string; dot: string }> = {
  SUCCESS: {
    label: 'Sucesso',
    cls: 'bg-green-50 text-green-700 border-green-200',
    dot: 'bg-green-500',
  },
  PARTIAL: {
    label: 'Parcial',
    cls: 'bg-amber-50 text-amber-700 border-amber-200',
    dot: 'bg-amber-500',
  },
  FAILURE: {
    label: 'Falha',
    cls: 'bg-red-50 text-red-700 border-red-200',
    dot: 'bg-red-500',
  },
};

const TRIGGER_META: Record<string, { label: string; icon: typeof Calendar }> = {
  agenda: { label: 'Agenda', icon: Calendar },
  'término': { label: 'Término', icon: TimerOff },
  enquanto: { label: 'Condição', icon: Repeat },
};

const fmt = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'short',
  timeStyle: 'medium',
  timeZone: 'America/Sao_Paulo',
});

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : fmt.format(d);
}

/** Linha do histórico; falhas expandem para mostrar o motivo por ação. */
function RunRow({ run }: { run: AutomationRun }) {
  const [open, setOpen] = useState(false);
  const meta = RESULT_META[run.result] ?? RESULT_META.FAILURE;
  const trig = TRIGGER_META[run.trigger] ?? { label: run.trigger, icon: Calendar };
  const TrigIcon = trig.icon;
  const failures = (run.details ?? []).filter((d) => d.status === 'FAILURE');
  const expandable = failures.length > 0;

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        onClick={() => expandable && setOpen((v) => !v)}
        className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left ${
          expandable ? 'cursor-pointer' : 'cursor-default'
        }`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">
              {run.automationName}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span>{formatWhen(run.startedAt)}</span>
              <span className="inline-flex items-center gap-1">
                <TrigIcon className="h-3 w-3" /> {trig.label}
              </span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${meta.cls}`}>
            {meta.label}
          </span>
          {expandable && (
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`}
            />
          )}
        </div>
      </button>
      {expandable && !open && (
        <div className="truncate border-t border-border/50 px-4 py-2 text-xs text-red-600">
          {run.errorSummary ?? failures[0]?.error}
        </div>
      )}
      {expandable && open && (
        <div className="space-y-1.5 border-t border-border/50 px-4 py-3">
          {(run.details ?? []).map((d, i) => (
            <div key={i} className="flex items-start gap-2 text-xs">
              <span
                className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                  d.status === 'FAILURE'
                    ? 'bg-red-500'
                    : d.status === 'SUCCESS'
                      ? 'bg-green-500'
                      : 'bg-slate-300'
                }`}
              />
              <span className="text-foreground">
                {d.label || (d.type === 'NOTIFY' ? 'Aviso' : 'Comando')}
                {d.status === 'FAILURE' && d.error ? (
                  <span className="text-red-600"> — {d.error}</span>
                ) : d.status === 'SKIPPED' ? (
                  <span className="text-muted-foreground"> — não executada</span>
                ) : null}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AutomationHistory({
  tenantId,
  siteId,
  automations,
  automationId,
  onAutomationChange,
}: Props) {
  const [result, setResult] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useAutomationRuns({
    tenantId,
    siteId,
    automationId: automationId || undefined,
    result: result || undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          value={automationId}
          onChange={(e) => {
            onAutomationChange(e.target.value);
            setPage(1);
          }}
          className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm sm:max-w-xs"
        >
          <option value="">Todas as automações</option>
          {automations.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select
          value={result}
          onChange={(e) => {
            setResult(e.target.value);
            setPage(1);
          }}
          className="h-10 w-full rounded-lg border border-border bg-card px-3 text-sm sm:max-w-[180px]"
        >
          <option value="">Todos os resultados</option>
          <option value="SUCCESS">Sucesso</option>
          <option value="PARTIAL">Parcial</option>
          <option value="FAILURE">Falha</option>
        </select>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Erro ao carregar o histórico: {(error as Error).message}. Se o backend acabou de subir,
          confirme que a migração foi aplicada (<code>prisma migrate deploy</code>).
        </div>
      )}

      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-muted/40" />
          ))}
        </div>
      )}

      {!isLoading && !error && (data?.items.length ?? 0) === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <History className="mb-3 h-12 w-12 text-muted-foreground/25" />
          <p className="text-sm text-muted-foreground">
            Nenhuma execução registrada ainda. As próximas execuções aparecerão aqui.
          </p>
        </div>
      )}

      {!isLoading && !error && (data?.items.length ?? 0) > 0 && (
        <>
          <div className="space-y-2">
            {data!.items.map((run) => (
              <RunRow key={run.id} run={run} />
            ))}
          </div>

          {/* Paginação */}
          <div className="flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {total} execução{total === 1 ? '' : 'ões'} · página {page} de {totalPages}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
