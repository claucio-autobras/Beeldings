'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Bell,
  FileBarChart,
  FileText,
  Loader2,
  Search,
  ShieldCheck,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { getTenants, type TenantItem } from '@/modules/tenants/services/tenants.service';
import { getSites, type SiteItem } from '@/modules/sites/services/sites.service';
import { getDevices, type Device } from '@/modules/devices/services/devices.service';
import { getTrends, type TrendItem } from '@/modules/trends/services/trends-api.service';
import {
  downloadAlarmsReport,
  downloadTrendsReport,
  downloadAuditReport,
  downloadAvailabilityReport,
  type AlarmReportStatus,
  type ReportFormat,
} from '../services/reports.service';
import { parsePeriodStart, parsePeriodEnd } from '../lib/report-period';
import { TrendsPreview } from '../components/TrendsPreview';
import { AlarmsSummary } from '../components/AlarmsSummary';
import { AuditSummary } from '../components/AuditSummary';
import { AvailabilitySummary } from '../components/AvailabilitySummary';

// ─── Catálogo de tipos de relatório ──────────────────────────────────────────

type ReportTypeId = 'alarms' | 'trends' | 'audit' | 'availability';

interface ReportType {
  id: ReportTypeId;
  label: string;
  icon: LucideIcon;
  description: string;
  available: boolean;
}

const REPORT_TYPES: ReportType[] = [
  {
    id: 'alarms',
    label: 'Relatório de Alarmes',
    icon: Bell,
    description: 'Alarmes ativos, reconhecidos, encerrados e histórico completo.',
    available: true,
  },
  {
    id: 'trends',
    label: 'Relatório de Trends',
    icon: TrendingUp,
    description: 'Exportação dos dados históricos das trends.',
    available: true,
  },
  {
    id: 'audit',
    label: 'Relatório de Auditoria',
    icon: ShieldCheck,
    description: 'Ações realizadas por todos os usuários do cliente (criação, edição, exclusão, login…).',
    available: true,
  },
  {
    id: 'availability',
    label: 'Relatório de Disponibilidade',
    icon: Activity,
    description: 'Uptime, quedas e tempo offline de gateways, equipamentos e câmeras.',
    available: true,
  },
];

const GLOBAL_ROLES = new Set(['ADMIN', 'CCO', 'SUPERVISOR']);
const ALARM_STATUS_OPTIONS: { value: AlarmReportStatus; label: string }[] = [
  { value: 'all', label: 'Histórico completo' },
  { value: 'active', label: 'Alarmes ativos' },
  { value: 'ack', label: 'Alarmes reconhecidos' },
  { value: 'closed', label: 'Alarmes encerrados' },
];

const selectCls =
  'w-full rounded-md border border-border bg-background text-foreground px-2.5 py-2 text-sm [color-scheme:light] dark:[color-scheme:dark] focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:cursor-not-allowed disabled:opacity-60';


