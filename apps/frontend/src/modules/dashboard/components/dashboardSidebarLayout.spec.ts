import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { DashboardSidebarStack } from './DashboardSidebarStack';

const componentSource = readFileSync(join(__dirname, 'DashboardSidebarStack.tsx'), 'utf8');
const gatewaysSource = readFileSync(join(__dirname, 'GatewaysHealthTable.tsx'), 'utf8');
const dashboardSource = readFileSync(join(__dirname, '../pages/dashboard.page.tsx'), 'utf8');

describe('dashboard sidebar layout', () => {
  it('keeps the recent alarm card in the normal flow', () => {
    expect(componentSource).toContain('className="min-w-0 space-y-4"');
    expect(componentSource).toContain('{recentAlarms && (');
    expect(componentSource).toContain('{children &&');
    expect(componentSource.indexOf('{recentAlarms}')).toBeLessThan(componentSource.indexOf('{children}'));
    expect(componentSource).toContain('data-testid="dashboard-recent-alarms"');
    expect(componentSource).not.toMatch(/\bsticky\b/);
    expect(componentSource).not.toMatch(/\bfixed\b/);
    expect(componentSource).not.toContain('overflow-y-auto');
  });

  it('lets the main dashboard scroller receive the wheel over the gateway card', () => {
    expect(componentSource).not.toMatch(/onScroll|scrollTop|translate[XY]|use(Layout)?Effect/);
    expect(componentSource).not.toMatch(/overflow-(?:auto|scroll|y-auto|y-scroll)/);
    expect(gatewaysSource).not.toContain('overflow-y-auto');
    expect(gatewaysSource).not.toContain('overscroll-contain');
  });

  it('uses the same alarm slot for admin and client dashboards', () => {
    expect(dashboardSource).toContain('function AdminDashboardView');
    expect(dashboardSource).toContain('function ClientDashboardView');
    expect(dashboardSource).toContain('recentAlarms={');
    expect(dashboardSource).toContain('<RecentAlarmsCard events={recentActiveAlarms}');
    expect(dashboardSource).toContain('contextCard={');
    expect(dashboardSource).toContain('<SiteOverviewSection');
  });

  it('uses the shared mockup panel language without legacy chamfers', () => {
    const recentSource = readFileSync(join(__dirname, 'RecentAlarmsCard.tsx'), 'utf8');
    const criticalSource = readFileSync(join(__dirname, 'CriticalAssetsCard.tsx'), 'utf8');
    expect(recentSource).toContain('DashboardPanel');
    expect(criticalSource).toContain('DashboardPanel');
    expect(recentSource).not.toContain('chamfer');
    expect(criticalSource).not.toContain('chamfer');
    expect(criticalSource).toContain('critical-assets-scroll');
  });

  it('keeps the indicator and recent-alarm panels in a responsive two-column band', () => {
    expect(dashboardSource).toContain(
      'xl:grid-cols-[minmax(0,1.3fr)_minmax(360px,.7fr)]',
    );
    expect(dashboardSource).toContain('DashboardPanel className="px-4 pb-4 pt-5 sm:px-7" accent');
    expect(dashboardSource).toContain("t('Indicadores essenciais')");
  });

  it('keeps the mockup reading order and removes the legacy client cards', () => {
    const context = dashboardSource.indexOf('{contextCard}');
    const workOrders = dashboardSource.indexOf('{workOrders}');
    const timeline = dashboardSource.indexOf('{timeline}');
    const critical = dashboardSource.indexOf('{criticalAssets}');
    const gateways = dashboardSource.indexOf('{gateways}');
    const activity = dashboardSource.indexOf('{activity}');

    expect(context).toBeGreaterThanOrEqual(0);
    expect(critical).toBeGreaterThan(context);
    expect(timeline).toBeGreaterThan(critical);
    expect(workOrders).toBeGreaterThan(timeline);
    expect(gateways).toBeGreaterThan(critical);
    expect(activity).toBeGreaterThan(gateways);
    expect(dashboardSource).not.toContain('QuickAccess');
    expect(dashboardSource).not.toContain('OperationalSummaryCard');
    expect(dashboardSource).not.toContain('TopOffendersCard');
    expect(dashboardSource).not.toContain('DeviceAreaTable');
  });

  it('passes the effective tenant to the client gateway query and hides global context there', () => {
    expect(dashboardSource).toContain(
      '<GatewaysHealthTable',
    );
    expect(dashboardSource).toContain('tenantId={tenantId}');
    expect(dashboardSource).toContain('isAdminView={isAdminProfile}');
    expect(gatewaysSource).toContain("queryKey: ['gateways', tenantId ?? 'all']");
    expect(gatewaysSource).toContain('queryFn: () => getGateways(tenantId)');
    expect(gatewaysSource).toContain('const showTenantContext = isAdminView && !tenantId;');
    expect(gatewaysSource).toContain('table-fixed');
    expect(gatewaysSource).not.toContain('overflow-x-auto');
    expect(gatewaysSource).toContain('DashboardPanel');
    expect(gatewaysSource).toContain("t('Fila S&F')");
    expect(gatewaysSource).toContain("t('Reconexões')");
    expect(gatewaysSource).toContain('Array.from({ length: 5 }');
    expect(dashboardSource).toContain('siteName={selectedSiteName}');
  });

  it('exports the stack component for the dashboard composition', () => {
    expect(DashboardSidebarStack).toBeDefined();
  });
});