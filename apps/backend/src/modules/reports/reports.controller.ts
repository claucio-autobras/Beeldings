import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/presentation/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/presentation/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/domain/interfaces/auth.interface.js';
import { UserRole } from '../auth/domain/interfaces/auth.interface.js';
import { ReportsService } from './reports.service.js';
import type { AlarmReportStatus, ReportFile, ReportFormat } from './reports.service.js';
import { resolveTenantScope } from '../auth/presentation/tenant-scope.util.js';

const GLOBAL_ROLES = new Set<UserRole>([UserRole.ADMIN, UserRole.CCO, UserRole.SUPERVISOR]);
const ALARM_STATUSES: AlarmReportStatus[] = ['all', 'active', 'ack', 'closed'];

function parseDate(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function parseFormat(v: string | undefined): ReportFormat {
  return (v ?? '').toUpperCase() === 'CSV' ? 'CSV' : 'PDF';
}

function parseStatus(v: string | undefined): AlarmReportStatus {
  const s = (v ?? 'all') as AlarmReportStatus;
  return ALARM_STATUSES.includes(s) ? s : 'all';
}

function parseIds(v: string | undefined): string[] {
  return (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** Escopo de tenant: globais veem tudo (ou filtram por query); demais, travados no próprio. */
  private scope(user: AuthenticatedUser, queryTenantId?: string): string | undefined {
    return resolveTenantScope(user, queryTenantId);
  }

  private send(res: Response, file: ReportFile): void {
    res.setHeader('Content-Type', file.mime);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.send(file.body);
  }

  /** Catálogo dos tipos de relatório disponíveis. */
  @Get('/')
  listTypes() {
    return this.reports.listTypes();
  }

  @Get('/alarms')
  async alarms(
    @Query('format') format: string | undefined,
    @Query('status') status: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('tenantId') tenantId: string | undefined,
    @Query('siteId') siteId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.reports.generateAlarmsReport({
      tenantId: this.scope(user, tenantId),
      siteId: siteId || undefined,
      from: parseDate(from),
      to: parseDate(to),
      status: parseStatus(status),
      format: parseFormat(format),
    });
    this.send(res, file);
  }

  /**
   * Histórico completo de comandos (aba "Histórico" da página Comandos).
   * Mesma fonte do card do dashboard: trilha de auditoria action='COMMAND'.
   */
  @Get('/command-history')
  async commandHistory(
    @Query('tenantId') tenantId: string | undefined,
    @Query('userId') userId: string | undefined,
    @Query('result') result: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reports.getCommandHistory({
      tenantId: this.scope(user, tenantId || undefined),
      userId: userId || undefined,
      result: result === 'success' || result === 'error' ? result : undefined,
      from: parseDate(from),
      to: parseDate(to),
    });
  }

  @Get('/audit/preview')
  async auditPreview(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('tenantId') tenantId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reports.getAuditPreview({
      tenantId: this.scope(user, tenantId),
      from: parseDate(from),
      to: parseDate(to),
    });
  }

  @Get('/audit')
  async audit(
    @Query('format') format: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('tenantId') tenantId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.reports.generateAuditReport({
      tenantId: this.scope(user, tenantId),
      from: parseDate(from),
      to: parseDate(to),
      format: parseFormat(format),
    });
    this.send(res, file);
  }

  /** Prévia (JSON) da disponibilidade — resumo + linhas por equipamento. */
  @Get('/availability/preview')
  async availabilityPreview(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('tenantId') tenantId: string | undefined,
    @Query('siteId') siteId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.reports.getAvailabilityPreview({
      tenantId: this.scope(user, tenantId),
      siteId: siteId || undefined,
      from: parseDate(from),
      to: parseDate(to),
    });
  }

  @Get('/availability')
  async availability(
    @Query('format') format: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('tenantId') tenantId: string | undefined,
    @Query('siteId') siteId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.reports.generateAvailabilityReport({
      tenantId: this.scope(user, tenantId),
      siteId: siteId || undefined,
      from: parseDate(from),
      to: parseDate(to),
      format: parseFormat(format),
    });
    this.send(res, file);
  }

  @Get('/trends')
  async trends(
    @Query('format') format: string | undefined,
    @Query('ids') ids: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('tenantId') tenantId: string | undefined,
    @Query('siteId') siteId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const file = await this.reports.generateTrendsReport({
      tenantId: this.scope(user, tenantId),
      siteId: siteId || undefined,
      ids: parseIds(ids),
      from: parseDate(from),
      to: parseDate(to),
      format: parseFormat(format),
    });
    this.send(res, file);
  }
}
