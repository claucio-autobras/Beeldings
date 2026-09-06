import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';

export type SiteMetricKind = 'energy' | 'water' | 'runtime';
export type SiteMetricMode = 'cumulative' | 'rate' | 'state';
type MetricStatus = 'ready' | 'no_data' | 'not_configured';

interface WindowInput {
  tenantId?: string;
  siteId?: string;
  from: Date;
  to: Date;
  period: '24h' | '7d' | '30d';
}

interface Sample {
  trendId: string;
  timestamp: Date;
  value: number;
  count?: number;
}

interface ConfiguredPoint {
  id: string;
  tag: string;
  objectName: string;
  objectType: string;
  unit: string | null;
  siteMetric: string | null;
  siteMetricMode: string | null;
  binding: unknown;
  device: {
    id: string;
    name: string;
    protocol: string;
    tenantId: string;
    siteId: string | null;
    site: { id: string; name: string } | null;
  };
  trends: Array<{ id: string; intervalSeconds: number | null; maxIntervalSeconds: number | null }>;
}

export interface ChartPoint {
  timestamp: string;
  value: number;
}

const DIGITAL_BACNET = new Set(['BI', 'BO', 'BV', 'MSI', 'MSO', 'MSV']);
const DIGITAL_MODBUS_REGISTERS = new Set(['coil', 'discrete']);
const DIGITAL_MODBUS_TYPES = new Set(['boolean']);

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function emptyMetric(status: MetricStatus, unit: string) {
  return {
    status,
    total: null as number | null,
    unit,
    series: [] as ChartPoint[],
    configuredPoints: 0,
    sources: [] as Array<{ pointId: string; pointName: string; deviceName: string; siteName: string | null }>,
  };
}

/**
 * Agrega as três fontes semânticas da visão do cliente. A semântica vive no
 * DevicePoint, por isso remover a classificação nunca remove TrendRecord ou
 * Telemetry.
 */
@Injectable()
export class SiteOverviewService {
  constructor(private readonly prisma: PrismaService) {}

  async compute(input: WindowInput) {
    const points = (await this.prisma.devicePoint.findMany({
      where: {
        siteMetric: { in: ['energy', 'water', 'runtime'] },
        device: {
          ...(input.tenantId ? { tenantId: input.tenantId } : {}),
          ...(input.siteId ? { siteId: input.siteId } : {}),
        },
      },
      select: {
        id: true,
        tag: true,
        objectName: true,
        objectType: true,
        unit: true,
        binding: true,
        siteMetric: true,
        siteMetricMode: true,
        device: {
          select: {
            id: true,
            name: true,
            protocol: true,
            tenantId: true,
            siteId: true,
            site: { select: { id: true, name: true } },
          },
        },
        trends: {
          where: { enabled: true },
          orderBy: { createdAt: 'asc' },
          take: 1,
          select: { id: true, intervalSeconds: true, maxIntervalSeconds: true },
        },
      },
    })) as ConfiguredPoint[];

    const energyPoints = points.filter((p) => p.siteMetric === 'energy');
    const waterPoints = points.filter((p) => p.siteMetric === 'water');
    const runtimePoints = points.filter((p) => p.siteMetric === 'runtime');

    const allTrendIds = points.flatMap((p) => p.trends.map((t) => t.id));
    const rateTrendIds = points
      .filter((p) => p.siteMetricMode === 'rate')
      .flatMap((p) => p.trends.map((t) => t.id));
    const rollupSamples =
      input.period === '7d' || input.period === '30d'
        ? await this.loadRollupSamples(rateTrendIds, input.from, input.to, input.period)
        : new Map<string, Sample[]>();
    const intervalByTrend = new Map(
      points.flatMap((p) => p.trends.map((t) => [t.id, t.intervalSeconds] as const)),
    );
    const usableRollupIds = new Set(
      [...rollupSamples.keys()].filter((id) => (intervalByTrend.get(id) ?? 0) > 0),
    );
    const rawTrendIds = allTrendIds.filter((id) => !usableRollupIds.has(id));
    const samples = await this.loadSamples(rawTrendIds, input.from, input.to);
    const statefulTrendIds = points
      .filter((p) => p.siteMetricMode === 'cumulative' || p.siteMetricMode === 'state')
      .flatMap((p) => p.trends.map((t) => t.id));
    const previous = await this.loadPreviousSamples(statefulTrendIds, input.from);

    return {
      period: input.period,
      from: input.from.toISOString(),
      to: input.to.toISOString(),
      generatedAt: new Date().toISOString(),
      energy: this.computeConsumption(
        energyPoints,
        samples,
        previous,
        rollupSamples,
        input,
        'energy',
      ),
      water: this.computeConsumption(
        waterPoints,
        samples,
        previous,
        rollupSamples,
        input,
        'water',
      ),
      runtime: this.computeRuntime(runtimePoints, samples, previous, input),
    };
  }

