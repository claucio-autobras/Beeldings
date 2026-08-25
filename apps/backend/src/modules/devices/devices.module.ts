import { Module } from '@nestjs/common';
import { BacnetDiscoveryService } from './application/bacnet-discovery.service.js';
import { BacnetNetworkDiscoveryService } from './application/bacnet-network-discovery.service.js';
import { BacnetWriteService } from './application/bacnet-write.service.js';
import { MqttWriteService } from './application/mqtt-write.service.js';
import { ModbusWriteService } from './application/modbus-write.service.js';
import { DeviceConfigPublisherService } from './application/device-config-publisher.service.js';
import { ModbusConnectionService } from './application/modbus-connection.service.js';
import { MqttSampleService } from './application/mqtt-sample.service.js';
import { SnmpNetworkScanService } from './application/snmp-network-scan.service.js';
import { OnvifProbeService } from './application/onvif-probe.service.js';
import { OnvifPendingValidationService } from './application/onvif-pending-validation.service.js';
import { OnvifNetworkScanService } from './application/onvif-network-scan.service.js';
import { SnmpHealthTestService } from './application/snmp-health-test.service.js';
import { SnmpDiagnoseService } from './application/snmp-diagnose.service.js';
import { SnmpMibService } from './application/snmp-mib.service.js';
import { SnmpMibSeedService } from './application/snmp-mib-seed.service.js';
import { SnmpMetricService } from './application/snmp-metric.service.js';
import { SnmpDiscoveryPersistenceService } from './application/snmp-discovery-persistence.service.js';
import { SwitchPortSyncService } from './application/switch-port-sync.service.js';
import { NvrTableSyncService } from './application/nvr-table-sync.service.js';
import { CameraHealthBackfillService } from './application/camera-health-backfill.service.js';
import { ControlIdOidMigrationService } from './application/control-id-oid-migration.service.js';
import { OfficialMibOidMigrationService } from './application/official-mib-oid-migration.service.js';
import { CameraLiveViewService } from './application/camera-live-view.service.js';
import { CapabilityProbeService } from './application/capability-probe.service.js';
import { EmqxProvisioningService } from '../sites/application/emqx-provisioning.service.js';
import { DevicesController } from './presentation/devices.controller.js';
import { CftvController } from './presentation/cftv.controller.js';
import { ScaController } from './presentation/sca.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { TrendsModule } from '../trends/trends.module.js';

@Module({
  imports: [PrismaModule, TrendsModule],
  controllers: [DevicesController, CftvController, ScaController],
  providers: [
    BacnetDiscoveryService,
    BacnetNetworkDiscoveryService,
    BacnetWriteService,
    MqttWriteService,
    ModbusWriteService,
    DeviceConfigPublisherService,
    ModbusConnectionService,
    MqttSampleService,
    SnmpNetworkScanService,
    OnvifProbeService,
    OnvifPendingValidationService,
    OnvifNetworkScanService,
    SnmpHealthTestService,
    SnmpDiagnoseService,
    SnmpMibService,
    SnmpMibSeedService,
    SnmpMetricService,
    SnmpDiscoveryPersistenceService,
    SwitchPortSyncService,
    NvrTableSyncService,
    CameraHealthBackfillService,
    ControlIdOidMigrationService,
    OfficialMibOidMigrationService,
    CameraLiveViewService,
    CapabilityProbeService,
    EmqxProvisioningService,
  ],
  exports: [BacnetWriteService, ModbusWriteService, MqttWriteService],
})
export class DevicesModule {}
