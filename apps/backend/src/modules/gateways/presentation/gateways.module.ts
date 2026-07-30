import { Module } from '@nestjs/common';
import { GatewaysController } from './gateways.controller.js';
import { GatewayUpdatePackageController } from './gateway-update-package.controller.js';
import { GatewaysService } from '../application/gateways.service.js';
import { GatewayPackageService } from '../application/gateway-package.service.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { EmqxProvisioningService } from '../../sites/application/emqx-provisioning.service.js';
import { SensorAclSyncService } from '../application/sensor-acl-sync.service.js';

@Module({
  imports: [PrismaModule],
  // O controller público do pacote OTA vem ANTES: sua rota estática
  // /gateways/update-package precisa registrar antes de GET /gateways/:id
  // (senão o :id captura "update-package" e o JwtAuthGuard responde 401).
  controllers: [GatewayUpdatePackageController, GatewaysController],
  providers: [GatewaysService, GatewayPackageService, EmqxProvisioningService, SensorAclSyncService],
  exports: [GatewaysService],
})
export class GatewaysModule {}
