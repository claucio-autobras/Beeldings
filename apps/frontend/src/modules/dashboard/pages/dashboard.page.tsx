'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  Clock,
  WifiOff,
  Activity,
  Server,
  Building2,
  MapPin,
  ShieldAlert,
} from 'lucide-react';
import { apiGet } from '@/lib/api-client';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useTenantFilter } from '@/hooks/useTenantFilter';
import { useSiteFilter } from '@/hooks/useSiteFilter';
import { useNewAlarmNotification } from '@/hooks/useNewAlarmNotification';
import { useSites } from '@/modules/sites/hooks/useSites';
import { useT } from '@/lib/i18n';
import { AlarmSimulateButton } from '@/components/AlarmSimulateButton';
import { NewAlarmModal } from '@/modules/alarms/components/NewAlarmModal';
import { DashboardPanel } from '../components/DashboardShared';
import type { DashboardOverview, DashboardPeriod } from '../services/dashboard.service';
import {
  useDevices,
  useAlarmStatusCounts,
  useAdminStats,
  useDashboardOverview,
  useCriticalAssets,
  useRecentActiveAlarms,
  useSiteOverview,
} from '../hooks/useDashboard';
import {
  CriticalAssetsCard,
  SeverityTimelineCard,
  GatewaysHealthTable,
  TenantRankingCard,
  ActivityFeedCard,
  RecentAlarmsCard,
  WorkOrdersCard,
  SiteOverviewSection,
  Hive,
  type HiveSatellite,
} from '../components/dashboard.component';
import { resolveHiveFocus } from '../components/dashboardHiveFocus';

const IS_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === 'true';

const PERIOD_LABEL: Record<DashboardPeriod, string> = {
  '24h': '24h',
  '7d': '7 dias',
  '30d': '30 dias',
};

function isDashboardOverview(value: unknown): value is DashboardOverview {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<DashboardOverview>;
  return Boolean(candidate.current && candidate.previous && candidate.tenants);
}

function compactPercent(value: number, total: number): string {
  if (total <= 0) return '—';
  return `${Math.round((value / total) * 1000) / 10}%`;
}

interface CompactDashboardLayoutProps {
  hive: ReactNode;
  recentAlarms: ReactNode;
  timeline: ReactNode;
  criticalAssets: ReactNode;
  gateways: ReactNode;
  contextCard: ReactNode;
  activity: ReactNode;
  workOrders: ReactNode;
  periodLabel: string;
}

/**
 * Composição do mockup compacto aplicada somente ao conteúdo do Dashboard.
 * A toolbar, a navegação global e os filtros do shell continuam fora deste
 * componente e não são alterados.
 */
function CompactDashboardLayout({
  hive,
  recentAlarms,
  timeline,
  criticalAssets,
  gateways,
  contextCard,
  activity,
  workOrders,
  periodLabel,
}: CompactDashboardLayoutProps) {
  const t = useT();

  return (
    <div className="space-y-6">
      <div className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(390px,.85fr)]">
        <DashboardPanel className="hive-dashboard-panel px-4 pb-4 pt-5 sm:px-5" accent>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[9px] font-bold uppercase tracking-[.18em] text-cyan-700 dark:text-cyan-300">
                {t('Indicadores essenciais')}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {t('Período')}: {periodLabel}
              </p>
            </div>
          </div>
          <div className="flex flex-1 items-center justify-center">
            {hive}
          </div>
        </DashboardPanel>
        <div className="min-w-0">{recentAlarms}</div>
      </div>

      <div>
        <p className="font-mono text-[9px] font-bold uppercase tracking-[.2em] text-muted-foreground">
          {t('Contexto e prioridade')}
        </p>
        <div className="mt-2 flex items-center gap-3">
          <span className="h-px w-8 bg-cyan-600/70 dark:bg-cyan-400/70" aria-hidden="true" />
          <div className="h-px flex-1 bg-border" />
        </div>
      </div>

      <div className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,.85fr)]">
        <div className="min-w-0">{contextCard}</div>
        <div className="min-w-0">{criticalAssets}</div>
      </div>

      <div>
        <p className="font-mono text-[9px] font-bold uppercase tracking-[.2em] text-muted-foreground">
          {t('Análise operacional')}
        </p>
        <div className="mt-2 flex items-center gap-3">
          <span className="h-px w-8 bg-cyan-600/70 dark:bg-cyan-400/70" aria-hidden="true" />
          <div className="h-px flex-1 bg-border" />
        </div>
      </div>

      <div className="grid items-stretch gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(330px,.8fr)]">
        <div className="min-w-0">{timeline}</div>
        <div className="min-w-0">{workOrders}</div>
      </div>

      <div className="min-w-0">{gateways}</div>
      <div className="min-w-0">{activity}</div>

      <p className="sr-only">{t('Período')}: {periodLabel}</p>
    </div>
  );
}

