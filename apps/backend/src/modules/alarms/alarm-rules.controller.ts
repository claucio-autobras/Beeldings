import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/presentation/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/presentation/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/domain/interfaces/auth.interface.js';
import { UserRole } from '../auth/domain/interfaces/auth.interface.js';
import { AlarmRulesService } from './alarm-rules.service.js';
import type { CreateAlarmRuleInput, UpdateAlarmRuleInput } from './alarm-rules.service.js';
import { resolveTenantScope } from '../auth/presentation/tenant-scope.util.js';

const GLOBAL_ROLES = new Set<UserRole>([UserRole.ADMIN, UserRole.CCO, UserRole.SUPERVISOR]);

@Controller('alarm-rules')
@UseGuards(JwtAuthGuard)
export class AlarmRulesController {
  constructor(private readonly rules: AlarmRulesService) {}

  /** Escopo de tenant: globais veem tudo (ou filtram por query); demais, travados no próprio. */
  private scope(user: AuthenticatedUser, queryTenantId?: string): string | undefined {
    return resolveTenantScope(user, queryTenantId);
  }

  @Get('/')
  findAll(
    @Query('deviceId') deviceId: string | undefined,
    @Query('pointId') pointId: string | undefined,
    @Query('tenantId') tenantId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.rules.findAll({ tenantId: this.scope(user, tenantId), deviceId, pointId });
  }

  @Post('/')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() body: CreateAlarmRuleInput, @CurrentUser() user: AuthenticatedUser) {
    void user; // tenantId é derivado do dispositivo do ponto
    return this.rules.create(body);
  }

  @Patch('/:id')
  update(@Param('id') id: string, @Body() body: UpdateAlarmRuleInput, @CurrentUser() user: AuthenticatedUser) {
    return this.rules.update(id, this.scope(user), body);
  }

  @Delete('/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.rules.delete(id, this.scope(user));
  }
}
