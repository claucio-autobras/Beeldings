'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Bell, CheckCircle2, Clock, TriangleAlert } from 'lucide-react';
import {
  useAcknowledgeAlarmEvent,
  useAcknowledgeAlarmEvents,
  useAlarmEventStats,
  useAlarmEvents,
} from '../hooks/useAlarmEvents';
import { AlarmEventsTable } from '../components/AlarmEventsTable';
import type { AlarmEventState, AlarmSeverity } from '../services/alarms-api.service';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useTenantFilter } from '@/hooks/useTenantFilter';
import { useSiteFilter } from '@/hooks/useSiteFilter';
import { useT } from '@/lib/i18n';
import { Hex } from '@/components/ui/Hex';

type SeverityFilter = AlarmSeverity | 'all';
type StateFilter = AlarmEventState | 'open' | 'all';

const SEVERITY_FILTERS: { value: SeverityFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'HIGH', label: 'Alta' },
  { value: 'MEDIUM', label: 'Média' },
  { value: 'LOW', label: 'Baixa' },
];

const STATE_FILTERS: { value: StateFilter; label: string }[] = [
  { value: 'open', label: 'Ativos' },
  { value: 'all', label: 'Todos' },
  { value: 'NORMALIZED_UNACK', label: 'Aguardando ACK' },
  { value: 'NORMALIZED_ACK', label: 'Normalizados' },
];

