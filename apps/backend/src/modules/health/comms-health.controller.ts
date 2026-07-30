import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/presentation/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/presentation/guards/roles.guard.js';
import { Roles } from '../auth/presentation/decorators/roles.decorator.js';
import { UserRole } from '../auth/domain/interfaces/auth.interface.js';
import { MqttService } from '../mqtt/mqtt.service.js';
import type { MqttConnectionStatus } from '../mqtt/mqtt.service.js';
import { IngestionMetricsService } from '../mqtt/ingestion-metrics.service.js';
import type { IngestionMetricsSnapshot } from '../mqtt/ingestion-metrics.service.js';
import { ClusterService } from '../cluster/cluster.service.js';

/** Resposta consolidada de saúde das comunicações do backend. */
interface CommsHealthResponse {
  /** Instante da coleta (ISO). */
  timestamp: string;
  /** Segundos desde o boot do processo. */
  uptimeSeconds: number;
  /** Estado da conexão MQTT do backend com o broker. */
  mqtt: MqttConnectionStatus;
  /** Liderança desta instância no cluster. */
  cluster: { isLeader: boolean; instanceId: string };
  /** Taxa/contadores de ingestão MQTT desta instância. */
  ingestion: IngestionMetricsSnapshot;
}

/**
 * CommsHealthController — expõe a saúde das comunicações do backend
 * (conexão MQTT, reconexões, liderança do cluster e taxa de ingestão) num
 * único endpoint legível por dashboards e load balancers.
 *
 * É read-only, mas restrito a papéis administrativos (achado F8 da auditoria):
 * expõe URL do broker (sanitizada), IDs de instância e taxas de ingestão —
 * informação de operação que um CLIENTE não deve ver. Load balancers usam
 * GET /cluster/status, que segue público.
 */
@Controller('health')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.CCO, UserRole.SUPERVISOR)
export class CommsHealthController {
  constructor(
    private readonly mqtt: MqttService,
    private readonly ingestion: IngestionMetricsService,
    private readonly cluster: ClusterService,
  ) {}

  @Get('comms')
  getComms(): CommsHealthResponse {
    return {
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
      mqtt: this.mqtt.getConnectionStatus(),
      cluster: this.cluster.getStatus(),
      ingestion: this.ingestion.getSnapshot(),
    };
  }
}
