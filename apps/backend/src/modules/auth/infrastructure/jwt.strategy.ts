import { Injectable, UnauthorizedException, ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma/prisma.service.js';
import { readSessionCookie } from '../session-cookie.js';
import { JwtPayload, AuthenticatedUser, UserRole } from '../domain/interfaces/auth.interface.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      // Header Authorization primeiro (serviços internos, testes, ferramentas);
      // fallback para o cookie de sessão HttpOnly emitido no login (browser).
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req) => readSessionCookie(req),
      ]),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { tenant: { select: { active: true } } },
    });

    if (!user) {
      this.logger.warn(`Usuário não encontrado para sub=${payload.sub}`);
      throw new UnauthorizedException('Token inválido — usuário não encontrado');
    }

    // Uma redefinição de senha incrementa a versão e derruba sessões emitidas
    // antes dela, inclusive JWTs que ainda não expiraram.
    if ((payload.sessionVersion ?? 0) !== user.sessionVersion) {
      throw new UnauthorizedException('Sessão encerrada por uma alteração de senha');
    }

    // Cliente inativado: rejeita sessões ativas de usuários do tenant (o token
    // continua criptograficamente válido, então o corte é feito aqui). O código
    // TENANT_INACTIVE permite ao frontend encerrar a sessão com mensagem clara.
    if (user.tenant && !user.tenant.active) {
      throw new ForbiddenException({
        message:
          'O acesso da sua empresa está temporariamente desativado. Entre em contato com o administrador do sistema.',
        code: 'TENANT_INACTIVE',
      });
    }

    return {
      id: user.id,
      supabaseId: user.supabaseId,
      email: user.email,
      name: user.name,
      role: user.role as UserRole,
      tenantId: user.tenantId,
    };
  }
}
