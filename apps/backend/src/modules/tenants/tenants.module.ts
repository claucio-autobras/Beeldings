import { Module } from '@nestjs/common';
import { TenantsController } from './tenants.controller.js';
import { ScadaModule } from '../scada/presentation/scada.module.js';

@Module({
  imports: [ScadaModule],
  controllers: [TenantsController],
})
export class TenantsModule {}
