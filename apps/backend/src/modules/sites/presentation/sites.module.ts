import { Module } from '@nestjs/common';
import { SitesController } from './sites.controller.js';
import { SitesService } from '../application/sites.service.js';
import { EmqxProvisioningService } from '../application/emqx-provisioning.service.js';
import { PrismaModule } from '../../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [SitesController],
  providers: [SitesService, EmqxProvisioningService],
  exports: [SitesService],
})
export class SitesModule {}
