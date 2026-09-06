import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmbeddingsService } from '../knowledge/embeddings.service.js';
import { ClusterService } from '../cluster/cluster.service.js';
import {
  buildOperationalCase,
  rankSimilarCases,
  type CaseSearchTarget,
  type OperationalCaseRow,
  type SimilarOperationalCase,
} from './operational-memory.util.js';

/** Resultado de uma passada de sincronização (logs/status). */
export interface OperationalMemorySyncResult {
  scanned: number;
  created: number;
  updated: number;
  skippedUnsafe: number;
  skipped: boolean;
  error: string | null;
}

const BOOT_DELAY_MS = 60_000;
const EMBED_BATCH = 64;
// Limite por passada: as mais recentes primeiro; passadas seguintes completam.
const SCAN_LIMIT = 2000;

/**
 * Memória operacional anonimizada da IA — sync automático (leader-only, mesmo
 * padrão do índice de chamados Infraspeak) + busca por similaridade.
 *
 * Sync: varre ocorrências de alarme RESOLVIDAS e RECONHECIDAS COM MOTIVO
 * (kind=ALARM, state=NORMALIZED_ACK, ackNote preenchido), monta o caso pela
 * whitelist estrita de campos não identificáveis, sanea o texto livre e faz
 * upsert idempotente com embedding — só para casos novos/alterados. Casos cujo
 * texto não puder ser saneado com segurança ficam FORA do índice.
 *
 * Busca: cosine (pgvector) com limiar mínimo e ranking que prioriza mesmo tipo
 * de equipamento e mesmo tipo de alarme; retorna poucos casos, sempre anônimos.
 */
