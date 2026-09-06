import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller.js';
import { ProjectsService } from '../application/projects.service.js';
import { EmqxProvisioningService } from '../../sites/application/emqx-provisioning.service.js';
import { PrismaModule } from '../../prisma/prisma.module.js';

@Module({
  imports: [PrismaModule],
  controllers: [ProjectsController],
  providers: [ProjectsService, EmqxProvisioningService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
