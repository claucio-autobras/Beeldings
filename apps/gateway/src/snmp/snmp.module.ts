import { Module } from '@nestjs/common';
import { MqttModule } from '../mqtt/mqtt.module';
import { ObservabilityModule } from '../observability/observability.module';
import { SnmpDiagnoseService } from './snmp-diagnose.service';
import { SnmpPollingService } from './snmp-polling.service';
import { SnmpScanService } from './snmp-scan.service';
import { SnmpTestService } from './snmp-test.service';

/**
 * SnmpModule — monitoramento de câmeras CFTV via SNMP.
 *
 *   - SnmpPollingService: polling config-driven dos OIDs das câmeras,
 *     telemetria no tópico canônico (sem resposta = STATUS 0/offline).
 *   - SnmpScanService: varredura de range de IP para descobrir câmeras
 *     (comando 'command.snmp.scan' roteado pelo CommandDispatcher).
 */
@Module({
  imports: [MqttModule, ObservabilityModule],
  providers: [SnmpPollingService, SnmpScanService, SnmpTestService, SnmpDiagnoseService],
})
export class SnmpModule {}
