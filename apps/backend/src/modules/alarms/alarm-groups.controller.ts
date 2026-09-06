import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/presentation/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/presentation/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/domain/interfaces/auth.interface.js';
import { UserRole } from '../auth/domain/interfaces/auth.interface.js';
import { AlarmGroupsService } from './alarm-groups.service.js';
import type { CreateAlarmGroupInput, UpdateAlarmGroupInput } from './alarm-groups.service.js';
import { resolveTenantScope } from '../auth/presentation/tenant-scope.util.js';

const GLOBAL_ROLES = new Set<UserRole>([UserRole.ADMIN, UserRole.CCO, UserRole.SUPERVISOR]);

@Controller('alarm-groups')
@UseGuards(JwtAuthGuard)
export class AlarmGroupsController {
  constructor(private readonly groups: AlarmGroupsService) {}

  /** Escopo de tenant: globais veem tudo (ou filtram por query); demais, travados no próprio. */
  private scope(user: AuthenticatedUser, queryTenantId?: string): string | undefined {
    return resolveTenantScope(user, queryTenantId);
  }

  @Get('/')
  findAll(
    @Query('tenantId') tenantId: string | undefined,
    @Query('siteId') siteId: string | undefined,
    @Query('projectId') projectId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.groups.findAll({ tenantId: this.scope(user, tenantId), siteId, projectId });
  }

  @Get('/:id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.groups.findOne(id, this.scope(user));
  }

  @Post('/')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() body: CreateAlarmGroupInput, @CurrentUser() user: AuthenticatedUser) {
    return this.groups.create(body, this.scope(user));
  }

  @Patch('/:id')
  update(@Param('id') id: string, @Body() body: UpdateAlarmGroupInput, @CurrentUser() user: AuthenticatedUser) {
    return this.groups.update(id, this.scope(user), body);
  }

  @Delete('/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.groups.delete(id, this.scope(user));
  }
}
