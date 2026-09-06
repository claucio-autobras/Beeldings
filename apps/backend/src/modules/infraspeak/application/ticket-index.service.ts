import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EmbeddingsService } from '../../knowledge/embeddings.service.js';
import { ClusterService } from '../../cluster/cluster.service.js';
import { RequestsService, type InfraspeakRequestItem } from './requests.service.js';

/** Resultado de uma passada de sincronização (para logs e endpoint manual). */
export interface TicketSyncResult {
  fetched: number;
  created: number;
  updated: number;
  embedded: number;
  skipped: boolean;
  error: string | null;
}

/**
 * Monta o texto composto de um chamado para indexação semântica:
 * problema/categoria, local, descrição (sintomas) e observações (diagnóstico/
 * solução dos técnicos, quando preenchidas). Exportada para testes.
 */
export function composeTicketText(t: InfraspeakRequestItem): string {
  const parts = [
    t.problemName ? `Problema/categoria: ${t.problemName}` : null,
    t.localName ? `Local: ${t.localName}` : null,
    t.clientName ? `Cliente: ${t.clientName}` : null,
    t.description ? `Descrição/sintomas: ${t.description}` : null,
    t.observations ? `Observações/diagnóstico/solução: ${t.observations}` : null,
    t.state ? `Estado: ${t.state}` : null,
    t.solved === true ? 'Resolução: chamado resolvido.' : null,
  ].filter((p): p is string => Boolean(p));
  return parts.join('\n');
}

/**
 * Um chamado tem "resolução confirmada" quando foi marcado como resolvido ou
 * concluído. Só esses sustentam recomendações como evidência principal.
 * Exportada para testes.
 */
export function hasConfirmedResolution(t: InfraspeakRequestItem): boolean {
  return t.solved === true || Boolean(t.completedDate);
}

const BOOT_DELAY_MS = 45_000;
const EMBED_BATCH = 64;

/**
 * Sincronização periódica dos chamados da Infraspeak para a cópia local
 * indexada (infraspeak_tickets) — a base de conhecimento do analista de IA.
 *
 * - Roda só na instância líder do cluster (a API tem rate limit de 60 req/min).
 * - Upsert por failure_id: nunca duplica; chamados que mudam de estado/ganham
 *   observações têm o texto composto refeito e o embedding regenerado
 *   (aprendizado contínuo — encerrados entram sozinhos na base).
 * - Tolerante a indisponibilidade: qualquer falha (503/429/timeout) é logada e
 *   a próxima passada tenta de novo; nunca derruba o backend.
 */
