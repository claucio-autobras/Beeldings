import { Module } from '@nestjs/common';
import { ScadaController } from './scada.controller.js';
import { ScadaProjectsController } from './scada-projects.controller.js';
import { ScadaComponentsController } from './scada-components.controller.js';
import { ScadaAssetsController } from './scada-assets.controller.js';
import { ScadaAssetFilesController } from './scada-asset-files.controller.js';
import { ScadaSimulatorController } from './scada-simulator.controller.js';
import { ScadaService } from '../application/scada.service.js';
import { ScadaAssetService } from '../application/scada-asset.service.js';
import { ScadaObjectStorageService } from '../infrastructure/scada-object-storage.service.js';
import { SimulatorService } from '../application/simulator.service.js';
import { PrismaModule } from '../../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [
    ScadaController,
    ScadaComponentsController,
    ScadaProjectsController,
    ScadaAssetsController,
    ScadaAssetFilesController,
    ScadaSimulatorController,
  ],
  providers: [ScadaService, ScadaAssetService, ScadaObjectStorageService, SimulatorService],
  exports: [ScadaService, ScadaAssetService, ScadaObjectStorageService],
})
export class ScadaModule {}
