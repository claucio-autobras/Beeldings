'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  Activity,
  AlertTriangle,
  Bell,
  Building2,
  Calendar,
  Clock,
  History,
  Loader2,
  Pencil,
  Plus,
  Repeat,
  Trash2,
  Zap,
} from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useTenantFilter } from '@/hooks/useTenantFilter';
import { useSiteFilter } from '@/hooks/useSiteFilter';
import { useSites } from '@/modules/sites/hooks/useSites';
import {
  useAutomations,
  useToggleAutomation,
  useDeleteAutomation,
} from '../hooks/useAutomations';
import { AutomationDrawer } from '../components/AutomationDrawer';
import { AutomationHistory } from '../components/AutomationHistory';
import type { Automation } from '../types/automation.types';

const DAY_ABBR = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const RESULT_META: Record<string, { label: string; cls: string }> = {
  SUCCESS: { label: 'OK', cls: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-800' },
  PARTIAL: { label: 'Parcial', cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800' },
  FAILURE: { label: 'Falhou', cls: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-800' },
};

/** Resumo de uma linha: "Contínuo · reavalia a cada Xs" ou "Agenda · HH:mm". */
function summarize(a: Automation): string {
  if (a.mode === 'CONTINUOUS') {
    return `Contínuo · reavalia a cada ${a.evalSeconds}s`;
  }
  const first = a.triggerConfig?.entries?.[0];
  if (!first) return 'Agenda';
  return `Agenda · ${first.time}${first.endTime ? `–${first.endTime}` : ''}`;
}

function siteName(a: Automation, sites: { id: string; name: string }[]): string {
  if (!a.siteId) return 'Todos os locais';
  return sites.find((s) => s.id === a.siteId)?.name ?? 'Local';
}

export default function AutomationPage() {
  const user = useCurrentUser();
  const { selectedTenantId } = useTenantFilter();
  const { selectedSiteId } = useSiteFilter();

  const isGlobal = ['ADMIN', 'CCO', 'SUPERVISOR'].includes(user.role);
  const canView = ['ADMIN', 'CCO', 'SUPERVISOR'].includes(user.role);
  const canEdit = ['ADMIN', 'CCO'].includes(user.role);

  // Tenant efetivo: global usa o seletor do topo; cliente usa o próprio.
  const tenantId = isGlobal ? selectedTenantId ?? undefined : user.tenantId ?? undefined;
  const siteId = selectedSiteId ?? undefined;

  const { data: sites = [] } = useSites(tenantId);
  const { data: automations = [], isLoading, error } = useAutomations(tenantId, siteId);
  const toggle = useToggleAutomation();
  const del = useDeleteAutomation();

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Automation | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Automation | null>(null);
  const [tab, setTab] = useState<'rules' | 'history'>('rules');
  const [historyAutomationId, setHistoryAutomationId] = useState('');

  // Deep-link do sino: /automation?tab=history&automationId=<id> abre o
  // histórico pré-filtrado na regra que gerou o aviso de falha.
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get('tab') === 'history') {
      const autoId = searchParams.get('automationId');
      if (autoId) setHistoryAutomationId(autoId);
      setTab('history');
    }
  }, [searchParams]);

  const needsTenant = isGlobal && !tenantId;

  if (!canView) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <Zap className="mb-3 h-12 w-12 text-muted-foreground/25" />
        <p className="text-sm text-muted-foreground">Você não tem acesso às automações.</p>
      </div>
    );
  }

  const openNew = () => {
    setEditing(null);
    setDrawerOpen(true);
  };
  const openEdit = (a: Automation) => {
    setEditing(a);
    setDrawerOpen(true);
  };
  const openHistoryFor = (automationId: string) => {
    setHistoryAutomationId(automationId);
    setTab('history');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-cyan-50 dark:bg-cyan-950/40">
            <Zap className="h-5 w-5 text-cyan-700 dark:text-cyan-400" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-foreground">Automações</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Regras QUANDO/SE/ENTÃO que comandam os pontos das controladoras
            </p>
          </div>
        </div>
        {canEdit && (
          <button
            onClick={openNew}
            disabled={needsTenant}
            title={needsTenant ? 'Selecione um cliente no topo' : undefined}
            className="inline-flex shrink-0 items-center gap-2 rounded-md bg-cyan-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Nova automação
          </button>
        )}
      </div>

      {needsTenant && (
        <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
          {/* Ícone em destaque com badge de prédio */}
          <div className="relative mb-5">
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-cyan-50 ring-1 ring-cyan-100 dark:bg-cyan-950/40 dark:ring-cyan-900">
              <Zap className="h-9 w-9 text-cyan-700 dark:text-cyan-400" />
            </div>
            <div className="absolute -bottom-1.5 -right-1.5 flex h-8 w-8 items-center justify-center rounded-xl border-2 border-white bg-cyan-700 shadow-sm dark:border-slate-900">
              <Building2 className="h-4 w-4 text-white" />
            </div>
          </div>

          <h2 className="text-lg font-semibold text-foreground">
            Selecione um cliente para começar
          </h2>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            As automações são organizadas por cliente. Basta escolher um no seletor
            &quot;Todos Clientes&quot; no topo para ver e criar as regras dele.
          </p>
          <div className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-cyan-200 bg-cyan-50 px-3 py-1 text-xs font-medium text-cyan-800 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-300">
            <span aria-hidden>↑</span> use o seletor no topo
          </div>

          {/* Cards de exemplo */}
          <div className="mt-10 grid w-full max-w-3xl gap-4 sm:grid-cols-3">
            {[
              {
                icon: Clock,
                title: 'Por horário',
                desc: 'Ligar a iluminação de seg a sex, das 18h às 6h.',
              },
              {
                icon: Activity,
                title: 'Por sensor',
                desc: 'Ligar o exaustor enquanto o CO passar de 25 ppm.',
              },
              {
                icon: Bell,
                title: 'Avisar a equipe',
                desc: 'Notificar o CCO quando uma bomba falhar.',
              },
            ].map(({ icon: Icon, title, desc }) => (
              <div
                key={title}
                className="rounded-xl border border-border bg-card p-4 text-left"
              >
                <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-50 dark:bg-cyan-950/40">
                  <Icon className="h-4 w-4 text-cyan-700 dark:text-cyan-400" />
                </div>
                <div className="text-sm font-medium text-foreground">{title}</div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Abas: Regras | Histórico */}
      {!needsTenant && (
        <div className="flex items-center gap-1 border-b border-border">
          <button
            onClick={() => setTab('rules')}
            className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === 'rules'
                ? 'border-cyan-700 text-cyan-700'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Zap className="h-4 w-4" /> Regras
          </button>
          <button
            onClick={() => setTab('history')}
            className={`inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              tab === 'history'
                ? 'border-cyan-700 text-cyan-700'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <History className="h-4 w-4" /> Histórico
          </button>
        </div>
      )}

      {/* Aba Histórico */}
      {!needsTenant && tab === 'history' && (
        <AutomationHistory
          tenantId={tenantId}
          siteId={siteId}
          automations={automations}
          automationId={historyAutomationId}
          onAutomationChange={setHistoryAutomationId}
        />
      )}

      {/* Error */}
      {tab === 'rules' && error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
          Erro ao carregar automações: {(error as Error).message}. Se o backend acabou de subir,
          confirme que a migração foi aplicada (<code>prisma migrate deploy</code>).
        </div>
      )}

      {/* Loading */}
      {tab === 'rules' && isLoading && !needsTenant && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted/40" />
          ))}
        </div>
      )}

      {/* Empty */}
      {tab === 'rules' && !isLoading && !error && !needsTenant && automations.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Zap className="mb-3 h-12 w-12 text-muted-foreground/25" />
          <p className="text-sm text-muted-foreground">Nenhuma automação criada ainda.</p>
        </div>
      )}

      {/* List */}
      {tab === 'rules' && !isLoading && !error && automations.length > 0 && (
        <div className="space-y-3">
          {automations.map((a) => {
            const result = a.lastRunResult ? RESULT_META[a.lastRunResult] : null;
            return (
              <div
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted/40">
                    {a.mode === 'CONTINUOUS' ? (
                      <Repeat className="h-4 w-4 text-cyan-700 dark:text-cyan-400" />
                    ) : (
                      <Calendar className="h-4 w-4 text-cyan-700 dark:text-cyan-400" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{a.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {siteName(a, sites)} · {summarize(a)}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {result && (
                    <span
                      className={`hidden rounded-full border px-2 py-0.5 text-xs font-medium sm:inline-flex ${result.cls}`}
                    >
                      {result.label}
                    </span>
                  )}
                  <button
                    onClick={() => openHistoryFor(a.id)}
                    title="Ver histórico desta automação"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-cyan-50 hover:text-cyan-700 dark:hover:bg-cyan-950/40 dark:hover:text-cyan-400"
                  >
                    <History className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() =>
                      toggle.mutate({ id: a.id, enabled: !a.enabled, tenantId })
                    }
                    disabled={!canEdit || toggle.isPending}
                    title={a.enabled ? 'Desativar' : 'Ativar'}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
                      a.enabled ? 'bg-green-500' : 'bg-slate-300 dark:bg-slate-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        a.enabled ? 'translate-x-5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                  {canEdit && (
                    <>
                      <button
                        onClick={() => openEdit(a)}
                        title="Editar"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-cyan-50 hover:text-cyan-700 dark:hover:bg-cyan-950/40 dark:hover:text-cyan-400"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setConfirmDelete(a)}
                        title="Excluir"
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Drawer create/edit */}
      {drawerOpen && tenantId && (
        <AutomationDrawer
          open={drawerOpen}
          automation={editing}
          tenantId={tenantId}
          defaultSiteId={siteId ?? null}
          onClose={() => {
            setDrawerOpen(false);
            setEditing(null);
          }}
        />
      )}

      {/* Delete confirm modal */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => {
            if (!del.isPending) setConfirmDelete(null);
          }}
        >
          <div
            className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 dark:bg-red-950/40">
                <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              </div>
              <h2 className="text-sm font-semibold text-foreground">Excluir automação?</h2>
            </div>
            <p className="text-sm text-muted-foreground">
              A automação &quot;{confirmDelete.name}&quot; será removida e deixará de comandar os
              pontos. Esta ação não pode ser desfeita.
            </p>
            {del.error && (
              <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
                {(del.error as Error).message}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                disabled={del.isPending}
                className="h-11 flex-1 rounded-lg border border-border px-4 text-sm text-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={() =>
                  del.mutate(
                    { id: confirmDelete.id, tenantId },
                    { onSuccess: () => setConfirmDelete(null) },
                  )
                }
                disabled={del.isPending}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-red-600 px-4 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
              >
                {del.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
