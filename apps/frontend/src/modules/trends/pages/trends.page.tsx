'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Loader2, RefreshCw, Search, TrendingUp } from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useTenantFilter } from '@/hooks/useTenantFilter';
import { useSiteFilter } from '@/hooks/useSiteFilter';
import { getSites, type SiteItem } from '@/modules/sites/services/sites.service';
import { getDevices, type Device } from '@/modules/devices/services/devices.service';
import {
  getTrends,
  getTrendDataBatch,
  getTrendHistory,
  type TrendItem,
  type TrendBatchResponse,
  type TrendHistoryResponse,
} from '../services/trends-api.service';
import { TrendsChart, type ChartSeries } from '../components/TrendsChart';
import { TrendsHistoryTable } from '../components/TrendsHistoryTable';
import {
  buildColorMap,
  isDigitalPoint,
  trendType,
  formatValue,
  QUICK_RANGES,
  toLocalInput,
} from '../lib/trends-utils';

const GLOBAL_ROLES = new Set(['ADMIN', 'CCO', 'SUPERVISOR']);
const REFRESH_INTERVALS = [
  { label: '5s', ms: 5000 },
  { label: '10s', ms: 10000 },
  { label: '30s', ms: 30000 },
  { label: '1min', ms: 60000 },
];

const selectCls = 'w-full rounded-md border border-border px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500';

