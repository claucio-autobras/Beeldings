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
import { JwtAuthGuard } from '../auth/presentation/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/presentation/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/domain/interfaces/auth.interface.js';
import {
  resolveTenantScope,
  resolveBodyTenantScope,
  isGlobalRole,
} from '../auth/presentation/tenant-scope.util.js';
import { NotificationRecipientsService } from './notification-recipients.service.js';
import type {
  CreateRecipientInput,
  UpdateRecipientInput,
} from './notification-recipients.service.js';

@Controller('notification-recipients')
@UseGuards(JwtAuthGuard)
export class NotificationRecipientsController {
  constructor(private readonly service: NotificationRecipientsService) {}

  /** Escopo de tenant via query string (GET list). */
  private scope(user: AuthenticatedUser, queryTenantId?: string): string | undefined {
    return resolveTenantScope(user, queryTenantId);
  }

  /**
   * GET /notification-recipients?tenantId=
   * Globais filtram por tenantId (ou veem todos se omitido).
   * Clientes veem somente o próprio tenant.
   */
  @Get('/')
  findAll(
    @Query('tenantId') tenantId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.findAll(this.scope(user, tenantId));
  }

  /**
   * GET /notification-recipients/resolve
   * Retorna destinatários ativos que atendem ao contexto de envio.
   * Papéis globais podem resolver para qualquer tenant; clientes, apenas o próprio.
   */
  @Get('/resolve')
  resolveRecipients(
    @Query('tenantId') tenantId: string | undefined,
    @Query('category') category: string | undefined,
    @Query('channel') channel: string | undefined,
    @Query('siteId') siteId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const resolvedTenantId = this.scope(user, tenantId);
    if (!resolvedTenantId) {
      throw new BadRequestException('tenantId é obrigatório');
    }
    if (category !== 'alarms' && category !== 'insights') {
      throw new BadRequestException('category deve ser "alarms" ou "insights"');
    }
    return this.service.resolveRecipients({
      tenantId: resolvedTenantId,
      category,
      channel: channel as 'email' | 'whatsapp' | undefined,
      siteId,
    });
  }

  /**
   * GET /notification-recipients/:id
   */
  @Get('/:id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.findOne(id, this.scope(user));
  }

  /**
   * POST /notification-recipients
   * Papéis globais usam body.tenantId; clientes derivam do próprio tenant.
   */
  @Post('/')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() body: CreateRecipientInput, @CurrentUser() user: AuthenticatedUser) {
    const tenantId = resolveBodyTenantScope(user, body.tenantId);
    if (!tenantId) {
      throw new BadRequestException('tenantId é obrigatório');
    }
    return this.service.create(body, tenantId);
  }

  /**
   * PATCH /notification-recipients/:id
   */
  @Patch('/:id')
  update(
    @Param('id') id: string,
    @Body() body: UpdateRecipientInput,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.update(id, this.scope(user), body);
  }

  /**
   * DELETE /notification-recipients/:id
   */
  @Delete('/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.delete(id, this.scope(user));
  }
}
