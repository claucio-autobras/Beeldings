import { Controller, ForbiddenException, Get, Query, UseGuards } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { EXCLUDE_NON_BMS_DEVICES } from '../prisma/device-filters.js';
import { DeviceStatusService } from '../mqtt/device-status.service.js';
import { JwtAuthGuard } from '../auth/presentation/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/presentation/guards/roles.guard.js';
import { Roles } from '../auth/presentation/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/presentation/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/domain/interfaces/auth.interface.js';
import { UserRole } from '../auth/domain/interfaces/auth.interface.js';
import { resolveTenantScope } from '../auth/presentation/tenant-scope.util.js';
import { CriticalAssetsService } from './critical-assets.service.js';
import { DashboardInsightsService } from './dashboard-insights.service.js';
import type { TopOffenderEntry, TenantAttentionEntry, AdminTrend } from './dashboard-insights.service.js';
import { AvailabilityService } from '../reports/availability.service.js';

/** Papéis com visão global (mesmo critério do frontend em dashboard.page). */
const GLOBAL_ROLES = new Set(['ADMIN', 'CCO', 'SUPERVISOR']);

/** Janelas suportadas pelo seletor de período do dashboard. */
const PERIOD_MS: Record<string, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

/** Rótulos legíveis das ações de auditoria (mesmos do relatório). */
const AUDIT_ACTION_LABEL: Record<string, string> = {
  LOGIN: 'Entrou no sistema',
  LOGOUT: 'Saiu do sistema',
  CREATE: 'Criou',
  UPDATE: 'Alterou',
  DELETE: 'Excluiu',
  COMMAND: 'Enviou comando',
  ACK: 'Reconheceu alarme',
};

