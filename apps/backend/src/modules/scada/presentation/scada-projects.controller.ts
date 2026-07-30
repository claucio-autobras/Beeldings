import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ScadaService } from '../application/scada.service.js';
import type { ScadaProject } from '../application/scada.service.js';
import { JwtAuthGuard } from '../../auth/presentation/guards/jwt-auth.guard.js';
import { SensitiveActionGuard } from '../../auth/presentation/guards/sensitive-action.guard.js';
import { CurrentUser } from '../../auth/presentation/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/domain/interfaces/auth.interface.js';
import { UserRole } from '../../auth/domain/interfaces/auth.interface.js';
import { resolveTenantScope } from '../../auth/presentation/tenant-scope.util.js';

/** Perfis globais (Autobras): enxergam todos os tenants e podem gerir o SCADA. */
const GLOBAL_ROLES = new Set<UserRole>([UserRole.ADMIN, UserRole.CCO, UserRole.SUPERVISOR]);

interface AddScadaProjectDto {
  projectId: string;
}

/** Projetos que aparecem como cards na landing do SCADA. */
@Controller('scada/projects')
@UseGuards(JwtAuthGuard)
export class ScadaProjectsController {
  constructor(private readonly scadaService: ScadaService) {}

  @Get('/')
  async findAll(
    @Query('tenantId') queryTenantId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ScadaProject[]> {
    const tenantId = resolveTenantScope(user, queryTenantId);
    return this.scadaService.findEnabledProjects(tenantId);
  }

  @Post('/')
  @HttpCode(HttpStatus.CREATED)
  async add(
    @Body() body: AddScadaProjectDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ScadaProject> {
    if (!GLOBAL_ROLES.has(user.role)) {
      throw new ForbiddenException('Sem permissão para gerir projetos SCADA');
    }
    const tenantId = resolveTenantScope(user);
    return this.scadaService.enableProject(body.projectId, tenantId);
  }

  @Delete('/:projectId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SensitiveActionGuard)
  async remove(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    if (!GLOBAL_ROLES.has(user.role)) {
      throw new ForbiddenException('Sem permissão para gerir projetos SCADA');
    }
    const tenantId = resolveTenantScope(user);
    return this.scadaService.removeProjectFromScada(projectId, tenantId);
  }
}
