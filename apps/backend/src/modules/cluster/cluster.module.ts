import { Global, Module } from '@nestjs/common';
import { ClusterController } from './cluster.controller.js';
import { ClusterService } from './cluster.service.js';

/**
 * ClusterModule — coordenação multi-instância via Postgres (advisory lock para
 * eleição de líder + LISTEN/NOTIFY como barramento de eventos). Global para que
 * qualquer módulo (MQTT, alarmes, trends, devices) injete o ClusterService.
 * Expõe também GET /cluster/status (read-only) para tornar a liderança
 * observável por HTTP.
 */
@Global()
@Module({
  controllers: [ClusterController],
  providers: [ClusterService],
  exports: [ClusterService],
})
export class ClusterModule {}
