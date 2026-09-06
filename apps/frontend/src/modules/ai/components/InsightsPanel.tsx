'use client';

// Aba "Insights" do módulo de IA: lista os resumos executivos periódicos por
// cliente, mostra o detalhe (parte factual + texto da IA), permite copiar o
// texto, baixar em PDF e — para administradores — gerar sob demanda por período.

import { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Calendar,
  Check,
  Copy,
  Download,
  FileText,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { getTenants, type TenantItem } from '@/modules/tenants/services/tenants.service';
import {
  downloadInsightPdf,
  generateInsight,
  getInsight,
  getInsights,
  insightToPlainText,
  type InsightDetail,
  type InsightPeriodPreset,
  type InsightSummary,
} from '../services/insights.service';

const PRESET_LABELS: Record<InsightPeriodPreset, string> = {
  last_week: 'Semana passada (fechada)',
  last_month: 'Mês passado (fechado)',
  current_week: 'Semana atual (parcial)',
  current_month: 'Mês atual (parcial)',
};

const SEVERITY_LABEL: Record<string, string> = { HIGH: 'Alta', MEDIUM: 'Média', LOW: 'Baixa' };

const GLOBAL_ROLES = ['ADMIN', 'CCO', 'SUPERVISOR'];

function fmtDateTime(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));
}

function fmtMs(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return h === 0 ? `${min} min` : `${h} h ${min} min`;
}

