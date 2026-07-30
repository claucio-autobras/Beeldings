import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { DeviceStatusService, DeviceLiveStatus } from './device-status.service.js';
import { AvailabilityRecorderService } from './availability-recorder.service.js';

/**
 * GatewayStatusService
 *
 * Ponte entre o sinal EXPLÍCITO de liveness do gateway (LWT/heartbeat, tópico
 * `bluebee/{tenant}/gateway/{id}/status`) e o estado do sistema.
 *
 * Faz DUAS coisas ao receber um status:
 *   1. Atualiza o `DeviceStatusService` (memória) — fonte usada ao vivo pelas
 *      telas para refletir online/offline sem depender só de telemetria.
 *   2. Persiste `status`/`lastSeen` no gateway (Postgres) — fonte durável que
 *      sobrevive a restart do backend, além do retido do próprio broker.
 *
 * A mensagem de status é RETIDA no broker: ao (re)subscrever após um restart do
 * backend, o EMQX reentrega o último status de cada gateway, repovoando a
 * memória automaticamente — o liveness não se perde no restart.
 */
@Injectable()
export class GatewayStatusService {
  private readonly logger = new Logger(GatewayStatusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly deviceStatus: DeviceStatusService,
    private readonly availability: AvailabilityRecorderService,
  ) {}

  /**
   * Aplica um status de liveness recebido no tópico de status do gateway.
   * `status` vazio (payload retido limpo) é ignorado.
   */
  async apply(gatewayId: string, status: DeviceLiveStatus): Promise<void> {
    if (!gatewayId || (status !== 'online' && status !== 'offline')) return;

    this.deviceStatus.markGatewayStatus(gatewayId, status);

    // Histórico durável de transições (relatório de disponibilidade). A
    // deduplicação interna ignora reentregas do retido no restart do backend.
    this.availability.noteGatewayStatus(gatewayId, status);

    try {
      const data =
        status === 'online'
          ? { status, lastSeen: new Date() }
          : { status };
      await this.prisma.gateway.update({ where: { id: gatewayId }, data });
    } catch (err) {
      // Gateway ainda não cadastrado / removido: manter só o estado em memória.
      this.logger.debug(
        `Não foi possível persistir status do gateway ${gatewayId}: ${(err as Error).message}`,
      );
    }

    this.logger.log(`Gateway ${gatewayId} → ${status}`);
  }
}