  private sourceView(point: ConfiguredPoint) {
    return {
      pointId: point.id,
      pointName: point.objectName || point.tag,
      deviceName: point.device.name,
      siteName: point.device.site?.name ?? null,
    };
  }

  private async loadSamples(ids: string[], from: Date, to: Date): Promise<Map<string, Sample[]>> {
    const byTrend = new Map<string, Sample[]>();
    if (ids.length === 0) return byTrend;
    const rows = await this.prisma.trendRecord.findMany({
      where: {
        trendId: { in: ids },
        timestamp: { gte: from, lte: to },
        quality: 'GOOD',
      },
      orderBy: [{ trendId: 'asc' }, { timestamp: 'asc' }],
      select: { trendId: true, timestamp: true, value: true },
    });
    for (const row of rows) {
      const list = byTrend.get(row.trendId) ?? [];
      list.push(row);
      byTrend.set(row.trendId, list);
    }
    return byTrend;
  }

  /**
   * O primeiro estado/medição antes da janela é necessário para calcular a
   * primeira duração/delta. DISTINCT ON mantém esta consulta pequena mesmo
   * quando há anos de histórico.
   */
  private async loadPreviousSamples(ids: string[], from: Date): Promise<Map<string, Sample>> {
    const result = new Map<string, Sample>();
    if (ids.length === 0) return result;
    try {
      const rows = await this.prisma.$queryRaw<Sample[]>`
        SELECT DISTINCT ON ("trend_id")
          "trend_id" AS "trendId", "timestamp", "value"
        FROM "trend_records"
        WHERE "trend_id" IN (${Prisma.join(ids)})
          AND "timestamp" < ${from}
          AND "quality" = 'GOOD'
        ORDER BY "trend_id", "timestamp" DESC
      `;
      for (const row of rows) result.set(row.trendId, row);
    } catch {
      // Bancos antigos sem a partição/índice esperado continuam honestos:
      // sem amostra anterior, a primeira transição/delta fica sem cobertura.
    }
    return result;
  }

  /**
   * Taxas usam rollups em janelas longas. Rollup de média × duração do bucket
   * evita carregar dezenas de milhares de registros e linhas ausentes não são
   * convertidas em zero.
   */
  private async loadRollupSamples(
    ids: string[],
    from: Date,
    to: Date,
    period: '7d' | '30d',
  ): Promise<Map<string, Sample[]>> {
    const result = new Map<string, Sample[]>();
    if (ids.length === 0) return result;
    // Use hourly even for 30d: it keeps boundary loss below one hour while
    // still avoiding raw-series volume (máx. ~720 rows/trend).
    const table = Prisma.raw('"trend_rollups_hourly"');
    try {
      const rows = await this.prisma.$queryRaw<Array<{
         trendId: string; timestamp: Date; value: number; count: number;
      }>>`
        SELECT "trend_id" AS "trendId", "bucket" AS "timestamp",
               ("sum" / NULLIF("count", 0))::float8 AS "value", "count"
        FROM ${table}
        WHERE "trend_id" IN (${Prisma.join(ids)})
          AND "bucket" >= ${from}
          AND "bucket" + INTERVAL '1 hour' <= ${to}
          AND "count" > 0
        ORDER BY "trend_id", "bucket"
      `;
      for (const row of rows) {
        const list = result.get(row.trendId) ?? [];
        list.push(row);
        result.set(row.trendId, list);
      }
    } catch {
      // Fallback para os registros brutos abaixo; o dado continua correto,
      // apenas menos econômico em uma instalação sem rollups.
    }
    return result;
  }

