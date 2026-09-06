/**
 * ExternalNotificationsService — entrega de notificações externas.
 *
 * Responsabilidades:
 *  1. Deduplicação/agrupamento anti-tempestade: acumula alarmes numa janela de
 *     60 s por destinatário+canal e envia um digest quando há mais de um.
 *  2. Retry limitado (3 tentativas) com backoff exponencial por canal.
 *  3. Isolamento de falha: erro no e-mail não afeta o WhatsApp e vice-versa.
 *  4. Degradação graciosa: sem credenciais → só log, nunca exceção.
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ResendAdapter } from './resend.adapter.js';
import { ZapiAdapter } from './zapi.adapter.js';
import {
  type AlarmContext,
  type InsightContext,
  buildAlarmEmailSubject,
  buildAlarmEmailHtml,
  buildAlarmWhatsAppMessage,
  buildAlarmDigestEmailSubject,
  buildAlarmDigestEmailHtml,
  buildAlarmDigestWhatsApp,
  buildInsightEmailSubject,
  buildInsightEmailHtml,
  buildInsightWhatsAppMessage,
  buildTestEmailHtml,
  buildTestWhatsAppMessage,
} from './notification-templates.js';

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface RecipientTarget {
  id: string;
  name: string;
  email?: string;
  phone?: string;
}

interface QueuedAlarm {
  ctx: AlarmContext;
  queuedAt: number;
}

interface RecipientQueue {
  emailItems: QueuedAlarm[];
  whatsappItems: QueuedAlarm[];
  emailTimer: NodeJS.Timeout | null;
  whatsappTimer: NodeJS.Timeout | null;
}

// Janela de agrupamento (ms): coleta alarmes durante este intervalo e entrega
// um digest único, evitando tempestade de mensagens em quedas em massa.
const STORM_WINDOW_MS = 60_000;

// Retry: até 3 tentativas com backoff de 2^attempt × 2s.
const MAX_RETRIES = 3;

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class ExternalNotificationsService implements OnModuleDestroy {
  private readonly logger = new Logger(ExternalNotificationsService.name);
  /** Filas anti-tempestade por recipientId. */
  private readonly queues = new Map<string, RecipientQueue>();
  /** Todos os timers ativos (para limpar no destroy). */
  private readonly activeTimers = new Set<NodeJS.Timeout>();

  constructor(
    private readonly resend: ResendAdapter,
    private readonly zapi: ZapiAdapter,
  ) {}

  onModuleDestroy(): void {
    for (const t of this.activeTimers) clearTimeout(t);
    this.activeTimers.clear();
    this.queues.clear();
  }

  /** Retorna se algum provedor está configurado. */
  isAnyProviderConfigured(): boolean {
    return this.resend.isConfigured() || this.zapi.isConfigured();
  }

  isEmailConfigured(): boolean {
    return this.resend.isConfigured();
  }

  isWhatsAppConfigured(): boolean {
    return this.zapi.isConfigured();
  }

  providersStatus(): { email: boolean; whatsapp: boolean } {
    return {
      email: this.resend.isConfigured(),
      whatsapp: this.zapi.isConfigured(),
    };
  }

  // ── Alarmes ──────────────────────────────────────────────────────────────

  /**
   * Enfileira uma notificação de alarme por destinatário.
   * Anti-tempestade: acumula na janela e envia um único digest ao final.
   */
  dispatchAlarm(recipient: RecipientTarget, ctx: AlarmContext): void {
    if (!this.isAnyProviderConfigured()) return;
    const queue = this.getOrCreateQueue(recipient.id);
    const item: QueuedAlarm = { ctx, queuedAt: Date.now() };

    if (recipient.email && this.resend.isConfigured()) {
      queue.emailItems.push(item);
      if (!queue.emailTimer) {
        const t = setTimeout(() => {
          this.activeTimers.delete(t);
          const items = queue.emailItems.splice(0);
          if (items.length === 0) return;
          void this.flushAlarmEmail(recipient, items);
        }, STORM_WINDOW_MS);
        this.activeTimers.add(t);
        queue.emailTimer = t;
      }
    }

    if (recipient.phone && this.zapi.isConfigured()) {
      queue.whatsappItems.push(item);
      if (!queue.whatsappTimer) {
        const t = setTimeout(() => {
          this.activeTimers.delete(t);
          const items = queue.whatsappItems.splice(0);
          if (items.length === 0) return;
          void this.flushAlarmWhatsApp(recipient, items);
        }, STORM_WINDOW_MS);
        this.activeTimers.add(t);
        queue.whatsappTimer = t;
      }
    }
  }

  private async flushAlarmEmail(recipient: RecipientTarget, items: QueuedAlarm[]): Promise<void> {
    const queue = this.queues.get(recipient.id);
    if (queue) queue.emailTimer = null;
    if (!recipient.email) return;

    const ctxs = items.map((i) => i.ctx);
    let subject: string;
    let html: string;

    if (ctxs.length === 1) {
      subject = buildAlarmEmailSubject(ctxs[0]);
      html = buildAlarmEmailHtml(ctxs[0], recipient.name);
    } else {
      subject = buildAlarmDigestEmailSubject(ctxs);
      html = buildAlarmDigestEmailHtml(ctxs, recipient.name);
    }

    await this.withRetry('email', recipient.email, () =>
      this.resend.send({ to: recipient.email!, subject, html, recipientName: recipient.name }),
    );
  }

  private async flushAlarmWhatsApp(
    recipient: RecipientTarget,
    items: QueuedAlarm[],
  ): Promise<void> {
    const queue = this.queues.get(recipient.id);
    if (queue) queue.whatsappTimer = null;
    if (!recipient.phone) return;

    const ctxs = items.map((i) => i.ctx);
    const message =
      ctxs.length === 1
        ? buildAlarmWhatsAppMessage(ctxs[0])
        : buildAlarmDigestWhatsApp(ctxs);

    await this.withRetry('whatsapp', recipient.phone, () =>
      this.zapi.send({ phone: recipient.phone!, message }),
    );
  }

  // ── Insights ─────────────────────────────────────────────────────────────

  /** Envia notificação de insight (sem agrupamento — um evento por período). */
  dispatchInsight(recipient: RecipientTarget, ctx: InsightContext): void {
    if (recipient.email && this.resend.isConfigured()) {
      void this.withRetry('email', recipient.email, () =>
        this.resend.send({
          to: recipient.email!,
          subject: buildInsightEmailSubject(ctx),
          html: buildInsightEmailHtml(ctx, recipient.name),
          recipientName: recipient.name,
        }),
      );
    }
    if (recipient.phone && this.zapi.isConfigured()) {
      void this.withRetry('whatsapp', recipient.phone, () =>
        this.zapi.send({
          phone: recipient.phone!,
          message: buildInsightWhatsAppMessage(ctx),
        }),
      );
    }
  }

  // ── Teste de canal ────────────────────────────────────────────────────────

  /**
   * Envia uma mensagem de teste imediata (sem agrupamento) e retorna o resultado.
   * Pode ser chamado do controller para feedback em tempo real na UI.
   */
  async sendTest(
    recipient: RecipientTarget,
    channel: 'email' | 'whatsapp',
  ): Promise<{ ok: boolean; error?: string }> {
    if (channel === 'email') {
      if (!this.resend.isConfigured()) return { ok: false, error: 'RESEND_API_KEY não configurada' };
      if (!recipient.email) return { ok: false, error: 'Destinatário sem e-mail cadastrado' };
      return this.resend.send({
        to: recipient.email,
        subject: '✅ Teste de canal — Plataforma Beeldings',
        html: buildTestEmailHtml(recipient.name),
        recipientName: recipient.name,
      });
    }

    if (channel === 'whatsapp') {
      if (!this.zapi.isConfigured()) return { ok: false, error: 'Credenciais Z-API não configuradas' };
      if (!recipient.phone) return { ok: false, error: 'Destinatário sem telefone cadastrado' };
      return this.zapi.send({
        phone: recipient.phone,
        message: buildTestWhatsAppMessage(recipient.name),
      });
    }

    return { ok: false, error: 'Canal inválido' };
  }

  // ── Retry ─────────────────────────────────────────────────────────────────

  private async withRetry(
    channel: string,
    target: string,
    fn: () => Promise<{ ok: boolean; error?: string }>,
  ): Promise<void> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = Math.min(2_000 * 2 ** attempt, 30_000);
        await sleep(delay);
      }
      try {
        const result = await fn();
        if (result.ok) return;
        // Falha não-retryável (ex.: número inválido): loga e para.
        const retryable = this.isRetryableError(result.error);
        if (!retryable) {
          this.logger.warn(
            `[${channel}] Falha permanente ao enviar para ${target}: ${result.error}`,
          );
          return;
        }
        this.logger.warn(
          `[${channel}] Tentativa ${attempt + 1}/${MAX_RETRIES} falhou ao enviar para ${target}: ${result.error}`,
        );
      } catch (err) {
        this.logger.warn(
          `[${channel}] Tentativa ${attempt + 1}/${MAX_RETRIES} — exceção ao enviar para ${target}: ${(err as Error).message}`,
        );
      }
    }
    this.logger.error(
      `[${channel}] Todas as ${MAX_RETRIES} tentativas falharam ao enviar para ${target} — desistindo`,
    );
  }

  private isRetryableError(error?: string): boolean {
    if (!error) return true;
    const lower = error.toLowerCase();
    // Erros de rede, timeout, 5xx = retryable. 4xx = não retryable (exceto 429).
    if (lower.includes('timeout') || lower.includes('network') || lower.includes('fetch')) return true;
    if (lower.includes('http 5')) return true;
    if (lower.includes('http 429')) return true;
    return false;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private getOrCreateQueue(recipientId: string): RecipientQueue {
    if (!this.queues.has(recipientId)) {
      this.queues.set(recipientId, {
        emailItems: [],
        whatsappItems: [],
        emailTimer: null,
        whatsappTimer: null,
      });
    }
    return this.queues.get(recipientId)!;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