export default function TrendsPage() {
  const user = useCurrentUser();
  const isAdmin = GLOBAL_ROLES.has(user.role);
  const { selectedTenantId } = useTenantFilter();
  const { selectedSiteId, setSite } = useSiteFilter();
  const effectiveTenantId = (isAdmin ? selectedTenantId ?? '' : user.tenantId ?? '') || '';

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  // Painel de variáveis colapsável no mobile (sempre visível no desktop ≥lg)
  const [showVarPanel, setShowVarPanel] = useState(false);
  const chartRef = useRef<HTMLDivElement>(null);

  // Filtros — o site é o filtro global (single source of truth)
  const fSite = selectedSiteId ?? '';
  const [fDevice, setFDevice] = useState('');
  const [fType, setFType] = useState<'' | 'analog' | 'digital'>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [quickRange, setQuickRange] = useState<string>('');

  // Histórico (paginação)
  const [histPage, setHistPage] = useState(1);
  const [histPageSize, setHistPageSize] = useState(50);

  // Atualização automática
  const [autoOn, setAutoOn] = useState(false);
  const [autoMs, setAutoMs] = useState(30000);
  const refetchInterval = autoOn ? autoMs : (false as const);

  const { data: trends = [], isLoading: loadingTrends } = useQuery<TrendItem[]>({
    queryKey: ['trends', 'all', effectiveTenantId],
    queryFn: () => getTrends({ tenantId: effectiveTenantId || undefined }),
  });
  const { data: sites = [] } = useQuery<SiteItem[]>({
    queryKey: ['sites', 'trends', effectiveTenantId],
    queryFn: () => getSites(effectiveTenantId || undefined),
  });
  const { data: devices = [] } = useQuery<Device[]>({
    queryKey: ['devices', 'trends', effectiveTenantId],
    queryFn: () => getDevices(effectiveTenantId || undefined),
  });
  const deviceMap = useMemo(() => new Map(devices.map((d) => [d.id, d])), [devices]);
  const deviceOptions = devices.filter((d) => !fSite || d.siteId === fSite);

  // Escopo = site/controladora/tipo (NÃO inclui a busca textual). Define quais
  // trends podem estar ativas; a seleção é restrita a esse escopo.
  const scopedTrends = useMemo(
    () =>
      trends.filter((t) => {
        const dev = t.point ? deviceMap.get(t.point.deviceId) : undefined;
        if (fSite && dev?.siteId !== fSite) return false;
        if (fDevice && t.point?.deviceId !== fDevice) return false;
        if (fType && (isDigitalPoint(t.point?.objectType) ? 'digital' : 'analog') !== fType) return false;
        return true;
      }),
    [trends, deviceMap, fSite, fDevice, fType],
  );

  // Lista exibida na sidebar = escopo + busca textual.
  const filteredTrends = useMemo(
    () =>
      scopedTrends.filter((t) => {
        if (search && !`${t.name} ${t.point?.tag ?? ''} ${t.point?.objectName ?? ''}`.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      }),
    [scopedTrends, search],
  );

  // Ao mudar o escopo (site/controladora/tipo), descarta seleções fora do escopo.
  useEffect(() => {
    const scopedIds = new Set(scopedTrends.map((t) => t.id));
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (scopedIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [scopedTrends]);

  // Ordem estável de seleção (segue a ordem do escopo/sidebar) → cores consistentes
  const selectedOrdered = useMemo(
    () => scopedTrends.filter((t) => selectedIds.has(t.id)).map((t) => t.id),
    [scopedTrends, selectedIds],
  );
  const colorById = useMemo(() => buildColorMap(selectedOrdered), [selectedOrdered]);
  const idsKey = useMemo(() => selectedOrdered.slice().sort().join(','), [selectedOrdered]);
  const selectionCount = selectedOrdered.length;
  const hasSelection = selectionCount > 0;

  // Janela calculada no momento da consulta: Data Final vazia = "até agora".
  function windowFor() {
    const to = dateTo ? new Date(dateTo) : new Date();
    const from = dateFrom ? new Date(dateFrom) : new Date(to.getTime() - 24 * 3600 * 1000);
    const spanH = (to.getTime() - from.getTime()) / 3_600_000;
    const bucket: 'minute' | 'hour' | 'day' = spanH > 24 * 14 ? 'day' : spanH > 48 ? 'hour' : 'minute';
    return { from, to, bucket };
  }

  const { data: batch, isLoading: loadingChart, isFetching: fetchingChart, refetch: refetchChart } = useQuery<TrendBatchResponse>({
    queryKey: ['trend-batch', idsKey, dateFrom, dateTo],
    queryFn: () => {
      const w = windowFor();
      return getTrendDataBatch(selectedOrdered, { from: w.from, to: w.to, bucket: w.bucket });
    },
    enabled: hasSelection,
    refetchInterval,
  });

  const { data: history, isLoading: loadingTable, isFetching: fetchingTable, refetch: refetchTable } = useQuery<TrendHistoryResponse>({
    queryKey: ['trend-history', idsKey, dateFrom, dateTo, histPage, histPageSize],
    queryFn: () => {
      const w = windowFor();
      return getTrendHistory(selectedOrdered, { from: w.from, to: w.to, page: histPage, pageSize: histPageSize });
    },
    enabled: hasSelection,
    refetchInterval,
  });

  // Séries para o gráfico
  const chartSeries = useMemo<ChartSeries[]>(() => {
    if (!batch) return [];
    // Mantém a ordem da seleção (cores estáveis)
    const byId = new Map(batch.trends.map((s) => [s.trend.id, s]));
    return selectedOrdered.flatMap((id) => {
      const s = byId.get(id);
      if (!s) return [];
      return [{
        id,
        name: s.trend.name,
        type: trendType(s.trend),
        unit: s.trend.point?.unit ?? '',
        color: colorById.get(id) ?? '#0e7490',
        points: s.chartPoints.map((p) => ({ t: p.t, value: p.value })),
      }];
    });
  }, [batch, selectedOrdered, colorById]);

  const refreshing = fetchingChart || fetchingTable;
  function handleRefresh() { void refetchChart(); void refetchTable(); }
  function clearFilters() { setSite(null); setFDevice(''); setFType(''); setDateFrom(''); setDateTo(''); setQuickRange(''); }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setHistPage(1);
  }
  function selectAllFiltered() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      filteredTrends.forEach((t) => next.add(t.id));
      return next;
    });
    setHistPage(1);
  }
  function clearSelection() { setSelectedIds(new Set()); setHistPage(1); }

  function applyQuickRange(label: string, ms: number) {
    const to = new Date();
    const from = new Date(to.getTime() - ms);
    setDateFrom(toLocalInput(from));
    setDateTo(toLocalInput(to));
    setQuickRange(label);
    setHistPage(1);
  }
  function onDateChange(which: 'from' | 'to', value: string) {
    if (which === 'from') setDateFrom(value);
    else setDateTo(value);
    setQuickRange('');
    setHistPage(1);
  }

  // KPIs adaptativos
  const periodLabel = quickRange
    ? `Últimas ${quickRange}`
    : dateFrom || dateTo
      ? 'Personalizado'
      : 'Últimas 24h';
  const single = selectionCount === 1 ? batch?.trends.find((s) => s.trend.id === selectedOrdered[0]) : undefined;
  const singleUnit = single?.trend.point?.unit ?? '';
  const kpis = useMemo(() => {
    if (single) {
      const s = single.summary;
      return [
        { label: 'Registros', value: s.totalRecords.toLocaleString('pt-BR') },
        { label: 'Mínimo', value: s.minValue != null ? formatValue(s.minValue, trendType(single.trend), singleUnit) : '—' },
        { label: 'Máximo', value: s.maxValue != null ? formatValue(s.maxValue, trendType(single.trend), singleUnit) : '—' },
        { label: 'Média', value: s.avgValue != null ? formatValue(s.avgValue, trendType(single.trend), singleUnit) : '—' },
      ];
    }
    // Só soma registros das séries que estão de fato selecionadas/escopadas.
    const selectedSet = new Set(selectedOrdered);
    const totalRecords = (batch?.trends ?? [])
      .filter((s) => selectedSet.has(s.trend.id))
      .reduce((acc, s) => acc + s.summary.totalRecords, 0);
    return [
      { label: 'Variáveis selecionadas', value: String(selectionCount) },
      { label: 'Total de registros', value: totalRecords.toLocaleString('pt-BR') },
      { label: 'Período', value: periodLabel },
    ];
  }, [single, singleUnit, batch, selectedOrdered, selectionCount, periodLabel]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <TrendingUp size={20} strokeWidth={1.5} className="text-cyan-700" />
        <h1 className="text-xl font-semibold text-foreground">Trends</h1>
        <span className="text-sm text-muted-foreground">— análise histórica de variáveis</span>
      </div>

      {/* ── Filtros ──────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium text-foreground">Filtros</span>
          <button type="button" onClick={clearFilters} className="text-xs text-muted-foreground hover:text-foreground">Limpar</button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Site</span>
            <select value={fSite} onChange={(e) => { setSite(e.target.value || null); setFDevice(''); }} className={selectCls}>
              <option value="">Todos os sites</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Controladora / Equipamento</span>
            <select value={fDevice} onChange={(e) => setFDevice(e.target.value)} className={selectCls}>
              <option value="">Todas as controladoras</option>
              {deviceOptions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Tipo de variável</span>
            <select value={fType} onChange={(e) => setFType(e.target.value as '' | 'analog' | 'digital')} className={selectCls}>
              <option value="">Todos</option>
              <option value="analog">Analógico</option>
              <option value="digital">Digital</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Data inicial</span>
            <input type="datetime-local" value={dateFrom} onChange={(e) => onDateChange('from', e.target.value)} className={selectCls} />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Data final <span className="text-muted-foreground/60">(vazio = agora)</span></span>
            <input type="datetime-local" value={dateTo} onChange={(e) => onDateChange('to', e.target.value)} className={selectCls} />
          </label>
        </div>

        {/* Períodos rápidos + atualização automática */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border/60 pt-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-muted-foreground">Período rápido:</span>
            {QUICK_RANGES.map((r) => (
              <button
                key={r.label}
                type="button"
                onClick={() => applyQuickRange(r.label, r.ms)}
                className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                  quickRange === r.label ? 'border-cyan-600 bg-cyan-50 text-cyan-800' : 'border-border text-foreground hover:bg-muted/50'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-foreground">
              <input type="checkbox" checked={autoOn} onChange={(e) => setAutoOn(e.target.checked)} className="accent-cyan-600" />
              Atualização automática
            </label>
            <select value={autoMs} onChange={(e) => setAutoMs(Number(e.target.value))} disabled={!autoOn}
              className="rounded-md border border-border px-1.5 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-50">
              {REFRESH_INTERVALS.map((i) => <option key={i.ms} value={i.ms}>{i.label}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Toggle do painel de variáveis — só no mobile */}
      <button
        type="button"
        onClick={() => setShowVarPanel((v) => !v)}
        className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-foreground lg:hidden"
      >
        <span>
          Variáveis <span className="font-normal text-muted-foreground">({selectionCount} selecionada{selectionCount === 1 ? '' : 's'})</span>
        </span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${showVarPanel ? 'rotate-180' : ''}`} />
      </button>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
        {/* ── Lista de Trends (seleção múltipla) ──────────── */}
        <aside className={`${showVarPanel ? 'flex' : 'hidden'} max-h-[60dvh] flex-col rounded-xl border border-border bg-card lg:sticky lg:top-4 lg:flex lg:max-h-[calc(100dvh-9rem)]`}>
          <div className="shrink-0 border-b border-border p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar variável…"
                className="w-full rounded-md border border-border py-1.5 pl-8 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs">
              <button type="button" onClick={selectAllFiltered} className="text-cyan-700 hover:underline" disabled={filteredTrends.length === 0}>
                Selecionar todos
              </button>
              <span className="text-muted-foreground">{selectionCount} selecionada(s)</span>
              <button type="button" onClick={clearSelection} className="text-muted-foreground hover:text-foreground" disabled={!hasSelection}>
                Limpar
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {loadingTrends ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
              </div>
            ) : filteredTrends.length === 0 ? (
              <p className="px-2 py-8 text-center text-xs text-muted-foreground">
                {trends.length === 0 ? 'Nenhuma trend criada. Crie nos pontos da controladora.' : 'Nenhuma trend para os filtros.'}
              </p>
            ) : (
              <ul className="space-y-0.5">
                {filteredTrends.map((t) => {
                  const checked = selectedIds.has(t.id);
                  const color = colorById.get(t.id);
                  return (
                    <li key={t.id}>
                      <label
                        className={`flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 transition-colors ${checked ? 'bg-cyan-50' : 'hover:bg-muted/50'}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelected(t.id)}
                          className="accent-cyan-600"
                        />
                        <span
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: checked && color ? color : '#cbd5e1' }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate text-sm font-medium ${checked ? 'text-cyan-800' : 'text-foreground'}`}>{t.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {t.point?.objectName ?? t.point?.tag ?? '—'} · {isDigitalPoint(t.point?.objectType) ? 'digital' : 'analógico'}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* ── Detalhe ─────────────────────────────────────── */}
        <section className="space-y-4">
          {!hasSelection ? (
            <div className="flex h-72 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted/10 text-center">
              <TrendingUp size={28} strokeWidth={1} className="text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">Selecione uma ou mais variáveis à esquerda para comparar.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-foreground">
                    {selectionCount === 1 ? single?.trend.name ?? 'Variável' : `${selectionCount} variáveis selecionadas`}
                  </h2>
                  <p className="text-xs text-muted-foreground">{periodLabel}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={handleRefresh} disabled={refreshing} title="Atualizar valores"
                    className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-muted/50 disabled:opacity-50 transition-colors">
                    <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Atualizar
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {kpis.map((c) => (
                  <div key={c.label} className="rounded-lg border border-border bg-card p-3">
                    <p className="text-xs text-muted-foreground">{c.label}</p>
                    <p className="mt-0.5 font-mono text-lg font-semibold text-foreground">{c.value}</p>
                  </div>
                ))}
              </div>

              <TrendsChart series={chartSeries} isLoading={loadingChart} captureRef={chartRef} />

              <TrendsHistoryTable
                rows={history?.records ?? []}
                total={history?.total ?? 0}
                page={history?.page ?? histPage}
                pageSize={histPageSize}
                totalPages={history?.totalPages ?? 1}
                isLoading={loadingTable}
                colorById={colorById}
                onPageChange={setHistPage}
                onPageSizeChange={(s) => { setHistPageSize(s); setHistPage(1); }}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
