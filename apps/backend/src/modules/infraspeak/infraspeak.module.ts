import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { AiRateLimitGuard } from '../ai/ai-rate-limit.guard.js';
import { InfraspeakController } from './presentation/infraspeak.controller.js';
import { RequestsService } from './application/requests.service.js';
import { TicketIndexService } from './application/ticket-index.service.js';
import { TicketAnalysisService } from './application/ticket-analysis.service.js';
import { InfraspeakClient } from './infrastructure/infraspeak.client.js';

/**
 * Módulo de integração com a API REST da Infraspeak (leitura e criação de
 * chamados/failures).
 * - InfraspeakClient: camada única de integração (auth, headers, paginação,
 *   erros, rate limit, logs, retries; POST sem retry pós-envio).
 * - RequestsService: consumo do recurso de chamados com auto-paginação,
 *   criação de chamado e dados de apoio do formulário.
 * - InfraspeakController: endpoints internos protegidos por JWT.
 *
 * ConfigService é fornecido globalmente pelo ConfigModule.forRoot({ isGlobal: true })
 * em app.module.ts, portanto não é necessário importá-lo aqui.
 */
@Module({
  imports: [KnowledgeModule],
  controllers: [InfraspeakController],
  providers: [
    InfraspeakClient,
    RequestsService,
    TicketIndexService,
    TicketAnalysisService,
    AiRateLimitGuard,
  ],
  exports: [InfraspeakClient, RequestsService],
})
export class InfraspeakModule {}
