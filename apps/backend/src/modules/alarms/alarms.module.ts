import { Module } from '@nestjs/common';
import { AlarmRulesController } from './alarm-rules.controller.js';
import { AlarmEventsController } from './alarm-events.controller.js';
import { AlarmsLegacyController } from './alarms-legacy.controller.js';
import { AlarmGroupsController } from './alarm-groups.controller.js';
import { AlarmRulesService } from './alarm-rules.service.js';
import { AlarmEventsService } from './alarm-events.service.js';
import { AlarmGroupsService } from './alarm-groups.service.js';
import { AlarmEngineService } from './alarm-engine.service.js';

@Module({
  controllers: [AlarmRulesController, AlarmEventsController, AlarmsLegacyController, AlarmGroupsController],
  providers: [AlarmEngineService, AlarmRulesService, AlarmEventsService, AlarmGroupsService],
  exports: [AlarmEngineService, AlarmEventsService],
})
export class AlarmsModule {}
