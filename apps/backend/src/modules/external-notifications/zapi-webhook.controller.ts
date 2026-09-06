/**
 * Webhook público de mensagens recebidas do Z-API (WhatsApp).
 *
 * POST /webhooks/zapi/receive?token=<ZAPI_CLIENT_TOKEN>
 *
 * Quando alguém responde ao número de alertas, enviamos UMA resposta
 * automática ("canal não monitorado") por telefone dentro de uma janela de
 * 24 h — nunca mais que isso, para não virar spam nem criar loop.
 *
 * Segurança: rota pública (o Z-API não autentica via JWT); exige o token da
 * conta na query string e confere o instanceId do payload quando presente.
 * Sempre responde 200 para o Z-API não re-tentar indefinidamente.
 */

import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { ZapiAdapter } from './zapi.adapter.js';
import { buildWhatsAppAutoReply } from './notification-templates.js';

/** Janela mínima entre respostas automáticas para o mesmo telefone. */
const AUTO_REPLY_COOLDOWN_MS = 24 * 60 * 60 * 1000;
/** Teto do mapa de cooldown (evita crescimento sem limite). */
const MAX_TRACKED_PHONES = 5000;

/** Comparação em tempo constante (evita timing attack no token). */
function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

interface ZapiReceivedPayload {
  instanceId?: string;
  phone?: string;
  fromMe?: boolean;
  isGroup?: boolean;
  isNewsletter?: boolean;
  isStatusReply?: boolean;
  type?: string;
}

@Controller('webhooks/zapi')
export class ZapiWebhookController {
  private readonly logger = new Logger(ZapiWebhookController.name);
  /** phone → timestamp da última resposta automática. */
  private readonly lastAutoReply = new Map<string, number>();

  constructor(
    private readonly zapi: ZapiAdapter,
    private readonly cfg: ConfigService,
  ) {}

  @Post('/receive')
  @HttpCode(HttpStatus.OK)
  async receive(
    @Body() body: ZapiReceivedPayload,
    @Query('token') token?: string,
  ): Promise<{ ok: boolean }> {
    const expected = this.cfg.get<string>('ZAPI_CLIENT_TOKEN')?.trim();
    if (!expected || !token || !safeEquals(token, expected)) {
      // 200 de propósito: não damos pista de token válido/inválido e o
      // Z-API não fica re-tentando. Apenas ignoramos.
      this.logger.warn('Webhook Z-API ignorado: token ausente ou inválido');
      return { ok: true };
    }

    // Payload precisa ser um objeto JSON — qualquer outra coisa é ignorada
    // (sempre 200 para o Z-API não re-tentar).
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return { ok: true };
    }

    // instanceId OBRIGATÓRIO e igual ao da instância configurada: impede que
    // alguém com o token use o endpoint para disparar mensagens arbitrárias.
    if (
      typeof body.instanceId !== 'string' ||
      !this.zapi.matchesInstance(body.instanceId)
    ) {
      this.logger.warn('Webhook Z-API ignorado: instanceId ausente ou não confere');
      return { ok: true };
    }

    // Só mensagens diretas de terceiros: nunca as nossas, grupos, canais
    // ou respostas de status.
    if (body.fromMe || body.isGroup || body.isNewsletter || body.isStatusReply) {
      return { ok: true };
    }

    const phone =
      typeof body.phone === 'string' ? body.phone.replace(/\D/g, '') : '';
    if (!phone || phone.length < 8 || phone.length > 15) return { ok: true };

    const now = Date.now();
    const last = this.lastAutoReply.get(phone);
    if (last && now - last < AUTO_REPLY_COOLDOWN_MS) return { ok: true };

    // Registra ANTES de enviar: se o envio falhar, preferimos silêncio a
    // arriscar rajada de tentativas para o mesmo telefone.
    this.lastAutoReply.set(phone, now);
    this.pruneIfNeeded();

    const result = await this.zapi.send({
      phone,
      message: buildWhatsAppAutoReply(),
    });
    if (result.ok) {
      this.logger.log(`Resposta automática enviada para ${phone}`);
    }
    return { ok: true };
  }

  /** Remove as entradas mais antigas quando o mapa passa do teto. */
  private pruneIfNeeded(): void {
    if (this.lastAutoReply.size <= MAX_TRACKED_PHONES) return;
    const entries = [...this.lastAutoReply.entries()].sort((a, b) => a[1] - b[1]);
    const toRemove = entries.slice(0, entries.length - MAX_TRACKED_PHONES);
    for (const [phone] of toRemove) this.lastAutoReply.delete(phone);
  }
}
