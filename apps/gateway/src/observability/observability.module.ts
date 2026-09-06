import { Global, Module } from '@nestjs/common';
import { PollingMetricsService } from './polling-metrics.service';
import { GatewayHealthService } from './gateway-health.service';
import { GatewayHealthPublisherService } from './gateway-health-publisher.service';
import { HealthController } from './health.controller';
import { MqttModule } from '../mqtt/mqtt.module';

/**
 * ObservabilityModule — expõe a saúde das comunicações do gateway.
 *
 * Global para que os serviços de polling (BACnet/Modbus) injetem o
 * PollingMetricsService sem acoplamento entre módulos. O GatewayHealthService
 * monta o resumo (conexão MQTT, fila offline e latências de polling); o
 * HealthController o expõe via HTTP e o GatewayHealthPublisherService o publica
 * periodicamente via MQTT para o backend.
 */
@Global()
@Module({
  imports: [MqttModule],
  controllers: [HealthController],
  providers: [
    PollingMetricsService,
    GatewayHealthService,
    GatewayHealthPublisherService,
  ],
  exports: [PollingMetricsService, GatewayHealthService],
})
export class ObservabilityModule {}
