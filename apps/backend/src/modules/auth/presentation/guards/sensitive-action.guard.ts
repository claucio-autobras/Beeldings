import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SENSITIVE_ACTION_PURPOSE } from '../../application/use-cases/auth.service.js';
import type { AuthenticatedUser } from '../../domain/interfaces/auth.interface.js';

/** Header em que o frontend envia o token de confirmação de senha. */
export const SENSITIVE_ACTION_HEADER = 'x-sensitive-action-token';

interface SensitiveActionPayload {
  sub?: string;
  purpose?: string;
}

interface RequestLike {
  headers?: Record<string, string | string[] | undefined>;
  user?: AuthenticatedUser;
  sensitiveActionVerified?: boolean;
}

/**
 * Exige que a requisição carregue um token de confirmação de senha válido
 * (emitido por POST /auth/confirm-password) no header `X-Sensitive-Action-Token`.
 * O token deve: ter assinatura válida (mesmo JWT_SECRET do login), não estar
 * expirado, ter claim `purpose: 'sensitive-action'` e pertencer AO MESMO usuário
 * autenticado da requisição. Sem isso, a exclusão é recusada — a proteção vale
 * também para chamadas diretas à API.
 *
 * Deve ser usado APÓS o JwtAuthGuard (que popula req.user). Sem dependências de
 * DI: verifica o token com uma instância própria de JwtService e o JWT_SECRET do
 * ambiente, para poder ser aplicado em qualquer módulo sem importar o AuthModule.
 */
@Injectable()
export class SensitiveActionGuard implements CanActivate {
  private readonly jwt = new JwtService({});

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<RequestLike>();
    const raw = req.headers?.[SENSITIVE_ACTION_HEADER];
    const token = Array.isArray(raw) ? raw[0] : raw;

    if (!token || typeof token !== 'string') {
      throw new ForbiddenException(
        'Esta exclusão exige confirmação por senha. Confirme sua senha e tente novamente.',
      );
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      // Configuração ausente: falha explícita (nunca libera sem verificação).
      throw new ForbiddenException('Confirmação por senha indisponível (JWT_SECRET ausente)');
    }

    let payload: SensitiveActionPayload;
    try {
      payload = this.jwt.verify<SensitiveActionPayload>(token, { secret });
    } catch {
      throw new ForbiddenException(
        'Confirmação de senha expirada ou inválida. Confirme sua senha novamente.',
      );
    }

    if (payload.purpose !== SENSITIVE_ACTION_PURPOSE || !req.user || payload.sub !== req.user.id) {
      throw new ForbiddenException(
        'Confirmação de senha inválida para este usuário. Confirme sua senha novamente.',
      );
    }

    // Sinaliza ao AuditInterceptor que a exclusão foi confirmada por senha.
    req.sensitiveActionVerified = true;
    return true;
  }
}
