import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, TrendMode } from '@prisma/client';
import type { Trend } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { TrendRecorderService } from './trend-recorder.service.js';

export interface CreateTrendInput {
  pointId: string;
  name: string;
  mode: TrendMode;
  intervalSeconds?: number;
  /** ON_CHANGE: deadband analógico (0/omitido = qualquer mudança). */
  covThreshold?: number | null;
  /** ON_CHANGE: heartbeat em segundos (omitido = desligado). */
  maxIntervalSeconds?: number | null;
  retentionDays: number;
}

export interface UpdateTrendInput {
  name?: string;
  mode?: TrendMode;
  intervalSeconds?: number | null;
  covThreshold?: number | null;
  maxIntervalSeconds?: number | null;
  retentionDays?: number;
  enabled?: boolean;
}

export interface TrendFilters {
  tenantId?: string;
  deviceId?: string;
  pointId?: string;
}

export interface TrendDataOptions {
  from?: Date;
  to?: Date;
  bucket?: string;
  page: number;
  pageSize: number;
}

export interface TrendBatchOptions {
  from?: Date;
  to?: Date;
  bucket?: string;
}

export interface TrendHistoryOptions {
  from?: Date;
  to?: Date;
  page: number;
  pageSize: number;
}

const ALLOWED_BUCKETS = new Set(['minute', 'hour', 'day']);
const MAX_BATCH_IDS = 12;

const POINT_SELECT = {
  id: true, tag: true, objectName: true, objectType: true, instance: true, unit: true, deviceId: true,
} as const;

type TrendWithPoint = Prisma.TrendGetPayload<{ include: { point: { select: typeof POINT_SELECT } } }>;

