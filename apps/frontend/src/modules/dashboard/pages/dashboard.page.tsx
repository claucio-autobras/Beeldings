'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Bell, Clock, WifiOff, Activity, Camera, Server, Building2, Zap, MapPin } from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useTenantFilter } from '@/hooks/useTenantFilter';
import { useSiteFilter } from '@/hooks/useSiteFilter';
import { useNewAlarmNotification } from '@/hooks/useNewAlarmNotification';
import { useSites } from '@/modules/sites/hooks/useSites';
import { useT } from '@/lib/i18n';
import { AlarmSimulateButton } from '@/components/AlarmSimulateButton';
import { NewAlarmModal } from '@/modules/alarms/components/NewAlarmModal';
import { useAutomations } from '@/modules/automation/hooks/useAutomations';
import type { DashboardPeriod } from '../services/dashboard.service';
import {
  useDevices,
  useAlarms,
  useAlarmStatusCounts,
  useAdminStats,
  useRecentCommands,
  useDashboardOverview,
  useAlarmTimeline,
  useCriticalAssets,
} from '../hooks/useDashboard';
import { useCftvKpi } from '../hooks/useCftvKpi';
import {
  PeriodSelector,
  PERIOD_WINDOW_MS,
  ActionKpiCard,
  InfoKpiCard,
  CriticalAssetsCard,
  SeverityTimelineCard,
  GatewaysHealthTable,
  CftvStatusCard,
  AutomationsCard,
  TenantRankingCard,
  ActivityFeedCard,
  DeviceAreaTable,
  QuickAccess,
  OperationalSummaryCard,
  TopOffendersCard,
  AdminTrendCard,
} from '../components/dashboard.component';

const IS_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === 'true';

const PERIOD_LABEL: Record<DashboardPeriod, string> = {
  '24h': '24h',
  '7d': '7 dias',
  '30d': '30 dias',
};

