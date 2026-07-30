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
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../../prisma/prisma.service.js';
import { AuditService } from '../../../audit/audit.service.js';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { LoginDto } from '../dtos/login.dto.js';
import { RegisterDto } from '../dtos/register.dto.js';
import { UpdateProfileDto } from '../dtos/update-profile.dto.js';
import { ChangePasswordDto } from '../dtos/change-password.dto.js';
import {
  AuthenticatedUser,
  JwtPayload,
  LoginResult,
  UserRole,
} from '../../domain/interfaces/auth.interface.js';
import {
  sanitizeUserPreferences,
  type UserPreferences,
} from '../../domain/interfaces/user-preferences.interface.js';
import type { Prisma } from '@prisma/client';

// Hash fictício (gerado uma vez no startup) usado para nivelar o tempo de
// resposta do login quando o usuário/senha não existe — mitiga enumeração
// de usuários por análise de timing.
const DUMMY_PASSWORD_HASH = bcrypt.hashSync('bluebee-dummy-password', 10);

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
  ) {}

  // ─── Login ───────────────────────────────────────────────────────────────────

  async login(
    dto: LoginDto,
    context?: { ip?: string | null; userAgent?: string | null },
  ): Promise<LoginResult> {
    // 1. Busca o usuário no Postgres pelo e-mail
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    // 2. Valida a senha contra o hash armazenado (bcrypt) — sem Supabase
    if (!user || !user.passwordHash) {
      // Compara contra um hash fictício para nivelar o tempo de resposta
      // e evitar enumeração de usuários por timing.
      await bcrypt.compare(dto.password, DUMMY_PASSWORD_HASH);
      // Conta inexistente: usuário aparece como "desconhecido" na trilha, mas
      // o e-mail tentado é preservado em actorEmail para investigação.
      await this.audit.record({
        actor: { name: 'desconhecido', email: dto.email },
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
      this.logger.warn(`Senha inválida para ${dto.email}`);
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
        this.logger.warn(`Login bloqueado (cliente inativo) para ${dto.email}`);
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

    // 3. Monta payload JWT
    const payload: Omit<JwtPayload, 'iat' | 'exp'> = {
      sub: user.id,
      email: user.email,
      role: user.role as UserRole,
      tenantId: user.tenantId,
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
      data: { passwordHash },
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
