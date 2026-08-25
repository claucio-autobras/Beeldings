/**
 * Adaptador de e-mail via Resend REST API.
 * Degrada graciosamente quando RESEND_API_KEY está ausente (log + retorna false).
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface EmailPayload {
  to: string;
  subject: string;
  html: string;
  /** Nome do destinatário (usado em fallback de texto). */
  recipientName: string;
}

const RESEND_API = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'Plataforma Beeldings <no-reply@beeldings.com.br>';

@Injectable()
export class ResendAdapter {
  private readonly logger = new Logger(ResendAdapter.name);
  private readonly apiKey: string | null;
  private readonly from: string;

  constructor(cfg: ConfigService) {
    this.apiKey = cfg.get<string>('RESEND_API_KEY') ?? null;
    const fromEmail = cfg.get<string>('RESEND_FROM_EMAIL');
    const fromName = cfg.get<string>('RESEND_FROM_NAME');
    this.from =
      fromEmail && fromName
        ? `${fromName} <${fromEmail}>`
        : fromEmail
          ? fromEmail
          : DEFAULT_FROM;
  }

  isConfigured(): boolean {
    return this.apiKey !== null && this.apiKey.length > 0;
  }

  async send(payload: EmailPayload): Promise<{ ok: boolean; error?: string }> {
    if (!this.isConfigured()) {
      this.logger.log(
        `Resend não configurado — e-mail para ${payload.to} não enviado (RESEND_API_KEY ausente)`,
      );
      return { ok: false, error: 'RESEND_API_KEY não configurada' };
    }

    try {
      const res = await fetch(RESEND_API, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [payload.to],
          subject: payload.subject,
          html: payload.html,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.warn(
          `Resend HTTP ${res.status} ao enviar para ${payload.to}: ${body.slice(0, 300)}`,
        );
        return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
      }

      this.logger.log(`E-mail enviado via Resend para ${payload.to} — assunto: "${payload.subject}"`);
      return { ok: true };
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.warn(`Resend: falha de rede ao enviar para ${payload.to}: ${msg}`);
      return { ok: false, error: msg };
    }
  }
}
