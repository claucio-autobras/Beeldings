import { Module } from '@nestjs/common';
import {
  TrendsController,
  TelemetryStubController,
  CommandsController,
  SystemsStubController,
} from './trends.controller.js';
import { TrendsService } from './trends.service.js';
import { TrendRecorderService } from './trend-recorder.service.js';
import { TrendRetentionService } from './trend-retention.service.js';
import { TrendRollupService } from './trend-rollup.service.js';
import { DefaultTrendsService } from './default-trends.service.js';
import { EquipmentAnalyticsService } from './equipment-analytics.service.js';
import { EquipmentAnalyticsController } from './equipment-analytics.controller.js';

@Module({
  controllers: [
    TrendsController,
    EquipmentAnalyticsController,
    TelemetryStubController,
    CommandsController,
    SystemsStubController,
  ],
  providers: [
    TrendsService,
    TrendRecorderService,
    TrendRetentionService,
    TrendRollupService,
    DefaultTrendsService,
    EquipmentAnalyticsService,
  ],
  exports: [TrendRecorderService, DefaultTrendsService],
})
export class TrendsModule {}