@Injectable()
export class TicketIndexService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TicketIndexService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastResult: TicketSyncResult | null = null;
  private lastRunAt: Date | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly requests: RequestsService,
    private readonly embeddings: EmbeddingsService,
    private readonly cluster: ClusterService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const minutes = this.intervalMinutes();
    if (minutes <= 0) {
      this.logger.log('Sync de chamados Infraspeak desativado (INFRASPEAK_SYNC_INTERVAL_MIN=0).');
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
    const raw = this.config.get<string>('INFRASPEAK_SYNC_INTERVAL_MIN');
    const parsed = Number(raw);
    return raw === undefined || !Number.isFinite(parsed) ? 30 : parsed;
  }

  /** Estado da última sincronização (para o endpoint de status). */
  getStatus(): { lastRunAt: Date | null; lastResult: TicketSyncResult | null; indexing: boolean } {
    return { lastRunAt: this.lastRunAt, lastResult: this.lastResult, indexing: this.running };
  }

  private async tick(): Promise<void> {
    if (!this.cluster.isLeader() || this.running) return;
    try {
      await this.syncOnce();
    } catch (err) {
      // syncOnce já trata; guarda extra para nunca virar unhandled rejection.
      this.logger.error(`Sync de chamados Infraspeak falhou: ${(err as Error).message}`);
    }
  }

  /**
   * Uma passada completa de sincronização. Exposta pública para o endpoint de
   * sync manual e para testes. Nunca lança: erros viram `result.error`.
   */
  async syncOnce(): Promise<TicketSyncResult> {
    if (this.running) {
      return { fetched: 0, created: 0, updated: 0, embedded: 0, skipped: true, error: null };
    }
    this.running = true;
    const result: TicketSyncResult = {
      fetched: 0,
      created: 0,
      updated: 0,
      embedded: 0,
      skipped: false,
      error: null,
    };
    try {
      const { data } = await this.requests.findAll();
      result.fetched = data.length;

      // Estado atual local: composed_text por failure_id para detectar mudanças.
      const existing = await this.prisma.infraspeakTicket.findMany({
        select: { failureId: true, composedText: true },
      });
      const currentText = new Map<number, string>();
      for (const row of existing) {
        currentText.set(row.failureId, row.composedText);
      }

      const toEmbed: Array<{ item: InfraspeakRequestItem; text: string; isNew: boolean }> = [];
      for (const item of data) {
        if (item.id === null) continue;
        const text = composeTicketText(item);
        const prev = currentText.get(item.id);
        if (prev === undefined) {
          toEmbed.push({ item, text, isNew: true });
        } else if (prev !== text) {
          toEmbed.push({ item, text, isNew: false });
        }
      }

      for (let i = 0; i < toEmbed.length; i += EMBED_BATCH) {
        const batch = toEmbed.slice(i, i + EMBED_BATCH);
        const vectors = await this.embeddings.embed(batch.map((b) => b.text));
        for (let j = 0; j < batch.length; j++) {
          const { item, text, isNew } = batch[j];
          await this.upsertTicket(item, text, vectors[j]);
          result.embedded += 1;
          if (isNew) result.created += 1;
          else result.updated += 1;
        }
      }

      this.lastRunAt = new Date();
      if (result.created + result.updated > 0) {
        this.logger.log(
          `Chamados Infraspeak sincronizados: ${result.fetched} consultado(s), ` +
            `${result.created} novo(s), ${result.updated} atualizado(s).`,
        );
      }
    } catch (err) {
      result.error = (err as Error).message;
      this.logger.warn(
        `Sync de chamados Infraspeak indisponível nesta passada: ${result.error} — nova tentativa no próximo ciclo.`,
      );
    } finally {
      this.running = false;
      this.lastResult = result;
    }
    return result;
  }

  /** Upsert de um chamado com embedding, via SQL bruto (coluna pgvector). */
  private async upsertTicket(
    item: InfraspeakRequestItem,
    composedText: string,
    vector: number[],
  ): Promise<void> {
    const vec = this.embeddings.toSqlVector(vector);
    const resolved = hasConfirmedResolution(item);
    await this.prisma.$executeRaw`
      INSERT INTO "infraspeak_tickets" (
        "id", "failure_id", "uuid", "state", "state_description", "priority",
        "priority_text", "problem_id", "problem_name", "client_name",
        "local_id", "local_name", "description", "observations",
        "report_date", "completed_date", "api_updated_at", "solved",
        "confirmed", "has_resolution", "composed_text", "embedding", "raw",
        "synced_at", "created_at", "updated_at"
      ) VALUES (
        ${randomUUID()}, ${item.id}, ${item.uuid}, ${item.state}, ${item.stateDescription},
        ${item.priority}, ${item.priorityText}, ${item.problemId}, ${item.problemName},
        ${item.clientName}, ${item.localId}, ${item.localName}, ${item.description},
        ${item.observations}, ${item.reportDate}, ${item.completedDate}, ${item.updatedAt},
        ${item.solved}, ${item.confirmed}, ${resolved}, ${composedText}, ${vec}::vector,
        ${JSON.stringify(item.raw ?? null)}::jsonb, now(), now(), now()
      )
      ON CONFLICT ("failure_id") DO UPDATE SET
        "uuid" = EXCLUDED."uuid",
        "state" = EXCLUDED."state",
        "state_description" = EXCLUDED."state_description",
        "priority" = EXCLUDED."priority",
        "priority_text" = EXCLUDED."priority_text",
        "problem_id" = EXCLUDED."problem_id",
        "problem_name" = EXCLUDED."problem_name",
        "client_name" = EXCLUDED."client_name",
        "local_id" = EXCLUDED."local_id",
        "local_name" = EXCLUDED."local_name",
        "description" = EXCLUDED."description",
        "observations" = EXCLUDED."observations",
        "report_date" = EXCLUDED."report_date",
        "completed_date" = EXCLUDED."completed_date",
        "api_updated_at" = EXCLUDED."api_updated_at",
        "solved" = EXCLUDED."solved",
        "confirmed" = EXCLUDED."confirmed",
        "has_resolution" = EXCLUDED."has_resolution",
        "composed_text" = EXCLUDED."composed_text",
        "embedding" = EXCLUDED."embedding",
        "raw" = EXCLUDED."raw",
        "synced_at" = now(),
        "updated_at" = now()
    `;
  }

  /** Total de chamados indexados localmente (para o endpoint de status). */
  async countIndexed(): Promise<number> {
    return this.prisma.infraspeakTicket.count();
  }
}
