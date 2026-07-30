import { Module } from '@nestjs/common';
import { StorageMonitorService } from './storage-monitor.service.js';
import { EmqxMonitorService } from './emqx-monitor.service.js';
import { HealthController } from './health.controller.js';
import { CommsHealthController } from './comms-health.controller.js';

@Module({
  controllers: [HealthController, CommsHealthController],
  providers: [StorageMonitorService, EmqxMonitorService],
  exports: [StorageMonitorService, EmqxMonitorService],
})
export class HealthModule {}