  private computeConsumption(
    points: ConfiguredPoint[],
    samples: Map<string, Sample[]>,
    previous: Map<string, Sample>,
    rollupSamples: Map<string, Sample[]>,
    input: WindowInput,
    kind: 'energy' | 'water',
  ) {
    const unit = kind === 'energy' ? 'kWh' : 'L';
    const result = emptyMetric(points.length === 0 ? 'not_configured' : 'no_data', unit);
    result.configuredPoints = points.length;
    result.sources = points.map((p) => this.sourceView(p));
    const buckets = new Map<string, number>();
    let total = 0;
    let hasCoverage = false;

    for (const point of points) {
      const trendId = point.trends[0]?.id;
      if (!trendId || !point.siteMetricMode) continue;
      const mode = point.siteMetricMode as SiteMetricMode;
      const source = mode === 'rate' && rollupSamples.has(trendId)
        ? rollupSamples.get(trendId)!
        : samples.get(trendId) ?? [];
      if (mode === 'cumulative') {
        const windowMs = input.to.getTime() - input.from.getTime();
        const boundaryToleranceMs = Math.min(12 * 3_600_000, windowMs * 0.2);
        const candidatePrevious = previous.get(trendId);
        const acceptedPrevious = candidatePrevious &&
          input.from.getTime() - candidatePrevious.timestamp.getTime() <= boundaryToleranceMs
          ? candidatePrevious
          : undefined;
        const ordered = acceptedPrevious ? [acceptedPrevious, ...source] : source;
        const coverageStart = acceptedPrevious
          ? input.from.getTime()
          : source[0]?.timestamp.getTime();
        const coverageEnd = source.at(-1)?.timestamp.getTime();
        const pointBuckets = new Map<string, number>();
        let pointTotal = 0;
        let prior: Sample | undefined;
        for (const sample of ordered) {
          if (prior && sample.timestamp >= input.from) {
            const rawDelta = sample.value - prior.value;
            // Após um reset, o valor corrente representa o consumo contado
            // desde zero até a primeira amostra observada após o reset.
            const measuredDelta = rawDelta >= 0 ? rawDelta : Math.max(0, sample.value);
            const delta = this.toCanonicalCumulative(kind, point.unit, measuredDelta);
            pointTotal += delta;
            this.addBucket(pointBuckets, sample.timestamp, delta, input.period);
          }
          prior = sample;
        }
        const coveredMs = coverageStart !== undefined && coverageEnd !== undefined
          ? Math.max(0, coverageEnd - coverageStart)
          : 0;
        const closingIsFresh = coverageEnd !== undefined &&
          input.to.getTime() - coverageEnd <= boundaryToleranceMs;
        if (closingIsFresh && coveredMs >= windowMs * 0.8 && ordered.length >= 2) {
          hasCoverage = true;
          total += pointTotal;
          for (const [timestamp, amount] of pointBuckets) {
            buckets.set(timestamp, (buckets.get(timestamp) ?? 0) + amount);
          }
        }
      } else if (mode === 'rate') {
        let pointTotal = 0;
        let pointCoverageHours = 0;
        const pointBuckets = new Map<string, number>();
        const isRollup = rollupSamples.has(trendId) && (point.trends[0]?.intervalSeconds ?? 0) > 0;
        for (const sample of source) {
          const converted = this.toCanonicalRate(kind, point.unit, sample.value, input.period);
          if (converted === null) continue;
          // Rollup values represent one complete bucket; raw values are
          // integrated only to the next sample to avoid inventing a tail.
          const durationHours = isRollup
            ? this.rollupOverlapHours(sample.timestamp, input)
            : this.rawRateDurationHours(source, sample);
          if (durationHours <= 0) continue;
          if (isRollup) {
            const intervalSeconds = point.trends[0]!.intervalSeconds!;
            const expectedSamples = Math.max(1, Math.floor(durationHours * 3600 / intervalSeconds));
            // Um rollup esparso não prova que a média persistiu pelo bucket.
            if ((sample.count ?? 0) < expectedSamples * 0.8) continue;
          }
          const amount = converted * durationHours;
          pointTotal += amount;
          pointCoverageHours += durationHours;
          this.addBucket(pointBuckets, sample.timestamp, amount, input.period);
        }
        const windowHours = (input.to.getTime() - input.from.getTime()) / 3_600_000;
        // Para rollups, só publique um total de período quando a cobertura
        // densa alcançar a maior parte da janela; caso contrário é no_data.
        if (pointCoverageHours >= windowHours * 0.8) {
          if (pointCoverageHours > 0) hasCoverage = true;
          total += pointTotal;
          for (const [timestamp, amount] of pointBuckets) {
            buckets.set(timestamp, (buckets.get(timestamp) ?? 0) + amount);
          }
        }
      }
    }

    if (hasCoverage) {
      result.status = 'ready';
      result.total = round(total);
      result.series = [...buckets.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([timestamp, value]) => ({ timestamp, value: round(value) }));
    }
    return result;
  }