function FactCard({ label, value, tone }: { label: string; value: string; tone?: 'bad' | 'neutral' }) {
  return (
    <div
      className={`rounded-lg border px-3 py-2 ${
        tone === 'bad'
          ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40'
          : 'border-border bg-muted/40'
      }`}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={`text-lg font-semibold ${
          tone === 'bad' ? 'text-red-700 dark:text-red-400' : 'text-foreground'
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export default function InsightsPanel() {
  const user = useCurrentUser();
  const role = user.role;
  const isGlobal = GLOBAL_ROLES.includes(role);
  const isAdmin = role === 'ADMIN';

  const [tenants, setTenants] = useState<TenantItem[]>([]);
  const [tenantFilter, setTenantFilter] = useState('');
  const [items, setItems] = useState<InsightSummary[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InsightDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [preset, setPreset] = useState<InsightPeriodPreset>('last_week');
  const [genTenantId, setGenTenantId] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);

  async function loadList(tenantId: string) {
    setListLoading(true);
    setListError(null);
    try {
      const data = await getInsights(tenantId || undefined);
      setItems(data);
    } catch (err) {
      setListError((err as Error).message || 'Não foi possível carregar os insights.');
    } finally {
      setListLoading(false);
    }
  }

  useEffect(() => {
    void loadList(tenantFilter);
  }, [tenantFilter]);

  useEffect(() => {
    if (!isGlobal) return;
    getTenants()
      .then(setTenants)
      .catch(() => setTenants([]));
  }, [isGlobal]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    getInsight(selectedId)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  async function handleGenerate() {
    if (isGlobal && !genTenantId) {
      setGenError('Selecione o cliente para gerar o insight.');
      return;
    }
    setGenerating(true);
    setGenError(null);
    try {
      const created = await generateInsight({
        tenantId: isGlobal ? genTenantId : undefined,
        preset,
      });
      await loadList(tenantFilter);
      setSelectedId(created.id);
    } catch (err) {
      setGenError((err as Error).message || 'Não foi possível gerar o insight.');
    } finally {
      setGenerating(false);
    }
  }

  async function handleCopy() {
    if (!detail) return;
    try {
      await navigator.clipboard.writeText(insightToPlainText(detail));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard indisponível */
    }
  }

  async function handleDownload() {
    if (!detail) return;
    setDownloading(true);
    try {
      await downloadInsightPdf(detail.id);
    } catch {
      /* erro já visível na UI do browser */
    } finally {
      setDownloading(false);
    }
  }

  const facts = detail?.facts;
  const narrative = detail?.narrative ?? null;
  const generateDisabled = generating || (isGlobal && !genTenantId);

  const selectClass =
    'rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500';

  const detailBlock = useMemo(() => {
    if (!selectedId) {
      return (
        <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-2 text-center text-sm text-muted-foreground">
          <FileText className="h-8 w-8 opacity-40" />
          Selecione um insight na lista para ver o detalhe.
        </div>
      );
    }
    if (detailLoading) {
      return (
        <div className="flex min-h-[280px] items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      );
    }
    if (!detail || !facts) {
      return (
        <div className="flex min-h-[280px] items-center justify-center text-sm text-muted-foreground">
          Não foi possível carregar o insight.
        </div>
      );
    }
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-foreground">
              {narrative?.theme ?? `Resumo do período — ${detail.tenantName}`}
            </h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {detail.tenantName} · {detail.periodLabel} · gerado em {fmtDateTime(detail.createdAt)}
              {detail.trigger === 'manual' ? ' · sob demanda' : ' · automático'}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copiado' : 'Copiar texto'}
            </button>
            <button
              type="button"
              onClick={() => void handleDownload()}
              disabled={downloading}
              className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-muted disabled:opacity-60"
            >
              {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              PDF
            </button>
          </div>
        </div>

        {detail.aiFailed && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            O texto executivo da IA não pôde ser gerado — este insight contém apenas os números do período.
          </div>
        )}

        {/* Bloco factual determinístico */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <FactCard label="Alarmes no período" value={String(facts.alarms.total)} />
          <FactCard
            label="Alta severidade"
            value={String(facts.alarms.bySeverity.high)}
            tone={facts.alarms.bySeverity.high > 0 ? 'bad' : 'neutral'}
          />
          <FactCard
            label="Disponibilidade média"
            value={facts.availability.avgUptimePct == null ? 'Sem dados' : `${facts.availability.avgUptimePct}%`}
          />
          <FactCard label="Quedas" value={String(facts.availability.totalDrops)} />
        </div>

        {narrative && (
          <div className="space-y-3 rounded-lg border border-cyan-200 bg-cyan-50/50 p-4 dark:border-cyan-900 dark:bg-cyan-950/30">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{narrative.summary}</p>
            {narrative.highlights.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-400">
                  Destaques
                </p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
                  {narrative.highlights.map((h, i) => (
                    <li key={i}>{h}</li>
                  ))}
                </ul>
              </div>
            )}
            {narrative.recommendations.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-400">
                  Recomendações
                </p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
                  {narrative.recommendations.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {facts.alarms.topDevices.length > 0 && (
            <div className="rounded-lg border border-border p-3">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">Equipamentos com mais alarmes</p>
              <ul className="space-y-1 text-sm">
                {facts.alarms.topDevices.map((d, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="truncate text-foreground">
                      {d.deviceName}
                      {d.siteName ? <span className="text-muted-foreground"> · {d.siteName}</span> : null}
                    </span>
                    <span className="shrink-0 font-medium text-foreground">{d.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {facts.availability.worst.length > 0 && (
            <div className="rounded-lg border border-border p-3">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">Piores disponibilidades</p>
              <ul className="space-y-1 text-sm">
                {facts.availability.worst.map((w, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="truncate text-foreground">{w.name}</span>
                    <span className="shrink-0 font-medium text-foreground">{w.uptimePct}%</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {facts.criticalAssets.inFaultDuringPeriod.length > 0 && (
            <div className="rounded-lg border border-border p-3">
              <p className="mb-2 text-xs font-semibold text-muted-foreground">Ativos críticos com alarme</p>
              <ul className="space-y-1 text-sm">
                {facts.criticalAssets.inFaultDuringPeriod.map((c, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="truncate text-foreground">{c.deviceName}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {c.alarmCount}x · {SEVERITY_LABEL[c.maxSeverity] ?? c.maxSeverity}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {facts.availability.longestOffline && (
            <div className="rounded-lg border border-border p-3 text-sm">
              <p className="mb-1 text-xs font-semibold text-muted-foreground">Maior queda contínua</p>
              <p className="text-foreground">
                {facts.availability.longestOffline.name} —{' '}
                {fmtMs(facts.availability.longestOffline.ms)}
              </p>
            </div>
          )}
        </div>
      </div>
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, detail, detailLoading, facts, narrative, copied, downloading]);

  return (
    <div className="flex flex-col gap-4">
      {/* Geração sob demanda (admin) */}
      {isAdmin && (
        <div className="space-y-2 rounded-lg border border-border bg-card p-4">
          <p className="text-sm font-medium text-foreground">Gerar insight sob demanda</p>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={genTenantId}
              onChange={(e) => setGenTenantId(e.target.value)}
              className={selectClass}
            >
              <option value="">Selecione o cliente…</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <select
              value={preset}
              onChange={(e) => setPreset(e.target.value as InsightPeriodPreset)}
              className={selectClass}
            >
              {(Object.keys(PRESET_LABELS) as InsightPeriodPreset[]).map((p) => (
                <option key={p} value={p}>
                  {PRESET_LABELS[p]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={generateDisabled}
              className="flex items-center gap-1.5 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-700 disabled:opacity-60"
            >
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {generating ? 'Gerando…' : 'Gerar insight'}
            </button>
          </div>
          {genError && <p className="text-xs text-red-600">{genError}</p>}
          <p className="text-xs text-muted-foreground">
            A geração automática segue a periodicidade configurada em Ajustes → Insights de IA.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(260px,340px)_1fr]">
        {/* Lista */}
        <div className="flex flex-col gap-2">
          {isGlobal && (
            <select
              value={tenantFilter}
              onChange={(e) => {
                setTenantFilter(e.target.value);
                setSelectedId(null);
              }}
              className={selectClass}
            >
              <option value="">Todos os clientes</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <div className="max-h-[560px] overflow-y-auto rounded-lg border border-border">
            {listLoading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : listError ? (
              <div className="flex items-start gap-2 p-4 text-sm text-red-600">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {listError}
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
                <Calendar className="h-6 w-6 opacity-40" />
                Nenhum insight gerado ainda. Os insights automáticos aparecem aqui no fechamento de cada
                período.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {items.map((it) => (
                  <li key={it.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(it.id)}
                      className={`w-full px-3 py-2.5 text-left transition hover:bg-muted/60 ${
                        selectedId === it.id ? 'bg-cyan-50 dark:bg-cyan-950/30' : ''
                      }`}
                    >
                      <p className="truncate text-sm font-medium text-foreground">
                        {it.theme ?? it.periodLabel}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span>{it.tenantName}</span>
                        <span>·</span>
                        <span>{it.periodLabel}</span>
                        <span
                          className={`rounded-full border px-1.5 py-px text-[10px] ${
                            it.frequency === 'WEEKLY'
                              ? 'border-cyan-200 text-cyan-700 dark:border-cyan-800 dark:text-cyan-400'
                              : 'border-violet-200 text-violet-700 dark:border-violet-800 dark:text-violet-400'
                          }`}
                        >
                          {it.frequency === 'WEEKLY' ? 'Semanal' : 'Mensal'}
                        </span>
                        {it.aiFailed && (
                          <span className="rounded-full border border-amber-200 px-1.5 py-px text-[10px] text-amber-700 dark:border-amber-800 dark:text-amber-400">
                            só dados
                          </span>
                        )}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button
            type="button"
            onClick={() => void loadList(tenantFilter)}
            className="flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-muted"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Atualizar lista
          </button>
        </div>

        {/* Detalhe */}
        <div className="rounded-lg border border-border bg-card p-4">{detailBlock}</div>
      </div>
    </div>
  );
}
