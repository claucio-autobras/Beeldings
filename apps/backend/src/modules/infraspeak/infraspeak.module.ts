import { Module } from '@nestjs/common';
import { InfraspeakController } from './presentation/infraspeak.controller.js';
import { RequestsService } from './application/requests.service.js';
import { InfraspeakClient } from './infrastructure/infraspeak.client.js';

/**
 * Módulo de integração com a API REST da Infraspeak (somente leitura).
 * - InfraspeakClient: camada única de integração (auth, headers, paginação,
 *   erros, rate limit, logs, retries).
 * - RequestsService: consumo do recurso de chamados com auto-paginação.
 * - InfraspeakController: endpoint interno read-only.
 *
 * ConfigService é fornecido globalmente pelo ConfigModule.forRoot({ isGlobal: true })
 * em app.module.ts, portanto não é necessário importá-lo aqui.
 */
@Module({
  controllers: [InfraspeakController],
  providers: [InfraspeakClient, RequestsService],
  exports: [InfraspeakClient, RequestsService],
})
export class InfraspeakModule {}