// ─── Admin Dashboard View ─────────────────────────────────────────────────────

function AdminDashboardView({
  period,
  onPeriodChange,
}: {
  period: DashboardPeriod;
  onPeriodChange: (period: DashboardPeriod) => void;
}) {
  const t = useT();
  const { data: adminStats } = useAdminStats();
  const { data: alarmStats } = useAlarmStatusCounts(undefined);
  const { data: overviewResponse, isLoading: loadingOverview } = useDashboardOverview({ period });
  const overview = isDashboardOverview(overviewResponse) ? overviewResponse : null;
  const { data: criticalAssets, isLoading: loadingCritical } = useCriticalAssets({ period });
  const { data: recentActiveAlarms, isLoading: loadingRecentAlarms } = useRecentActiveAlarms({
    limit: 6,
  });

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

  const totalDevices = devicesByStatus.online + devicesByStatus.offline;
  const criticalAssetRows = criticalAssets?.assets ?? [];
  const criticalFaults = criticalAssetRows.filter(
    (asset) => asset.state === 'fault' || asset.state === 'no_response',
  ).length;
  const hiveFocus = resolveHiveFocus({
    activeAlarms,
    offlineDevices: devicesByStatus.offline,
    totalDevices,
  });
  const hiveCenter = hiveFocus === 'alarms'
    ? {
        id: 'alarms' as const,
        label: t('Alarmes ativos'),
        value: activeAlarms,
        sub: t('agora'),
        href: '/alarms?state=open',
        tone: 'critical' as const,
      }
    : hiveFocus === 'offline'
      ? {
          id: 'offline' as const,
          label: t('Disp. offline'),
          value: devicesByStatus.offline,
          sub: totalDevices > 0 ? `${t('de')} ${totalDevices}` : t('sem dados'),
          href: '/devices',
          tone: 'offline' as const,
        }
      : {
          id: 'clients' as const,
          label: t('Clientes ativos'),
          value: overview?.tenants.active ?? '—',
          sub: overview?.tenants.total ? `${t('de')} ${overview.tenants.total}` : t('sem dados'),
          href: '/admin/clients',
          tone: 'brand' as const,
        };
  const hiveSatellites: HiveSatellite[] = [
    {
      id: 'alarms',
      label: t('Alarmes ativos'),
      value: activeAlarms,
      sub: t('agora'),
      icon: <Bell size={14} />,
      tone: 'critical',
      href: '/alarms?state=open',
    },
    {
      id: 'ack',
      label: t('Aguard. Reconhecimento'),
      value: pendingAck,
      icon: <Clock size={14} />,
      tone: 'warning',
      href: '/alarms?state=NORMALIZED_UNACK',
    },
    {
      id: 'offline',
      label: t('Disp. offline'),
      value: devicesByStatus.offline,
      sub: totalDevices > 0 ? `${t('de')} ${totalDevices}` : t('sem dados'),
      icon: <WifiOff size={14} />,
      tone: 'offline',
      href: '/devices',
    },
    {
      id: 'clients',
      label: t('Clientes ativos'),
      value: overview?.tenants.active ?? '—',
      sub: overview?.tenants.total ? `${t('de')} ${overview.tenants.total}` : t('sem dados'),
      icon: <Building2 size={14} />,
      tone: 'brand',
      href: '/admin/clients',
    },
    {
      id: 'gateways',
      label: t('Gateways online'),
      value: gatewaysOnline,
      sub: gateways.length > 0 ? `${t('de')} ${gateways.length}` : t('sem dados'),
      icon: <Server size={14} />,
      tone: 'brand',
      href: '/admin/gateways',
    },
    {
      id: 'critical',
      label: t('Pontos críticos'),
      value: criticalAssetRows.length,
      sub: criticalAssetRows.length > 0 ? `${criticalFaults} ${t('em falha')}` : t('sem dados'),
      icon: <ShieldAlert size={14} />,
      tone: 'warning',
      href: '/devices',
    },
    {
      id: 'iot',
      label: t('IOT/BMS online'),
      value: compactPercent(devicesByStatus.online, totalDevices),
      sub: totalDevices > 0
        ? `${devicesByStatus.online} ${t('de')} ${totalDevices}`
        : t('sem dados'),
      icon: <Activity size={14} />,
      tone: 'brand',
      href: '/devices',
    },
  ];
  const visibleHiveSatellites = hiveSatellites.filter((satellite) => satellite.id !== hiveCenter.id);

  return (
    <CompactDashboardLayout
      hive={
        <Hive
          center={{
            ...hiveCenter,
          }}
          satellites={visibleHiveSatellites}
          className="max-w-[600px]"
          loading={!alarmStats || !adminStats || loadingOverview || loadingCritical}
        />
      }
      recentAlarms={
        <RecentAlarmsCard events={recentActiveAlarms} isLoading={loadingRecentAlarms} />
      }
      timeline={
        <SeverityTimelineCard
          period={period}
          onPeriodChange={onPeriodChange}
          offlineTrend={overview?.trend}
        />
      }
      criticalAssets={
        <CriticalAssetsCard assets={criticalAssets?.assets} isAdmin isLoading={loadingCritical} />
      }
      gateways={<GatewaysHealthTable tenantNameById={tenantNameById} />}
      contextCard={
        <TenantRankingCard ranking={overview?.tenantRanking ?? null} isLoading={loadingOverview} />
      }
      activity={
        <ActivityFeedCard entries={overview?.recentAudit ?? null} isLoading={loadingOverview} />
      }
      workOrders={<WorkOrdersCard scope="admin" />}
      periodLabel={t(PERIOD_LABEL[period])}
    />
  );
}