export default function ReportsPage() {
  const user = useCurrentUser();
  const isAdmin = GLOBAL_ROLES.has(user.role);

  const [selectedId, setSelectedId] = useState<ReportTypeId>('alarms');
  const selected = REPORT_TYPES.find((r) => r.id === selectedId) ?? REPORT_TYPES[0];

  // Escopo: admin escolhe o cliente; cliente fica travado no próprio tenant.
  const [tenantId, setTenantId] = useState('');
  const [siteId, setSiteId] = useState('');
  const effectiveTenantId = (isAdmin ? tenantId : user.tenantId ?? '') || '';

  // Parâmetros comuns
  const [format, setFormat] = useState<ReportFormat>('PDF');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // Alarmes
  const [alarmStatus, setAlarmStatus] = useState<AlarmReportStatus>('all');

  // Trends
  const [trendSearch, setTrendSearch] = useState('');
  const [trendIds, setTrendIds] = useState<Set<string>>(new Set());

  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  // Cliente muda → zera site e seleção de trends.
  useEffect(() => {
    setSiteId('');
  }, [tenantId]);
  useEffect(() => {
    setTrendIds(new Set());
  }, [effectiveTenantId, siteId]);

  const { data: tenants = [] } = useQuery<TenantItem[]>({
    queryKey: ['tenants', 'reports'],
    queryFn: getTenants,
    enabled: isAdmin,
  });

  const siteScopeReady = !isAdmin || !!tenantId;
  const { data: sites = [] } = useQuery<SiteItem[]>({
    queryKey: ['sites', 'reports', effectiveTenantId],
    queryFn: () => getSites(effectiveTenantId || undefined),
    enabled: siteScopeReady,
  });

  const { data: devices = [] } = useQuery<Device[]>({
    queryKey: ['devices', 'reports', effectiveTenantId],
    queryFn: () => getDevices(effectiveTenantId || undefined),
    enabled: selectedId === 'trends' && siteScopeReady,
  });
  const deviceMap = useMemo(() => new Map(devices.map((d) => [d.id, d])), [devices]);

  const { data: trends = [], isLoading: loadingTrends } = useQuery<TrendItem[]>({
    queryKey: ['trends', 'reports', effectiveTenantId],
    queryFn: () => getTrends({ tenantId: effectiveTenantId || undefined }),
    enabled: selectedId === 'trends' && siteScopeReady,
  });

  // Lista de trends: escopo de site + busca textual.
  const filteredTrends = useMemo(
    () =>
      trends.filter((t) => {
        if (siteId) {
          const dev = t.point ? deviceMap.get(t.point.deviceId) : undefined;
          if (dev?.siteId !== siteId) return false;
        }
        if (trendSearch && !`${t.name} ${t.point?.tag ?? ''} ${t.point?.objectName ?? ''}`.toLowerCase().includes(trendSearch.toLowerCase())) {
          return false;
        }
        return true;
      }),
    [trends, deviceMap, siteId, trendSearch],
  );

  function toggleTrend(id: string) {
    setTrendIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Auditoria pode ser gerada para todos os clientes (admin); os demais
  // relatórios exigem um cliente selecionado.
  const needsClient = isAdmin && !tenantId && selectedId !== 'audit';
  const canGenerate =
    selected.available && !generating && !needsClient && (selectedId !== 'trends' || trendIds.size > 0);

  async function handleGenerate() {
    setError('');
    setGenerating(true);
    try {
      const common = {
        format,
        from: parsePeriodStart(from),
        to: parsePeriodEnd(to),
        tenantId: effectiveTenantId || undefined,
        siteId: siteId || undefined,
      };
      if (selectedId === 'alarms') {
        await downloadAlarmsReport({ ...common, status: alarmStatus });
      } else if (selectedId === 'trends') {
        await downloadTrendsReport({ ...common, ids: [...trendIds] });
      } else if (selectedId === 'audit') {
        await downloadAuditReport({
          format,
          from: parsePeriodStart(from),
          to: parsePeriodEnd(to),
          tenantId: effectiveTenantId || undefined,
        });
      } else if (selectedId === 'availability') {
        await downloadAvailabilityReport(common);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao gerar relatório');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <FileBarChart size={20} strokeWidth={1.5} className="text-cyan-700" />
        <h1 className="text-xl font-semibold text-foreground">Relatórios</h1>
        <span className="text-sm text-muted-foreground">— geração de documentos históricos e auditorias</span>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[280px_1fr]">
        {/* ── Tipos de relatório ──────────────────────────── */}
        <aside className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-2 lg:sticky lg:top-4 lg:self-start">
          {REPORT_TYPES.map((r) => {
            const active = r.id === selectedId;
            const Icon = r.icon;
            return (
              <button
                key={r.id}
                type="button"
                onClick={() => { setSelectedId(r.id); setError(''); }}
                className={`flex items-start gap-2.5 rounded-md px-2.5 py-2.5 text-left transition-colors ${
                  active ? 'bg-cyan-50' : 'hover:bg-muted/50'
                }`}
              >
                <Icon size={18} strokeWidth={1.5} className={active ? 'mt-0.5 text-cyan-700' : 'mt-0.5 text-muted-foreground'} />
                <span className="min-w-0">
                  <span className={`block text-sm font-medium ${active ? 'text-cyan-800' : 'text-foreground'}`}>{r.label}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{r.description}</span>
                </span>
              </button>
            );
          })}
        </aside>

        {/* ── Painel de geração ───────────────────────────── */}
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2.5">
            <selected.icon size={20} strokeWidth={1.5} className="text-cyan-700" />
            <div>
              <h2 className="text-base font-semibold text-foreground">{selected.label}</h2>
              <p className="text-xs text-muted-foreground">{selected.description}</p>
            </div>
          </div>

          <>
              {/* Escopo: cliente (admin) + site (site não se aplica à auditoria) */}
              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {isAdmin && (
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Cliente</span>
                    <select value={tenantId} onChange={(e) => setTenantId(e.target.value)} className={selectCls}>
                      <option value="">{selected.id === 'audit' ? 'Todos os clientes' : 'Selecione o cliente…'}</option>
                      {tenants.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </label>
                )}
                {selected.id !== 'audit' && (
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Site</span>
                    <select
                      value={siteId}
                      onChange={(e) => setSiteId(e.target.value)}
                      disabled={!siteScopeReady}
                      className={selectCls}
                    >
                      <option value="">{needsClient ? 'Selecione o cliente primeiro' : 'Todos os sites'}</option>
                      {sites.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>

              {/* Seleção de variáveis (apenas Trends) */}
              {selected.id === 'trends' && (
                <div className="mt-4">
                  <p className="mb-2 text-xs font-medium text-foreground">
                    Variáveis <span className="text-muted-foreground">({trendIds.size} selecionada(s))</span>
                  </p>
                  <div className="relative mb-2">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      value={trendSearch}
                      onChange={(e) => setTrendSearch(e.target.value)}
                      placeholder="Buscar variável…"
                      disabled={!siteScopeReady}
                      className="w-full rounded-md border border-border py-1.5 pl-8 pr-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 disabled:opacity-60"
                    />
                  </div>
                  <div className="max-h-56 overflow-y-auto rounded-md border border-border">
                    {needsClient ? (
                      <p className="px-3 py-8 text-center text-xs text-muted-foreground">Selecione um cliente para listar as variáveis.</p>
                    ) : loadingTrends ? (
                      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
                      </div>
                    ) : filteredTrends.length === 0 ? (
                      <p className="px-3 py-8 text-center text-xs text-muted-foreground">
                        {trends.length === 0 ? 'Nenhuma trend disponível.' : 'Nenhuma trend para o filtro.'}
                      </p>
                    ) : (
                      <ul className="divide-y divide-border/60">
                        {filteredTrends.map((t) => (
                          <li key={t.id}>
                            <label className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-muted/40">
                              <input
                                type="checkbox"
                                checked={trendIds.has(t.id)}
                                onChange={() => toggleTrend(t.id)}
                                className="accent-cyan-600"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm text-foreground">{t.name}</span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {t.point?.objectName ?? t.point?.tag ?? '—'}
                                </span>
                              </span>
                            </label>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              {/* Parâmetros */}
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {selected.id === 'alarms' && (
                  <label className="flex flex-col gap-1">
                    <span className="text-xs text-muted-foreground">Conteúdo</span>
                    <select value={alarmStatus} onChange={(e) => setAlarmStatus(e.target.value as AlarmReportStatus)} className={selectCls}>
                      {ALARM_STATUS_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Data inicial</span>
                  <input type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} className={selectCls} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Data final <span className="text-muted-foreground/60">(vazio = agora)</span></span>
                  <input type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} className={selectCls} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted-foreground">Formato</span>
                  <select value={format} onChange={(e) => setFormat(e.target.value as ReportFormat)} className={selectCls}>
                    <option value="PDF">PDF</option>
                    <option value="CSV">CSV</option>
                  </select>
                </label>
              </div>

              {selected.id === 'trends' && !needsClient && trendIds.size > 0 && (
                <TrendsPreview ids={[...trendIds]} from={parsePeriodStart(from)} to={parsePeriodEnd(to)} />
              )}
              {selected.id === 'alarms' && !needsClient && (
                <AlarmsSummary
                  tenantId={effectiveTenantId || undefined}
                  siteId={siteId || undefined}
                  from={parsePeriodStart(from)}
                  to={parsePeriodEnd(to)}
                  status={alarmStatus}
                />
              )}
              {selected.id === 'availability' && !needsClient && (
                <AvailabilitySummary
                  tenantId={effectiveTenantId || undefined}
                  siteId={siteId || undefined}
                  from={parsePeriodStart(from)}
                  to={parsePeriodEnd(to)}
                />
              )}
              {selected.id === 'audit' && (
                <AuditSummary
                  tenantId={effectiveTenantId || undefined}
                  from={parsePeriodStart(from)}
                  to={parsePeriodEnd(to)}
                />
              )}

              {error && (
                <p className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>
              )}

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={!canGenerate}
                  className="flex items-center justify-center gap-1.5 rounded-md bg-cyan-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                  Gerar relatório
                </button>
                {needsClient ? (
                  <span className="text-xs text-muted-foreground">Selecione um cliente para gerar o relatório.</span>
                ) : selected.id === 'trends' && trendIds.size === 0 ? (
                  <span className="text-xs text-muted-foreground">Selecione ao menos uma variável.</span>
                ) : null}
              </div>
            </>
        </section>
      </div>
    </div>
  );
}
