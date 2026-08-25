import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClusterService } from '../cluster/cluster.service.js';
import { AiService } from '../ai/ai.service.js';
import { NotificationRecipientsService } from '../notification-recipients/notification-recipients.service.js';
import { InsightFactsService, type InsightFacts } from './insight-facts.service.js';
import {
  buildInsightUserPrompt,
  INSIGHT_SYSTEM_PROMPT,
  parseInsightNarrative,
  type InsightNarrative,
} from './insight-narrative.util.js';
import type { InsightFrequencyKey, InsightPeriod } from './insight-period.util.js';

/**
 * Canal interno (Postgres NOTIFY via ClusterService) publicado a cada insight
 * salvo — é o gancho que a futura camada de entrega (e-mail/WhatsApp, template
 * `beeldings_insight`: tema, resumo, período) vai consumir. Nada é enviado
 * externamente por enquanto.
 */
export const INSIGHT_GENERATED_CHANNEL = 'insight_generated';

export interface InsightGeneratedEvent {
  insightId: string;
  tenantId: string;
  tenantName: string;
  frequency: InsightFrequencyKey;
  trigger: 'scheduled' | 'manual';
  /** Contrato beeldings_insight: tema, resumo curto e período. */
  theme: string;
  summary: string;
  period: { start: string; end: string; label: string };
  /** Destinatários da categoria "Insights" (cadastro de Ajustes) já resolvidos. */
  recipients: Array<{ id: string; name: string; email?: string; phone?: string }>;
}

export interface InsightConfigDto {
  tenantId: string;
  enabled: boolean;
  frequency: InsightFrequencyKey;
}

export interface InsightSummaryDto {
  id: string;
  tenantId: string;
  tenantName: string;
  frequency: InsightFrequencyKey;
  trigger: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  theme: string | null;
  aiFailed: boolean;
  createdAt: string;
}

export interface InsightDetailDto extends InsightSummaryDto {
  summary: string | null;
  narrative: InsightNarrative | null;
  facts: InsightFacts;
}

const EVENT_SUMMARY_MAX = 600;

/** Violação de unicidade (Prisma P2002 ou Postgres 23505, ex.: índice parcial). */
function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; meta?: unknown; message?: string };
  return e?.code === 'P2002' || `${e?.message ?? ''}`.includes('23505');
}

