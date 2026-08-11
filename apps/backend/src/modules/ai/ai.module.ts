import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { AlarmsModule } from '../alarms/alarms.module.js';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { AiRateLimitGuard } from './ai-rate-limit.guard.js';
import { OperationalMemoryService } from './operational-memory.service.js';

@Module({
  // DeviceStatusService vem do MqttModule (@Global) — não precisa importar.
  imports: [PrismaModule, KnowledgeModule, AlarmsModule],
  controllers: [AiController],
  providers: [AiService, AiRateLimitGuard, OperationalMemoryService],
})
export class AiModule {}
