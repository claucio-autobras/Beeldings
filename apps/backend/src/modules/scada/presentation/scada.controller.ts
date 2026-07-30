import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { ScadaScreen } from '@prisma/client';
import { ScadaService } from '../application/scada.service.js';
import type { CreateScadaScreenDto } from '../application/dtos/create-scada-screen.dto.js';
import type { UpdateScadaScreenDto } from '../application/dtos/update-scada-screen.dto.js';
import { JwtAuthGuard } from '../../auth/presentation/guards/jwt-auth.guard.js';
import { SensitiveActionGuard } from '../../auth/presentation/guards/sensitive-action.guard.js';
import { CurrentUser } from '../../auth/presentation/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/domain/interfaces/auth.interface.js';
import { UserRole } from '../../auth/domain/interfaces/auth.interface.js';
import { resolveTenantScope } from '../../auth/presentation/tenant-scope.util.js';

/** Perfis globais (Autobras): enxergam todos os tenants e podem editar telas. */
const GLOBAL_ROLES = new Set<UserRole>([UserRole.ADMIN, UserRole.CCO, UserRole.SUPERVISOR]);

@Controller('scada/screens')
@UseGuards(JwtAuthGuard)
export class ScadaController {
  constructor(private readonly scadaService: ScadaService) {}

  @Get('/')
  async findAll(
    @Query('tenantId') queryTenantId: string | undefined,
    @Query('siteId') siteId: string | undefined,
    @Query('projectId') projectId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ScadaScreen[]> {
    // Globais: podem filtrar por tenant (ou ver todos). Demais: travados no próprio tenant.
    const tenantId = resolveTenantScope(user, queryTenantId);
    return this.scadaService.findAll({ tenantId, siteId, projectId });
  }

  @Get('/:id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ScadaScreen> {
    const tenantId = resolveTenantScope(user);
    return this.scadaService.findOne(id, tenantId);
  }

  @Post('/')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: CreateScadaScreenDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ScadaScreen> {
    if (!GLOBAL_ROLES.has(user.role)) {
      throw new ForbiddenException('Sem permissão para criar telas SCADA');
    }
    // Globais escolhem o tenant no payload; sem isso caem no próprio (quando houver).
    const tenantId = body.tenantId ?? user.tenantId ?? '';
    return this.scadaService.create({ ...body, tenantId });
  }

  @Patch('/:id')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateScadaScreenDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ScadaScreen> {
    if (!GLOBAL_ROLES.has(user.role)) {
      throw new ForbiddenException('Sem permissão para editar telas SCADA');
    }
    const tenantId = resolveTenantScope(user);
    return this.scadaService.update(id, tenantId, body);
  }

  @Patch('/:id/home')
  async setHome(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ScadaScreen> {
    if (!GLOBAL_ROLES.has(user.role)) {
      throw new ForbiddenException('Sem permissão para definir a tela inicial');
    }
    const tenantId = resolveTenantScope(user);
    return this.scadaService.setHome(id, tenantId);
  }

  @Delete('/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SensitiveActionGuard)
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    if (!GLOBAL_ROLES.has(user.role)) {
      throw new ForbiddenException('Sem permissão para excluir telas SCADA');
    }
    return this.scadaService.delete(id, undefined);
  }
}
