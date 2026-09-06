import { Global, Module } from '@nestjs/common';
import { ResendAdapter } from './resend.adapter.js';
import { ZapiAdapter } from './zapi.adapter.js';
import { ExternalNotificationsService } from './external-notifications.service.js';
import { AlarmNotifierService } from './alarm-notifier.service.js';
import { InsightNotifierService } from './insight-notifier.service.js';
import { ExternalNotificationsTestController } from './external-notifications-test.controller.js';
import { ZapiWebhookController } from './zapi-webhook.controller.js';
import { AlarmsModule } from '../alarms/alarms.module.js';
import { NotificationRecipientsModule } from '../notification-recipients/notification-recipients.module.js';

/**
 * Módulo de entrega de notificações externas (e-mail via Resend, WhatsApp via Z-API).
 *
 * @Global — ExternalNotificationsService é injetável em qualquer módulo sem importação
 * explícita. Isso permite que NotificationRecipientsController injete o serviço para
 * expor GET /notification-recipients/providers-status sem criar dependência circular.
 *
 * Depende de:
 *   - PrismaModule (global)     — para carregar device/point/tenant
 *   - ClusterModule (global)    — para leader-only e cluster bus
 *   - AlarmsModule              — para registrar o notificador no motor
 *   - NotificationRecipientsModule — para resolveRecipients
 */
@Global()
@Module({
  imports: [AlarmsModule, NotificationRecipientsModule],
  controllers: [ExternalNotificationsTestController, ZapiWebhookController],
  providers: [
    ResendAdapter,
    ZapiAdapter,
    ExternalNotificationsService,
    AlarmNotifierService,
    InsightNotifierService,
  ],
  exports: [ExternalNotificationsService, ResendAdapter],
})
export class ExternalNotificationsModule {}
