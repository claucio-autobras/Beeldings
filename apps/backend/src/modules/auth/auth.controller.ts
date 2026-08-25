import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './application/use-cases/auth.service.js';
import { getClientIp } from '../audit/audit.util.js';
import type { LoginDto } from './application/dtos/login.dto.js';
import type { RegisterDto } from './application/dtos/register.dto.js';
import { JwtAuthGuard } from './presentation/guards/jwt-auth.guard.js';
import { RolesGuard } from './presentation/guards/roles.guard.js';
import { Roles } from './presentation/decorators/roles.decorator.js';
import { CurrentUser } from './presentation/decorators/current-user.decorator.js';
import type {
  AuthenticatedUser,
  LoginOutcome,
  LoginResult,
  TwoFactorRequiredResult,
} from './domain/interfaces/auth.interface.js';
import { UserRole } from './domain/interfaces/auth.interface.js';
import { setSessionCookie, clearSessionCookie } from './session-cookie.js';
import { TurnstileService } from './application/use-cases/turnstile.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly turnstile: TurnstileService,
  ) {}

  // GET /auth/turnstile-config — pública: o frontend consulta a site key (que
  // é pública por definição) para decidir se renderiza o widget anti-robô.
  @Get('turnstile-config')
  turnstileConfig(): { siteKey: string | null } {
    return { siteKey: this.turnstile.isEnabled() ? this.turnstile.getSiteKey() : null };
  }

  // POST /auth/login — limite estrito por IP contra força bruta (o guard
  // global usa um teto generoso; aqui o decorator sobrescreve para 10/min).
  @Post('login')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginOutcome> {
    const result = await this.authService.login(dto, {
      ip: getClientIp(req),
      userAgent: req.headers['user-agent'] ?? null,
    });
    // Enquanto o 2FA não foi confirmado, NENHUM cookie/JWT é emitido.
    if ('accessToken' in result) {
      // Sessão do browser via cookie HttpOnly (o frontend NÃO armazena o token).
      // O accessToken continua no corpo para serviços internos/testes que usam
      // o header Authorization.
      setSessionCookie(res, result.accessToken);
    }
    return result;
  }

  @Post('two-factor/verify')
  @Throttle({ default: { limit: 10, ttl: 5 * 60_000 } })
  @HttpCode(HttpStatus.OK)
  async verifyTwoFactor(
    @Body() dto: { challengeId?: string; code?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<LoginResult> {
    const result = await this.authService.verifyTwoFactor(
      dto?.challengeId ?? '',
      dto?.code ?? '',
      { ip: getClientIp(req), userAgent: req.headers['user-agent'] ?? null },
    );
    setSessionCookie(res, result.accessToken);
    return result;
  }

  @Post('two-factor/resend')
  @Throttle({ default: { limit: 3, ttl: 5 * 60_000 } })
  @HttpCode(HttpStatus.OK)
  async resendTwoFactor(
    @Body() dto: { challengeId?: string },
  ): Promise<{ resent: boolean; retryAfterSeconds?: number }> {
    return this.authService.resendTwoFactor(dto?.challengeId ?? '');
  }

  @Post('forgot-password')
  @Throttle({ default: { limit: 3, ttl: 15 * 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  async forgotPassword(@Body() dto: { email?: string }): Promise<void> {
    await this.authService.requestPasswordReset(dto?.email ?? '');
  }

  @Post('reset-password')
  @Throttle({ default: { limit: 10, ttl: 15 * 60_000 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  async resetPassword(@Body() dto: { token?: string; newPassword?: string }): Promise<void> {
    await this.authService.resetPassword(dto?.token ?? '', dto?.newPassword ?? '');
  }

  // POST /auth/confirm-password — reverifica a senha do operador logado e emite
  // um token de curta duração que autoriza exclusões críticas (ações sensíveis).
  @Post('confirm-password')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async confirmPassword(
    @Body() dto: { password?: string },
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ confirmationToken: string; expiresInSeconds: number }> {
    return this.authService.confirmPassword(currentUser, dto?.password ?? '');
  }

  // POST /auth/register — ADMIN, CCO, SUPERVISOR e CLIENTE (com restrições no service)
  @Post('register')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CCO, UserRole.SUPERVISOR, UserRole.CLIENTE)
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() dto: RegisterDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<AuthenticatedUser> {
    return this.authService.register(dto, currentUser);
  }

  // GET /auth/profile
  @Get('profile')
  @UseGuards(JwtAuthGuard)
  async getProfile(@CurrentUser() currentUser: AuthenticatedUser): Promise<AuthenticatedUser> {
    return this.authService.getProfile(currentUser.id);
  }

  // GET /auth/users — ADMIN vê todos; CLIENTE/SUPERVISOR vê apenas o próprio tenant
  @Get('users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CCO, UserRole.SUPERVISOR, UserRole.CLIENTE)
  async listUsers(@CurrentUser() currentUser: AuthenticatedUser): Promise<AuthenticatedUser[]> {
    return this.authService.listUsers(currentUser);
  }

  // DELETE /auth/users/:id
  // ADMIN deleta qualquer usuário; demais perfis apenas usuários do próprio
  // tenant (e nunca a si mesmos) — escopo garantido em AuthService.deleteUser.
  // CLIENTE incluído para gerenciar o time do próprio cliente, em paridade
  // com register/listUsers.
  @Delete('users/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CCO, UserRole.SUPERVISOR, UserRole.CLIENTE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteUser(
    @Param('id') id: string,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<void> {
    return this.authService.deleteUser(id, currentUser);
  }

  // POST /auth/logout — expira o cookie de sessão HttpOnly. Sem guard de
  // propósito: mesmo com token expirado/inválido o browser precisa conseguir
  // limpar o cookie (senão a sessão zumbi ficaria presa até expirar sozinha).
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Res({ passthrough: true }) res: Response): Promise<void> {
    // JWT é stateless: expirar o cookie corta o acesso imediatamente.
    // Futura extensão: adicionar token a uma blacklist no Redis.
    clearSessionCookie(res);
  }
}
