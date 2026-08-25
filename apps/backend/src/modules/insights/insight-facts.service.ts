import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { EXCLUDE_VIRTUAL_DEVICES } from '../prisma/device-filters.js';
import { AvailabilityService } from '../reports/availability.service.js';

// ─── Payload factual ──────────────────────────────────────────────────────────
// Fonte ÚNICA de verdade do insight: todo número citado pela IA vem daqui.

export interface InsightFacts {
  tenantId: string;
  tenantName: string;
  period: { from: string; to: string; label: string };
  /** false quando o período não tem alarmes NEM cobertura de disponibilidade. */
  hasData: boolean;
  alarms: {
    total: number;
    bySeverity: { high: number; medium: number; low: number };
    acknowledged: number;
    /** Ocorrências ainda ativas no momento da geração. */
    stillActive: number;
    topRules: Array<{ name: string; deviceName: string; severity: string; count: number }>;
    topDevices: Array<{ deviceName: string; siteName: string | null; count: number }>;
  };
  availability: {
    entityCount: number;
    withDataCount: number;
    avgUptimePct: number | null;
    totalDrops: number;
    totalOfflineMs: number;
    worst: Array<{ name: string; uptimePct: number }>;
    longestOffline: { name: string; ms: number } | null;
  };
  criticalAssets: {
    /** Total de ativos marcados como críticos (equipamentos + pontos). */
    totalCritical: number;
    /** Ativos críticos que tiveram alarme no período. */
    inFaultDuringPeriod: Array<{ deviceName: string; alarmCount: number; maxSeverity: string }>;
  };
}

const TOP_LIMIT = 5;
/** Tamanho do lote da paginação por cursor — a agregação percorre TODOS os eventos. */
const BATCH_SIZE = 1000;
const SEVERITY_RANK: Record<string, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

/**
 * Seleção de alarmes do insight por SOBREPOSIÇÃO de INTERVALO ATIVO ao período
 * `[from, to)` (`to` EXCLUSIVO — evento exatamente em `to` pertence só ao
 * período seguinte, nunca aos dois).
 *
 * O motor REUSA a ocorrência na reativação antes do ACK (limpa `normalizedAt`,
 * grava `lastReactivatedAt`), então o estado atual NÃO prova atividade
 * histórica: uma ocorrência normalizada antes de `from` e reativada depois de
 * `to` está ACTIVE hoje sem nunca ter sobreposto o período. Por isso cada ramo
 * é limitado ao intervalo que ele evidencia:
 *   a) ativação dentro do período (`activatedAt >= from`, com o teto global);
 *   b) sem reativação e normalizada depois de `from`: o intervalo único
 *      [activatedAt, normalizedAt) cruza o início do período;
 *   c) sem reativação e ainda ativa: ativa contínua desde `activatedAt < to`;
 *   d) reativada ANTES de `to` e (ainda ativa OU renormalizada depois de
 *      `from`): o último intervalo [lastReactivatedAt, fim) sobrepõe o período.
 * Intervalos intermediários destruídos pelo reuso da linha (normalização dentro
 * do período seguida de reativação após `to`) não são reconstruíveis — a
 * seleção prefere OMITIR a contar em período errado (sem falso positivo).
 */
export function insightAlarmOverlapWhere(from: Date, to: Date): Prisma.AlarmEventWhereInput {
  const ACTIVE_STATES: Prisma.AlarmEventWhereInput['state'] = {
    in: ['ACTIVE', 'ACTIVE_ACK'],
  };
  return {
    AND: [
      { activatedAt: { lt: to } },
      {
        OR: [
          // a) ativou dentro do período
          { activatedAt: { gte: from } },
          // b) intervalo único cruzando o início do período
          { lastReactivatedAt: null, normalizedAt: { gt: from } },
          // c) ativa contínua desde antes do fim do período
          { lastReactivatedAt: null, state: ACTIVE_STATES },
          // d) último intervalo (reativação) começou antes de `to`…
          {
            lastReactivatedAt: { lt: to },
            OR: [
              { state: ACTIVE_STATES }, // …e segue ativo
              { normalizedAt: { gt: from } }, // …ou terminou depois de `from`
            ],
          },
        ],
      },
    ],
  };
}

/**
 * Agregador factual do insight: consolida, para UM tenant e UM período, os
 * números relevantes (alarmes por severidade e mais recorrentes, disponibilidade,
 * quedas/tempo offline e ativos críticos em falha). Escopo ESTRITO do tenant —
 * toda consulta filtra por tenantId; dispositivos virtuais (Bancada) ficam fora.
 */
