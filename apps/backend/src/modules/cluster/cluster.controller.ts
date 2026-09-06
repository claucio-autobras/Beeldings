import { Controller, Get } from '@nestjs/common';
import { ClusterService } from './cluster.service.js';

/**
 * ClusterController — expõe o estado de liderança desta instância por HTTP.
 *
 * É read-only e propositalmente PÚBLICO (sem JwtAuthGuard): serve para health
 * checks de load balancers e dashboards de observabilidade, que precisam saber
 * qual instância é a líder sem inspecionar `pg_locks` nem raspar o stdout. Não
 * revela nada sensível — apenas se esta instância é a ingestora stateful e seu
 * identificador estável.
 */
@Controller('cluster')
export class ClusterController {
  constructor(private readonly cluster: ClusterService) {}

  /** Estado atual de liderança desta instância. */
  @Get('status')
  getStatus(): { isLeader: boolean; instanceId: string } {
    return this.cluster.getStatus();
  }
}
