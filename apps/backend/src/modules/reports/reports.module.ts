import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller.js';
import { ReportsService } from './reports.service.js';
import { AvailabilityService } from './availability.service.js';

@Module({
  controllers: [ReportsController],
  providers: [ReportsService, AvailabilityService],
  // Exportado para o dashboard reutilizar a MESMA base de disponibilidade do
  // relatório (status_events) no Resumo Operacional do cliente.
  exports: [AvailabilityService],
})
export class ReportsModule {}
