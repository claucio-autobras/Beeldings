import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EmqxProvisioningService } from '../../sites/application/emqx-provisioning.service.js';

/**
 * SensorAclSyncService
 *
 * No boot, reaplica a ACL do usuário MQTT de sensores de todos os gateways já
 * provisionados (sensorMqttUser preenchido). Necessário para propagar novas
 * regras — ex.: o allow de SUBSCRIBE no sub-espaço de comando (rpc/command)
 * introduzido para escrita MQTT — a gateways criados antes da mudança.
 *
 * Best-effort e fire-and-forget: falhas são logadas e nunca impedem o boot.
 * Idempotente: o EMQX substitui o conjunto de regras do usuário (PUT em 409).
 */
@Injectable()
export class SensorAclSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SensorAclSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emqxProvisioning: EmqxProvisioningService,
  ) {}

  onApplicationBootstrap(): void {
    // Não bloqueia o boot — roda em background.
    void this.syncAll();
  }

  async syncAll(): Promise<void> {
    let gateways: Array<{ id: string; tenantId: string }>;
    try {
      gateways = await this.prisma.gateway.findMany({
        where: { sensorMqttUser: { not: null } },
        select: { id: true, tenantId: true },
      });
    } catch (err) {
      this.logger.warn(`Falha ao listar gateways para sync de ACL de sensor: ${(err as Error).message}`);
      return;
    }

    if (gateways.length === 0) return;

    let ok = 0;
    for (const gw of gateways) {
      try {
        await this.emqxProvisioning.reapplySensorAcl(gw.id, gw.tenantId);
        ok++;
      } catch (err) {
        this.logger.warn(
          `Falha ao reaplicar ACL de sensor do gateway ${gw.id}: ${(err as Error).message}`,
        );
      }
    }
    this.logger.log(`ACL de sensores reaplicada no boot: ${ok}/${gateways.length} gateway(s)`);
  }
}
