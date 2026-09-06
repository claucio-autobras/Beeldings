import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AiModule } from '../ai/ai.module.js';
import { AvailabilityService } from '../reports/availability.service.js';
import { NotificationRecipientsService } from '../notification-recipients/notification-recipients.service.js';
import { InsightsController } from './insights.controller.js';
import { InsightsService } from './insights.service.js';
import { InsightFactsService } from './insight-facts.service.js';
import { InsightSchedulerService } from './insight-scheduler.service.js';

/**
 * Insights de IA para clientes: resumo executivo periódico por tenant
 * (semanal/mensal em America/Sao_Paulo) — bloco factual determinístico +
 * texto redacional da IA, persistidos e listáveis. O envio por e-mail/WhatsApp
 * é futuro e consumirá o evento `insight_generated`.
 *
 * AvailabilityService e NotificationRecipientsService são stateless e dependem
 * só do Prisma — providos localmente para não mexer nos exports dos módulos.
 * ClusterService vem do ClusterModule (@Global).
 */
@Module({
  imports: [PrismaModule, AiModule],
  controllers: [InsightsController],
  providers: [
    InsightsService,
    InsightFactsService,
    InsightSchedulerService,
    AvailabilityService,
    NotificationRecipientsService,
  ],
})
export class InsightsModule {}
