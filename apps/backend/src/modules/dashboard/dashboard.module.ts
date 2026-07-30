import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller.js';
import { CriticalAssetsService } from './critical-assets.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [DashboardController],
  providers: [CriticalAssetsService],
})
export class DashboardModule {}
