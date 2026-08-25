import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  BadRequestException,
  HttpException,
  HttpStatus,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { AuditService } from '../../../audit/audit.service.js';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { LoginDto } from '../dtos/login.dto.js';
import { TurnstileService } from './turnstile.service.js';
import { RegisterDto } from '../dtos/register.dto.js';
import { UpdateProfileDto } from '../dtos/update-profile.dto.js';
import { ChangePasswordDto } from '../dtos/change-password.dto.js';
import {
  AuthenticatedUser,
  JwtPayload,
  LoginOutcome,
  LoginResult,
  UserRole,
} from '../../domain/interfaces/auth.interface.js';
import { ResendAdapter } from '../../../external-notifications/resend.adapter.js';
import { buildPasswordResetEmail, buildTwoFactorEmail } from '../auth-email.templates.js';
import {
  sanitizeUserPreferences,
  type UserPreferences,
} from '../../domain/interfaces/user-preferences.interface.js';
import type { Prisma } from '@prisma/client';

// Hash fictício (gerado uma vez no startup) usado para nivelar o tempo de
// resposta do login quando o usuário/senha não existe — mitiga enumeração
// de usuários por análise de timing.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('bluebee-dummy-password', 10);
const TWO_FACTOR_TTL_SECONDS = 10 * 60;
const PASSWORD_RESET_TTL_SECONDS = 30 * 60;
const MAX_CHALLENGE_ATTEMPTS = 5;
const TWO_FACTOR_RESEND_COOLDOWN_MS = 30_000;
const TWO_FACTOR_EXEMPT_EMAIL = 'admin@autobras.com.br';

/** Claim `purpose` do token de confirmação de ação sensível (exclusões críticas). */
export const SENSITIVE_ACTION_PURPOSE = 'sensitive-action';

/** Validade (segundos) do token de confirmação por senha — janela curta de uso. */
export const SENSITIVE_ACTION_TTL_SECONDS = 5 * 60;