@Injectable()
export class TrendsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recorder: TrendRecorderService,
  ) {}

  async findAll(filters: TrendFilters) {
    return this.prisma.trend.findMany({
      where: {
        ...(filters.tenantId ? { tenantId: filters.tenantId } : {}),
        ...(filters.pointId ? { pointId: filters.pointId } : {}),
        ...(filters.deviceId ? { point: { deviceId: filters.deviceId } } : {}),
      },
      include: {
        point: { select: { id: true, tag: true, objectName: true, objectType: true, instance: true, unit: true, deviceId: true } },
        _count: { select: { records: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, tenantId: string | undefined): Promise<Trend> {
    const trend = await this.prisma.trend.findFirst({ where: tenantId ? { id, tenantId } : { id } });
    if (!trend) throw new NotFoundException(`Trend ${id} não encontrada`);
    return trend;
  }

  async create(input: CreateTrendInput): Promise<Trend> {
    if (!input.name?.trim()) throw new BadRequestException('name é obrigatório');
    if (input.mode === 'INTERVAL' && !input.intervalSeconds) {
      throw new BadRequestException('intervalSeconds é obrigatório no modo INTERVAL');
    }
    const point = await this.prisma.devicePoint.findUnique({
      where: { id: input.pointId },
      include: { device: { select: { tenantId: true } } },
    });
    if (!point) throw new NotFoundException(`Ponto ${input.pointId} não encontrado`);

    const onChange = input.mode === 'ON_CHANGE';
    const trend = await this.prisma.trend.create({
      data: {
        tenantId: point.device.tenantId,
        pointId: input.pointId,
        name: input.name.trim(),
        mode: input.mode,
        intervalSeconds: input.mode === 'INTERVAL' ? input.intervalSeconds : null,
        // COV/heartbeat só se aplicam ao modo ON_CHANGE.
        covThreshold: onChange ? input.covThreshold ?? null : null,
        maxIntervalSeconds: onChange ? input.maxIntervalSeconds ?? null : null,
        retentionDays: input.retentionDays,
      },
    });
    await this.recorder.reload();
    return trend;
  }

  async update(id: string, tenantId: string | undefined, input: UpdateTrendInput): Promise<Trend> {
    await this.findOne(id, tenantId);
    const data: Prisma.TrendUpdateInput = {};
    if (input.name !== undefined) data.name = input.name.trim();
    if (input.mode !== undefined) data.mode = input.mode;
    if (input.intervalSeconds !== undefined) data.intervalSeconds = input.intervalSeconds;
    if (input.covThreshold !== undefined) data.covThreshold = input.covThreshold;
    if (input.maxIntervalSeconds !== undefined) data.maxIntervalSeconds = input.maxIntervalSeconds;
    if (input.retentionDays !== undefined) data.retentionDays = input.retentionDays;
    if (input.enabled !== undefined) data.enabled = input.enabled;
    const trend = await this.prisma.trend.update({ where: { id }, data });
    await this.recorder.reload();
    return trend;
  }

  async delete(id: string, tenantId: string | undefined): Promise<void> {
    await this.findOne(id, tenantId);
    await this.prisma.trend.delete({ where: { id } });
    await this.recorder.reload();
  }

  /** Normaliza a janela [from, to]: Data Final vazia = "agora"; padrão de 24h. */
  private resolveWindow(from?: Date, to?: Date): { from: Date; to: Date } {
    const resolvedTo = to ?? new Date();
    const resolvedFrom = from ?? new Date(resolvedTo.getTime() - 24 * 3600 * 1000);
    return { from: resolvedFrom, to: resolvedTo };
  }

  /**
   * Pontos do gráfico (agregados por bucket) + resumo de uma trend numa janela.
   * Buckets hour/day leem dos ROLLUPS contínuos (gráficos de meses ficam rápidos
   * e independem da retenção dos brutos); minute lê dos registros brutos.
   */
  private async seriesFor(id: string, from: Date, to: Date, bucket: string) {
    const safeBucket = ALLOWED_BUCKETS.has(bucket) ? bucket : 'minute';
    if (safeBucket === 'hour' || safeBucket === 'day') {
      return this.seriesFromRollup(id, from, to, safeBucket);
    }

    const chartRows = await this.prisma.$queryRaw<{ bucket: Date; avg: number; min: number; max: number }[]>`
      SELECT date_trunc(${safeBucket}::text, "timestamp") AS bucket,
             avg("value")::float8 AS avg, min("value")::float8 AS min, max("value")::float8 AS max
      FROM "trend_records"
      WHERE "trend_id" = ${id} AND "timestamp" >= ${from} AND "timestamp" <= ${to}
      GROUP BY bucket ORDER BY bucket ASC`;
    const chartPoints = chartRows.map((r) => ({ t: r.bucket, value: r.avg, min: r.min, max: r.max }));

    const summaryRows = await this.prisma.$queryRaw<
      { total: number; min: number | null; max: number | null; avg: number | null; first: Date | null; last: Date | null }[]
    >`
      SELECT count(*)::int AS total, min("value")::float8 AS min, max("value")::float8 AS max,
             avg("value")::float8 AS avg, min("timestamp") AS first, max("timestamp") AS last
      FROM "trend_records"
      WHERE "trend_id" = ${id} AND "timestamp" >= ${from} AND "timestamp" <= ${to}`;
    const s = summaryRows[0] ?? { total: 0, min: null, max: null, avg: null, first: null, last: null };

    return {
      chartPoints,
      summary: {
        totalRecords: s.total,
        minValue: s.min,
        maxValue: s.max,
        avgValue: s.avg,
        firstTimestamp: s.first,
        lastTimestamp: s.last,
      },
    };
  }

  /** Série + resumo a partir dos rollups contínuos (hourly/daily). */
  private async seriesFromRollup(id: string, from: Date, to: Date, bucket: 'hour' | 'day') {
    const table = bucket === 'hour' ? Prisma.raw('"trend_rollups_hourly"') : Prisma.raw('"trend_rollups_daily"');
    const chartRows = await this.prisma.$queryRaw<{ bucket: Date; avg: number; min: number; max: number }[]>`
      SELECT "bucket", ("sum" / NULLIF("count", 0))::float8 AS avg,
             "min"::float8 AS min, "max"::float8 AS max
      FROM ${table}
      WHERE "trend_id" = ${id} AND "bucket" >= ${from} AND "bucket" <= ${to}
      ORDER BY "bucket" ASC`;
    const chartPoints = chartRows.map((r) => ({ t: r.bucket, value: r.avg, min: r.min, max: r.max }));

    const summaryRows = await this.prisma.$queryRaw<
      { total: number; min: number | null; max: number | null; avg: number | null; first: Date | null; last: Date | null }[]
    >`
      SELECT coalesce(sum("count"), 0)::int AS total, min("min")::float8 AS min, max("max")::float8 AS max,
             (sum("sum") / NULLIF(sum("count"), 0))::float8 AS avg,
             min("bucket") AS first, max("bucket") AS last
      FROM ${table}
      WHERE "trend_id" = ${id} AND "bucket" >= ${from} AND "bucket" <= ${to}`;
    const s = summaryRows[0] ?? { total: 0, min: null, max: null, avg: null, first: null, last: null };

    return {
      chartPoints,
      summary: {
        totalRecords: s.total,
        minValue: s.min,
        maxValue: s.max,
        avgValue: s.avg,
        firstTimestamp: s.first,
        lastTimestamp: s.last,
      },
    };
  }

  /** Saneia/limita a lista de ids e garante que todas pertencem ao tenant. */
  private async resolveTrends(ids: string[], tenantId: string | undefined): Promise<TrendWithPoint[]> {
    const unique = Array.from(new Set(ids.map((i) => i.trim()).filter(Boolean)));
    if (unique.length === 0) throw new BadRequestException('Informe ao menos um id de trend');
    if (unique.length > MAX_BATCH_IDS) {
      throw new BadRequestException(`Máximo de ${MAX_BATCH_IDS} variáveis por consulta`);
    }
    const trends = await this.prisma.trend.findMany({
      where: { id: { in: unique }, ...(tenantId ? { tenantId } : {}) },
      include: { point: { select: POINT_SELECT } },
    });
    if (trends.length !== unique.length) {
      throw new NotFoundException('Uma ou mais trends não foram encontradas no escopo');
    }
    return trends;
  }

  async getData(id: string, tenantId: string | undefined, opts: TrendDataOptions) {
    const trend = await this.findOne(id, tenantId);
    const { from, to } = this.resolveWindow(opts.from, opts.to);
    const { chartPoints, summary } = await this.seriesFor(id, from, to, opts.bucket ?? 'minute');

    const total = summary.totalRecords;
    const page = Math.max(1, opts.page);
    const pageSize = Math.min(500, Math.max(1, opts.pageSize));
    const records = await this.prisma.trendRecord.findMany({
      where: { trendId: id, timestamp: { gte: from, lte: to } },
      orderBy: { timestamp: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    return {
      trend,
      summary,
      chartPoints,
      page: {
        records: records.map((r) => ({ id: r.id.toString(), timestamp: r.timestamp, value: r.value, quality: r.quality })),
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /** Séries + resumo de várias trends numa única janela (uma série por trend). */
  async getDataBatch(ids: string[], tenantId: string | undefined, opts: TrendBatchOptions) {
    const trends = await this.resolveTrends(ids, tenantId);
    const { from, to } = this.resolveWindow(opts.from, opts.to);
    const bucket = opts.bucket ?? 'minute';

    const series = await Promise.all(
      trends.map(async (trend) => {
        const { chartPoints, summary } = await this.seriesFor(trend.id, from, to, bucket);
        return { trend, summary, chartPoints };
      }),
    );
    return { from, to, bucket: ALLOWED_BUCKETS.has(bucket) ? bucket : 'minute', trends: series };
  }

  /** Histórico mesclado (todas as trends), ordenado por timestamp desc, paginado. */
  async getHistory(ids: string[], tenantId: string | undefined, opts: TrendHistoryOptions) {
    const trends = await this.resolveTrends(ids, tenantId);
    const nameById = new Map(trends.map((t) => [t.id, t]));
    const trendIds = trends.map((t) => t.id);
    const { from, to } = this.resolveWindow(opts.from, opts.to);

    const page = Math.max(1, opts.page);
    const pageSize = Math.min(500, Math.max(1, opts.pageSize));
    const where = { trendId: { in: trendIds }, timestamp: { gte: from, lte: to } };

    const [total, records] = await Promise.all([
      this.prisma.trendRecord.count({ where }),
      this.prisma.trendRecord.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      records: records.map((r) => {
        const trend = nameById.get(r.trendId);
        return {
          id: r.id.toString(),
          timestamp: r.timestamp,
          trendId: r.trendId,
          trendName: trend?.name ?? r.trendId,
          value: r.value,
          quality: r.quality,
          unit: trend?.point?.unit ?? null,
          objectType: trend?.point?.objectType ?? null,
        };
      }),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async exportCsv(id: string, tenantId: string | undefined, from?: Date, to?: Date): Promise<string> {
    await this.findOne(id, tenantId);
    const records = await this.prisma.trendRecord.findMany({
      where: { trendId: id, ...(from || to ? { timestamp: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
      orderBy: { timestamp: 'asc' },
    });
    const header = 'timestamp,value,quality';
    const lines = records.map((r) => `${r.timestamp.toISOString()},${r.value},${r.quality}`);
    return [header, ...lines].join('\n');
  }

  /**
   * Exportação em massa para treino de modelos externos: itera os registros em
   * lotes (keyset por timestamp+id) e invoca `write` por chunk — o controller
   * faz streaming da resposta (nunca materializa tudo em memória).
   * `granularity`: raw (brutos) | hourly | daily (rollups, com min/max/avg/count).
   */
  async exportBulk(
    opts: {
      tenantId: string | undefined;
      deviceId?: string;
      trendIds?: string[];
      from?: Date;
      to?: Date;
      granularity: 'raw' | 'hourly' | 'daily';
    },
    write: (chunk: string) => Promise<void> | void,
  ): Promise<void> {
    // Resolve as trends do escopo: por device OU por ids explícitos.
    const trends = await this.prisma.trend.findMany({
      where: {
        ...(opts.tenantId ? { tenantId: opts.tenantId } : {}),
        ...(opts.deviceId ? { point: { deviceId: opts.deviceId } } : {}),
        ...(opts.trendIds && opts.trendIds.length > 0 ? { id: { in: opts.trendIds } } : {}),
      },
      include: { point: { select: POINT_SELECT } },
    });
    if (trends.length === 0) throw new NotFoundException('Nenhuma trend encontrada no escopo informado');
    const meta = new Map(trends.map((t) => [t.id, t]));
    const trendIds = trends.map((t) => t.id);
    const { from, to } = this.resolveWindow(opts.from, opts.to);
    const esc = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const BATCH = 5000;

    if (opts.granularity === 'raw') {
      await write('timestamp,trend_id,variable,device_id,point_tag,unit,value,quality\n');
      let cursor: { ts: Date; id: bigint } | null = null;
      for (;;) {
        const rows: { id: bigint; trendId: string; timestamp: Date; value: number; quality: string }[] =
          await this.prisma.trendRecord.findMany({
            where: {
              trendId: { in: trendIds },
              timestamp: { gte: from, lte: to },
              ...(cursor
                ? { OR: [{ timestamp: { gt: cursor.ts } }, { timestamp: cursor.ts, id: { gt: cursor.id } }] }
                : {}),
            },
            orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
            take: BATCH,
          });
        if (rows.length === 0) break;
        const lines = rows.map((r) => {
          const t = meta.get(r.trendId);
          return `${r.timestamp.toISOString()},${r.trendId},${esc(t?.name ?? '')},${t?.point.deviceId ?? ''},${esc(t?.point.tag ?? '')},${esc(t?.point.unit ?? '')},${r.value},${r.quality}`;
        });
        await write(lines.join('\n') + '\n');
        const last = rows[rows.length - 1];
        cursor = { ts: last.timestamp, id: last.id };
        if (rows.length < BATCH) break;
      }
      return;
    }

    const table = opts.granularity === 'hourly' ? Prisma.raw('"trend_rollups_hourly"') : Prisma.raw('"trend_rollups_daily"');
    await write('bucket,trend_id,variable,device_id,point_tag,unit,min,max,avg,count\n');
    let cursor: { bucket: Date; trendId: string } | null = null;
    for (;;) {
      const rows = await this.prisma.$queryRaw<
        { trend_id: string; bucket: Date; min: number; max: number; sum: number; count: number }[]
      >`
        SELECT "trend_id", "bucket", "min"::float8 AS min, "max"::float8 AS max, "sum"::float8 AS sum, "count"
        FROM ${table}
        WHERE "trend_id" IN (${Prisma.join(trendIds)}) AND "bucket" >= ${from} AND "bucket" <= ${to}
          AND (${cursor === null} OR ("bucket", "trend_id") > (${cursor?.bucket ?? from}, ${cursor?.trendId ?? ''}))
        ORDER BY "bucket" ASC, "trend_id" ASC
        LIMIT ${BATCH}`;
      if (rows.length === 0) break;
      const lines = rows.map((r) => {
        const t = meta.get(r.trend_id);
        const avg = r.count > 0 ? r.sum / r.count : null;
        return `${r.bucket.toISOString()},${r.trend_id},${esc(t?.name ?? '')},${t?.point.deviceId ?? ''},${esc(t?.point.tag ?? '')},${esc(t?.point.unit ?? '')},${r.min},${r.max},${avg ?? ''},${r.count}`;
      });
      await write(lines.join('\n') + '\n');
      const last = rows[rows.length - 1];
      cursor = { bucket: last.bucket, trendId: last.trend_id };
      if (rows.length < BATCH) break;
    }
  }

  /** CSV mesclado de várias trends, com coluna `variable`. */
  async exportCsvBatch(ids: string[], tenantId: string | undefined, from?: Date, to?: Date): Promise<string> {
    const trends = await this.resolveTrends(ids, tenantId);
    const nameById = new Map(trends.map((t) => [t.id, t.name]));
    const records = await this.prisma.trendRecord.findMany({
      where: {
        trendId: { in: trends.map((t) => t.id) },
        ...(from || to ? { timestamp: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      },
      orderBy: { timestamp: 'asc' },
    });
    const escape = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const header = 'timestamp,variable,value,quality';
    const lines = records.map(
      (r) => `${r.timestamp.toISOString()},${escape(nameById.get(r.trendId) ?? r.trendId)},${r.value},${r.quality}`,
    );
    return [header, ...lines].join('\n');
  }
}