  private rawRateDurationHours(source: Sample[], current: Sample): number {
    const next = source.find((s) => s.timestamp > current.timestamp);
    if (!next) return 0;
    const hours = (next.timestamp.getTime() - current.timestamp.getTime()) / 3_600_000;
    // A long gap is a coverage gap, not a period of zero/constant usage.
    return hours > 12 ? 0 : hours;
  }

  private rollupOverlapHours(bucket: Date, input: WindowInput): number {
    const bucketEnd = new Date(bucket);
    bucketEnd.setUTCHours(bucketEnd.getUTCHours() + 1);
    const overlapStart = Math.max(bucket.getTime(), input.from.getTime());
    const overlapEnd = Math.min(bucketEnd.getTime(), input.to.getTime());
    return Math.max(0, overlapEnd - overlapStart) / 3_600_000;
  }

  private computeRuntime(
    points: ConfiguredPoint[],
    samples: Map<string, Sample[]>,
    previous: Map<string, Sample>,
    input: WindowInput,
  ) {
    const items: Array<{
      pointId: string;
      pointName: string;
      deviceId: string;
      deviceName: string;
      siteName: string | null;
      runtimeMs: number;
      runtimeHours: number;
    }> = [];
    const buckets = new Map<string, number>();

    for (const point of points) {
      if (!this.isDigital(point) || point.siteMetricMode !== 'state') continue;
      const trendId = point.trends[0]?.id;
      if (!trendId) continue;
      const first = previous.get(trendId);
      const ordered = first
        ? [first, ...(samples.get(trendId) ?? [])]
        : (samples.get(trendId) ?? []);
      let runningMs = 0;
      let coveredMs = 0;
      let prior: Sample | undefined;
      for (const sample of ordered) {
        if (prior && sample.timestamp > input.from) {
          const intervalStart = Math.max(prior.timestamp.getTime(), input.from.getTime());
          const intervalMs = sample.timestamp.getTime() - intervalStart;
          // Uma lacuna longa não prova que o equipamento permaneceu no mesmo
          // estado durante todo o período sem comunicação.
          if (intervalMs >= 0 && intervalMs <= 12 * 3_600_000) {
            coveredMs += intervalMs;
            if (prior.value >= 0.5) runningMs += intervalMs;
          }
        }
        prior = sample;
      }
      if (prior && prior.value >= 0.5 && prior.timestamp <= input.to) {
        // A state sample alone does not prove that it stayed on through the
        // end of the window; only close an interval when a later sample exists.
        // This intentionally favors missing-data honesty over inflated hours.
      }
      const windowMs = input.to.getTime() - input.from.getTime();
      if (coveredMs >= windowMs * 0.8) {
        const item = {
          pointId: point.id,
          pointName: point.objectName || point.tag,
          deviceId: point.device.id,
          deviceName: point.device.name,
          siteName: point.device.site?.name ?? null,
          runtimeMs: runningMs,
          runtimeHours: round(runningMs / 3_600_000, 2),
        };
        items.push(item);
        if (runningMs > 0) {
          this.addBucket(buckets, new Date(input.from), runningMs / 3_600_000, input.period);
        }
      }
    }

    const totalHours = items.reduce((sum, item) => sum + item.runtimeHours, 0);
    return {
      status: points.length === 0 ? 'not_configured' : items.length > 0 ? 'ready' : 'no_data' as MetricStatus,
      totalHours: items.length > 0 ? round(totalHours, 2) : null,
      unit: 'h',
      configuredPoints: points.length,
      items,
      series: [...buckets.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([timestamp, value]) => ({ timestamp, value: round(value, 2) })),
    };
  }