/** Estado de rate limit das confirmações de senha (por usuário, em memória). */
interface ConfirmAttemptState {
  failures: number;
  windowStart: number;
  blockedUntil: number;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly turnstile: TurnstileService,
    private readonly resend: ResendAdapter,
  ) {}

  // ─── Login ───────────────────────────────────────────────────────────────────

  async login(
    dto: LoginDto,
    context?: { ip?: string | null; userAgent?: string | null },
  ): Promise<LoginOutcome> {
    // 0. Anti-robô (Cloudflare Turnstile) — antes de tocar no banco. Só é
    //    exigido quando as chaves estão configuradas no servidor.
    await this.turnstile.assertValid(dto.turnstileToken, context?.ip ?? null);

    // 1. Busca o usuário no Postgres pelo e-mail
    const loginEmail = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({
      where: { email: loginEmail },
    });

    // 2. Valida a senha contra o hash armazenado (bcrypt) — sem Supabase
    if (!user || !user.passwordHash) {
      // Compara contra um hash fictício para nivelar o tempo de resposta
      // e evitar enumeração de usuários por timing.
      await bcrypt.compare(dto.password, DUMMY_PASSWORD_HASH);
      // Conta inexistente: usuário aparece como "desconhecido" na trilha, mas
      // o e-mail tentado é preservado em actorEmail para investigação.
      await this.audit.record({
        actor: { name: 'desconhecido', email: loginEmail },
        action: 'LOGIN',
        entityType: 'Sessão',
        result: 'FAILURE',
        ip: context?.ip ?? null,
        userAgent: context?.userAgent ?? null,
      });
      throw new UnauthorizedException('Credenciais inválidas');
    }

    const senhaValida = await bcrypt.compare(dto.password, user.passwordHash);
    if (!senhaValida) {
      this.logger.warn(`Senha inválida para ${loginEmail}`);
      await this.audit.record({
        actor: { id: user.id, name: user.name, email: user.email, role: user.role },
        action: 'LOGIN',
        entityType: 'Sessão',
        tenantId: user.tenantId,
        result: 'FAILURE',
        ip: context?.ip ?? null,
        userAgent: context?.userAgent ?? null,
      });
      throw new UnauthorizedException('Credenciais inválidas');
    }

    // Cliente inativado: bloqueia o login DEPOIS da senha validada, com mensagem
    // amigável distinta de "credenciais inválidas". Papéis globais (sem tenant)
    // nunca passam por aqui. O código TENANT_INACTIVE permite ao frontend
    // diferenciar o caso (sessões ativas também são derrubadas pelo JwtStrategy).
    if (user.tenantId) {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: user.tenantId },
        select: { active: true },
      });
      if (tenant && !tenant.active) {
        this.logger.warn(`Login bloqueado (cliente inativo) para ${loginEmail}`);
        await this.audit.record({
          actor: { id: user.id, name: user.name, email: user.email, role: user.role },
          action: 'LOGIN',
          entityType: 'Sessão',
          tenantId: user.tenantId,
          result: 'FAILURE',
          ip: context?.ip ?? null,
          userAgent: context?.userAgent ?? null,
        });
        throw new ForbiddenException({
          message:
            'O acesso da sua empresa está temporariamente desativado. Entre em contato com o administrador do sistema.',
          code: 'TENANT_INACTIVE',
        });
      }
    }

    // Em produção, a segunda etapa é obrigatória por padrão. A conta operacional
    // do Autobras é a única exceção explícita: ela autentica somente com a senha.
    // Em desenvolvimento, os demais usuários só recebem 2FA quando
    // EMAIL_2FA_REQUIRED=true, para não bloquear o preview sem e-mail configurado.
    const isTwoFactorExempt = user.email.trim().toLowerCase() === TWO_FACTOR_EXEMPT_EMAIL;
    if (this.isEmailTwoFactorRequired() && !isTwoFactorExempt) {
      const challenge = await this.createChallenge(user.id, 'LOGIN_2FA', TWO_FACTOR_TTL_SECONDS, true);
      const sent = await this.resend.send({
        to: user.email,
        recipientName: user.name,
        subject: 'Código de acesso — Beeldings',
        html: buildTwoFactorEmail(user.name, challenge.secret),
      });

      if (!sent.ok) {
        await this.prisma.authChallenge.delete({ where: { id: challenge.id } }).catch(() => undefined);
        this.logger.error(`Não foi possível enviar o código 2FA para ${user.email}: ${sent.error ?? 'erro desconhecido'}`);
        throw new ServiceUnavailableException(
          'Não foi possível enviar o código de confirmação por e-mail. Tente novamente em instantes.',
        );
      }

      this.logger.log(`Código 2FA enviado para ${user.email}`);
      return {
        requiresTwoFactor: true,
        challengeId: challenge.id,
        expiresInSeconds: TWO_FACTOR_TTL_SECONDS,
        emailMasked: this.maskEmail(user.email),
      };
    }

    // 3. Monta payload JWT
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: user.id,
      email: user.email,
      role: user.role as UserRole,
      tenantId: user.tenantId,
      sessionVersion: user.sessionVersion,
    };

    const accessToken = this.jwt.sign(payload);

    const authenticatedUser: AuthenticatedUser = {
      id: user.id,
      supabaseId: user.supabaseId,
      email: user.email,
      name: user.name,
      role: user.role as UserRole,
      tenantId: user.tenantId,
      preferences: sanitizeUserPreferences(user.preferences),
    };

    this.logger.log(`Login realizado: ${user.email} (role=${user.role})`);

    await this.audit.record({
      actor: { id: user.id, name: user.name, email: user.email, role: user.role },
      action: 'LOGIN',
      entityType: 'Sessão',
      tenantId: user.tenantId,
      result: 'SUCCESS',
      ip: context?.ip ?? null,
      userAgent: context?.userAgent ?? null,
    });

    return { accessToken, user: authenticatedUser };
  }

  // ─── 2FA por e-mail ──────────────────────────────────────────────────────────

  async verifyTwoFactor(
    challengeId: string,
    code: string,
    context?: { ip?: string | null; userAgent?: string | null },
  ): Promise<LoginResult> {
    const challenge = await this.consumeChallenge(challengeId, 'LOGIN_2FA', code);
    const user = await this.prisma.user.findUnique({
      where: { id: challenge.userId },
      include: { tenant: { select: { active: true } } },
    });
    if (!user || (user.tenant && !user.tenant.active)) {
      throw new UnauthorizedException('Não foi possível concluir a autenticação');
    }

    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: user.id,
      email: user.email,
      role: user.role as UserRole,
      tenantId: user.tenantId,
      sessionVersion: user.sessionVersion,
    };
    const accessToken = this.jwt.sign(payload);
    const authenticatedUser: AuthenticatedUser = {
      id: user.id,
      supabaseId: user.supabaseId,
      email: user.email,
      name: user.name,
      role: user.role as UserRole,
      tenantId: user.tenantId,
      preferences: sanitizeUserPreferences(user.preferences),
    };

    await this.audit.record({
      actor: { id: user.id, name: user.name, email: user.email, role: user.role },
      action: 'LOGIN',
      entityType: 'Sessão',
      tenantId: user.tenantId,
      result: 'SUCCESS',
      ip: context?.ip ?? null,
      userAgent: context?.userAgent ?? null,
    });
    this.logger.log(`Login 2FA concluído: ${user.email} (role=${user.role})`);
    return { accessToken, user: authenticatedUser };
  }

  async resendTwoFactor(
    challengeId: string,
  ): Promise<{ resent: boolean; retryAfterSeconds?: number }> {
    const previous = await this.prisma.authChallenge.findFirst({
      where: {
        id: challengeId,
        type: 'LOGIN_2FA',
        consumedAt: null,
        expiresAt: { gt: new Date() },
        attempts: { lt: MAX_CHALLENGE_ATTEMPTS },
      },
      include: { user: true },
    });
    // Resposta neutra: não revela se o desafio existe, expirou ou pertence a outro usuário.
    if (!previous) return { resent: false };

    // Mantém o mesmo challengeId que a tela já possui. O lock por usuário/tipo
    // também garante que dois cliques simultâneos não enviem códigos concorrentes.
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${this.challengeLockKey(previous.userId, 'LOGIN_2FA')}))`;
      const current = await tx.authChallenge.findFirst({
        where: {
          id: challengeId,
          type: 'LOGIN_2FA',
          consumedAt: null,
          expiresAt: { gt: new Date() },
          attempts: { lt: MAX_CHALLENGE_ATTEMPTS },
        },
        include: { user: true },
      });
      if (!current) return { resent: false };

      const cooldownBase = current.lastSentAt ?? current.createdAt;
      const remainingMs = TWO_FACTOR_RESEND_COOLDOWN_MS - (Date.now() - cooldownBase.getTime());
      if (remainingMs > 0) {
        return { resent: false, retryAfterSeconds: Math.ceil(remainingMs / 1000) };
      }

      const code = String(randomInt(100_000, 1_000_000));
      const sent = await this.resend.send({
        to: current.user.email,
        recipientName: current.user.name,
        subject: 'Novo código de acesso — Beeldings',
        html: buildTwoFactorEmail(current.user.name, code),
      });
      if (!sent.ok) {
        throw new ServiceUnavailableException('Não foi possível enviar um novo código. Tente novamente em instantes.');
      }
      await tx.authChallenge.update({
        where: { id: current.id },
        data: {
          tokenHash: this.hashChallenge(current.id, code),
          expiresAt: new Date(Date.now() + TWO_FACTOR_TTL_SECONDS * 1000),
          attempts: 0,
          lastSentAt: new Date(),
        },
      });
      return { resent: true };
    });
  }

  // ─── Recuperação de senha ────────────────────────────────────────────────────

  async requestPasswordReset(emailInput: string): Promise<void> {
    const email = (emailInput ?? '').trim().toLowerCase();
    const user = email ? await this.prisma.user.findUnique({ where: { email } }) : null;
    // A rota sempre responde sucesso para impedir enumeração de contas.
    if (!user) return;

    const challenge = await this.createChallenge(user.id, 'PASSWORD_RESET', PASSWORD_RESET_TTL_SECONDS, true);
    const appUrl = (process.env.APP_URL?.trim() || 'https://www.beeldings.com.br').replace(/\/+$/, '');
    const resetUrl = `${appUrl}/reset-password?token=${encodeURIComponent(`${challenge.id}.${challenge.secret}`)}`;
    const sent = await this.resend.send({
      to: user.email,
      recipientName: user.name,
      subject: 'Redefinição de senha — Beeldings',
      html: buildPasswordResetEmail(user.name, resetUrl),
    });
    if (!sent.ok) {
      await this.prisma.authChallenge.delete({ where: { id: challenge.id } }).catch(() => undefined);
      this.logger.error(`Não foi possível enviar redefinição de senha para ${user.email}: ${sent.error ?? 'erro desconhecido'}`);
    }
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('A nova senha deve ter ao menos 8 caracteres');
    }
    const challenge = await this.consumeChallengeToken(token, 'PASSWORD_RESET');
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: challenge.userId },
        data: { passwordHash, sessionVersion: { increment: 1 } },
      }),
      this.prisma.authChallenge.updateMany({
        where: { userId: challenge.userId, type: 'PASSWORD_RESET', consumedAt: null },
        data: { consumedAt: new Date() },
      }),
    ]);
    this.logger.log(`Senha redefinida via e-mail para userId=${challenge.userId}`);
  }

  private isEmailTwoFactorRequired(): boolean {
    const configured = process.env.EMAIL_2FA_REQUIRED?.trim().toLowerCase();
    if (configured !== undefined && configured !== '') return configured === 'true';
    return process.env.NODE_ENV === 'production';
  }

  private async createChallenge(
    userId: string,
    type: 'LOGIN_2FA' | 'PASSWORD_RESET',
    ttlSeconds: number,
    invalidateExisting: boolean,
  ): Promise<{ id: string; secret: string }> {
    const id = randomUUID();
    const secret =
      type === 'LOGIN_2FA'
        ? String(randomInt(100_000, 1_000_000))
        : randomBytes(32).toString('base64url');
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${this.challengeLockKey(userId, type)}))`;
      if (invalidateExisting) {
        await tx.authChallenge.updateMany({
          where: { userId, type, consumedAt: null },
          data: { consumedAt: new Date() },
        });
      }
      await tx.authChallenge.create({
        data: {
          id,
          userId,
          type,
          tokenHash: this.hashChallenge(id, secret),
          expiresAt: new Date(Date.now() + ttlSeconds * 1000),
          lastSentAt: new Date(),
        },
      });
    });
    return { id, secret };
  }

  private async consumeChallenge(
    challengeId: string,
    type: 'LOGIN_2FA' | 'PASSWORD_RESET',
    secret: string,
  ): Promise<{ userId: string }> {
    const candidate = await this.prisma.authChallenge.findFirst({
      where: { id: challengeId, type },
      select: { userId: true },
    });
    if (!candidate) {
      throw new UnauthorizedException('Código ou link inválido ou expirado');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${this.challengeLockKey(candidate.userId, type)}))`;
      const challenge = await tx.authChallenge.findFirst({
        where: { id: challengeId, type, consumedAt: null },
        select: { id: true, userId: true, tokenHash: true, expiresAt: true, attempts: true },
      });
      if (!challenge || challenge.expiresAt <= new Date() || challenge.attempts >= MAX_CHALLENGE_ATTEMPTS) {
        throw new UnauthorizedException('Código ou link inválido ou expirado');
      }

      const expected = Buffer.from(challenge.tokenHash, 'hex');
      const received = Buffer.from(this.hashChallenge(challenge.id, secret), 'hex');
      const valid = expected.length === received.length && timingSafeEqual(expected, received);
      if (!valid) {
        const nextAttempts = challenge.attempts + 1;
        await tx.authChallenge.update({
          where: { id: challenge.id },
          data: {
            attempts: { increment: 1 },
            ...(nextAttempts >= MAX_CHALLENGE_ATTEMPTS ? { consumedAt: new Date() } : {}),
          },
        });
        throw new UnauthorizedException('Código ou link inválido ou expirado');
      }

      const consumed = await tx.authChallenge.updateMany({
        where: {
          id: challenge.id,
          consumedAt: null,
          expiresAt: { gt: new Date() },
          attempts: { lt: MAX_CHALLENGE_ATTEMPTS },
        },
        data: { consumedAt: new Date() },
      });
      if (consumed.count !== 1) throw new UnauthorizedException('Código ou link inválido ou expirado');
      // Um reset bem-sucedido invalida outros links antes de soltar o lock:
      // duas solicitações paralelas nunca conseguem redefinir a senha em sequência.
      if (type === 'PASSWORD_RESET') {
        await tx.authChallenge.updateMany({
          where: { userId: challenge.userId, type, consumedAt: null },
          data: { consumedAt: new Date() },
        });
      }
      return { userId: challenge.userId };
    });
  }

  private async consumeChallengeToken(
    token: string,
    type: 'PASSWORD_RESET',
  ): Promise<{ userId: string }> {
    const [challengeId, secret, ...rest] = (token ?? '').split('.');
    if (!challengeId || !secret || rest.length > 0) {
      throw new UnauthorizedException('Link de redefinição inválido ou expirado');
    }
    return this.consumeChallenge(challengeId, type, secret);
  }

  private hashChallenge(id: string, secret: string): string {
    return createHash('sha256')
      .update(`${id}:${secret}:${process.env.JWT_SECRET ?? ''}`)
      .digest('hex');
  }

  private challengeLockKey(userId: string, type: 'LOGIN_2FA' | 'PASSWORD_RESET'): string {
    return `auth-challenge:${type}:${userId}`;
  }

  private maskEmail(email: string): string {
    const [local, domain] = email.split('@');
    if (!local || !domain) return 'seu e-mail';
    return `${local.slice(0, 2)}${'*'.repeat(Math.max(1, local.length - 2))}@${domain}`;
  }

  // ─── Confirmação de senha p/ ações sensíveis (exclusões críticas) ────────────

  /** Tentativas de confirmação de senha por usuário (rate limit em memória). */
  private readonly confirmAttempts = new Map<string, ConfirmAttemptState>();
  private static readonly CONFIRM_MAX_FAILURES = 5;
  private static readonly CONFIRM_WINDOW_MS = 5 * 60_000;
  private static readonly CONFIRM_BLOCK_MS = 5 * 60_000;

  /**
   * Reverifica a senha de login do operador já autenticado e, se correta, emite
   * um token de curta duração (claim `purpose: 'sensitive-action'`) que autoriza
   * UMA janela curta para executar exclusões críticas. Reutiliza o bcrypt.compare
   * do login (com nivelamento de tempo) e aplica rate limit por usuário:
   * 5 senhas erradas em 5 minutos bloqueiam novas tentativas por 5 minutos.
   */
  async confirmPassword(
    requestingUser: AuthenticatedUser,
    password: string,
  ): Promise<{ confirmationToken: string; expiresInSeconds: number }> {
    if (!password || typeof password !== 'string') {
      throw new BadRequestException('Informe sua senha para confirmar');
    }

    const now = Date.now();
    const state = this.confirmAttempts.get(requestingUser.id);

    // Bloqueado por excesso de tentativas?
    if (state && state.blockedUntil > now) {
      const restanteSeg = Math.ceil((state.blockedUntil - now) / 1000);
      throw new HttpException(
        `Muitas tentativas de senha incorreta. Aguarde ${Math.ceil(restanteSeg / 60)} minuto(s) e tente novamente.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const user = await this.prisma.user.findUnique({ where: { id: requestingUser.id } });

    // Conta sem senha local (legado): compara contra hash fictício para nivelar
    // o tempo de resposta e devolve erro claro.
    if (!user || !user.passwordHash) {
      await bcrypt.compare(password, DUMMY_PASSWORD_HASH);
      throw new BadRequestException(
        'Sua conta ainda não possui senha local cadastrada. Solicite ao administrador a redefinição da sua senha.',
      );
    }

    const senhaValida = await bcrypt.compare(password, user.passwordHash);
    if (!senhaValida) {
      this.registerConfirmFailure(requestingUser.id, now);
      this.logger.warn(`Confirmação de senha incorreta para ${user.email}`);
      throw new UnauthorizedException('Senha incorreta');
    }

    // Sucesso: zera o contador de falhas do usuário.
    this.confirmAttempts.delete(requestingUser.id);

    const confirmationToken = this.jwt.sign(
      { sub: user.id, purpose: SENSITIVE_ACTION_PURPOSE },
      { expiresIn: SENSITIVE_ACTION_TTL_SECONDS },
    );

    this.logger.log(`Confirmação de senha para ação sensível: ${user.email}`);

    return { confirmationToken, expiresInSeconds: SENSITIVE_ACTION_TTL_SECONDS };
  }

  /** Registra uma falha de confirmação e ativa o bloqueio ao atingir o limite. */
  private registerConfirmFailure(userId: string, now: number): void {
    const state = this.confirmAttempts.get(userId);
    // Janela expirada (ou primeira falha): reinicia a contagem.
    if (!state || now - state.windowStart > AuthService.CONFIRM_WINDOW_MS) {
      this.confirmAttempts.set(userId, { failures: 1, windowStart: now, blockedUntil: 0 });
      return;
    }
    state.failures += 1;
    if (state.failures >= AuthService.CONFIRM_MAX_FAILURES) {
      state.blockedUntil = now + AuthService.CONFIRM_BLOCK_MS;
      state.failures = 0;
      state.windowStart = now;
      this.logger.warn(`Confirmação de senha bloqueada temporariamente para userId=${userId}`);
    }
  }

  // ─── Register ────────────────────────────────────────────────────────────────

  async register(dto: RegisterDto, requestingUser: AuthenticatedUser): Promise<AuthenticatedUser> {
    this.validateRegisterPermission(dto, requestingUser);

    // Verifica duplicidade
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new ConflictException(`Usuário com email ${dto.email} já existe`);
    }

    // Gera o hash da senha (bcrypt) — autenticação local, sem Supabase
    const passwordHash = await bcrypt.hash(dto.password, 10);

    // Resolve o tenantId: CLIENTE herda o próprio tenant
    const tenantId =
      requestingUser.role === UserRole.CLIENTE
        ? requestingUser.tenantId
        : (dto.tenantId ?? null);

    // Cria no Prisma
    const newUser = await this.prisma.user.create({
      data: {
        supabaseId: randomUUID(),
        passwordHash,
        email: dto.email,
        name: dto.name,
        role: dto.role,
        tenantId,
      },
    });

    this.logger.log(`Novo usuário registrado: ${newUser.email} (role=${newUser.role}) por ${requestingUser.email}`);

    return {
      id: newUser.id,
      supabaseId: newUser.supabaseId,
      email: newUser.email,
      name: newUser.name,
      role: newUser.role as UserRole,
      tenantId: newUser.tenantId,
    };
  }

  // ─── Register Permission ──────────────────────────────────────────────────────

  private validateRegisterPermission(dto: RegisterDto, requestingUser: AuthenticatedUser): void {
    const { role: requesterRole, tenantId: requesterTenant } = requestingUser;
    const targetRole = dto.role as UserRole;

    // Roles não-privilegiadas que qualquer gestor pode criar
    const TENANT_ROLES: UserRole[] = [UserRole.CLIENTE, UserRole.VISUALIZADOR];

    switch (requesterRole) {
      case UserRole.ADMIN:
        // ADMIN pode criar qualquer usuário
        break;

      case UserRole.CCO:
      case UserRole.SUPERVISOR:
        // CCO e SUPERVISOR só podem criar roles de tenant
        if (!TENANT_ROLES.includes(targetRole)) {
          throw new ForbiddenException(
            `Seu perfil não pode criar usuários com role ${targetRole}`,
          );
        }
        break;

      case UserRole.CLIENTE:
        // CLIENTE só pode criar CLIENTE/VISUALIZADOR dentro do próprio tenant
        if (!TENANT_ROLES.includes(targetRole)) {
          throw new ForbiddenException(
            `Seu perfil não pode criar usuários com role ${targetRole}`,
          );
        }
        if (!requesterTenant) {
          throw new ForbiddenException('Seu usuário não está associado a nenhum tenant');
        }
        break;

      default:
        throw new ForbiddenException('Seu perfil não tem permissão para criar usuários');
    }
  }

  // ─── Get Profile ─────────────────────────────────────────────────────────────

  async getProfile(userId: string): Promise<AuthenticatedUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    return {
      id: user.id,
      supabaseId: user.supabaseId,
      email: user.email,
      name: user.name,
      role: user.role as UserRole,
      tenantId: user.tenantId,
      preferences: sanitizeUserPreferences(user.preferences),
    };
  }

  // ─── Preferências pessoais ───────────────────────────────────────────────────

  async getPreferences(userId: string): Promise<UserPreferences> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { preferences: true },
    });
    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado');
    }
    return sanitizeUserPreferences(user.preferences);
  }

  /**
   * Aceita atualização parcial: mescla o payload sobre as preferências atuais
   * (que já saem mescladas com os defaults) e persiste o objeto completo.
   */
  async updatePreferences(userId: string, dto: unknown): Promise<UserPreferences> {
    if (!dto || typeof dto !== 'object' || Array.isArray(dto)) {
      throw new BadRequestException('Payload de preferências inválido');
    }
    const current = await this.getPreferences(userId);
    const patch = dto as Partial<UserPreferences>;
    const merged = sanitizeUserPreferences(
      {
        ...current,
        ...patch,
        notifications: {
          ...current.notifications,
          ...(patch.notifications && typeof patch.notifications === 'object'
            ? patch.notifications
            : {}),
        },
      },
      current, // campos inválidos preservam o valor atual, não o default
    );

    await this.prisma.user.update({
      where: { id: userId },
      data: { preferences: merged as unknown as Prisma.InputJsonValue },
    });

    return merged;
  }

  // ─── Update Own Profile ──────────────────────────────────────────────────────

  private static readonly EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<AuthenticatedUser> {
    const name = (dto.name ?? '').trim();
    const email = (dto.email ?? '').trim().toLowerCase();

    if (name.length < 2) {
      throw new BadRequestException('O nome deve ter ao menos 2 caracteres');
    }
    if (!AuthService.EMAIL_REGEX.test(email)) {
      throw new BadRequestException('Informe um e-mail válido');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    // E-mail duplicado (outro usuário)
    if (email !== user.email) {
      const existing = await this.prisma.user.findUnique({ where: { email } });
      if (existing && existing.id !== userId) {
        throw new ConflictException('Este e-mail já está em uso por outro usuário');
      }
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { name, email },
    });

    this.logger.log(`Perfil atualizado: ${user.email} → ${updated.email} (${updated.name})`);

    return {
      id: updated.id,
      supabaseId: updated.supabaseId,
      email: updated.email,
      name: updated.name,
      role: updated.role as UserRole,
      tenantId: updated.tenantId,
    };
  }

  // ─── Change Own Password ─────────────────────────────────────────────────────

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<void> {
    const currentPassword = dto.currentPassword ?? '';
    const newPassword = dto.newPassword ?? '';

    if (newPassword.length < 6) {
      throw new BadRequestException('A nova senha deve ter ao menos 6 caracteres');
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException('A nova senha deve ser diferente da atual');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    // Usuário legado sem senha local (a senha antiga vivia no Supabase)
    if (!user.passwordHash) {
      throw new BadRequestException(
        'Sua conta ainda não possui senha local cadastrada. Solicite ao administrador a redefinição da sua senha.',
      );
    }

    const senhaValida = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!senhaValida) {
      this.logger.warn(`Troca de senha com senha atual incorreta: ${user.email}`);
      throw new UnauthorizedException('Senha atual incorreta');
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, sessionVersion: { increment: 1 } },
    });

    this.logger.log(`Senha alterada: ${user.email}`);
  }

  // ─── List Users ──────────────────────────────────────────────────────────────

  async listUsers(requestingUser: AuthenticatedUser): Promise<AuthenticatedUser[]> {
    const isGlobal =
      requestingUser.role === UserRole.ADMIN || requestingUser.role === UserRole.CCO;

    const users = await this.prisma.user.findMany({
      where: isGlobal
        ? undefined
        : { tenantId: requestingUser.tenantId },
      orderBy: { createdAt: 'asc' },
    });

    return users.map((u) => ({
      id: u.id,
      supabaseId: u.supabaseId,
      email: u.email,
      name: u.name,
      role: u.role as UserRole,
      tenantId: u.tenantId,
      createdAt: u.createdAt.toISOString(),
    }));
  }

  // ─── Delete User ─────────────────────────────────────────────────────────────

  async deleteUser(targetId: string, requestingUser: AuthenticatedUser): Promise<void> {
    if (targetId === requestingUser.id) {
      throw new ForbiddenException('Você não pode excluir sua própria conta');
    }

    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!target) {
      throw new NotFoundException('Usuário não encontrado');
    }

    // Não-ADMIN só pode deletar usuários do próprio tenant
    if (requestingUser.role !== UserRole.ADMIN && target.tenantId !== requestingUser.tenantId) {
      throw new ForbiddenException('Você não tem permissão para excluir este usuário');
    }

    await this.prisma.user.delete({ where: { id: targetId } });
    this.logger.log(`Usuário ${target.email} excluído por ${requestingUser.email}`);
  }

  // ─── Validate User (usado pelo JwtStrategy) ───────────────────────────────────

  async validateUser(supabaseId: string): Promise<AuthenticatedUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { supabaseId },
    });

    if (!user) return null;

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
