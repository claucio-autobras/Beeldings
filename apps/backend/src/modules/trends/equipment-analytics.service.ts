import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

const DAY_MS = 24 * 3600 * 1000;

export interface OpStateAt {
  status: number | null;
  mode: number | null;
  setpoint: number | null;
}

interface OpSeries {
  role: 'status' | 'mode' | 'setpoint';
  /** Ordenado por timestamp ASC; inclui 1 amostra anterior à janela (valor vigente). */
  samples: { t: number; value: number }[];
}

/** Valor vigente (última amostra <= t) de uma série ordenada — busca binária. */
export function valueAt(samples: { t: number; value: number }[], t: number): number | null {
  if (samples.length === 0 || samples[0].t > t) return null;
  let lo = 0;
  let hi = samples.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (samples[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return samples[lo].value;
}

/**
 * Consultas analíticas por equipamento para IA/manutenção preditiva:
 * - Telemetria anotada com o contexto operacional vigente (ligado/desligado,
 *   modo, setpoint) em cada instante — sem cruzamentos manuais.
 * - Linha do tempo: telemetria + alarmes + comandos alinhados no tempo.
 */
@Injectable()
export class EquipmentAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  private async loadDevice(deviceId: string, tenantId: string | undefined) {
    const device = await this.prisma.device.findFirst({
      where: { id: deviceId, ...(tenantId ? { tenantId } : {}) },
      include: { points: { include: { trends: { select: { id: true, enabled: true } } } } },
    });
    if (!device) throw new NotFoundException('Dispositivo não encontrado');
    return device;
  }

  /** Janela padrão de 24h terminando agora. */
  private resolveWindow(from?: Date, to?: Date): { from: Date; to: Date } {
    const rTo = to ?? new Date();
    const rFrom = from ?? new Date(rTo.getTime() - DAY_MS);
    if (rFrom.getTime() >= rTo.getTime()) throw new BadRequestException('Período inválido (from >= to)');
    return { from: rFrom, to: rTo };
  }

  /** Carrega as séries dos pontos operacionais (opRole) do device na janela. */
  private async loadOpSeries(
    points: { id: string; opRole: string | null; trends: { id: string }[] }[],
    from: Date,
    to: Date,
  ): Promise<OpSeries[]> {
    const opPoints = points.filter(
      (p): p is typeof p & { opRole: 'status' | 'mode' | 'setpoint' } =>
        p.opRole === 'status' || p.opRole === 'mode' || p.opRole === 'setpoint',
    );
    const series: OpSeries[] = [];
    for (const p of opPoints) {
      const trendIds = p.trends.map((t) => t.id);
      if (trendIds.length === 0) {
        series.push({ role: p.opRole, samples: [] });
        continue;
      }
      const [prev, inWindow] = await Promise.all([
        this.prisma.trendRecord.findFirst({
          where: { trendId: { in: trendIds }, timestamp: { lt: from } },
          orderBy: { timestamp: 'desc' },
          select: { timestamp: true, value: true },
        }),
        this.prisma.trendRecord.findMany({
          where: { trendId: { in: trendIds }, timestamp: { gte: from, lte: to } },
          orderBy: { timestamp: 'asc' },
          select: { timestamp: true, value: true },
        }),
      ]);
      const samples = [
        ...(prev ? [{ t: prev.timestamp.getTime(), value: prev.value }] : []),
        ...inWindow.map((r) => ({ t: r.timestamp.getTime(), value: r.value })),
      ];
      series.push({ role: p.opRole, samples });
    }
    return series;
  }

  /** Anota cada timestamp com o estado operacional vigente. */
  private annotate(series: OpSeries[], t: number): OpStateAt {
    const state: OpStateAt = { status: null, mode: null, setpoint: null };
    for (const s of series) state[s.role] = valueAt(s.samples, t);
    return state;
  }

  /**
   * GET /devices/:id/context-series — telemetria (trend) de um ponto já anotada
   * com o estado operacional (status/mode/setpoint) vigente em cada instante.
   */
  async contextSeries(
    deviceId: string,
    tenantId: string | undefined,
    pointId: string,
    fromRaw?: Date,
    toRaw?: Date,
  ) {
    const device = await this.loadDevice(deviceId, tenantId);
    const point = device.points.find((p) => p.id === pointId);
    if (!point) throw new NotFoundException('Ponto não encontrado neste dispositivo');
    const trendIds = point.trends.map((t) => t.id);
    if (trendIds.length === 0) {
      throw new BadRequestException('Este ponto não tem histórico (trend) configurado');
    }
    const { from, to } = this.resolveWindow(fromRaw, toRaw);

    const [records, opSeries] = await Promise.all([
      this.prisma.trendRecord.findMany({
        where: { trendId: { in: trendIds }, timestamp: { gte: from, lte: to } },
        orderBy: { timestamp: 'asc' },
        take: 20_000,
        select: { timestamp: true, value: true, quality: true },
      }),
      this.loadOpSeries(device.points, from, to),
    ]);

    const opPoints = device.points
      .filter((p) => p.opRole)
      .map((p) => ({ id: p.id, opRole: p.opRole, name: p.objectName, tag: p.tag, unit: p.unit }));

    return {
      device: { id: device.id, name: device.name },
      point: { id: point.id, name: point.objectName, tag: point.tag, unit: point.unit },
      opPoints,
      from,
      to,
      samples: records.map((r) => {
        const t = r.timestamp.getTime();
        return { timestamp: r.timestamp, value: r.value, quality: r.quality, op: this.annotate(opSeries, t) };
      }),
    };
  }

  /**
   * GET /devices/:id/timeline — telemetria + alarmes + comandos do equipamento
   * alinhados no tempo (reutiliza alarm_events e audit_logs).
   */
  async timeline(
    deviceId: string,
    tenantId: string | undefined,
    fromRaw?: Date,
    toRaw?: Date,
    pointId?: string,
  ) {
    const device = await this.loadDevice(deviceId, tenantId);
    const { from, to } = this.resolveWindow(fromRaw, toRaw);

    // Ponto da curva: o pedido, ou o primeiro ponto com trend habilitada.
    const trended = device.points.filter((p) => p.trends.length > 0);
    const point = pointId
      ? device.points.find((p) => p.id === pointId)
      : trended[0];
    if (pointId && !point) throw new NotFoundException('Ponto não encontrado neste dispositivo');

    const trendIds = point?.trends.map((t) => t.id) ?? [];
    // Bucket automático: janelas longas usam rollups (hora), curtas usam minuto.
    const windowMs = to.getTime() - from.getTime();
    const bucket: 'minute' | 'hour' = windowMs > 3 * DAY_MS ? 'hour' : 'minute';

    const pointIdsOfDevice = device.points.map((p) => p.id);

    const [chartRows, alarmEvents, commandLogs] = await Promise.all([
      trendIds.length === 0
        ? Promise.resolve([] as { bucket: Date; avg: number; min: number; max: number }[])
        : bucket === 'hour'
        ? this.prisma.$queryRaw<{ bucket: Date; avg: number; min: number; max: number }[]>`
            SELECT "bucket", ("sum" / NULLIF("count", 0))::float8 AS avg, "min"::float8 AS min, "max"::float8 AS max
            FROM "trend_rollups_hourly"
            WHERE "trend_id" IN (${Prisma.join(trendIds)}) AND "bucket" >= ${from} AND "bucket" <= ${to}
            ORDER BY "bucket" ASC`
        : this.prisma.$queryRaw<{ bucket: Date; avg: number; min: number; max: number }[]>`
            SELECT date_trunc('minute', "timestamp") AS bucket,
                   avg("value")::float8 AS avg, min("value")::float8 AS min, max("value")::float8 AS max
            FROM "trend_records"
            WHERE "trend_id" IN (${Prisma.join(trendIds)}) AND "timestamp" >= ${from} AND "timestamp" <= ${to}
            GROUP BY 1 ORDER BY 1 ASC`,
      this.prisma.alarmEvent.findMany({
        where: {
          kind: 'ALARM',
          alarmRule: { pointId: { in: pointIdsOfDevice } },
          OR: [
            { activatedAt: { gte: from, lte: to } },
            { normalizedAt: { gte: from, lte: to } },
          ],
        },
        include: { alarmRule: { select: { name: true, severity: true, pointId: true, point: { select: { objectName: true } } } } },
        orderBy: { activatedAt: 'desc' },
        take: 500,
      }),
      this.prisma.auditLog.findMany({
        where: {
          action: 'COMMAND',
          entityId: deviceId,
          createdAt: { gte: from, lte: to },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
    ]);

    // Feed cronológico unificado (desc).
    const events: Array<{
      id: string;
      type: 'alarm_activated' | 'alarm_normalized' | 'command';
      at: Date;
      severity: string | null;
      title: string;
      detail: string | null;
    }> = [];
    for (const e of alarmEvents) {
      const rule = e.alarmRule!;
      if (e.activatedAt >= from && e.activatedAt <= to) {
        events.push({
          id: `${e.id}:on`,
          type: 'alarm_activated',
          at: e.activatedAt,
          severity: rule.severity,
          title: `Alarme ativado: ${rule.name}`,
          detail: rule.point?.objectName ?? null,
        });
      }
      if (e.normalizedAt && e.normalizedAt >= from && e.normalizedAt <= to) {
        events.push({
          id: `${e.id}:off`,
          type: 'alarm_normalized',
          at: e.normalizedAt,
          severity: rule.severity,
          title: `Alarme normalizado: ${rule.name}`,
          detail: rule.point?.objectName ?? null,
        });
      }
    }
    for (const c of commandLogs) {
      events.push({
        id: c.id,
        type: 'command',
        at: c.createdAt,
        severity: null,
        title: 'Comando ao equipamento',
        detail: c.actorName ? `por ${c.actorName}` : c.actorEmail,
      });
    }
    events.sort((a, b) => b.at.getTime() - a.at.getTime());

    return {
      device: { id: device.id, name: device.name },
      point: point
        ? { id: point.id, name: point.objectName, tag: point.tag, unit: point.unit, hasTrend: point.trends.length > 0 }
        : null,
      trendedPoints: trended.map((p) => ({ id: p.id, name: p.objectName, tag: p.tag, unit: p.unit })),
      from,
      to,
      bucket,
      chartPoints: chartRows.map((r) => ({ t: r.bucket, value: r.avg, min: r.min, max: r.max })),
      events,
    };
  }
}
