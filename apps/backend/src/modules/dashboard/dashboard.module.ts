import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller.js';
import { CriticalAssetsService } from './critical-assets.service.js';
import { DashboardInsightsService } from './dashboard-insights.service.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ReportsModule } from '../reports/reports.module.js';

@Module({
  imports: [PrismaModule, ReportsModule],
  controllers: [DashboardController],
  providers: [CriticalAssetsService, DashboardInsightsService],
})
export class DashboardModule {}
