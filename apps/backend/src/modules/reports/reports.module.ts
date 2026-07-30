import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';
import { AvailabilityService } from './availability.service.js';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, AvailabilityService],
})
export class ReportsModule {}
