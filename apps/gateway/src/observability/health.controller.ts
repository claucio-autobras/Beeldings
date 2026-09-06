import { Controller, Get } from '@nestjs/common';
import { GatewayHealthService } from './gateway-health.service';
import type { GatewayHealthSnapshot } from './gateway-health.service';

/**
 * HealthController — expõe a saúde das comunicações do gateway num único
 * endpoint legível por dashboards e load balancers (conexão MQTT, reconexões,
 * profundidade da fila offline e latência de polling BACnet/Modbus).
 *
 * Read-only e observacional: não altera o comportamento das comunicações. Não
 * revela segredos — a URL do broker é sanitizada e não há credenciais na
 * resposta. O mesmo resumo é publicado periodicamente via MQTT
 * (GatewayHealthPublisherService) para o backend consumir.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly health: GatewayHealthService) {}

  @Get()
  getHealth(): GatewayHealthSnapshot {
    return this.health.buildSnapshot();
  }
}
