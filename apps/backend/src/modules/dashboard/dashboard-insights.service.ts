import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { DeviceStatusService } from '../mqtt/device-status.service.js';
import { EXCLUDE_NON_BMS_DEVICES } from '../prisma/device-filters.js';

/** Top ofensor do período: regra/equipamento com mais ativações de alarme. */
export interface TopOffenderEntry {
  ruleId: string;
  ruleName: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH';
  deviceId: string;
  deviceName: string;
  pointName: string | null;
  siteName: string | null;
  /** Ativações (eventos com activatedAt dentro da janela). */
  count: number;
  /** Evento mais recente da regra na janela (deep-link /alarms?highlight=). */
  lastEventId: string;
  lastActivatedAt: string;
}

/** Fatores + score do ranking "Atenção por Cliente". */
export interface TenantAttentionEntry {
  tenantId: string;
  tenantName: string;
  activeAlarms: number;
  offlineDevices: number;
  /** Alarmes ativos em devices/pontos marcados como críticos. */
  criticalFaults: number;
  offlineGateways: number;
  /** Alarmes normalizados aguardando reconhecimento (backlog de ACK). */
  pendingAck: number;
  score: number;
}

export interface TrendBucket {
  start: string;
  /** Alarmes disparados (ativados) no bucket. */
  activated: number;
  /** Transições para offline registradas em status_events no bucket. */
  offlineTransitions: number;
}

export interface AdminTrend {
  bucketMs: number;
  buckets: TrendBucket[];
}

/**
 * Score composto do ranking de atenção: falha em ativo crítico pesa mais que
 * gateway offline, que pesa mais que alarme ativo comum; dispositivos offline
 * e backlog de ACK entram com peso 1 (ruído de fundo, mas não dominante).
 */
export function attentionScore(e: {
  activeAlarms: number;
  offlineDevices: number;
  criticalFaults: number;
  offlineGateways: number;
  pendingAck: number;
}): number {
  return (
    e.criticalFaults * 5 +
    e.offlineGateways * 4 +
    e.activeAlarms * 3 +
    e.offlineDevices +
    e.pendingAck
  );
}

/**
 * Agregados "inteligentes" do dashboard: top ofensores do período (cliente),
 * ranking de atenção por cliente com score composto (admin) e tendência do
 * período em buckets (admin) — tudo derivado de dados já persistidos
 * (alarm_events/status_events) + status ao vivo, sem histórico novo.
 */