@Controller('dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deviceStatus: DeviceStatusService,
    private readonly criticalAssets: CriticalAssetsService,
    private readonly insights: DashboardInsightsService,
    private readonly availability: AvailabilityService,
  ) {}

  /**
   * GET /dashboard/critical-assets — ativos marcados como críticos com estado
   * atual + métricas operacionais (horas ligado no período, falha contínua,
   * tempo offline). Payload autodescritivo (ms + timestamps ISO), reutilizável
   * pela IA/assistente para manutenção preditiva.
   */
  @Get('critical-assets')
  async getCriticalAssets(
    @CurrentUser() user: AuthenticatedUser,
    @Query('period') period?: string,
    @Query('tenantId') tenantId?: string,
    @Query('siteId') siteId?: string,
  ) {
    const effectiveTenantId = resolveTenantScope(user, tenantId);
    const effectiveSiteId = effectiveTenantId ? (siteId || undefined) : undefined;
    const windowMs = PERIOD_MS[period ?? '24h'] ?? PERIOD_MS['24h'];
    const to = new Date();
    const from = new Date(to.getTime() - windowMs);
    return this.criticalAssets.compute({
      tenantId: effectiveTenantId,
      siteId: effectiveSiteId,
      from,
      to,
    });
  }

  /** Conta quantos dos devices informados estão online pelo status AO VIVO. */
  private countOnline(devices: Array<{ id: string }>): number {
    return devices.filter((d) => this.deviceStatus.getStatus(d.id) === 'online').length;
  }

  /**
   * Agregados globais (todos os clientes) — SÓ papéis com visão global.
   * Achado F1 da auditoria: sem essa restrição, um CLIENTE via nomes de
   * tenants e contagens de alarmes/dispositivos de outros clientes.
   */
  @Get('admin-stats')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CCO, UserRole.SUPERVISOR)
  async getAdminStats() {
    const [devices, gatewaysRaw, activeAlarms, tenants, alarmsPerTenant, activeAutomations] = await Promise.all([
      this.prisma.device.findMany({ where: EXCLUDE_NON_BMS_DEVICES, select: { id: true } }),
      this.prisma.gateway.findMany({
        select: { id: true, tenant: { select: { name: true } } },
        orderBy: { createdAt: 'asc' },
      }),
      // Alarme "ativo" = evento ainda não normalizado (ACTIVE ou ACTIVE_ACK).
      // kind='ALARM' exclui avisos de automação, que não são alarmes de telemetria.
      this.prisma.alarmEvent.count({ where: { kind: 'ALARM', state: { in: ['ACTIVE', 'ACTIVE_ACK'] } } }),
      this.prisma.tenant.findMany({ select: { id: true, name: true } }),
      this.prisma.alarmEvent.groupBy({
        by: ['tenantId'],
        where: { kind: 'ALARM', state: { in: ['ACTIVE', 'ACTIVE_ACK'] } },
        _count: { _all: true },
      }),
      // Automações ativas em TODOS os tenants (visão Admin global).
      this.prisma.automation.count({ where: { enabled: true } }),
    ]);

    const alarmCountByTenant = new Map(alarmsPerTenant.map((g) => [g.tenantId, g._count._all]));

    // Status derivado da telemetria ao vivo (não do status persistido, que desatualiza).
    const totalDevices = devices.length;
    const onlineDevices = this.countOnline(devices);
    const offlineDevices = totalDevices - onlineDevices;

    // Gateways com status AO VIVO — mesma fonte usada em projetos/gateways.
    const gateways = gatewaysRaw.map((g) => ({
      id: g.id,
      name: g.id,
      tenantName: g.tenant?.name ?? '',
      status: this.deviceStatus.getStatus(g.id),
    }));

    return {
      totalDevices,
      onlineDevices,
      devicesByStatus: {
        online: onlineDevices,
        offline: offlineDevices,
      },
      gateways,
      alarmsByTenant: tenants.map((t) => {
        const alarmCount = alarmCountByTenant.get(t.id) ?? 0;
        return {
          tenantName: t.name,
          alarmCount,
          severity: alarmCount > 0 ? 'active' : 'none',
        };
      }),
      activeAlarms,
      activeAutomations,
    };
  }

  @Get('client-stats')
  async getClientStats(
    @CurrentUser() user: AuthenticatedUser,
    @Query('tenantId') tenantId?: string,
  ) {
    const isGlobal = GLOBAL_ROLES.has(user.role);
    const effectiveTenantId = isGlobal
      ? (tenantId ?? user.tenantId ?? undefined)
      : (user.tenantId ?? undefined);

    // Achado F8: papel sem visão global e sem tenant NUNCA pode cair no
    // escopo "todos os clientes" — nega em vez de vazar agregados globais.
    if (!isGlobal && !effectiveTenantId) {
      throw new ForbiddenException('Usuário sem cliente associado');
    }

    const where = effectiveTenantId ? { tenantId: effectiveTenantId } : {};

    const [devices, alarmCount] = await Promise.all([
      this.prisma.device.findMany({ where: { ...where, ...EXCLUDE_NON_BMS_DEVICES }, select: { id: true } }),
      this.prisma.alarmEvent.count({ where: { ...where, kind: 'ALARM', state: { in: ['ACTIVE', 'ACTIVE_ACK'] } } }),
    ]);

    return {
      deviceCount: devices.length,
      onlineDevices: this.countOnline(devices),
      alarmCount,
    };
  }

  /**
   * Agregados de período do dashboard modernizado (24h/7d/30d).
   *
   * Retorna, para a janela atual e a anterior (mesma duração, imediatamente
   * antes): alarmes disparados, resolvidos (normalizados) e tempo médio até o
   * ACK (ativação → reconhecimento). Na visão do cliente (tenant efetivo),
   * inclui a disponibilidade real do período (mesma base do relatório de
   * disponibilidade — status_events) e os top ofensores (regras com mais
   * ativações). Na visão global (sem tenant), inclui o ranking de clientes
   * por score composto (ativos críticos em falha, gateways offline, alarmes
   * ativos, dispositivos offline, backlog de ACK), a tendência do período em
   * buckets e o feed de auditoria recente. Sempre kind='ALARM' (avisos de
   * automação ficam de fora), clientes inativos excluídos do escopo global e
   * dispositivos virtuais fora das contagens de equipamentos.
   */
  @Get('overview')
  async getOverview(
    @CurrentUser() user: AuthenticatedUser,
    @Query('period') period?: string,
    @Query('tenantId') tenantId?: string,
    @Query('siteId') siteId?: string,
  ) {
    const isGlobal = GLOBAL_ROLES.has(user.role);
    // Papel de cliente sem tenant NUNCA cai no escopo global (mesma regra do
    // client-stats — achado F8): resolveTenantScope nega com 403.
    const effectiveTenantId = resolveTenantScope(user, tenantId);
    const effectiveSiteId = effectiveTenantId ? (siteId || undefined) : undefined;

    // Normaliza o período uma vez: janela e granularidade de bucket sempre
    // derivam do MESMO rótulo (período inválido cai em 24h por inteiro).
    const effectivePeriod = PERIOD_MS[period ?? '24h'] ? (period ?? '24h') : '24h';
    const windowMs = PERIOD_MS[effectivePeriod];
    const to = new Date();
    const from = new Date(to.getTime() - windowMs);
    const prevFrom = new Date(from.getTime() - windowMs);

    // Escopo global: exclui eventos de clientes inativos (mesma regra das
    // demais listas/contagens de alarmes).
    const inactiveTenants = effectiveTenantId
      ? []
      : (await this.prisma.tenant.findMany({ where: { active: false }, select: { id: true } })).map((t) => t.id);

    const scope: Prisma.AlarmEventWhereInput = {
      kind: 'ALARM',
      ...(effectiveTenantId
        ? { tenantId: effectiveTenantId }
        : inactiveTenants.length > 0
          ? { tenantId: { notIn: inactiveTenants } }
          : {}),
      ...(effectiveSiteId ? { alarmRule: { point: { device: { siteId: effectiveSiteId } } } } : {}),
    };

    const windowStats = async (start: Date, end: Date) => {
      const [activated, resolved, acked] = await Promise.all([
        this.prisma.alarmEvent.count({
          where: { ...scope, activatedAt: { gte: start, lt: end } },
        }),
        this.prisma.alarmEvent.count({
          where: { ...scope, normalizedAt: { gte: start, lt: end } },
        }),
        // Só alarmes que ATIVARAM dentro da janela — ACKs de alarmes muito
        // antigos não distorcem mais o indicador de tempo de resposta.
        this.prisma.alarmEvent.findMany({
          where: {
            ...scope,
            activatedAt: { gte: start, lt: end },
            acknowledgedAt: { not: null },
          },
          select: { activatedAt: true, acknowledgedAt: true },
        }),
      ]);
      const deltas = acked
        .map((e) => (e.acknowledgedAt ? e.acknowledgedAt.getTime() - e.activatedAt.getTime() : null))
        .filter((d): d is number => d !== null && d >= 0)
        .sort((a, b) => a - b);
      // Mediana em vez de média: um único ACK atrasado não deve mascarar a
      // velocidade típica da equipe.
      let ackMedianMs: number | null = null;
      if (deltas.length > 0) {
        const mid = Math.floor(deltas.length / 2);
        ackMedianMs = deltas.length % 2 === 1
          ? deltas[mid]
          : Math.round((deltas[mid - 1] + deltas[mid]) / 2);
      }
      return { activated, resolved, ackMedianMs, ackCount: deltas.length };
    };

    const [current, previous, tenantsTotal, tenantsActive] = await Promise.all([
      windowStats(from, to),
      windowStats(prevFrom, from),
      this.prisma.tenant.count(),
      this.prisma.tenant.count({ where: { active: true } }),
    ]);

    // Extras da visão do cliente (tenant efetivo): disponibilidade real do
    // período (mesma base do relatório — status_events) e top ofensores.
    let availabilitySummary: {
      avgUptimePct: number | null;
      entityCount: number;
      withDataCount: number;
    } | null = null;
    let topOffenders: TopOffenderEntry[] | null = null;

    if (effectiveTenantId) {
      const [avail, offenders] = await Promise.all([
        this.availability.compute({
          tenantId: effectiveTenantId,
          siteId: effectiveSiteId,
          from,
          to,
        }),
        this.insights.topOffenders({
          tenantId: effectiveTenantId,
          siteId: effectiveSiteId,
          from,
          to,
        }),
      ]);
      availabilitySummary = {
        avgUptimePct:
          avail.summary.avgUptimePct !== null
            ? Math.round(avail.summary.avgUptimePct * 10) / 10
            : null,
        entityCount: avail.summary.entityCount,
        withDataCount: avail.summary.withDataCount,
      };
      topOffenders = offenders;
    }

    // Extras da visão global (Admin sem cliente selecionado).
    let tenantRanking: TenantAttentionEntry[] | null = null;
    let trend: AdminTrend | null = null;
    let recentAudit: Array<{
      id: string;
      createdAt: string;
      actorName: string;
      action: string;
      entityName: string | null;
      tenantName: string | null;
      result: string;
    }> | null = null;

    if (isGlobal && !effectiveTenantId) {
      const [ranking, adminTrend, auditLogs] = await Promise.all([
        // Score composto: ativos críticos em falha, gateways offline, alarmes
        // ativos, dispositivos offline e backlog de ACK.
        this.insights.tenantAttention(),
        // Evolução no período: ativações + transições offline por bucket,
        // agregadas sobre clientes ativos (inativos excluídos).
        this.insights.adminTrend({ from, to, period: effectivePeriod, excludeTenantIds: inactiveTenants }),
        this.prisma.auditLog.findMany({
          orderBy: { createdAt: 'desc' },
          take: 8,
          select: {
            id: true, createdAt: true, actorName: true, actorEmail: true,
            action: true, entityType: true, entityName: true, tenantName: true, result: true,
          },
        }),
      ]);

      tenantRanking = ranking;
      trend = adminTrend;

      recentAudit = auditLogs.map((l) => ({
        id: l.id,
        createdAt: l.createdAt.toISOString(),
        actorName: l.actorName || l.actorEmail || 'Sistema',
        action: [AUDIT_ACTION_LABEL[l.action] ?? l.action, l.entityType].filter(Boolean).join(' '),
        entityName: l.entityName ?? null,
        tenantName: l.tenantName ?? null,
        result: l.result,
      }));
    }

    return {
      period: effectivePeriod,
      from: from.toISOString(),
      to: to.toISOString(),
      current,
      previous,
      tenants: { total: tenantsTotal, active: tenantsActive },
      // Visão do cliente (tenant efetivo) apenas; null no global.
      availability: availabilitySummary,
      topOffenders,
      // Visão global (Admin) apenas; null nas demais.
      tenantRanking,
      trend,
      recentAudit,
    };
  }
}