  private isDigital(point: ConfiguredPoint): boolean {
    const binding = (point.binding ?? {}) as Record<string, unknown>;
    if (point.device.protocol === 'bacnet') return DIGITAL_BACNET.has(point.objectType);
    if (point.device.protocol === 'modbus') {
      return DIGITAL_MODBUS_REGISTERS.has(String(binding.registerType ?? '')) ||
        DIGITAL_MODBUS_TYPES.has(String(binding.dataType ?? ''));
    }
    return binding.valueType === 'boolean';
  }

  private toCanonicalCumulative(kind: 'energy' | 'water', unit: string | null, value: number): number {
    if (kind === 'energy') {
      const factor: Record<string, number> = { Wh: 0.001, kWh: 1, MWh: 1000 };
      return value * (factor[unit ?? ''] ?? 1);
    }
    const factor: Record<string, number> = { L: 1, 'm³': 1000, m3: 1000 };
    return value * (factor[unit ?? ''] ?? 1);
  }

  private toCanonicalRate(
    kind: 'energy' | 'water',
    unit: string | null,
    value: number,
    period: '24h' | '7d' | '30d',
  ): number | null {
    void period;
    if (!Number.isFinite(value)) return null;
    if (kind === 'energy') {
      const factor: Record<string, number> = { W: 0.001, kW: 1, MW: 1000 };
      return value * (factor[unit ?? ''] ?? 1);
    }
    const factor: Record<string, number> = {
      'L/s': 3600, 'L/min': 60, 'L/h': 1,
      'm³/s': 3_600_000, 'm³/min': 60_000, 'm³/h': 1000,
      'm3/s': 3_600_000, 'm3/min': 60_000, 'm3/h': 1000,
    };
    return value * (factor[unit ?? ''] ?? 1);
  }

  private addBucket(map: Map<string, number>, timestamp: Date, value: number, period: WindowInput['period']): void {
    const bucketMs = period === '24h' ? 60 * 60_000 : period === '7d' ? 6 * 60 * 60_000 : 24 * 60 * 60_000;
    const bucket = new Date(Math.floor(timestamp.getTime() / bucketMs) * bucketMs).toISOString();
    map.set(bucket, (map.get(bucket) ?? 0) + value);
  }
}