import {
  Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Param, Patch, Post, Query, Res, UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { JwtAuthGuard } from '../auth/presentation/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/presentation/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/domain/interfaces/auth.interface.js';
import { UserRole } from '../auth/domain/interfaces/auth.interface.js';
import { TrendsService } from './trends.service.js';
import type { CreateTrendInput, UpdateTrendInput } from './trends.service.js';
import { resolveTenantScope } from '../auth/presentation/tenant-scope.util.js';

const GLOBAL_ROLES = new Set<UserRole>([UserRole.ADMIN, UserRole.CCO, UserRole.SUPERVISOR]);

function parseDate(v: string | undefined): Date | undefined {
  if (!v) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** Lê ids de uma query string CSV (?ids=a,b,c) descartando vazios. */
function parseIds(v: string | undefined): string[] {
  return (v ?? '').split(',').map((s) => s.trim()).filter(Boolean);
}

interface BatchDataBody {
  ids?: string[];
  from?: string;
  to?: string;
  bucket?: string;
}

@Controller('trends')
@UseGuards(JwtAuthGuard)
export class TrendsController {
  constructor(private readonly trends: TrendsService) {}

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
    return this.trends.findAll({ tenantId: this.scope(user, tenantId), deviceId, pointId });
  }

  @Post('/')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() body: CreateTrendInput, @CurrentUser() user: AuthenticatedUser) {
    void user; // tenantId é derivado do dispositivo do ponto
    return this.trends.create(body);
  }

  @Post('/data/batch')
  @HttpCode(HttpStatus.OK)
  getDataBatch(@Body() body: BatchDataBody, @CurrentUser() user: AuthenticatedUser) {
    return this.trends.getDataBatch(body.ids ?? [], this.scope(user), {
      from: parseDate(body.from),
      to: parseDate(body.to),
      bucket: body.bucket,
    });
  }

  @Get('/history')
  getHistory(
    @Query('ids') ids: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.trends.getHistory(parseIds(ids), this.scope(user), {
      from: parseDate(from),
      to: parseDate(to),
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 50,
    });
  }

  /**
   * GET /trends/export/bulk — exportação em massa de histórico (bruto ou
   * agregado) por equipamento/trends/período, com STREAMING (chunked) para não
   * estourar memória em anos de dados. Uso: treino de modelos externos.
   */
  @Get('/export/bulk')
  async exportBulk(
    @Query('deviceId') deviceId: string | undefined,
    @Query('ids') ids: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('granularity') granularity: string | undefined,
    @Query('tenantId') tenantId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const gran = granularity === 'hourly' || granularity === 'daily' ? granularity : 'raw';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="bluebee-history-${gran}.csv"`);
    try {
      await this.trends.exportBulk(
        {
          tenantId: this.scope(user, tenantId),
          deviceId: deviceId || undefined,
          trendIds: parseIds(ids),
          from: parseDate(from),
          to: parseDate(to),
          granularity: gran,
        },
        (chunk) =>
          new Promise<void>((resolve, reject) => {
            // Respeita backpressure: espera o 'drain' quando o buffer enche.
            const ok = res.write(chunk);
            if (ok) resolve();
            else {
              res.once('drain', resolve);
              res.once('error', reject);
            }
          }),
      );
      res.end();
    } catch (err) {
      // Se nada foi enviado ainda, devolve o erro; senão, encerra o stream.
      if (!res.headersSent) throw err;
      res.end();
    }
  }

  @Get('/export.csv')
  @Header('Content-Type', 'text/csv')
  async exportCsvBatch(
    @Query('ids') ids: string | undefined,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const csv = await this.trends.exportCsvBatch(parseIds(ids), this.scope(user), parseDate(from), parseDate(to));
    res.setHeader('Content-Disposition', 'attachment; filename="trends.csv"');
    res.send(csv);
  }

  @Get('/:id/data')
  getData(
    @Param('id') id: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('bucket') bucket: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.trends.getData(id, this.scope(user), {
      from: parseDate(from),
      to: parseDate(to),
      bucket,
      page: Number(page) || 1,
      pageSize: Number(pageSize) || 50,
    });
  }

  @Get('/:id/export.csv')
  @Header('Content-Type', 'text/csv')
  async exportCsv(
    @Param('id') id: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ): Promise<void> {
    const csv = await this.trends.exportCsv(id, this.scope(user), parseDate(from), parseDate(to));
    res.setHeader('Content-Disposition', `attachment; filename="trend-${id}.csv"`);
    res.send(csv);
  }

  @Patch('/:id')
  update(@Param('id') id: string, @Body() body: UpdateTrendInput, @CurrentUser() user: AuthenticatedUser) {
    return this.trends.update(id, this.scope(user), body);
  }

  @Delete('/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.trends.delete(id, this.scope(user));
  }
}

// ─── Stubs mantidos (Fase 2) ────────────────────────────────────────────────────

@Controller('telemetry')
export class TelemetryStubController {
  @Get('/')
  getTelemetry() {
    return [];
  }
}

/**
 * Comandos recentes para o card "Automações & Comandos" do dashboard.
 * Fonte: trilha de auditoria (action='COMMAND') — todo comando de escrita
 * (manual via POST /devices/bacnet/write ou disparado por automação) já é
 * registrado lá com resultado SUCCESS/FAILURE, então a taxa de sucesso é real.
 */
@Controller('commands')
@UseGuards(JwtAuthGuard)
export class CommandsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('/')
  async getRecentCommands(
    @CurrentUser() user: AuthenticatedUser,
    @Query('tenantId') tenantId?: string,
    @Query('siteId') siteId?: string,
    @Query('limit') limit?: string,
  ) {
    const isGlobal = GLOBAL_ROLES.has(user.role);
    // Usuário de tenant fica travado no próprio; global pode filtrar por query.
    const effectiveTenantId = resolveTenantScope(user, tenantId);

    const where: Prisma.AuditLogWhereInput = { action: 'COMMAND' };
    if (effectiveTenantId) {
      where.tenantId = effectiveTenantId;
    } else {
      // Visão global SEM filtro explícito: exclui clientes desativados (mesma
      // semântica dos feeds globais de alarme). Logs sem tenant (globais) ficam.
      const inactive = await this.prisma.tenant.findMany({
        where: { active: false },
        select: { id: true },
      });
      if (inactive.length > 0) {
        where.OR = [
          { tenantId: null },
          { tenantId: { notIn: inactive.map((t) => t.id) } },
        ];
      }
    }

    const take = Math.min(Math.max(Number(limit) || 20, 1), 100);
    // Filtro por site é resolvido APÓS a query (o site vem do device/ponto
    // referenciado pelo log, não é coluna do audit_log) — então buscamos uma
    // janela maior quando há filtro para não devolver menos itens que `take`.
    const fetchCount = siteId ? 100 : take;
    const logs = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: fetchCount,
      select: {
        id: true,
        tenantName: true,
        entityName: true,
        entityId: true,
        change: true,
        actorName: true,
        actorEmail: true,
        result: true,
        createdAt: true,
      },
    });

    // Resolve o site de cada comando a partir do entityId do log, que pode ser
    // um Device (comando manual envia deviceId) ou um DevicePoint (automação).
    // Logs antigos sem entityId ficam sem site — a UI omite com elegância.
    const entityIds = [...new Set(logs.map((l) => l.entityId).filter((v): v is string => !!v))];
    const siteByEntity = new Map<string, { siteId: string; siteName: string }>();
    if (entityIds.length > 0) {
      const [devices, points] = await Promise.all([
        this.prisma.device.findMany({
          where: { id: { in: entityIds } },
          select: { id: true, siteId: true, site: { select: { name: true } } },
        }),
        this.prisma.devicePoint.findMany({
          where: { id: { in: entityIds } },
          select: {
            id: true,
            device: { select: { siteId: true, site: { select: { name: true } } } },
          },
        }),
      ]);
      for (const d of devices) {
        if (d.siteId && d.site) siteByEntity.set(d.id, { siteId: d.siteId, siteName: d.site.name });
      }
      for (const p of points) {
        if (p.device.siteId && p.device.site) {
          siteByEntity.set(p.id, { siteId: p.device.siteId, siteName: p.device.site.name });
        }
      }
    }

    // Formato PendingCommand consumido pelo dashboard (AutomationsCard).
    const rows = logs.map((log) => {
      const site = log.entityId ? siteByEntity.get(log.entityId) : undefined;
      return {
        id: log.id,
        tenantName: log.tenantName ?? '',
        siteId: site?.siteId ?? null,
        siteName: site?.siteName ?? null,
        deviceName: log.entityName ?? 'Equipamento',
        command: log.change ?? 'Comando de escrita',
        requestedAt: log.createdAt.toISOString(),
        requestedBy: log.actorName ?? log.actorEmail,
        status: log.result === 'SUCCESS' ? 'done' : 'failed',
      };
    });

    return siteId ? rows.filter((r) => r.siteId === siteId).slice(0, take) : rows;
  }
}

@Controller('systems')
export class SystemsStubController {
  @Get('/status')
  getStatus() {
    return [];
  }
}
