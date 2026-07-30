import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/presentation/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/presentation/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/domain/interfaces/auth.interface.js';
import { UserRole } from '../auth/domain/interfaces/auth.interface.js';
import { EquipmentAnalyticsService } from './equipment-analytics.service.js';
import { resolveTenantScope } from '../auth/presentation/tenant-scope.util.js';

const GLOBAL_ROLES = new Set<UserRole>([UserRole.ADMIN, UserRole.CCO, UserRole.SUPERVISOR]);

function parseDate(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Consultas analíticas por equipamento (contexto operacional + linha do tempo).
 * Vive em controller próprio para não inchar o DevicesController.
 */
@Controller('devices')
@UseGuards(JwtAuthGuard)
export class EquipmentAnalyticsController {
  constructor(private readonly analytics: EquipmentAnalyticsService) {}

  /** Escopo de tenant: globais veem tudo; demais, travados no próprio. */
  private scope(user: AuthenticatedUser): string | undefined {
    return resolveTenantScope(user);
  }

  /** Telemetria de um ponto anotada com o estado operacional vigente. */
  @Get(':id/context-series')
  contextSeries(
    @Param('id') id: string,
    @Query('pointId') pointId: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (!pointId) throw new BadRequestException('pointId é obrigatório');
    return this.analytics.contextSeries(id, this.scope(user), pointId, parseDate(from), parseDate(to));
  }

  /** Linha do tempo: telemetria + alarmes + comandos alinhados no tempo. */
  @Get(':id/timeline')
  timeline(
    @Param('id') id: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('pointId') pointId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.analytics.timeline(id, this.scope(user), parseDate(from), parseDate(to), pointId || undefined);
  }
}