@Injectable()
export class InsightFactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly availability: AvailabilityService,
  ) {}

  async compute(tenantId: string, from: Date, to: Date, periodLabel: string): Promise<InsightFacts> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true },
    });
    if (!tenant) throw new NotFoundException('Cliente não encontrado');

    const [availabilityData, criticalDevices, criticalPoints] = await Promise.all([
      // A disponibilidade dos relatórios usa fim INCLUSIVO (`at <= to`); o
      // insight fecha períodos com `to` EXCLUSIVO — converte para o último
      // instante interno ao período, senão uma transição exatamente em `to`
      // contaria como queda do período anterior.
      this.availability.compute({ tenantId, from, to: new Date(to.getTime() - 1) }),
      this.prisma.device.count({ where: { tenantId, critical: true, ...EXCLUDE_VIRTUAL_DEVICES } }),
      this.prisma.devicePoint.count({
        where: { critical: true, device: { tenantId, ...EXCLUDE_VIRTUAL_DEVICES } },
      }),
    ]);

    // ── Alarmes por severidade / estado ──
    // Paginação por cursor (ordem determinística por id): a agregação percorre
    // TODOS os eventos do período — sem teto silencioso.
    const alarmWhere: Prisma.AlarmEventWhereInput = {
      tenantId,
      kind: 'ALARM',
      ...insightAlarmOverlapWhere(from, to),
      alarmRule: { point: { device: EXCLUDE_VIRTUAL_DEVICES } },
    };
    const bySeverity = { high: 0, medium: 0, low: 0 };
    let totalEvents = 0;
    let acknowledged = 0;
    let stillActive = 0;
    const ruleCount = new Map<string, { name: string; deviceName: string; severity: string; count: number }>();
    const deviceCount = new Map<string, { deviceName: string; siteName: string | null; count: number }>();
    const criticalFaults = new Map<string, { deviceName: string; alarmCount: number; maxSeverity: string }>();

    let cursor: string | undefined;
    for (;;) {
      const batch = await this.prisma.alarmEvent.findMany({
        where: alarmWhere,
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: {
          id: true,
          state: true,
          acknowledgedAt: true,
          alarmRule: {
            select: {
              name: true,
              severity: true,
              point: {
                select: {
                  critical: true,
                  device: {
                    select: {
                      id: true,
                      name: true,
                      critical: true,
                      site: { select: { name: true } },
                    },
                  },
                },
              },
            },
          },
        },
      });

      for (const e of batch) {
        const rule = e.alarmRule;
        if (!rule) continue;
        const sev = rule.severity;
        if (sev === 'HIGH') bySeverity.high += 1;
        else if (sev === 'MEDIUM') bySeverity.medium += 1;
        else bySeverity.low += 1;
        if (e.acknowledgedAt) acknowledged += 1;
        if (e.state === 'ACTIVE' || e.state === 'ACTIVE_ACK') stillActive += 1;

        const device = rule.point.device;
        const ruleKey = `${device.id}|${rule.name}`;
        const r = ruleCount.get(ruleKey);
        if (r) r.count += 1;
        else ruleCount.set(ruleKey, { name: rule.name, deviceName: device.name, severity: sev, count: 1 });

        const d = deviceCount.get(device.id);
        if (d) d.count += 1;
        else deviceCount.set(device.id, { deviceName: device.name, siteName: device.site?.name ?? null, count: 1 });

        // Ativo crítico em falha: alarme em device crítico OU em ponto crítico.
        if (device.critical || rule.point.critical) {
          const c = criticalFaults.get(device.id);
          if (c) {
            c.alarmCount += 1;
            if ((SEVERITY_RANK[sev] ?? 0) > (SEVERITY_RANK[c.maxSeverity] ?? 0)) c.maxSeverity = sev;
          } else {
            criticalFaults.set(device.id, { deviceName: device.name, alarmCount: 1, maxSeverity: sev });
          }
        }
      }

      totalEvents += batch.length;
      if (batch.length < BATCH_SIZE) break;
      cursor = batch[batch.length - 1].id;
    }

    const topRules = [...ruleCount.values()].sort((a, b) => b.count - a.count).slice(0, TOP_LIMIT);
    const topDevices = [...deviceCount.values()].sort((a, b) => b.count - a.count).slice(0, TOP_LIMIT);

    // ── Disponibilidade (mesma fonte do relatório) ──
    const s = availabilityData.summary;
    const withData = availabilityData.rows.filter((r) => !r.noData);
    let longestOffline: { name: string; ms: number } | null = null;
    for (const r of withData) {
      if (r.longestOfflineMs > 0 && (!longestOffline || r.longestOfflineMs > longestOffline.ms)) {
        longestOffline = { name: r.name, ms: r.longestOfflineMs };
      }
    }

    const hasData = totalEvents > 0 || s.withDataCount > 0;

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      period: { from: from.toISOString(), to: to.toISOString(), label: periodLabel },
      hasData,
      alarms: {
        total: totalEvents,
        bySeverity,
        acknowledged,
        stillActive,
        topRules,
        topDevices,
      },
      availability: {
        entityCount: s.entityCount,
        withDataCount: s.withDataCount,
        avgUptimePct: s.avgUptimePct == null ? null : Number(s.avgUptimePct.toFixed(2)),
        totalDrops: s.totalDrops,
        totalOfflineMs: s.totalOfflineMs,
        worst: s.worst.map((w) => ({ name: w.name, uptimePct: Number(w.uptimePct.toFixed(2)) })),
        longestOffline,
      },
      criticalAssets: {
        totalCritical: criticalDevices + criticalPoints,
        inFaultDuringPeriod: [...criticalFaults.values()].sort((a, b) => b.alarmCount - a.alarmCount),
      },
    };
  }
}
