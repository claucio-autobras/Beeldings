import { Module } from '@nestjs/common';
import { NotificationRecipientsController } from './notification-recipients.controller.js';
import { NotificationRecipientsService } from './notification-recipients.service.js';

@Module({
  controllers: [NotificationRecipientsController],
  providers: [NotificationRecipientsService],
  exports: [NotificationRecipientsService],
})
export class NotificationRecipientsModule {}
