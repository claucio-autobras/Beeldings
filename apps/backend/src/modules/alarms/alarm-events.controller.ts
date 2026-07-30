import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { AlarmEventState, AlarmSeverity } from '@prisma/client';
import { JwtAuthGuard } from '../auth/presentation/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/presentation/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/domain/interfaces/auth.interface.js';
import { UserRole } from '../auth/domain/interfaces/auth.interface.js';
import { AlarmEventsService } from './alarm-events.service.js';
import { resolveTenantScope } from '../auth/presentation/tenant-scope.util.js';

const GLOBAL_ROLES = new Set<UserRole>([UserRole.ADMIN, UserRole.CCO, UserRole.SUPERVISOR]);

function parseDate(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

@Controller('alarm-events')
@UseGuards(JwtAuthGuard)
export class AlarmEventsController {
  constructor(private readonly events: AlarmEventsService) {}

  private scope(user: AuthenticatedUser, queryTenantId?: string): string | undefined {
    return resolveTenantScope(user, queryTenantId);
  }

  @Get('/')
  findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query('tenantId') tenantId: string | undefined,
    @Query('siteId') siteId: string | undefined,
    @Query('deviceId') deviceId: string | undefined,
    @Query('pointId') pointId: string | undefined,
    @Query('severity') severity: AlarmSeverity | undefined,
    @Query('state') state: AlarmEventState | undefined,
    @Query('open') open: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
  ) {
    return this.events.findAll({
      tenantId: this.scope(user, tenantId),
      siteId,
      deviceId,
      pointId,
      severity,
      state,
      open: open === 'true' || open === '1',
      from: parseDate(from),
      to: parseDate(to),
    });
  }

  @Get('/stats')
  stats(
    @CurrentUser() user: AuthenticatedUser,
    @Query('tenantId') tenantId: string | undefined,
    @Query('siteId') siteId: string | undefined,
  ) {
    return this.events.stats(this.scope(user, tenantId), siteId);
  }

  // Rota estática precisa vir ANTES de '/:id/acknowledge' para o Nest não
  // interpretar 'acknowledge' como um :id.
  @Post('/acknowledge')
  acknowledgeMany(
    @Body() body: { ids?: string[]; note?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.events.acknowledgeMany(body.ids ?? [], this.scope(user), user.id, body.note);
  }

  @Post('/:id/acknowledge')
  acknowledge(
    @Param('id') id: string,
    @Body() body: { userId?: string; note?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.events.acknowledge(id, this.scope(user), body.userId ?? user.id, body.note);
  }
}