// Variação percentual da janela atual vs anterior; null quando não há base de
// comparação (nunca inventamos tendência).
function pctTrend(current: number, previous: number): { label: string; isUp: boolean } | null {
  if (previous <= 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  if (pct === 0) return null;
  return { label: `${pct > 0 ? '+' : ''}${pct}%`, isUp: pct > 0 };
}

// Sparkline real: ativações de alarme por bucket dentro da janela do período.
function useActivationSpark(params: {
  period: DashboardPeriod;
  tenantId?: string;
  siteId?: string;
}): number[] | undefined {
  const { period, tenantId, siteId } = params;
  const { data } = useAlarmTimeline({
    tenantId,
    siteId,
    period,
    windowMs: PERIOD_WINDOW_MS[period],
  });
  return useMemo(() => {
    if (!data) return undefined;
    const start = data.from.getTime();
    const end = data.to.getTime();
    const n = 8;
    const step = (end - start) / n;
    const out = Array<number>(n).fill(0);
    for (const e of data.events) {
      const t = new Date(e.activatedAt).getTime();
      if (t < start || t > end) continue;
      out[Math.min(n - 1, Math.floor((t - start) / step))] += 1;
    }
    return out;
  }, [data]);
}

// ─── Admin Dashboard View ─────────────────────────────────────────────────────

function AdminDashboardView({ period }: { period: DashboardPeriod }) {
  const t = useT();
  const { data: adminStats, isLoading: loadingStats } = useAdminStats();
  const { data: alarmStats } = useAlarmStatusCounts(undefined);
  const { data: overview, isLoading: loadingOverview } = useDashboardOverview({ period });
  const { data: commands, isLoading: loadingCommands } = useRecentCommands();
  const cftvKpi = useCftvKpi(undefined, null);
  const spark = useActivationSpark({ period });
  const { data: criticalAssets, isLoading: loadingCritical } = useCriticalAssets({ period });

  // Nomes dos tenants para a tabela de gateways (gateway → tenant).
  const { data: tenants = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['tenants'],
    queryFn: () => apiGet('/tenants'),
  });
  const tenantNameById = useMemo(() => new Map(tenants.map((t) => [t.id, t.name])), [tenants]);

  const activeAlarms = alarmStats?.active ?? 0;
  const pendingAck = alarmStats?.pendingAck ?? 0;
  const devicesByStatus = adminStats?.devicesByStatus ?? { online: 0, offline: 0 };
  const gateways = adminStats?.gateways ?? [];
  const gatewaysOnline = gateways.filter((g) => g.status === 'online').length;

  const activatedTrend = overview
    ? pctTrend(overview.current.activated, overview.previous.activated)
    : null;

  return (
    <div className="space-y-4">
      {/* KPI ROW */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-6">
          <ActionKpiCard
            title={t('Alarmes Ativos')}
            value={activeAlarms}
            status="critical"
            icon={<Bell size={15} />}
            href="/alarms?state=open"
            spark={spark}
            trend={activatedTrend}
            isLoading={!alarmStats}
          />
          {/* Aguard. ACK e Disp. Offline: sem histórico dessas contagens →
              sparkline/tendência omitidas com elegância. */}
          <ActionKpiCard
            title={t('Aguard. ACK')}
            value={pendingAck}
            status="warning"
            icon={<Clock size={15} />}
            href="/alarms?state=NORMALIZED_UNACK"
            isLoading={!alarmStats}
          />
          <ActionKpiCard
            title={t('Disp. Offline')}
            value={devicesByStatus.offline}
            status="warning"
            icon={<WifiOff size={15} />}
            href="/devices"
            isLoading={loadingStats}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:col-span-6">
          <InfoKpiCard
            title={t('Clientes ativos')}
            value={overview?.tenants.active ?? 0}
            total={overview?.tenants.total ?? 0}
            icon={<Building2 size={16} strokeWidth={1.5} />}
            href="/admin/clients"
            isLoading={loadingOverview}
          />
          <InfoKpiCard
            title={t('IOT/BMS online')}
            value={devicesByStatus.online}
            total={devicesByStatus.online + devicesByStatus.offline}
            icon={<Activity size={16} strokeWidth={1.5} />}
            href="/devices"
            isLoading={loadingStats}
          />
          {cftvKpi && (
            <InfoKpiCard
              title={t('Câmeras online')}
              value={cftvKpi.online}
              total={cftvKpi.total}
              icon={<Camera size={16} strokeWidth={1.5} />}
              href="/cftv"
            />
          )}
          <InfoKpiCard
            title={t('Gateways online')}
            value={gatewaysOnline}
            total={gateways.length}
            icon={<Server size={16} strokeWidth={1.5} />}
            href="/admin/gateways"
            isLoading={loadingStats}
          />
        </div>
      </div>

      {/* MAIN GRID */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 xl:grid-cols-4">
        <div className="space-y-4 lg:col-span-2 xl:col-span-3">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <SeverityTimelineCard period={period} />
            </div>
            <CriticalAssetsCard
              assets={criticalAssets?.assets}
              isAdmin
              isLoading={loadingCritical}
            />
          </div>

          <AdminTrendCard trend={overview?.trend} period={period} isLoading={loadingOverview} />

          <GatewaysHealthTable tenantNameById={tenantNameById} />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {cftvKpi && <CftvStatusCard kpi={cftvKpi} />}
            <AutomationsCard
              activeAutomations={adminStats?.activeAutomations ?? null}
              recentCommands={commands ?? []}
              showTenant
              isLoading={loadingCommands || loadingStats}
            />
          </div>
        </div>

        <div className="space-y-4">
          <TenantRankingCard ranking={overview?.tenantRanking ?? null} isLoading={loadingOverview} />
          <ActivityFeedCard entries={overview?.recentAudit ?? null} isLoading={loadingOverview} />
        </div>
      </div>
    </div>
  );
}

// ─── Client Dashboard View ────────────────────────────────────────────────────

interface ClientDashboardViewProps {
  tenantId: string | undefined;
  siteId: string | undefined;
  period: DashboardPeriod;
}

function ClientDashboardView({ tenantId, siteId, period }: ClientDashboardViewProps) {
  const t = useT();
  const user = useCurrentUser();
  // CLIENT não tem acesso à página /automation; vê as automações num modal.
  const clientUsesModal = !['ADMIN', 'CCO', 'SUPERVISOR'].includes(user.role);
  const { data: devices, isLoading: loadingDevices } = useDevices(tenantId);
  const { data: alarms, isLoading: loadingAlarms } = useAlarms(tenantId);
  const { data: alarmStats } = useAlarmStatusCounts(tenantId, siteId);
  const { data: overview, isLoading: loadingOverview } = useDashboardOverview({
    period,
    tenantId,
    siteId,
  });
  const { data: sites } = useSites(tenantId);
  const { data: commands, isLoading: loadingCommands } = useRecentCommands(tenantId, siteId);
  const { data: automations, isLoading: loadingAutomations } = useAutomations(tenantId, siteId);
  const cftvKpi = useCftvKpi(tenantId, siteId ?? null);
  const spark = useActivationSpark({ period, tenantId, siteId });
  const { data: criticalAssets, isLoading: loadingCritical } = useCriticalAssets({
    period,
    tenantId,
    siteId,
  });
  // Admin com cliente selecionado continua vendo a visão técnica nos deep-links.
  const isAdminProfile = ['ADMIN', 'CCO', 'SUPERVISOR'].includes(user.role);

  const baseDevices = devices ?? [];
  // Exclui avisos de automação (kind='automation'); não são alarmes de telemetria.
  const baseAlarms = (alarms ?? []).filter((a) => a.kind !== 'automation');

  // Escopo por site: dispositivos têm siteId; alarmes herdam o site do dispositivo.
  // O feed legado `/alarms` não filtra por site, então filtramos localmente.
  const deviceSiteMap = new Map(baseDevices.map((d) => [d.id, d.siteId]));
  const allDevices = siteId ? baseDevices.filter((d) => d.siteId === siteId) : baseDevices;
  const allAlarms = siteId
    ? baseAlarms.filter((a) => deviceSiteMap.get(a.deviceId) === siteId)
    : baseAlarms;
  const activeAlarms = allAlarms.filter((a) => a.status === 'ALARME');
  const criticalActive = activeAlarms.filter((a) => a.severity === 'HIGH').length;

  // "Aguard. ACK" vem da fonte autoritativa (`/alarm-events/stats`, já escopada
  // por site no backend), a mesma da tela de Alarmes.
  const pendingAck = alarmStats?.pendingAck ?? 0;
  const activeCount = alarmStats?.active ?? activeAlarms.length;

  const onlineDevices = allDevices.filter((d) => d.status === 'online').length;
  const offlineDevices = allDevices.length - onlineDevices;

  // Com um site selecionado, conta apenas as automações daquele site — as de
  // "Todos os locais" (siteId nulo) não pertencem a um site específico.
  const scopedAutomations = (automations ?? []).filter((a) => !siteId || a.siteId === siteId);
  const activeAutomations = tenantId ? scopedAutomations.filter((a) => a.enabled).length : null;

  const activatedTrend = overview
    ? pctTrend(overview.current.activated, overview.previous.activated)
    : null;

  return (
    <div className="space-y-4">
      {/* KPI ROW */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-6">
          <ActionKpiCard
            title={t('Alarmes Ativos')}
            value={activeCount}
            status="critical"
            icon={<Bell size={15} />}
            href="/alarms?state=open"
            spark={spark}
            trend={activatedTrend}
            isLoading={loadingAlarms && !alarmStats}
          />
          <ActionKpiCard
            title={t('Aguard. ACK')}
            value={pendingAck}
            status="warning"
            icon={<Clock size={15} />}
            href="/alarms?state=NORMALIZED_UNACK"
            isLoading={!alarmStats}
          />
          <ActionKpiCard
            title={t('Disp. Offline')}
            value={offlineDevices}
            status="warning"
            icon={<WifiOff size={15} />}
            href="/devices"
            isLoading={loadingDevices}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:col-span-6">
          <InfoKpiCard
            title={t('IOT/BMS online')}
            value={onlineDevices}
            total={allDevices.length}
            icon={<Activity size={16} strokeWidth={1.5} />}
            href="/devices"
            isLoading={loadingDevices}
          />
          {cftvKpi && (
            <InfoKpiCard
              title={t('Câmeras online')}
              value={cftvKpi.online}
              total={cftvKpi.total}
              icon={<Camera size={16} strokeWidth={1.5} />}
              href="/cftv"
            />
          )}
          <InfoKpiCard
            title={t('Automações ativas')}
            value={activeAutomations ?? 0}
            total={scopedAutomations.length}
            icon={<Zap size={16} strokeWidth={1.5} />}
            href={clientUsesModal ? undefined : '/automation'}
            isLoading={loadingAutomations}
          />
          <InfoKpiCard
            title={t('Sites/Áreas')}
            value={(sites ?? []).length}
            total={(sites ?? []).length}
            icon={<MapPin size={16} strokeWidth={1.5} />}
          />
        </div>
      </div>

      {/* MAIN GRID */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 xl:grid-cols-4">
        <div className="space-y-4 lg:col-span-2 xl:col-span-3">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <SeverityTimelineCard period={period} tenantId={tenantId} siteId={siteId} />
            </div>
            <CriticalAssetsCard
              assets={criticalAssets?.assets}
              isAdmin={isAdminProfile}
              isLoading={loadingCritical}
            />
          </div>

          <DeviceAreaTable
            devices={allDevices}
            activeAlarms={activeAlarms}
            isLoading={loadingDevices}
          />

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {cftvKpi && <CftvStatusCard kpi={cftvKpi} />}
            <AutomationsCard
              activeAutomations={activeAutomations}
              recentCommands={commands ?? []}
              hideSite={!!siteId}
              isLoading={loadingCommands || loadingAutomations}
              useModal={clientUsesModal}
              automations={scopedAutomations}
              sites={sites ?? []}
              automationsLoading={loadingAutomations}
            />
          </div>
        </div>

        <div className="space-y-4">
          <QuickAccess />
          <OperationalSummaryCard
            criticalActive={criticalActive}
            pendingAck={pendingAck}
            resolvedInPeriod={overview?.current.resolved ?? null}
            periodLabel={t(PERIOD_LABEL[period])}
            availability={overview?.availability}
          />
          <TopOffendersCard
            offenders={overview?.topOffenders}
            from={overview?.from}
            to={overview?.to}
            periodLabel={t(PERIOD_LABEL[period])}
            isLoading={loadingOverview}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const t = useT();
  const router = useRouter();
  const user = useCurrentUser();
  const isAdmin = user.role === 'ADMIN' || user.role === 'CCO' || user.role === 'SUPERVISOR';

  const { selectedTenantId } = useTenantFilter();
  const { selectedSiteId } = useSiteFilter();

  const effectiveTenantId = isAdmin
    ? selectedTenantId ?? undefined
    : (user.tenantId ?? undefined);

  // Site só escopa quando há um tenant efetivo.
  const effectiveSiteId = effectiveTenantId ? selectedSiteId ?? undefined : undefined;

  // Período 24h/7d/30d — afeta o gráfico de severidade, tendências e métricas
  // de janela (tempo até ACK, resolvidos).
  const [period, setPeriod] = useState<DashboardPeriod>('24h');

  const {
    pendingAlarms,
    showModal,
    addAlarms,
    dismissModal,
    acknowledgeAll,
  } = useNewAlarmNotification();

  const showClientView = !isAdmin || !!selectedTenantId;

  // Nome do tenant selecionado (só admins têm o filtro global).
  const { data: tenantList } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['tenants'],
    queryFn: () => apiGet('/tenants'),
    enabled: isAdmin && !!selectedTenantId,
  });
  const selectedTenantName = tenantList?.find((t) => t.id === selectedTenantId)?.name;

  const pageSubtitle = isAdmin
    ? selectedTenantId
      ? `${selectedTenantName ?? t('Cliente')} — ${t('visão do Site')}`
      : t('Visão global — Todos os Sites')
    : `${t('Bem-vindo')}, ${user.name}`;

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex flex-col gap-3 border-b border-border pb-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <span className="h-6 w-1.5 rounded-sm bg-cyan-500" aria-hidden="true" />
            Dashboard
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{pageSubtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <PeriodSelector value={period} onChange={setPeriod} />
          {IS_MOCK && <AlarmSimulateButton addAlarms={addAlarms} />}
        </div>
      </div>

      {/* Conditional view */}
      {!showClientView ? (
        <AdminDashboardView period={period} />
      ) : (
        <ClientDashboardView
          tenantId={effectiveTenantId}
          siteId={effectiveSiteId}
          period={period}
        />
      )}

      {/* New Alarm Modal */}
      {showModal && pendingAlarms.length > 0 && (
        <NewAlarmModal
          alarms={pendingAlarms}
          onDismiss={dismissModal}
          onAcknowledgeNormalized={acknowledgeAll}
          onViewPanel={() => { dismissModal(); router.push('/alarms'); }}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}
