import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SitesService } from '../application/sites.service.js';
import type { CreateSiteDto } from '../application/dtos/create-site.dto.js';
import type { UpdateSiteDto } from '../application/dtos/update-site.dto.js';
import { JwtAuthGuard } from '../../auth/presentation/guards/jwt-auth.guard.js';
import { SensitiveActionGuard } from '../../auth/presentation/guards/sensitive-action.guard.js';
import { CurrentUser } from '../../auth/presentation/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/domain/interfaces/auth.interface.js';
import type { Site } from '@prisma/client';
import { isGlobalRole, resolveTenantScope } from '../../auth/presentation/tenant-scope.util.js';

@Controller('sites')
@UseGuards(JwtAuthGuard)
export class SitesController {
  constructor(private readonly sitesService: SitesService) {}

  @Post('/')
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() body: CreateSiteDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Site> {
    const effectiveTenantId = isGlobalRole(user)
      ? (body.tenantId ?? user.tenantId ?? '')
      : resolveTenantScope(user)!;

    return this.sitesService.create({
      ...body,
      tenantId: effectiveTenantId,
    });
  }

  @Get('/')
  async findAll(
    @Query('tenantId') queryTenantId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Site[]> {
    const tenantId = resolveTenantScope(user, queryTenantId);
    return this.sitesService.findAll(tenantId);
  }

  @Get('/:id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Site> {
    const tenantId = resolveTenantScope(user);
    return this.sitesService.findOne(id, tenantId);
  }

  @Patch('/:id')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateSiteDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<Site> {
    if (user.role === 'VISUALIZADOR') {
      throw new BadRequestException('Sem permissão para editar sites');
    }
    const tenantId = resolveTenantScope(user);
    const actor = { id: user.id, name: user.name ?? null, email: user.email, role: user.role };
    return this.sitesService.update(id, tenantId, body, actor);
  }

  @Delete('/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SensitiveActionGuard)
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    if (user.role !== 'ADMIN' && user.role !== 'CCO') {
      throw new BadRequestException('Sem permissão para excluir sites');
    }
    const tenantId = resolveTenantScope(user);
    return this.sitesService.delete(id, tenantId);
  }
}