@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly factsService: InsightFactsService,
    private readonly ai: AiService,
    private readonly recipients: NotificationRecipientsService,
    private readonly cluster: ClusterService,
  ) {}

  // ─── Configuração por tenant ────────────────────────────────────────────────

  async getConfig(tenantId: string): Promise<InsightConfigDto> {
    const row = await this.prisma.tenantInsightConfig.findUnique({ where: { tenantId } });
    return {
      tenantId,
      enabled: row?.enabled ?? true,
      frequency: (row?.frequency ?? 'WEEKLY') as InsightFrequencyKey,
    };
  }

  async updateConfig(
    tenantId: string,
    patch: { enabled?: boolean; frequency?: InsightFrequencyKey },
  ): Promise<InsightConfigDto> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) throw new NotFoundException('Cliente não encontrado');
    const current = await this.getConfig(tenantId);
    const enabled = patch.enabled ?? current.enabled;
    const frequency = patch.frequency ?? current.frequency;
    await this.prisma.tenantInsightConfig.upsert({
      where: { tenantId },
      create: { tenantId, enabled, frequency },
      update: { enabled, frequency },
    });
    return { tenantId, enabled, frequency };
  }

  // ─── Geração ────────────────────────────────────────────────────────────────

  /**
   * Gera e persiste um insight para o tenant no período dado. Duas partes:
   * bloco factual determinístico (sempre) + texto redacional da IA (best
   * effort — em falha, o insight é salvo só-factual com aiFailed=true).
   * Retorna null quando `skipIfNoData` e o período não tem dados.
   */
  async generateForPeriod(
    tenantId: string,
    period: InsightPeriod,
    frequency: InsightFrequencyKey,
    trigger: 'scheduled' | 'manual',
    opts: { skipIfNoData?: boolean } = {},
  ): Promise<InsightDetailDto | null> {
    const facts = await this.factsService.compute(tenantId, period.from, period.to, period.label);
    if (!facts.hasData && opts.skipIfNoData) {
      this.logger.log(`Insight pulado (sem dados no período): tenant=${tenantId} período=${period.label}`);
      return null;
    }

    let narrative: InsightNarrative | null = null;
    let aiFailed = false;
    try {
      const raw = await this.ai.completeWithSystem(
        INSIGHT_SYSTEM_PROMPT,
        buildInsightUserPrompt(facts),
        2048,
      );
      narrative = parseInsightNarrative(raw);
      if (!narrative) {
        aiFailed = true;
        this.logger.warn(`Resposta da IA sem JSON válido — insight salvo só-factual (tenant=${tenantId})`);
      }
    } catch (err) {
      aiFailed = true;
      this.logger.warn(
        `Falha da IA na geração do insight (tenant=${tenantId}): ${(err as Error).message} — salvando só a parte factual`,
      );
    }

    let row;
    try {
      row = await this.prisma.aiInsight.create({
        data: {
          tenantId,
          frequency,
          trigger,
          periodStart: period.from,
          periodEnd: period.to,
          periodLabel: period.label,
          facts: facts as unknown as Prisma.InputJsonValue,
          theme: narrative?.theme ?? null,
          summary: narrative?.summary ?? null,
          narrative: narrative ? (narrative as unknown as Prisma.InputJsonValue) : undefined,
          aiFailed,
        },
      });
    } catch (err) {
      // Índice único parcial (ai_insights_scheduled_unique): outra instância já
      // gerou o insight agendado deste período — idempotência, não é erro.
      if (trigger === 'scheduled' && isUniqueViolation(err)) {
        this.logger.log(
          `Insight agendado já existia (gerado por outra instância): tenant=${tenantId} período=${period.label}`,
        );
        return null;
      }
      throw err;
    }

    // Gancho para a entrega futura — nunca derruba a geração.
    await this.emitInsightGenerated({
      insightId: row.id,
      tenantId,
      tenantName: facts.tenantName,
      frequency,
      trigger,
      theme: narrative?.theme ?? `Resumo do período — ${facts.tenantName}`,
      summary: (narrative?.summary ?? this.factualSummary(facts)).slice(0, EVENT_SUMMARY_MAX),
      period: { start: period.from.toISOString(), end: period.to.toISOString(), label: period.label },
    });

    return this.toDetailDto({ ...row, tenant: { name: facts.tenantName } });
  }

  /** Resumo determinístico usado no evento quando a IA falhou. */
  private factualSummary(facts: InsightFacts): string {
    const a = facts.alarms;
    const av = facts.availability;
    const parts = [
      `${a.total} alarmes no período (${a.bySeverity.high} de alta severidade)`,
    ];
    if (av.avgUptimePct != null) parts.push(`disponibilidade média de ${av.avgUptimePct}%`);
    if (facts.criticalAssets.inFaultDuringPeriod.length > 0) {
      parts.push(`${facts.criticalAssets.inFaultDuringPeriod.length} ativos críticos com alarme`);
    }
    return `${facts.period.label}: ${parts.join(', ')}.`;
  }

  private async emitInsightGenerated(
    event: Omit<InsightGeneratedEvent, 'recipients'>,
  ): Promise<void> {
    try {
      let recipients: InsightGeneratedEvent['recipients'] = [];
      try {
        recipients = await this.recipients.resolveRecipients({
          tenantId: event.tenantId,
          category: 'insights',
        });
      } catch (err) {
        this.logger.warn(`Falha ao resolver destinatários de insights: ${(err as Error).message}`);
      }
      const payload: InsightGeneratedEvent = { ...event, recipients };
      await this.cluster.publish(INSIGHT_GENERATED_CHANNEL, JSON.stringify(payload));
      this.logger.log(
        `Insight gerado: tenant=${event.tenantName} período="${event.period.label}" tema="${event.theme}" destinatários=${recipients.length} (entrega externa fica com a futura camada de envio)`,
      );
    } catch (err) {
      this.logger.warn(`Falha ao emitir evento de insight gerado: ${(err as Error).message}`);
    }
  }

  // ─── Consulta ───────────────────────────────────────────────────────────────

  /** Lista insights; tenantId undefined = todos (papéis globais sem filtro). */
  async list(tenantId: string | undefined, limit = 50): Promise<InsightSummaryDto[]> {
    const rows = await this.prisma.aiInsight.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
      include: { tenant: { select: { name: true } } },
    });
    return rows.map((r) => this.toSummaryDto(r));
  }

  async get(id: string, tenantId: string | undefined): Promise<InsightDetailDto> {
    const row = await this.prisma.aiInsight.findFirst({
      where: { id, ...(tenantId ? { tenantId } : {}) },
      include: { tenant: { select: { name: true } } },
    });
    if (!row) throw new NotFoundException('Insight não encontrado');
    return this.toDetailDto(row);
  }

  private toSummaryDto(row: {
    id: string;
    tenantId: string;
    tenant: { name: string };
    frequency: string;
    trigger: string;
    periodStart: Date;
    periodEnd: Date;
    periodLabel: string;
    theme: string | null;
    aiFailed: boolean;
    createdAt: Date;
  }): InsightSummaryDto {
    return {
      id: row.id,
      tenantId: row.tenantId,
      tenantName: row.tenant.name,
      frequency: row.frequency as InsightFrequencyKey,
      trigger: row.trigger,
      periodStart: row.periodStart.toISOString(),
      periodEnd: row.periodEnd.toISOString(),
      periodLabel: row.periodLabel,
      theme: row.theme,
      aiFailed: row.aiFailed,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toDetailDto(
    row: Parameters<InsightsService['toSummaryDto']>[0] & {
      summary: string | null;
      narrative: unknown;
      facts: unknown;
    },
  ): InsightDetailDto {
    return {
      ...this.toSummaryDto(row),
      summary: row.summary,
      narrative: (row.narrative as InsightNarrative | null) ?? null,
      facts: row.facts as InsightFacts,
    };
  }
}
