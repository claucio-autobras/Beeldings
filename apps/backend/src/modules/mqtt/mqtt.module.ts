import { Global, Module } from '@nestjs/common';
import { MqttService } from './mqtt.service.js';
import { TelemetryGateway } from './telemetry.gateway.js';
import { BacnetMqttSubscriber } from './bacnet-mqtt.subscriber.js';
import { DeviceStatusService } from './device-status.service.js';
import { GatewayStatusService } from './gateway-status.service.js';
import { GatewayHealthService } from './gateway-health.service.js';
import { DeviceHeartbeatService } from './device-heartbeat.service.js';
import { GatewayOtaService } from './gateway-ota.service.js';
import { IngestionMetricsService } from './ingestion-metrics.service.js';
import { CameraLastValueService } from './camera-last-value.service.js';
import { AvailabilityRecorderService } from './availability-recorder.service.js';
import { TrendsModule } from '../trends/trends.module.js';
import { AlarmsModule } from '../alarms/alarms.module.js';
import { AuthModule } from '../auth/auth.module.js';

@Global()
@Module({
  imports: [TrendsModule, AlarmsModule, AuthModule],
  providers: [
    MqttService,
    TelemetryGateway,
    BacnetMqttSubscriber,
    DeviceStatusService,
    GatewayStatusService,
    GatewayHealthService,
    DeviceHeartbeatService,
    GatewayOtaService,
    IngestionMetricsService,
    CameraLastValueService,
    AvailabilityRecorderService,
  ],
  exports: [
    MqttService,
    TelemetryGateway,
    DeviceStatusService,
    GatewayStatusService,
    GatewayHealthService,
    DeviceHeartbeatService,
    GatewayOtaService,
    IngestionMetricsService,
  ],
})
export class MqttModule {}
