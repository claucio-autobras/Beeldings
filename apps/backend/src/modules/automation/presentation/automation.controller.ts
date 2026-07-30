import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/presentation/guards/jwt-auth.guard.js';
import { RolesGuard } from '../../auth/presentation/guards/roles.guard.js';
import { Roles } from '../../auth/presentation/decorators/roles.decorator.js';
import { CurrentUser } from '../../auth/presentation/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/domain/interfaces/auth.interface.js';
import { UserRole } from '../../auth/domain/interfaces/auth.interface.js';
import { AutomationService } from '../application/automation.service.js';
import { resolveTenantScope } from '../../auth/presentation/tenant-scope.util.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type {
  CreateAutomationInput,
  UpdateAutomationInput,
  AutomationCondition,
  AutomationActionInput,
} from '../domain/automation.types.js';

/** Papéis com visão global (todos os tenants). */
const GLOBAL_ROLES = new Set<UserRole>([UserRole.ADMIN, UserRole.CCO, UserRole.SUPERVISOR]);

@Controller('automation')
@UseGuards(JwtAuthGuard)
export class AutomationController {
  constructor(
    private readonly automations: AutomationService,
    private readonly prisma: PrismaService,
  ) {}

  /** Tenant efetivo de leitura: global usa a query (ou todos), demais o próprio. */
  private readScope(user: AuthenticatedUser, queryTenantId?: string): string | undefined {
    return resolveTenantScope(user, queryTenantId);
  }

  /** Tenant efetivo de escrita: global usa a query, demais o próprio (obrigatório). */
  private writeScope(user: AuthenticatedUser, bodyTenantId?: string): string {
    if (GLOBAL_ROLES.has(user.role)) {
      const t = bodyTenantId ?? user.tenantId;
      if (!t) throw new BadRequestException('tenantId é obrigatório');
      return t;
    }
    if (!user.tenantId) throw new ForbiddenException('Usuário sem tenant');
    return user.tenantId;
  }

  // CLIENTE/VISUALIZADOR têm leitura: readScope força o tenant do próprio
  // usuário (ignora a query), então não há vazamento cross-tenant. Escrita
  // continua restrita a ADMIN/CCO.
  @Get('/')
  @UseGuards(RolesGuard)
  @Roles(
    UserRole.ADMIN,
    UserRole.CCO,
    UserRole.SUPERVISOR,
    UserRole.CLIENTE,
    UserRole.VISUALIZADOR,
  )
  list(
    @Query('siteId') siteId: string | undefined,
    @Query('tenantId') tenantId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const scoped = this.readScope(user, tenantId);
    if (scoped === undefined && !GLOBAL_ROLES.has(user.role)) return [];
    // Global sem tenant filtra por site se dado; senão exige tenant explícito.
    if (scoped === undefined) {
      throw new BadRequestException('tenantId é obrigatório para listar automações');
    }
    return this.automations.list(scoped, siteId);
  }

  /**
   * Histórico de execuções, paginado. PRECISA vir antes de `/:id` para não ser
   * capturado pela rota de detalhe.
   */
  @Get('/runs')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CCO, UserRole.SUPERVISOR)
  listRuns(
    @Query('tenantId') tenantId: string | undefined,
    @Query('automationId') automationId: string | undefined,
    @Query('result') result: string | undefined,
    @Query('siteId') siteId: string | undefined,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const scoped = this.readScope(user, tenantId);
    if (scoped === undefined || scoped === '') {
      throw new BadRequestException('tenantId é obrigatório para listar o histórico');
    }
    const validResults = new Set(['SUCCESS', 'PARTIAL', 'FAILURE']);
    if (result && !validResults.has(result)) {
      throw new BadRequestException('result inválido (SUCCESS | PARTIAL | FAILURE)');
    }
    return this.automations.listRuns(scoped, {
      automationId,
      result: result as 'SUCCESS' | 'PARTIAL' | 'FAILURE' | undefined,
      siteId,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
  }

  @Get('/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CCO, UserRole.SUPERVISOR)
  get(@Param('id') id: string, @Query('tenantId') tenantId: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.automations.get(this.writeScope(user, tenantId), id);
  }

  @Post('/')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CCO)
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() body: CreateAutomationInput & { tenantId?: string }, @CurrentUser() user: AuthenticatedUser) {
    const tenantId = this.writeScope(user, body.tenantId);
    await this.assertPointsOwnership(tenantId, body);
    return this.automations.create(tenantId, user.id, body);
  }

  @Put('/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CCO)
  async update(
    @Param('id') id: string,
    @Body() body: UpdateAutomationInput & { tenantId?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const tenantId = this.writeScope(user, body.tenantId);
    await this.assertPointsOwnership(tenantId, body);
    return this.automations.update(tenantId, id, body);
  }

  @Patch('/:id/enabled')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CCO)
  setEnabled(
    @Param('id') id: string,
    @Body() body: { enabled: boolean; tenantId?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.automations.setEnabled(this.writeScope(user, body.tenantId), id, body.enabled);
  }

  @Delete('/:id')
  @UseGuards(RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.CCO)
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string, @Query('tenantId') tenantId: string | undefined, @CurrentUser() user: AuthenticatedUser) {
    return this.automations.remove(this.writeScope(user, tenantId), id);
  }

  /**
   * Garante que TODO ponto referenciado (condição + ações WRITE_POINT) pertence
   * a um dispositivo do tenant. Barra vazamento cross-tenant (400/403).
   */
  private async assertPointsOwnership(
    tenantId: string,
    body: { condition?: AutomationCondition | null; actions?: AutomationActionInput[] },
  ): Promise<void> {
    const ids = new Set<string>();
    if (body.condition?.pointId) ids.add(body.condition.pointId);
    for (const a of body.actions ?? []) {
      if (a.type === 'WRITE_POINT' && a.targetPointId) ids.add(a.targetPointId);
    }
    if (ids.size === 0) return;
    const points = await this.prisma.devicePoint.findMany({
      where: { id: { in: [...ids] } },
      include: { device: { select: { tenantId: true } } },
    });
    if (points.length !== ids.size) {
      throw new BadRequestException('Ponto referenciado inexistente');
    }
    for (const p of points) {
      if (p.device.tenantId !== tenantId) {
        throw new ForbiddenException('Ponto pertence a outro cliente');
      }
    }
  }
}
