import { Controller, Get, Patch, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { AuthService } from './application/use-cases/auth.service.js';
import { JwtAuthGuard } from './presentation/guards/jwt-auth.guard.js';
import { CurrentUser } from './presentation/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from './domain/interfaces/auth.interface.js';
import type { UpdateProfileDto } from './application/dtos/update-profile.dto.js';
import type { ChangePasswordDto } from './application/dtos/change-password.dto.js';
import type { UserPreferences } from './domain/interfaces/user-preferences.interface.js';

/**
 * Rotas de autogestão da própria conta (qualquer usuário logado).
 * Separado do AuthController para manter o prefixo `/account` usado pelo
 * frontend em Ajustes.
 */
@Controller('account')
@UseGuards(JwtAuthGuard)
export class AccountController {
  constructor(private readonly authService: AuthService) {}

  // PATCH /account/profile — edita apenas o próprio nome/e-mail
  @Patch('profile')
  @HttpCode(HttpStatus.OK)
  async updateProfile(
    @Body() dto: UpdateProfileDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<AuthenticatedUser> {
    return this.authService.updateProfile(currentUser.id, dto);
  }

  // PATCH /account/password — troca a própria senha (exige a senha atual)
  @Patch('password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<{ success: boolean }> {
    await this.authService.changePassword(currentUser.id, dto);
    return { success: true };
  }

  // GET /account/preferences — lê as próprias preferências (mescladas c/ defaults)
  @Get('preferences')
  async getPreferences(
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<UserPreferences> {
    return this.authService.getPreferences(currentUser.id);
  }

  // PATCH /account/preferences — atualização parcial das próprias preferências
  @Patch('preferences')
  @HttpCode(HttpStatus.OK)
  async updatePreferences(
    @Body() dto: Partial<UserPreferences>,
    @CurrentUser() currentUser: AuthenticatedUser,
  ): Promise<UserPreferences> {
    return this.authService.updatePreferences(currentUser.id, dto);
  }
}