@Injectable()
export class DashboardInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deviceStatus: DeviceStatusService,
  ) {}

  /**
   * Regras de alarme com mais ativações na janela, no escopo tenant(/site).
   * Conta eventos kind='ALARM' com activatedAt dentro da janela — a mesma
   * semântica do contador "disparados" do overview.
   */
  async topOffenders(input: {
    tenantId: string;
    siteId?: string;
    from: Date;
    to: Date;
    limit?: number;
  }): Promise<TopOffenderEntry[]> {
    const limit = input.limit ?? 5;
    const where: Prisma.AlarmEventWhereInput = {
      kind: 'ALARM',
      tenantId: input.tenantId,
      activatedAt: { gte: input.from, lt: input.to },
      alarmRuleId: { not: null },
      ...(input.siteId
        ? { alarmRule: { point: { device: { siteId: input.siteId } } } }
        : {}),
    };

    const grouped = await this.prisma.alarmEvent.groupBy({
      by: ['alarmRuleId'],
      where,
      _count: { _all: true },
      orderBy: { _count: { alarmRuleId: 'desc' } },
      take: limit,
    });
    const ruleIds = grouped
      .map((g) => g.alarmRuleId)
      .filter((id): id is string => id !== null);
    if (ruleIds.length === 0) return [];

    const [rules, lastEvents] = await Promise.all([
      this.prisma.alarmRule.findMany({
        where: { id: { in: ruleIds } },
        select: {
          id: true,
          name: true,
          severity: true,
          point: {
            select: {
              tag: true,
              objectName: true,
              device: {
                select: { id: true, name: true, site: { select: { name: true } } },
              },
            },
          },
        },
      }),
      // Evento mais recente de cada regra dentro da janela (deep-link).
      Promise.all(
        ruleIds.map((ruleId) =>
          this.prisma.alarmEvent.findFirst({
            where: { ...where, alarmRuleId: ruleId },
            orderBy: { activatedAt: 'desc' },
            select: { id: true, activatedAt: true },
          }),
        ),
      ),
    ]);

    const ruleById = new Map(rules.map((r) => [r.id, r]));
    const lastByRule = new Map(ruleIds.map((id, i) => [id, lastEvents[i]]));

    const out: TopOffenderEntry[] = [];
    for (const g of grouped) {
      const ruleId = g.alarmRuleId;
      if (!ruleId) continue;
      const rule = ruleById.get(ruleId);
      const last = lastByRule.get(ruleId);
      if (!rule || !last) continue; // regra apagada entre as queries
      out.push({
        ruleId,
        ruleName: rule.name,
        severity: rule.severity as 'LOW' | 'MEDIUM' | 'HIGH',
        deviceId: rule.point.device.id,
        deviceName: rule.point.device.name,
        pointName: rule.point.objectName || rule.point.tag || null,
        siteName: rule.point.device.site?.name ?? null,
        count: g._count._all,
        lastEventId: last.id,
        lastActivatedAt: last.activatedAt.toISOString(),
      });
    }
    // groupBy ordena por _count de alarmRuleId; reforça a ordenação por
    // contagem (desc) com desempate estável por nome.
    out.sort((a, b) => b.count - a.count || a.ruleName.localeCompare(b.ruleName));
    return out;
  }

  /**
   * Ranking "Atenção por Cliente" (visão global): fatores por tenant ativo +
   * score composto. Só entram clientes com score > 0.
   */
  async tenantAttention(limit = 8): Promise<TenantAttentionEntry[]> {
    const activeStates = ['ACTIVE', 'ACTIVE_ACK'] as const;
    const [tenants, activePerTenant, pendingAckPerTenant, criticalFaultEvents, devices, gateways] =
      await Promise.all([
        this.prisma.tenant.findMany({ where: { active: true }, select: { id: true, name: true } }),
        this.prisma.alarmEvent.groupBy({
          by: ['tenantId'],
          where: { kind: 'ALARM', state: { in: [...activeStates] } },
          _count: { _all: true },
        }),
        this.prisma.alarmEvent.groupBy({
          by: ['tenantId'],
          where: { kind: 'ALARM', state: 'NORMALIZED_UNACK' },
          _count: { _all: true },
        }),
        // Alarmes ativos em ativos críticos (ponto crítico OU device crítico).
        this.prisma.alarmEvent.findMany({
          where: {
            kind: 'ALARM',
            state: { in: [...activeStates] },
            alarmRule: {
              point: {
                OR: [{ critical: true }, { device: { critical: true } }],
              },
            },
          },
          select: { tenantId: true },
        }),
        this.prisma.device.findMany({
          where: EXCLUDE_NON_BMS_DEVICES,
          select: { id: true, tenantId: true },
        }),
        this.prisma.gateway.findMany({ select: { id: true, tenantId: true } }),
      ]);

    const activeByTenant = new Map(activePerTenant.map((g) => [g.tenantId, g._count._all]));
    const pendingAckByTenant = new Map(pendingAckPerTenant.map((g) => [g.tenantId, g._count._all]));

    const criticalByTenant = new Map<string, number>();
    for (const e of criticalFaultEvents) {
      criticalByTenant.set(e.tenantId, (criticalByTenant.get(e.tenantId) ?? 0) + 1);
    }

    const offlineDevicesByTenant = new Map<string, number>();
    for (const d of devices) {
      if (this.deviceStatus.getStatus(d.id) !== 'online') {
        offlineDevicesByTenant.set(d.tenantId, (offlineDevicesByTenant.get(d.tenantId) ?? 0) + 1);
      }
    }
    const offlineGatewaysByTenant = new Map<string, number>();
    for (const g of gateways) {
      if (this.deviceStatus.getStatus(g.id) !== 'online') {
        offlineGatewaysByTenant.set(g.tenantId, (offlineGatewaysByTenant.get(g.tenantId) ?? 0) + 1);
      }
    }

    return tenants
      .map((t) => {
        const factors = {
          activeAlarms: activeByTenant.get(t.id) ?? 0,
          offlineDevices: offlineDevicesByTenant.get(t.id) ?? 0,
          criticalFaults: criticalByTenant.get(t.id) ?? 0,
          offlineGateways: offlineGatewaysByTenant.get(t.id) ?? 0,
          pendingAck: pendingAckByTenant.get(t.id) ?? 0,
        };
        return {
          tenantId: t.id,
          tenantName: t.name,
          ...factors,
          score: attentionScore(factors),
        };
      })
      .filter((t) => t.score > 0)
      .sort((a, b) => b.score - a.score || a.tenantName.localeCompare(b.tenantName))
      .slice(0, limit);
  }

  /**
   * Tendência do período (visão global): ativações de alarme e transições para
   * offline por bucket de tempo, agregadas sobre os clientes ativos.
   * Buckets de 1h em 24h e de 1 dia em 7d/30d (mesma granularidade do gráfico
   * de severidade).
   */
  async adminTrend(input: {
    from: Date;
    to: Date;
    period: string;
    excludeTenantIds: string[];
  }): Promise<AdminTrend> {
    const bucketMs = input.period === '24h' ? 60 * 60 * 1000 : 24 * 60 * 60 * 1000;
    const start = input.from.getTime();
    const end = input.to.getTime();
    const count = Math.max(1, Math.ceil((end - start) / bucketMs));

    const tenantScope =
      input.excludeTenantIds.length > 0
        ? { tenantId: { notIn: input.excludeTenantIds } }
        : {};

    const [activations, offlineEvents] = await Promise.all([
      this.prisma.alarmEvent.findMany({
        where: {
          kind: 'ALARM',
          ...tenantScope,
          activatedAt: { gte: input.from, lt: input.to },
        },
        select: { activatedAt: true },
      }),
      this.prisma.statusEvent.findMany({
        where: {
          status: 'offline',
          ...tenantScope,
          at: { gte: input.from, lt: input.to },
        },
        select: { at: true },
      }),
    ]);

    const buckets: TrendBucket[] = Array.from({ length: count }, (_, i) => ({
      start: new Date(start + i * bucketMs).toISOString(),
      activated: 0,
      offlineTransitions: 0,
    }));
    const idxOf = (t: number) => Math.min(count - 1, Math.max(0, Math.floor((t - start) / bucketMs)));
    for (const e of activations) buckets[idxOf(e.activatedAt.getTime())].activated += 1;
    for (const e of offlineEvents) buckets[idxOf(e.at.getTime())].offlineTransitions += 1;

    return { bucketMs, buckets };
  }
}
