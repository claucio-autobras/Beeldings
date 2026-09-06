import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/presentation/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/presentation/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/domain/interfaces/auth.interface.js';
import { UserRole } from '../auth/domain/interfaces/auth.interface.js';
import {
  resolveBodyTenantScope,
  resolveTenantScope,
} from '../auth/presentation/tenant-scope.util.js';
import { InsightsService } from './insights.service.js';
import { buildInsightPdf } from './insight-pdf.helper.js';
import { resolvePresetPeriod, type InsightPeriodPreset } from './insight-period.util.js';

const PRESETS: InsightPeriodPreset[] = ['last_week', 'last_month', 'current_week', 'current_month'];

function parseFrequency(value: unknown): 'WEEKLY' | 'MONTHLY' {
  if (value !== 'WEEKLY' && value !== 'MONTHLY') {
    throw new BadRequestException('frequency deve ser WEEKLY ou MONTHLY');
  }
  return value;
}

@Controller('insights')
@UseGuards(JwtAuthGuard)
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  /** Tenant obrigatório para config: globais informam ?tenantId, cliente usa o próprio. */
  private requireTenant(user: AuthenticatedUser, queryTenantId?: string): string {
    const scope = resolveTenantScope(user, queryTenantId);
    if (!scope) throw new BadRequestException('tenantId é obrigatório');
    return scope;
  }

  // ─── Configuração (seção "Insights de IA" em Ajustes) ───────────────────────

  @Get('config')
  async getConfig(
    @Query('tenantId') tenantId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.insights.getConfig(this.requireTenant(user, tenantId));
  }

  @Put('config')
  async updateConfig(
    @Body() body: { tenantId?: string; enabled?: boolean; frequency?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Apenas administradores podem alterar a configuração de insights');
    }
    const tenantId = resolveBodyTenantScope(user, body.tenantId);
    if (!tenantId) throw new BadRequestException('tenantId é obrigatório');
    const patch: { enabled?: boolean; frequency?: 'WEEKLY' | 'MONTHLY' } = {};
    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'boolean') throw new BadRequestException('enabled deve ser booleano');
      patch.enabled = body.enabled;
    }
    if (body.frequency !== undefined) patch.frequency = parseFrequency(body.frequency);
    return this.insights.updateConfig(tenantId, patch);
  }

  // ─── Geração sob demanda (admin) ────────────────────────────────────────────

  @Post('generate')
  async generate(
    @Body() body: { tenantId?: string; preset?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    if (user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Apenas administradores podem gerar insights sob demanda');
    }
    const tenantId = resolveBodyTenantScope(user, body.tenantId);
    if (!tenantId) throw new BadRequestException('tenantId é obrigatório');
    const preset = body.preset as InsightPeriodPreset;
    if (!PRESETS.includes(preset)) {
      throw new BadRequestException(`preset deve ser um de: ${PRESETS.join(', ')}`);
    }
    const { period, frequency } = resolvePresetPeriod(preset);
    return this.insights.generateForPeriod(tenantId, period, frequency, 'manual');
  }

  // ─── Consulta ───────────────────────────────────────────────────────────────

  @Get()
  async list(
    @Query('tenantId') tenantId: string | undefined,
    @Query('limit') limit: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const scope = resolveTenantScope(user, tenantId);
    const parsedLimit = limit ? Number(limit) : 50;
    return this.insights.list(scope, Number.isFinite(parsedLimit) ? parsedLimit : 50);
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.insights.get(id, resolveTenantScope(user, undefined));
  }

  @Get(':id/pdf')
  async pdf(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const insight = await this.insights.get(id, resolveTenantScope(user, undefined));
    const body = buildInsightPdf({
      tenantName: insight.tenantName,
      periodLabel: insight.periodLabel,
      facts: insight.facts,
      narrative: insight.narrative,
      aiFailed: insight.aiFailed,
      createdAt: new Date(insight.createdAt),
    });
    const datePart = insight.periodStart.slice(0, 10);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="insight-${datePart}.pdf"`);
    res.send(body);
  }
}
