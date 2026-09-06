/**
 * Controller para teste de canais de notificação na UI de Configurações.
 * POST /notification-recipients/:id/test { channel: 'email' | 'whatsapp' }
 *
 * Papéis globais podem testar qualquer destinatário; clientes, apenas do próprio tenant.
 *
 * Nota: GET /notification-recipients/providers-status está no
 * NotificationRecipientsController (mesmo @Controller prefix, antes de /:id)
 * para garantir que a rota estática vença o parâmetro /:id sem depender da
 * ordem de registro entre controllers diferentes.
 */

import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/presentation/guards/jwt-auth.guard.js';
import { CurrentUser } from '../auth/presentation/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/domain/interfaces/auth.interface.js';
import { resolveTenantScope } from '../auth/presentation/tenant-scope.util.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ExternalNotificationsService } from './external-notifications.service.js';

interface TestBody {
  channel?: string;
}

@Controller('notification-recipients')
@UseGuards(JwtAuthGuard)
export class ExternalNotificationsTestController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: ExternalNotificationsService,
  ) {}

  /**
   * POST /notification-recipients/:id/test
   * Body: { "channel": "email" | "whatsapp" }
   */
  @Post('/:id/test')
  @HttpCode(HttpStatus.OK)
  async testChannel(
    @Param('id') id: string,
    @Body() body: TestBody,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{
    ok: boolean;
    error?: string;
    providersStatus: { email: boolean; whatsapp: boolean };
  }> {
    const channel = body.channel;
    if (channel !== 'email' && channel !== 'whatsapp') {
      throw new BadRequestException('channel deve ser "email" ou "whatsapp"');
    }

    const tenantScope = resolveTenantScope(user, undefined);

    const recipient = await this.prisma.notificationRecipient.findFirst({
      where: tenantScope ? { id, tenantId: tenantScope } : { id },
      select: { id: true, name: true, email: true, phone: true, emailEnabled: true, whatsappEnabled: true },
    });

    if (!recipient) {
      throw new BadRequestException('Destinatário não encontrado');
    }

    if (channel === 'email' && !recipient.emailEnabled) {
      return {
        ok: false,
        error: 'Canal e-mail não está habilitado para este destinatário',
        providersStatus: this.notifier.providersStatus(),
      };
    }
    if (channel === 'whatsapp' && !recipient.whatsappEnabled) {
      return {
        ok: false,
        error: 'Canal WhatsApp não está habilitado para este destinatário',
        providersStatus: this.notifier.providersStatus(),
      };
    }

    const result = await this.notifier.sendTest(
      {
        id: recipient.id,
        name: recipient.name,
        email: recipient.email ?? undefined,
        phone: recipient.phone ?? undefined,
      },
      channel,
    );

    return { ...result, providersStatus: this.notifier.providersStatus() };
  }
}
