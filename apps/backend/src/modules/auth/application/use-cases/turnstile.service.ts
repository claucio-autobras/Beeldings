import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Verificação anti-robô do Cloudflare Turnstile no login.
 *
 * - Só é exigida quando TURNSTILE_SECRET_KEY está configurada (dev/testes sem
 *   as chaves continuam funcionando sem widget).
 * - Token inválido/ausente → 401 (o robô não passa).
 * - Indisponibilidade da API do Cloudflare (rede/5xx) → deixa passar com log
 *   de aviso: o Turnstile é uma camada EXTRA; o login já tem throttle por IP e
 *   auditoria, e uma queda do Cloudflare não pode derrubar o login de todos.
 */
@Injectable()
export class TurnstileService {
  private readonly logger = new Logger(TurnstileService.name);

  /** Site key pública para o frontend renderizar o widget (null = desativado). */
  getSiteKey(): string | null {
    return process.env.TURNSTILE_SITE_KEY?.trim() || null;
  }

  isEnabled(): boolean {
    // Só em produção: a site key do Cloudflare é restrita aos domínios
    // cadastrados (bluebee.ia.br). No preview de desenvolvimento (*.replit.dev)
    // o widget falharia com erro 110200 e trancaria todo mundo fora do login.
    // Exige AS DUAS chaves: com secret mas sem site key o backend exigiria o
    // token enquanto o frontend não teria como renderizar o widget — lockout
    // silencioso de todos os logins.
    return (
      process.env.NODE_ENV === 'production' &&
      Boolean(process.env.TURNSTILE_SECRET_KEY?.trim()) &&
      Boolean(this.getSiteKey())
    );
  }

  /** Valida o token do widget; lança 401 quando a verificação falha. */
  async assertValid(token: string | undefined | null, ip?: string | null): Promise<void> {
    if (!this.isEnabled()) return;
    if (!token || typeof token !== 'string') {
      throw new UnauthorizedException('Confirme a verificação de segurança antes de entrar.');
    }

    let outcome: { success?: boolean; 'error-codes'?: string[] };
    try {
      const body = new URLSearchParams({
        secret: process.env.TURNSTILE_SECRET_KEY as string,
        response: token,
      });
      if (ip) body.set('remoteip', ip);
      const res = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`siteverify HTTP ${res.status}`);
      outcome = (await res.json()) as typeof outcome;
    } catch (err) {
      // Falha de infraestrutura (não do usuário): não bloqueia o login.
      this.logger.warn(
        `Turnstile indisponível — login liberado sem verificação: ${(err as Error).message}`,
      );
      return;
    }

    if (!outcome.success) {
      this.logger.warn(
        `Verificação Turnstile recusada: ${(outcome['error-codes'] ?? []).join(', ') || 'sem código'}`,
      );
      throw new UnauthorizedException(
        'Verificação de segurança expirada ou inválida. Recarregue a página e tente novamente.',
      );
    }
  }
}
