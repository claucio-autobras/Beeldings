/**
 * DriversModule — registra o DriverRegistry no container NestJS.
 *
 * Em fase 1, o DriverRegistry existe mas não é usado pelos PollingServices
 * (que instanciam SnmpDriver/OnvifDriver diretamente). Fase 2+: um orquestrador
 * unificado usará registry.create(protocol) para dispatching dinâmico.
 *
 * Import nos módulos que usam drivers:
 *   imports: [DriversModule]
 */

import { Module } from '@nestjs/common';
import { DriverRegistry } from './driver-registry';

@Module({
  providers: [DriverRegistry],
  exports: [DriverRegistry],
})
export class DriversModule {}