// ─── Client Dashboard View ────────────────────────────────────────────────────

interface ClientDashboardViewProps {
  tenantId: string | undefined;
  siteId: string | undefined;
  tenantName?: string;
  period: DashboardPeriod;
  onPeriodChange: (period: DashboardPeriod) => void;
}

function ClientDashboardView({
  tenantId,
  siteId,
  tenantName,
  period,
  onPeriodChange,
}: ClientDashboardViewProps) {
  const t = useT();
  const user = useCurrentUser();
  const { data: devices, isLoading: loadingDevices } = useDevices(tenantId);
  const { data: alarmStats } = useAlarmStatusCounts(tenantId, siteId);
  const { data: overviewResponse, isLoading: loadingOverview } = useDashboardOverview({
    period,
    tenantId,
    siteId,
  });
  const overview = isDashboardOverview(overviewResponse) ? overviewResponse : null;
  const siteOverview = useSiteOverview({ period, tenantId, siteId });
  const { data: sites } = useSites(tenantId);
  const { data: recentActiveAlarms, isLoading: loadingRecentAlarms } = useRecentActiveAlarms({
    tenantId,
    siteId,
    limit: 6,
  });
  const { data: criticalAssets, isLoading: loadingCritical } = useCriticalAssets({
    period,
    tenantId,
    siteId,
  });
  // Admin com cliente selecionado continua vendo a visão técnica nos deep-links.
  const isAdminProfile = ['ADMIN', 'CCO', 'SUPERVISOR'].includes(user.role);

  const baseDevices = devices ?? [];

  // Escopo por site: dispositivos têm siteId.
  const allDevices = siteId ? baseDevices.filter((d) => d.siteId === siteId) : baseDevices;

  // "Aguard. Reconhecimento" vem da fonte autoritativa (`/alarm-events/stats`, já escopada
  // por site no backend), a mesma da tela de Alarmes.
  const pendingAck = alarmStats?.pendingAck ?? 0;
  const activeCount = alarmStats?.active ?? 0;

  const onlineDevices = allDevices.filter((d) => d.status === 'online').length;
  const offlineDevices = allDevices.length - onlineDevices;
  const hiveFocus = resolveHiveFocus({
    activeAlarms: activeCount,
    offlineDevices,
    totalDevices: allDevices.length,
  });

  const selectedSiteName = sites?.find((site) => site.id === siteId)?.name;
  const criticalAssetRows = criticalAssets?.assets ?? [];
  const criticalFaults = criticalAssetRows.filter(
    (asset) => asset.state === 'fault' || asset.state === 'no_response',
  ).length;
  const hiveCenter = hiveFocus === 'alarms'
    ? {
        id: 'alarms' as const,
        label: t('Alarmes ativos'),
        value: activeCount,
        sub: t('agora'),
        href: '/alarms?state=open',
        tone: 'critical' as const,
      }
    : hiveFocus === 'offline'
      ? {
          id: 'offline' as const,
          label: t('Disp. offline'),
          value: offlineDevices,
          sub: allDevices.length > 0 ? `${t('de')} ${allDevices.length}` : t('sem dados'),
          href: '/devices',
          tone: 'offline' as const,
        }
      : {
          id: 'iot' as const,
          label: t('IOT/BMS online'),
          value: compactPercent(onlineDevices, allDevices.length),
          sub: allDevices.length > 0
            ? `${onlineDevices} ${t('de')} ${allDevices.length} ${t('dispositivos')}`
            : t('Sem dados'),
          href: '/devices',
          tone: 'brand' as const,
        };
  const hiveSatellites: HiveSatellite[] = [
    {
      id: 'alarms',
      label: t('Alarmes ativos'),
      value: activeCount,
      sub: t('agora'),
      icon: <Bell size={14} />,
      tone: 'critical',
      href: '/alarms?state=open',
    },
    {
      id: 'ack',
      label: t('Aguard. Reconhecimento'),
      value: pendingAck,
      icon: <Clock size={14} />,
      tone: 'warning',
      href: '/alarms?state=NORMALIZED_UNACK',
    },
    {
      id: 'offline',
      label: t('Disp. offline'),
      value: offlineDevices,
      sub: allDevices.length > 0 ? `${t('de')} ${allDevices.length}` : t('sem dados'),
      icon: <WifiOff size={14} />,
      tone: 'offline',
      href: '/devices',
    },
    {
      id: 'sites',
      label: t('Sites/Áreas'),
      value: (sites ?? []).length,
      sub: siteId && selectedSiteName ? selectedSiteName : t('escopo atual'),
      icon: <MapPin size={14} />,
      tone: 'brand',
    },
    {
      id: 'iot',
      label: t('IOT/BMS online'),
      value: compactPercent(onlineDevices, allDevices.length),
      sub: allDevices.length > 0
        ? `${onlineDevices} ${t('de')} ${allDevices.length}`
        : t('sem dados'),
      icon: <Activity size={14} />,
      tone: 'brand',
      href: '/devices',
    },
    {
      id: 'critical',
      label: t('Pontos críticos'),
      value: criticalAssetRows.length,
      sub: criticalAssetRows.length > 0 ? `${criticalFaults} ${t('em falha')}` : t('sem dados'),
      icon: <ShieldAlert size={14} />,
      tone: 'warning',
      href: '/devices',
    },
  ];
  const visibleHiveSatellites = hiveSatellites.filter((satellite) => satellite.id !== hiveCenter.id);

  return (
    <CompactDashboardLayout
      hive={
        <Hive
          center={{
            ...hiveCenter,
          }}
          satellites={visibleHiveSatellites}
          className="max-w-[600px]"
          loading={!alarmStats || loadingDevices || loadingCritical}
        />
      }
      recentAlarms={
        <RecentAlarmsCard events={recentActiveAlarms} isLoading={loadingRecentAlarms} />
      }
      timeline={
        <SeverityTimelineCard
          period={period}
          onPeriodChange={onPeriodChange}
          tenantId={tenantId}
          siteId={siteId}
        />
      }
      criticalAssets={
        <CriticalAssetsCard
          assets={criticalAssets?.assets}
          isAdmin={isAdminProfile}
          isLoading={loadingCritical}
        />
      }
      gateways={
        <GatewaysHealthTable
          tenantId={tenantId}
          isAdminView={isAdminProfile}
          tenantName={tenantName ?? user.tenantName ?? undefined}
          siteName={selectedSiteName}
        />
      }
      contextCard={
        <SiteOverviewSection
          data={siteOverview.data}
          isLoading={siteOverview.isLoading}
          isError={siteOverview.isError}
          isAdmin={isAdminProfile}
          periodLabel={t(PERIOD_LABEL[period])}
        />
      }
      activity={
        <ActivityFeedCard entries={overview?.recentAudit ?? null} isLoading={loadingOverview} />
      }
      workOrders={
        <WorkOrdersCard
          scope="client"
          tenantName={tenantName ?? user.tenantName ?? undefined}
          siteName={selectedSiteName}
        />
      }
      periodLabel={t(PERIOD_LABEL[period])}
    />
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
  const isGlobalAdminView = isAdmin && !selectedTenantId;
  const isClientUser = !isAdmin;

  // Nome do tenant selecionado (só admins têm o filtro global).
  const { data: tenantList } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['tenants'],
    queryFn: () => apiGet('/tenants'),
    enabled: isAdmin && !!selectedTenantId,
  });
  const selectedTenantName = tenantList?.find((t) => t.id === selectedTenantId)?.name;

  const pageEyebrow = isGlobalAdminView || isClientUser
    ? null
    : `${t('Dashboard compacto')} · ${t('cliente selecionado')}`;
  const pageTitle = isGlobalAdminView || isClientUser ? t('Dashboard') : t('Clareza para decidir.');
  const pageDescription = isGlobalAdminView
    ? t('Visão global — Todos os Sites')
    : showClientView
    ? `${selectedTenantName ?? user.tenantName ?? t('Cliente')} · ${t('contexto do site, sinais atuais e próximos passos em um só lugar.')}`
    : t('Uma leitura coordenada da malha inteira para decidir onde agir primeiro.');

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {pageEyebrow && (
            <p className="font-mono text-[9px] font-bold uppercase tracking-[.2em] text-cyan-700 dark:text-cyan-300">
              {pageEyebrow}
            </p>
          )}
          <h1 className={`mt-1 font-bold tracking-[-.06em] text-foreground ${
            isClientUser ? 'text-[30px] md:text-[32px]' : 'text-[24px]'
          }`}>
            {pageTitle}
          </h1>
          <p className={`mt-1 max-w-[620px] text-muted-foreground ${isGlobalAdminView ? 'text-sm' : 'text-[11px]'}`}>
            {pageDescription}
          </p>
        </div>
         {IS_MOCK && (
           <div className="flex flex-wrap items-center justify-end gap-2">
             <AlarmSimulateButton addAlarms={addAlarms} />
           </div>
         )}
      </div>

      {/* Conditional view */}
      {!showClientView ? (
         <AdminDashboardView period={period} onPeriodChange={setPeriod} />
      ) : (
        <ClientDashboardView
          tenantId={effectiveTenantId}
          siteId={effectiveSiteId}
          tenantName={selectedTenantName}
          period={period}
           onPeriodChange={setPeriod}
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
