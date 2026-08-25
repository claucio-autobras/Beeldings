/**
 * Adaptador de WhatsApp via Z-API REST API.
 * Toda chamada exige o header Client-Token (token de segurança da conta).
 * Degrada graciosamente quando as variáveis estão ausentes.
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface WhatsAppPayload {
  /** Número de destino em E.164 sem o + (Z-API aceita somente dígitos). */
  phone: string;
  message: string;
}

const ZAPI_HOST = 'https://api.z-api.io';

@Injectable()
export class ZapiAdapter {
  private readonly logger = new Logger(ZapiAdapter.name);
  private readonly instanceId: string | null;
  private readonly instanceToken: string | null;
  private readonly clientToken: string | null;

  constructor(cfg: ConfigService) {
    const clean = (v: string | undefined | null): string | null => {
      const t = v?.trim();
      return t ? t : null;
    };
    const rawInstanceId = clean(cfg.get<string>('ZAPI_INSTANCE_ID'));
    const rawInstanceToken = clean(cfg.get<string>('ZAPI_INSTANCE_TOKEN'));
    // Tolerância de configuração: aceita a URL completa da instância Z-API
    // (ex.: https://api.z-api.io/instances/<id>/token/<token>/send-text)
    // colada em ZAPI_INSTANCE_ID, extraindo id e token dela.
    const urlId = rawInstanceId?.match(/instances\/([^/]+)/)?.[1] ?? null;
    const urlToken = rawInstanceId?.match(/\/token\/([^/]+)/)?.[1] ?? null;
    this.instanceId = urlId ?? rawInstanceId;
    this.instanceToken = rawInstanceToken ?? urlToken;
    this.clientToken = cfg.get<string>('ZAPI_CLIENT_TOKEN') ?? null;
  }

  isConfigured(): boolean {
    return (
      !!this.instanceId &&
      !!this.instanceToken &&
      !!this.clientToken
    );
  }

  /** Confere se o instanceId de um webhook corresponde à instância configurada. */
  matchesInstance(instanceId: string): boolean {
    return !!this.instanceId && this.instanceId === instanceId;
  }

  /** Normaliza E.164 (+5511...) para somente dígitos (Z-API não aceita +). */
  private normalizePhone(e164: string): string {
    return e164.replace(/\D/g, '');
  }

  async send(payload: WhatsAppPayload): Promise<{ ok: boolean; error?: string }> {
    if (!this.isConfigured()) {
      this.logger.log(
        `Z-API não configurado — WhatsApp para ${payload.phone} não enviado (variáveis ausentes)`,
      );
      return { ok: false, error: 'Credenciais Z-API não configuradas' };
    }

    const phone = this.normalizePhone(payload.phone);
    const url = `${ZAPI_HOST}/instances/${this.instanceId}/token/${this.instanceToken}/send-text`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Header obrigatório: token de segurança da conta Z-API.
          'Client-Token': this.clientToken!,
        },
        body: JSON.stringify({ phone, message: payload.message }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.warn(
          `Z-API HTTP ${res.status} ao enviar para ${phone}: ${body.slice(0, 300)}`,
        );
        return { ok: false, error: `HTTP ${res.status}: ${body.slice(0, 200)}` };
      }

      this.logger.log(`WhatsApp enviado via Z-API para ${phone}`);
      return { ok: true };
    } catch (err) {
      const msg = (err as Error).message;
      this.logger.warn(`Z-API: falha de rede ao enviar para ${phone}: ${msg}`);
      return { ok: false, error: msg };
    }
  }
}
