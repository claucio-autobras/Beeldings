import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ClusterService } from '../cluster/cluster.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const RUN_INTERVAL_MS = 60 * 1000;
const BATCH_SIZE = 50_000;

/**
 * Agregações contínuas de trend (min/máx/soma/contagem por hora e por dia).
 * Job incremental por cursor de id: a cada minuto agrega os trend_records novos
 * (apenas quality=GOOD) nas tabelas de rollup via INSERT ... ON CONFLICT merge.
 * Guardamos SUM (não AVG) para o merge incremental ser exato; a média é derivada
 * na leitura (sum/count). Roda apenas na instância líder do cluster.
 */
@Injectable()
export class TrendRollupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TrendRollupService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cluster: ClusterService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), RUN_INTERVAL_MS);
    // Primeira passada logo após o boot (deixa o app subir primeiro).
    setTimeout(() => void this.tick(), 20 * 1000);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (!this.cluster.isLeader() || this.running) return;
    this.running = true;
    try {
      await this.runIncremental();
    } catch (err) {
      this.logger.error(`Falha no rollup incremental: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * Processa lotes até esvaziar o backlog. Retorna o total de registros agregados.
   * Exposto público para testes e para o backfill inicial.
   */
  async runIncremental(): Promise<number> {
    let totalProcessed = 0;
    for (;;) {
      const processed = await this.processBatch();
      totalProcessed += processed;
      if (processed < BATCH_SIZE) break;
    }
    if (totalProcessed > 0) {
      this.logger.log(`Rollup incremental: ${totalProcessed} registro(s) agregados`);
    }
    return totalProcessed;
  }

  /** Agrega o próximo lote (id > cursor, limitado) e avança o cursor. */
  private async processBatch(): Promise<number> {
    const state = await this.prisma.trendRollupState.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1, lastRecordId: 0n },
    });
    const cursor = state.lastRecordId;

    // Limite superior do lote (mantém o merge determinístico em 2 passadas).
    const bound = await this.prisma.$queryRaw<{ max_id: bigint | null; cnt: bigint }[]>`
      SELECT max(id) AS max_id, count(*) AS cnt FROM (
        SELECT id FROM "trend_records" WHERE id > ${cursor} ORDER BY id LIMIT ${BATCH_SIZE}
      ) b`;
    const maxId = bound[0]?.max_id;
    const count = Number(bound[0]?.cnt ?? 0n);
    if (!maxId || count === 0) return 0;

    await this.prisma.$transaction([
      this.prisma.$executeRaw`
        INSERT INTO "trend_rollups_hourly" ("trend_id", "tenant_id", "bucket", "min", "max", "sum", "count")
        SELECT "trend_id", "tenant_id", date_trunc('hour', "timestamp"),
               min("value"), max("value"), sum("value"), count(*)::int
        FROM "trend_records"
        WHERE id > ${cursor} AND id <= ${maxId} AND "quality" = 'GOOD'
        GROUP BY 1, 2, 3
        ON CONFLICT ("trend_id", "bucket") DO UPDATE SET
          "min" = LEAST("trend_rollups_hourly"."min", EXCLUDED."min"),
          "max" = GREATEST("trend_rollups_hourly"."max", EXCLUDED."max"),
          "sum" = "trend_rollups_hourly"."sum" + EXCLUDED."sum",
          "count" = "trend_rollups_hourly"."count" + EXCLUDED."count"`,
      this.prisma.$executeRaw`
        INSERT INTO "trend_rollups_daily" ("trend_id", "tenant_id", "bucket", "min", "max", "sum", "count")
        SELECT "trend_id", "tenant_id", date_trunc('day', "timestamp"),
               min("value"), max("value"), sum("value"), count(*)::int
        FROM "trend_records"
        WHERE id > ${cursor} AND id <= ${maxId} AND "quality" = 'GOOD'
        GROUP BY 1, 2, 3
        ON CONFLICT ("trend_id", "bucket") DO UPDATE SET
          "min" = LEAST("trend_rollups_daily"."min", EXCLUDED."min"),
          "max" = GREATEST("trend_rollups_daily"."max", EXCLUDED."max"),
          "sum" = "trend_rollups_daily"."sum" + EXCLUDED."sum",
          "count" = "trend_rollups_daily"."count" + EXCLUDED."count"`,
      this.prisma.trendRollupState.update({ where: { id: 1 }, data: { lastRecordId: maxId } }),
    ]);

    return count;
  }
}
