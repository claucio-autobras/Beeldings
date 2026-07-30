import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module.js';
import { KnowledgeModule } from '../knowledge/knowledge.module.js';
import { AiController } from './ai.controller.js';
import { AiService } from './ai.service.js';
import { AiRateLimitGuard } from './ai-rate-limit.guard.js';

@Module({
  imports: [PrismaModule, KnowledgeModule],
  controllers: [AiController],
  providers: [AiService, AiRateLimitGuard],
})
export class AiModule {}