export default function AlarmsPage() {
  const t = useT();
  const user = useCurrentUser();
  const isAdmin = user.role === 'ADMIN' || user.role === 'CCO' || user.role === 'SUPERVISOR';
  const { selectedTenantId } = useTenantFilter();
  const { selectedSiteId } = useSiteFilter();
  const searchParams = useSearchParams();
  const highlightId = searchParams.get('highlight') ?? undefined;
  // Permite aterrissar já filtrado por severidade (ex.: cliques nos cards de
  // "Prioridade dos alarmes" do Dashboard → /alarms?severity=HIGH).
  const severityParam = searchParams.get('severity');
  const initialSeverity: SeverityFilter =
    severityParam === 'HIGH' || severityParam === 'MEDIUM' || severityParam === 'LOW'
      ? severityParam
      : 'all';
  // Permite aterrissar já filtrado por estado (ex.: "ver mais" do card
  // "Prioridade dos alarmes" → /alarms?state=NORMALIZED_UNACK = "Aguardando ACK").
  const stateParam = searchParams.get('state');
  // Janela de tempo do deep-link (ex.: pico de alarmes no Dashboard →
  // /alarms?from=...&to=...). Recorta a lista pela janela investigada.
  const fromParam = searchParams.get('from');
  const toParam = searchParams.get('to');
  const fromDate = fromParam ? new Date(fromParam) : undefined;
  const toDate = toParam ? new Date(toParam) : undefined;
  const hasWindow =
    !!fromDate && !Number.isNaN(fromDate.getTime()) && !!toDate && !Number.isNaN(toDate.getTime());
  const initialState: StateFilter =
    stateParam === 'NORMALIZED_UNACK' ||
    stateParam === 'NORMALIZED_ACK' ||
    stateParam === 'all' ||
    stateParam === 'open'
      ? stateParam
      : // Ao aterrissar por uma janela de tempo, mostra todos os estados: o pico
        // é histórico e muitos alarmes já podem ter normalizado.
        hasWindow
        ? 'all'
        : 'open';

  const effectiveTenantId = isAdmin ? selectedTenantId ?? undefined : user.tenantId ?? undefined;
  // Site só escopa quando há um tenant efetivo (admin precisa ter escolhido um cliente).
  const effectiveSiteId = effectiveTenantId ? selectedSiteId ?? undefined : undefined;
  const showTenantColumn = isAdmin;
  const showSiteColumn = isAdmin;

  const [severity, setSeverity] = useState<SeverityFilter>(initialSeverity);
  const [stateFilter, setStateFilter] = useState<StateFilter>(initialState);

  // O realtime de alarmes é assinado globalmente no Topbar (uma única conexão).

  const filters = {
    tenantId: effectiveTenantId,
    siteId: effectiveSiteId,
    severity: severity === 'all' ? undefined : severity,
    open: stateFilter === 'open' ? true : undefined,
    state: stateFilter === 'open' || stateFilter === 'all' ? undefined : stateFilter,
    from: hasWindow ? fromDate : undefined,
    to: hasWindow ? toDate : undefined,
  };

  const { data: events, isLoading, error } = useAlarmEvents(filters);
  const { data: stats } = useAlarmEventStats(effectiveTenantId, effectiveSiteId);
  const { mutate: acknowledge, isPending, variables } = useAcknowledgeAlarmEvent();
  const { mutateAsync: acknowledgeMany, isPending: bulkPending } = useAcknowledgeAlarmEvents();

  const acknowledgingId = isPending ? variables?.eventId ?? null : null;

  const cards = [
    { label: t('Total'), value: stats?.total ?? 0, icon: Bell, cls: 'text-foreground', accent: 'bg-slate-400 dark:bg-slate-500' },
    { label: t('Ativos'), value: stats?.active ?? 0, icon: TriangleAlert, cls: 'text-red-600 dark:text-red-300', accent: 'bg-red-600 dark:bg-red-400' },
    { label: t('Aguardando ACK'), value: stats?.pendingAck ?? 0, icon: Clock, cls: 'text-amber-600 dark:text-amber-300', accent: 'bg-amber-500 dark:bg-amber-400' },
    { label: t('Reconhecidos'), value: stats?.acknowledged ?? 0, icon: CheckCircle2, cls: 'text-emerald-600 dark:text-emerald-300', accent: 'bg-emerald-600 dark:bg-emerald-400' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{t('Alarmes')}</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">{t('Ocorrências em tempo real — atualização automática')}</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {cards.map((c) => (
          <div
            key={c.label}
            className="relative overflow-hidden rounded-xl border border-border bg-card p-4 shadow-sm dark:border-[#30415f]"
          >
            <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${c.accent}`} />
            <div className="flex items-center gap-2">
              <Hex size="md" className={`${
                c.label === t('Ativos') ? 'bg-red-100' :
                c.label === t('Aguardando ACK') ? 'bg-amber-100' :
                c.label === t('Reconhecidos') ? 'bg-emerald-100' : 'bg-slate-100'
              } ${c.cls}`}>
                <c.icon size={16} strokeWidth={2} />
              </Hex>
              <span className="text-xs font-medium text-muted-foreground">{c.label}</span>
            </div>
            <p className={`mt-1 text-2xl font-semibold ${c.cls}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-3 shadow-sm dark:border-[#30415f]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold text-slate-600 dark:text-[#cbd5e1]">{t('Estado:')}</span>
          {STATE_FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => setStateFilter(f.value)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                stateFilter === f.value
                  ? 'border-cyan-600 bg-cyan-600 text-white dark:border-cyan-300 dark:bg-[#0e7490] dark:text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-[#52698f] dark:bg-[#1b2740] dark:text-[#d7e1ef] dark:hover:bg-[#24334f]'
              }`}
            >
              {t(f.label)}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-semibold text-slate-600 dark:text-[#cbd5e1]">{t('Prioridade:')}</span>
          {SEVERITY_FILTERS.map((f) => (
            <button 
              key={f.value}
              type="button"
              onClick={() => setSeverity(f.value)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                severity === f.value
                  ? 'border-cyan-600 bg-cyan-600 text-white dark:border-cyan-300 dark:bg-[#0e7490] dark:text-white'
                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-[#52698f] dark:bg-[#1b2740] dark:text-[#d7e1ef] dark:hover:bg-[#24334f]'
              }`}
            >
              {t(f.label)}
            </button>
          ))}
        </div>
      </div>

      {/* Tabela */}
      {isLoading ? (
        <div className="overflow-hidden rounded-lg border border-border">
          <div className="h-10 w-full animate-pulse bg-muted" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex animate-pulse items-center gap-4 border-t border-border px-4 py-3">
              <div className="h-5 w-14 rounded bg-muted" />
              <div className="h-4 flex-1 rounded bg-muted" />
              <div className="hidden h-4 w-20 rounded bg-muted sm:block" />
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-red-200 bg-red-50 py-12 text-center dark:border-red-500/50 dark:bg-[#331318]">
          <Bell size={32} strokeWidth={1.5} className="mb-3 text-red-400 dark:text-red-300" />
          <p className="text-sm font-medium text-red-600 dark:text-[#fecaca]">{t('Falha ao carregar alarmes')}</p>
          <p className="mt-1 text-xs text-red-400 dark:text-red-300">{error instanceof Error ? error.message : t('Erro desconhecido')}</p>
        </div>
      ) : (
        <AlarmEventsTable
          events={events ?? []}
          onAcknowledge={(eventId, note) => acknowledge({ eventId, userId: user.id, note })}
          onAcknowledgeMany={(ids, note) => acknowledgeMany({ ids, note })}
          acknowledgingId={acknowledgingId}
          bulkPending={bulkPending}
          showTenantColumn={showTenantColumn}
          showSiteColumn={showSiteColumn}
          highlightId={highlightId}
        />
      )}
    </div>
  );
}
