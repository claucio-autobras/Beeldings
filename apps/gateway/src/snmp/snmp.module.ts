import { Module } from '@nestjs/common';
import { MqttModule } from '../mqtt/mqtt.module';
import { ObservabilityModule } from '../observability/observability.module';
import { DriversModule } from '../drivers/drivers.module';
import { SnmpDiagnoseService } from './snmp-diagnose.service';
import { SnmpPollingService } from './snmp-polling.service';
import { SnmpScanService } from './snmp-scan.service';
import { SnmpTestService } from './snmp-test.service';
import { SnmpSwitchPortsService } from './snmp-switch-ports.service';
import { SnmpNvrTablesService } from './snmp-nvr-tables.service';

/**
 * SnmpModule — monitoramento de dispositivos via SNMP (câmeras, switches, NVRs).
 *
 *   - SnmpPollingService: polling config-driven via SnmpDriver (motor de
 *     perfis declarativos de 3 camadas), telemetria no tópico canônico.
 *   - SnmpScanService: varredura de range de IP para descobrir dispositivos
 *     (comando 'command.snmp.scan' roteado pelo CommandDispatcher).
 *   - SnmpSwitchPortsService: descoberta de portas via IF-MIB (switches).
 *   - SnmpNvrTablesService: descoberta de tabelas de disco e canal (NVRs/DVRs).
 */
@Module({
  imports: [MqttModule, ObservabilityModule, DriversModule],
  providers: [SnmpPollingService, SnmpScanService, SnmpTestService, SnmpDiagnoseService, SnmpSwitchPortsService, SnmpNvrTablesService],
})
export class SnmpModule {}
