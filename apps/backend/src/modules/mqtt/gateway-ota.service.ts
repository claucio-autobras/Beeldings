import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/** Estágios de uma atualização OTA reportados pelo gateway. */
export type GatewayOtaStage =
  | 'downloading'
  | 'applying'
  | 'restarting'
  | 'completed'
  | 'failed'
  | 'rolled_back';

/** Progresso de OTA reportado pelo gateway em bluebee/{tenant}/gateway/{id}/ota. */
export interface GatewayOtaProgress {
  commandId: string;
  stage: GatewayOtaStage;
  /** Versão alvo da atualização. */
  version: string;
  /** Versão que estava rodando quando a atualização começou. */
  fromVersion: string;
  error: string | null;
  /** Instante reportado pelo gateway (ISO). */
  ts: string;
  /** Instante em que o backend recebeu (ISO). */
  receivedAt: string;
}

const FINAL_STAGES: GatewayOtaStage[] = ['completed', 'failed', 'rolled_back'];

/**
 * GatewayOtaService (backend)
 *
 * Guarda EM MEMÓRIA o último progresso de OTA de cada gateway (estágios
 * intermediários: baixando/aplicando/reiniciando) e PERSISTE no Postgres o
 * resultado final (completed/failed/rolled_back) + a versão reportada, para
 * sobreviver a restart do backend.
 */
@Injectable()
export class GatewayOtaService {
  private readonly logger = new Logger(GatewayOtaService.name);
  private readonly progress = new Map<string, GatewayOtaProgress>();
  /** Cache da última versão persistida por gateway (evita UPDATE por health). */
  private readonly persistedVersion = new Map<string, string>();

  constructor(private readonly prisma: PrismaService) {}

  /** Aplica um progresso de OTA recebido do gateway. */
  apply(gatewayId: string, p: GatewayOtaProgress): void {
    if (!gatewayId) return;
    this.progress.set(gatewayId, p);

    if (FINAL_STAGES.includes(p.stage)) {
      const data: Record<string, unknown> = {
        otaState: p.stage,
        otaMessage: p.error ?? (p.stage === 'completed' ? `Atualizado para v${p.version}` : null),
        otaAt: new Date(),
      };
      if (p.stage === 'completed' && p.version) {
        data.reportedVersion = p.version;
        this.persistedVersion.set(gatewayId, p.version);
      }
      void this.prisma.gateway
        .update({ where: { id: gatewayId }, data })
        .catch((err: Error) =>
          this.logger.debug(
            `Não foi possível persistir resultado OTA do gateway ${gatewayId}: ${err.message}`,
          ),
        );
    }
  }

  /** Último progresso conhecido de OTA de um gateway, ou null. */
  get(gatewayId: string): GatewayOtaProgress | null {
    return this.progress.get(gatewayId) ?? null;
  }

  /**
   * Persiste a versão reportada pelo gateway (vinda do resumo de saúde) quando
   * ela muda — com cache para não gerar um UPDATE a cada health (20s).
   */
  recordReportedVersion(gatewayId: string, version: string): void {
    if (!gatewayId || !version) return;
    if (this.persistedVersion.get(gatewayId) === version) return;
    this.persistedVersion.set(gatewayId, version);
    void this.prisma.gateway
      .update({ where: { id: gatewayId }, data: { reportedVersion: version } })
      .catch((err: Error) => {
        this.persistedVersion.delete(gatewayId);
        this.logger.debug(
          `Não foi possível persistir versão do gateway ${gatewayId}: ${err.message}`,
        );
      });
  }
}
