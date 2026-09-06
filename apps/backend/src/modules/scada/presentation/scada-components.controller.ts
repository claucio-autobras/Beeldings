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
import type { ScadaComponent } from '@prisma/client';
import { ScadaService } from '../application/scada.service.js';
import { JwtAuthGuard } from '../../auth/presentation/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../auth/presentation/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/domain/interfaces/auth.interface.js';
import { UserRole } from '../../auth/domain/interfaces/auth.interface.js';
import { resolveTenantScope } from '../../auth/presentation/tenant-scope.util.js';

/** Perfis globais (Autobras): enxergam todos os tenants e podem editar telas. */
const GLOBAL_ROLES = new Set<UserRole>([UserRole.ADMIN, UserRole.CCO, UserRole.SUPERVISOR]);

/** Payload de criação de um componente reutilizável da biblioteca do tenant. */
interface CreateScadaComponentDto {
  id?: string;
  name: string;
  tenantId?: string;
  width: number;
  height: number;
  widgets: unknown[];
}

/**
 * Biblioteca global de componentes do editor SCADA ("Meus Componentes").
 * Escopo de tenant idêntico ao das telas: globais podem operar em qualquer
 * tenant (informando `tenantId`); clientes ficam travados no próprio.
 */
@Controller('scada/components')
@UseGuards(JwtAuthGuard)
export class ScadaComponentsController {
  constructor(private readonly scadaService: ScadaService) {}

  @Get('/')
  async findAll(
    @Query('tenantId') queryTenantId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ScadaComponent[]> {
    const tenantId = resolveTenantScope(user, queryTenantId);
    return this.scadaService.findComponents(tenantId);
  }

  @Post('/')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: CreateScadaComponentDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ScadaComponent> {
    if (!GLOBAL_ROLES.has(user.role)) {
      throw new ForbiddenException('Sem permissão para salvar componentes SCADA');
    }
    // Globais salvam no tenant da tela (payload); sem isso caem no próprio.
    const tenantId = body.tenantId ?? user.tenantId ?? '';
    return this.scadaService.createComponent({ ...body, tenantId });
  }

  @Delete('/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    if (!GLOBAL_ROLES.has(user.role)) {
      throw new ForbiddenException('Sem permissão para excluir componentes SCADA');
    }
    const tenantId = resolveTenantScope(user);
    return this.scadaService.deleteComponent(id, tenantId);
  }
}
