import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClusterService } from '../cluster/cluster.service.js';
import { InsightsService } from './insights.service.js';
import { lastClosedPeriod, type InsightFrequencyKey } from './insight-period.util.js';

// Job periódico LEADER-ONLY (mesmo padrão dos rollups de trend): no fechamento
// de cada período configurado (semana/mês em America/Sao_Paulo) gera um insight
// por tenant ativo — somente tenants com dados no período. Idempotente: nunca
// gera duas vezes o mesmo período agendado para o mesmo tenant.

const TICK_MS = 10 * 60_000;
/** Carência pós-boot: evita disputa com a partida do restante do sistema. */
const BOOT_DELAY_MS = 90_000;
const SKIPPED_CACHE_MAX = 2000;

@Injectable()
export class InsightSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InsightSchedulerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private startTimeout: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  /** Períodos sem dados já verificados neste processo (evita recomputar a cada tick). */
  private readonly skipped = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cluster: ClusterService,
    private readonly insights: InsightsService,
  ) {}

  onModuleInit(): void {
    this.startTimeout = setTimeout(() => {
      this.startTimeout = null;
      void this.tick();
      this.timer = setInterval(() => void this.tick(), TICK_MS);
    }, BOOT_DELAY_MS);
  }

  onModuleDestroy(): void {
    if (this.startTimeout) clearTimeout(this.startTimeout);
    if (this.timer) clearInterval(this.timer);
    this.startTimeout = null;
    this.timer = null;
  }

  async tick(now: Date = new Date()): Promise<void> {
    if (!this.cluster.isLeader() || this.running) return;
    this.running = true;
    try {
      const tenants = await this.prisma.tenant.findMany({
        where: { active: true },
        select: { id: true, name: true, insightConfig: { select: { enabled: true, frequency: true } } },
      });
      for (const tenant of tenants) {
        const enabled = tenant.insightConfig?.enabled ?? true;
        if (!enabled) continue;
        const frequency = (tenant.insightConfig?.frequency ?? 'WEEKLY') as InsightFrequencyKey;
        try {
          await this.generateIfDue(tenant.id, tenant.name, frequency, now);
        } catch (err) {
          this.logger.error(
            `Falha ao gerar insight agendado (tenant=${tenant.name}): ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(`Falha no ciclo de insights: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async generateIfDue(
    tenantId: string,
    tenantName: string,
    frequency: InsightFrequencyKey,
    now: Date,
  ): Promise<void> {
    const period = lastClosedPeriod(frequency, now);
    const key = `${tenantId}|${frequency}|${period.from.toISOString()}`;
    if (this.skipped.has(key)) return;

    const existing = await this.prisma.aiInsight.findFirst({
      where: { tenantId, frequency, periodStart: period.from, trigger: 'scheduled' },
      select: { id: true },
    });
    if (existing) {
      this.remember(key);
      return;
    }

    const result = await this.insights.generateForPeriod(tenantId, period, frequency, 'scheduled', {
      skipIfNoData: true,
    });
    if (result === null) {
      // Sem dados no período fechado — não tenta de novo neste processo.
      this.remember(key);
    } else {
      this.logger.log(`Insight agendado gerado: tenant=${tenantName} período="${period.label}"`);
    }
  }

  private remember(key: string): void {
    if (this.skipped.size >= SKIPPED_CACHE_MAX) this.skipped.clear();
    this.skipped.add(key);
  }
}
