import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ClusterService } from '../cluster/cluster.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const DAY_MS = 24 * 3600 * 1000;
const PARTITION_PREFIX = 'trend_records_y';

/** Retenção dos rollups (mais longa que a dos brutos): horário e diário. */
export function rollupRetentionDays(rawRetentionDays: number): { hourly: number; daily: number } {
  return {
    hourly: Math.max(rawRetentionDays * 2, 730),
    daily: Math.max(rawRetentionDays * 4, 1825),
  };
}

/** Nome da partição mensal (trend_records_yYYYYmMM) para uma data UTC. */
export function partitionNameFor(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${PARTITION_PREFIX}${y}m${m}`;
}

/** Extrai o início do mês (UTC) do nome da partição; null se não casa o padrão. */
export function partitionMonthStart(name: string): Date | null {
  const m = /^trend_records_y(\d{4})m(\d{2})$/.exec(name);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
}

/**
 * Retenção do histórico de trends, operando por partição:
 * - Garante partições mensais futuras de trend_records (mês corrente + 2).
 * - DROPa partições inteiras mais antigas que a MAIOR retenção entre as trends
 *   (descarte O(1), sem DELETE linha a linha nem inchaço de vacuum).
 * - Para retenções por-trend menores, o DELETE segue por trend, mas o planner
 *   poda para as partições atingidas (as antigas já foram dropadas).
 * - Expurga rollups com retenção própria, mais longa que a dos brutos.
 * Roda 1x após o boot e a cada 24h, apenas na instância líder.
 */
@Injectable()
export class TrendRetentionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrendRetentionService.name);
  private interval?: NodeJS.Timeout;
  private bootTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cluster: ClusterService,
  ) {}

  onModuleInit(): void {
    this.bootTimer = setTimeout(() => void this.run(), 60 * 1000);
    this.interval = setInterval(() => void this.run(), DAY_MS);
  }

  onModuleDestroy(): void {
    if (this.interval) clearInterval(this.interval);
    if (this.bootTimer) clearTimeout(this.bootTimer);
  }

  private async run(): Promise<void> {
    if (!this.cluster.isLeader()) return;
    try {
      await this.ensurePartitions();
    } catch (err) {
      this.logger.error(`Falha ao garantir partições: ${(err as Error).message}`);
    }
    try {
      await this.purge();
    } catch (err) {
      this.logger.error(`Falha na retenção de trends: ${(err as Error).message}`);
    }
  }

  /** Cria (se faltarem) as partições do mês corrente e dos 2 próximos. */
  async ensurePartitions(now = new Date()): Promise<void> {
    for (let i = 0; i <= 2; i++) {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + i, 1));
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
      const name = partitionNameFor(start);
      await this.prisma.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS "${name}" PARTITION OF "trend_records" FOR VALUES FROM ('${start.toISOString()}') TO ('${end.toISOString()}')`,
      );
    }
  }

  /** Lista os nomes das partições mensais existentes de trend_records. */
  async listPartitions(): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ relname: string }[]>`
      SELECT c.relname FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relname = 'trend_records'`;
    return rows.map((r) => r.relname).filter((n) => partitionMonthStart(n) !== null);
  }

  async purge(now = new Date()): Promise<void> {
    const trends = await this.prisma.trend.findMany({ select: { id: true, retentionDays: true } });
    if (trends.length === 0) return;

    // 1) Descarta partições INTEIRAS mais antigas que a maior retenção.
    const maxRetention = Math.max(...trends.map((t) => t.retentionDays));
    const globalCutoff = new Date(now.getTime() - maxRetention * DAY_MS);
    let dropped = 0;
    for (const name of await this.listPartitions()) {
      const start = partitionMonthStart(name);
      if (!start) continue;
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
      // Só quando o mês INTEIRO já passou do corte global.
      if (end.getTime() <= globalCutoff.getTime()) {
        await this.prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${name}"`);
        dropped++;
        this.logger.log(`Retenção: partição ${name} descartada (mais antiga que ${maxRetention}d)`);
      }
    }

    // 2) Retenções por-trend menores: DELETE por trend (poda de partição pelo planner).
    let totalDeleted = 0;
    for (const t of trends) {
      const cutoff = new Date(now.getTime() - t.retentionDays * DAY_MS);
      const res = await this.prisma.trendRecord.deleteMany({ where: { trendId: t.id, timestamp: { lt: cutoff } } });
      totalDeleted += res.count;
    }

    // 3) Rollups: retenção própria, mais longa que a dos brutos.
    let rollupsDeleted = 0;
    for (const t of trends) {
      const r = rollupRetentionDays(t.retentionDays);
      const [h, d] = await Promise.all([
        this.prisma.trendRollupHourly.deleteMany({
          where: { trendId: t.id, bucket: { lt: new Date(now.getTime() - r.hourly * DAY_MS) } },
        }),
        this.prisma.trendRollupDaily.deleteMany({
          where: { trendId: t.id, bucket: { lt: new Date(now.getTime() - r.daily * DAY_MS) } },
        }),
      ]);
      rollupsDeleted += h.count + d.count;
    }

    if (dropped > 0 || totalDeleted > 0 || rollupsDeleted > 0) {
      this.logger.log(
        `Retenção: ${dropped} partição(ões) descartada(s), ${totalDeleted} registro(s) bruto(s) e ${rollupsDeleted} rollup(s) expurgados`,
      );
    }
  }
}
