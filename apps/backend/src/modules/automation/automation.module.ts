import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { DevicesModule } from '../devices/devices.module.js';
import { AutomationController } from './presentation/automation.controller.js';
import { AutomationService } from './application/automation.service.js';
import { AutomationRunnerService } from './application/automation-runner.service.js';
import { AutomationSchedulerService } from './application/automation-scheduler.service.js';
import { PointValueCacheService } from './application/point-value-cache.service.js';

/**
 * Motor de automação (QUANDO/SE/ENTÃO). CRUD via controller; execução via
 * scheduler (só no líder) → runner → BacnetWriteService (reusado de DevicesModule).
 * AuditService e MqttService são globais.
 */
@Module({
  imports: [PrismaModule, DevicesModule],
  controllers: [AutomationController],
  providers: [
    AutomationService,
    AutomationRunnerService,
    AutomationSchedulerService,
    PointValueCacheService,
  ],
})
export class AutomationModule {}