@Injectable()
export class OperationalMemoryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OperationalMemoryService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastResult: OperationalMemorySyncResult | null = null;
  private lastRunAt: Date | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsService,
    private readonly cluster: ClusterService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const minutes = this.intervalMinutes();
    if (minutes <= 0) {
      this.logger.log('Sync da memória operacional desativado (OPERATIONAL_MEMORY_SYNC_INTERVAL_MIN=0).');
      return;
    }
    this.timer = setInterval(() => void this.tick(), minutes * 60_000);
    // Primeira passada logo após o boot (deixa o app subir primeiro).
    setTimeout(() => void this.tick(), BOOT_DELAY_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private intervalMinutes(): number {
    const raw = this.config.get<string>('OPERATIONAL_MEMORY_SYNC_INTERVAL_MIN');
    const parsed = Number(raw);
    return raw === undefined || !Number.isFinite(parsed) ? 30 : parsed;
  }

  /** Estado da última sincronização (observabilidade). */
  getStatus(): {
    lastRunAt: Date | null;
    lastResult: OperationalMemorySyncResult | null;
    indexing: boolean;
  } {
    return { lastRunAt: this.lastRunAt, lastResult: this.lastResult, indexing: this.running };
  }

  private async tick(): Promise<void> {
    if (!this.cluster.isLeader() || this.running) return;
    try {
      await this.syncOnce();
    } catch (err) {
      // syncOnce já trata; guarda extra para nunca virar unhandled rejection.
      this.logger.error(`Sync da memória operacional falhou: ${(err as Error).message}`);
    }
  }

  /**
   * Uma passada completa de sincronização. Nunca lança: erros viram
   * `result.error` e a próxima passada tenta de novo.
   */
  async syncOnce(): Promise<OperationalMemorySyncResult> {
    if (this.running) {
      return { scanned: 0, created: 0, updated: 0, skippedUnsafe: 0, skipped: true, error: null };
    }
    this.running = true;
    const result: OperationalMemorySyncResult = {
      scanned: 0,
      created: 0,
      updated: 0,
      skippedUnsafe: 0,
      skipped: false,
      error: null,
    };
    try {
      // Ocorrências elegíveis: resolvidas E reconhecidas com motivo.
      const events = await this.prisma.alarmEvent.findMany({
        where: {
          kind: 'ALARM',
          state: 'NORMALIZED_ACK',
          normalizedAt: { not: null },
          acknowledgedAt: { not: null },
          ackNote: { not: null },
        },
        orderBy: { acknowledgedAt: 'desc' },
        take: SCAN_LIMIT,
        select: {
          id: true,
          valueAtTrigger: true,
          reactivationCount: true,
          activatedAt: true,
          normalizedAt: true,
          acknowledgedAt: true,
          ackNote: true,
          alarmRule: {
            select: {
              name: true,
              message: true,
              type: true,
              severity: true,
              point: {
                select: {
                  device: { select: { protocol: true, monitoredDeviceType: true } },
                },
              },
            },
          },
        },
      });
      result.scanned = events.length;
      if (events.length === 0) {
        this.lastRunAt = new Date();
        return result;
      }

      // Lista global de nomes identificáveis a redigir do texto livre:
      // clientes, sites, equipamentos, gateways, projetos e usuários.
      const knownNames = await this.loadKnownNames();

      // Estado atual: composed_text por source_event_id para detectar mudanças.
      const existing = await this.prisma.operationalCase.findMany({
        select: { sourceEventId: true, composedText: true },
      });
      const currentText = new Map(existing.map((r) => [r.sourceEventId, r.composedText] as const));

      const toEmbed: Array<{ row: OperationalCaseRow; isNew: boolean }> = [];
      for (const e of events) {
        if (!e.alarmRule || !e.ackNote?.trim() || !e.acknowledgedAt) continue;
        const row = buildOperationalCase({
          sourceEventId: e.id,
          monitoredDeviceType: e.alarmRule.point.device.monitoredDeviceType,
          protocol: e.alarmRule.point.device.protocol,
          alarmName: e.alarmRule.name,
          alarmMessage: e.alarmRule.message,
          alarmType: e.alarmRule.type,
          severity: e.alarmRule.severity,
          valueAtTrigger: e.valueAtTrigger,
          recurrenceCount: e.reactivationCount,
          activatedAt: e.activatedAt,
          normalizedAt: e.normalizedAt,
          acknowledgedAt: e.acknowledgedAt,
          ackNote: e.ackNote,
          knownNames,
        });
        if (!row) {
          result.skippedUnsafe += 1;
          continue;
        }
        const prev = currentText.get(row.sourceEventId);
        if (prev === undefined) toEmbed.push({ row, isNew: true });
        else if (prev !== row.composedText) toEmbed.push({ row, isNew: false });
      }

      for (let i = 0; i < toEmbed.length; i += EMBED_BATCH) {
        const batch = toEmbed.slice(i, i + EMBED_BATCH);
        const vectors = await this.embeddings.embed(batch.map((b) => b.row.composedText));
        for (let j = 0; j < batch.length; j++) {
          await this.upsertCase(batch[j].row, vectors[j]);
          if (batch[j].isNew) result.created += 1;
          else result.updated += 1;
        }
      }

      this.lastRunAt = new Date();
      if (result.created + result.updated > 0) {
        this.logger.log(
          `Memória operacional sincronizada: ${result.scanned} ocorrência(s) elegível(is), ` +
            `${result.created} caso(s) novo(s), ${result.updated} atualizado(s)` +
            (result.skippedUnsafe > 0
              ? `, ${result.skippedUnsafe} fora do índice (texto não saneável com segurança)`
              : '') +
            '.',
        );
      }
    } catch (err) {
      result.error = (err as Error).message;
      this.logger.warn(
        `Sync da memória operacional indisponível nesta passada: ${result.error} — nova tentativa no próximo ciclo.`,
      );
    } finally {
      this.running = false;
      this.lastResult = result;
    }
    return result;
  }

  /** Nomes identificáveis da plataforma inteira (para redação no texto livre). */
  private async loadKnownNames(): Promise<string[]> {
    const [tenants, sites, devices, gateways, projects, users] = await Promise.all([
      this.prisma.tenant.findMany({ select: { name: true, slug: true } }),
      this.prisma.site.findMany({ select: { name: true, responsibleName: true } }),
      this.prisma.device.findMany({ select: { name: true } }),
      this.prisma.gateway.findMany({ select: { id: true } }),
      this.prisma.project.findMany({ select: { name: true, address: true, technicalContact: true } }),
      this.prisma.user.findMany({ select: { name: true } }),
    ]);
    const names: Array<string | null> = [
      ...tenants.flatMap((t) => [t.name, t.slug]),
      ...sites.flatMap((s) => [s.name, s.responsibleName]),
      ...devices.map((d) => d.name),
      ...gateways.map((g) => g.id),
      ...projects.flatMap((p) => [p.name, p.address, p.technicalContact]),
      ...users.map((u) => u.name),
    ];
    // Mais longos primeiro: redige "Condomínio Solar das Flores" antes de "Solar".
    return names
      .filter((n): n is string => Boolean(n && n.trim().length >= 3))
      .sort((a, b) => b.length - a.length);
  }

  /** Upsert idempotente de um caso com embedding (SQL bruto — pgvector). */
  private async upsertCase(row: OperationalCaseRow, vector: number[]): Promise<void> {
    const vec = this.embeddings.toSqlVector(vector);
    await this.prisma.$executeRaw`
      INSERT INTO "operational_cases" (
        "id", "source_event_id", "monitored_device_type", "protocol",
        "alarm_name", "alarm_message", "alarm_type", "severity",
        "value_at_trigger", "recurrence_count", "time_to_resolve_minutes",
        "resolution", "occurred_at", "composed_text", "embedding",
        "synced_at", "created_at", "updated_at"
      ) VALUES (
        ${randomUUID()}, ${row.sourceEventId}, ${row.monitoredDeviceType}, ${row.protocol},
        ${row.alarmName}, ${row.alarmMessage}, ${row.alarmType}, ${row.severity},
        ${row.valueAtTrigger}, ${row.recurrenceCount}, ${row.timeToResolveMinutes},
        ${row.resolution}, ${row.occurredAt}, ${row.composedText}, ${vec}::vector,
        now(), now(), now()
      )
      ON CONFLICT ("source_event_id") DO UPDATE SET
        "monitored_device_type" = EXCLUDED."monitored_device_type",
        "protocol" = EXCLUDED."protocol",
        "alarm_name" = EXCLUDED."alarm_name",
        "alarm_message" = EXCLUDED."alarm_message",
        "alarm_type" = EXCLUDED."alarm_type",
        "severity" = EXCLUDED."severity",
        "value_at_trigger" = EXCLUDED."value_at_trigger",
        "recurrence_count" = EXCLUDED."recurrence_count",
        "time_to_resolve_minutes" = EXCLUDED."time_to_resolve_minutes",
        "resolution" = EXCLUDED."resolution",
        "occurred_at" = EXCLUDED."occurred_at",
        "composed_text" = EXCLUDED."composed_text",
        "embedding" = EXCLUDED."embedding",
        "synced_at" = now(),
        "updated_at" = now()
    `;
  }

  /** Total de casos indexados (observabilidade). */
  async countIndexed(): Promise<number> {
    return this.prisma.operationalCase.count();
  }

  /**
   * Busca casos semelhantes por similaridade (cosine, pgvector) — GLOBAL,
   * sem filtro de tenant (a memória é anônima por construção). Aplica limiar
   * mínimo e ranking que prioriza mesmo tipo de equipamento/alarme. O
   * resultado NUNCA contém sourceEventId ou qualquer identificador de origem.
   */
  async findSimilar(query: string, target: CaseSearchTarget = {}): Promise<SimilarOperationalCase[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const vec = this.embeddings.toSqlVector(await this.embeddings.embedOne(trimmed));
    const rows = await this.prisma.$queryRaw<
      Array<{
        caseId: string;
        monitoredDeviceType: string | null;
        protocol: string;
        alarmName: string;
        alarmType: string;
        severity: string;
        valueAtTrigger: number | null;
        recurrenceCount: number;
        timeToResolveMinutes: number | null;
        resolution: string;
        occurredAt: Date;
        similarity: number;
      }>
    >`
      SELECT
        c."id" AS "caseId",
        c."monitored_device_type" AS "monitoredDeviceType",
        c."protocol" AS "protocol",
        c."alarm_name" AS "alarmName",
        c."alarm_type" AS "alarmType",
        c."severity" AS "severity",
        c."value_at_trigger" AS "valueAtTrigger",
        c."recurrence_count" AS "recurrenceCount",
        c."time_to_resolve_minutes" AS "timeToResolveMinutes",
        c."resolution" AS "resolution",
        c."occurred_at" AS "occurredAt",
        1 - (c."embedding" <=> ${vec}::vector) AS "similarity"
      FROM "operational_cases" c
      WHERE c."embedding" IS NOT NULL
      ORDER BY c."embedding" <=> ${vec}::vector
      LIMIT 30
    `;
    const candidates = rows.map((r) => ({ ...r, similarity: Number(r.similarity) }));
    return rankSimilarCases(target, candidates);
  }
}
