import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthenticatedUser } from '../auth/domain/interfaces/auth.interface.js';
import { PrismaService } from '../prisma/prisma.service.js';

const DEFAULT_MAX = 20;
const DEFAULT_WINDOW_MS = 60_000;

/**
 * Rate limit por usuário para o endpoint de chat de IA, que chama a API paga da
 * Anthropic a cada turno. Sem um teto, um loop no front ou abuso poderia gerar
 * custo alto.
 *
 * O estado é persistido no Postgres (tabela `ai_rate_limit_hits`), não em
 * memória, para que o limite seja COMPARTILHADO entre múltiplas instâncias do
 * backend — em memória o teto valeria por processo, deixando passar N×instâncias.
 *
 * A verificação roda dentro de uma transação com `pg_advisory_xact_lock` por
 * chave (usuário), serializando contagem+inserção para que dois pedidos
 * simultâneos não ultrapassem o teto juntos. Janela deslizante: conta apenas os
 * registros dentro da janela e expurga os mais antigos a cada chamada.
 *
 * Limites configuráveis via env (AI_RATE_LIMIT_MAX, AI_RATE_LIMIT_WINDOW_MS);
 * lidos por chamada para facilitar testes.
 */
@Injectable()
export class AiRateLimitGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  private limits(): { max: number; windowMs: number } {
    const max = Number(process.env.AI_RATE_LIMIT_MAX);
    const windowMs = Number(process.env.AI_RATE_LIMIT_WINDOW_MS);
    return {
      max: Number.isFinite(max) && max > 0 ? max : DEFAULT_MAX,
      windowMs:
        Number.isFinite(windowMs) && windowMs > 0 ? windowMs : DEFAULT_WINDOW_MS,
    };
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();

    // O JwtAuthGuard (nível de controller) roda antes deste guard de rota, então
    // req.user já está populado; o IP é apenas um fallback defensivo.
    const key = req.user?.id ?? req.ip ?? 'anonymous';
    const { max, windowMs } = this.limits();
    const now = Date.now();
    const windowStart = new Date(now - windowMs);

    // Retorna o Retry-After (em segundos) se o limite foi atingido, ou 0 se o
    // pedido foi liberado (e contabilizado).
    const retrySec = await this.prisma.$transaction(async (tx) => {
      // Serializa por chave para tornar contagem+inserção atômica entre
      // instâncias. `hashtext` mapeia a string para o int aceito pela função.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;

      // Expurga TODOS os registros fora da janela (de qualquer chave), não só os
      // desta. Assim, chaves de usuários que pararam de chamar o endpoint não
      // ficam acumuladas para sempre — a tabela é varrida a cada verificação,
      // dispensando um job agendado de limpeza.
      await tx.aiRateLimitHit.deleteMany({
        where: { createdAt: { lt: windowStart } },
      });

      const recent = await tx.aiRateLimitHit.findMany({
        where: { key },
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });

      if (recent.length >= max) {
        const oldest = recent[0].createdAt.getTime();
        return Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
      }

      await tx.aiRateLimitHit.create({ data: { key } });
      return 0;
    });

    if (retrySec > 0) {
      const res = context.switchToHttp().getResponse<Response>();
      res.setHeader('Retry-After', String(retrySec));
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: `Você atingiu o limite de ${max} mensagens por minuto. Aguarde ${retrySec}s e tente novamente.`,
          retryAfter: retrySec,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
