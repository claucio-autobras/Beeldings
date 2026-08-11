import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/** Estágios de uma atualização OTA reportados pelo gateway (+ `expired`, gerado pelo backend). */
export type GatewayOtaStage =
  | 'downloading'
  | 'applying'
  | 'restarting'
  | 'completed'
  | 'failed'
  | 'rolled_back'
  | 'expired';

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

const FINAL_STAGES: GatewayOtaStage[] = ['completed', 'failed', 'rolled_back', 'expired'];
const INTERMEDIATE_STAGES: GatewayOtaStage[] = ['downloading', 'applying', 'restarting'];

/**
 * Tempo máximo sem novo progresso antes de considerar a OTA "não confirmada".
 * Maior que o watchdog de 10 min do launcher (que reverte e reinicia): se nem o
 * rollback reconectou até aqui, o gateway não voltou.
 */
export const OTA_EXPIRE_MS = 15 * 60_000;

/** Mensagem terminal do estágio expirado (persistida em otaMessage). */
export const OTA_EXPIRED_MESSAGE =
  'Atualização não confirmada — o gateway não voltou após o restart.';

/** Mensagem terminal quando o operador cancela/limpa uma atualização travada. */
export const OTA_CANCELLED_MESSAGE =
  'Atualização cancelada pelo operador — verifique o gateway no local e dispare novamente se necessário.';

/** Intervalo da varredura periódica de expiração. */
const SWEEP_INTERVAL_MS = 60_000;

/**
 * GatewayOtaService (backend)
 *
 * Guarda EM MEMÓRIA o último progresso de OTA de cada gateway (estágios
 * intermediários: baixando/aplicando/reiniciando) e PERSISTE no Postgres o
 * resultado final (completed/failed/rolled_back/expired) + a versão reportada,
 * para sobreviver a restart do backend.
 *
 * Estágios intermediários sem novo progresso por mais de OTA_EXPIRE_MS são
 * transicionados para o estágio terminal `expired` (na leitura e numa varredura
 * periódica). Confirmações tardias via MQTT (completed/rolled_back/failed)
 * sobrescrevem o estado expirado normalmente.
 */
@Injectable()
export class GatewayOtaService implements OnModuleDestroy {
  private readonly logger = new Logger(GatewayOtaService.name);
  private readonly progress = new Map<string, GatewayOtaProgress>();
  /** Cache da última versão persistida por gateway (evita UPDATE por health). */
  private readonly persistedVersion = new Map<string, string>();
  private readonly sweepTimer: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaService) {
    // Varredura periódica: expira OTAs abandonadas mesmo sem ninguém lendo a
    // lista de gateways (persistência não depende de acesso à UI).
    this.sweepTimer = setInterval(() => void this.sweepExpired(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  onModuleDestroy(): void {
    clearInterval(this.sweepTimer);
  }

  /** Aplica um progresso de OTA recebido do gateway. */
  apply(gatewayId: string, p: GatewayOtaProgress): void {
    if (!gatewayId) return;
    const prev = this.progress.get(gatewayId);

    // Progresso REPETIDO do mesmo estágio intermediário (mesma tentativa) não
    // renova o prazo de expiração: o relógio conta desde a primeira vez que o
    // estágio foi visto. Sem isso, um gateway que repete "restarting" para
    // sempre nunca expiraria.
    if (
      prev &&
      INTERMEDIATE_STAGES.includes(p.stage) &&
      prev.stage === p.stage &&
      prev.commandId === p.commandId
    ) {
      p = { ...p, receivedAt: prev.receivedAt };
    }

    // Confirmação tardia (completed/rolled_back/failed) sobrescreve inclusive o
    // estado expirado — nunca bloqueada pelo timeout.
    this.progress.set(gatewayId, p);

    // Persiste TAMBÉM os estágios intermediários (só na transição de estágio,
    // não a cada repetição) — assim a expiração sobrevive a restart do backend:
    // a varredura encontra o estágio intermediário velho no banco mesmo que a
    // memória tenha sido perdida.
    if (INTERMEDIATE_STAGES.includes(p.stage) && (!prev || prev.stage !== p.stage)) {
      void this.prisma.gateway
        .update({
          where: { id: gatewayId },
          data: { otaState: p.stage, otaMessage: null, otaAt: new Date() },
        })
        .catch((err: Error) =>
          this.logger.debug(
            `Não foi possível persistir progresso OTA do gateway ${gatewayId}: ${err.message}`,
          ),
        );
    }

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

  /**
   * Último progresso conhecido de OTA de um gateway, ou null.
   * Estágios intermediários velhos demais são expirados aqui (lazy) — o
   * chamador sempre vê o estado já transicionado.
   */
  get(gatewayId: string): GatewayOtaProgress | null {
    const p = this.progress.get(gatewayId);
    if (!p) return null;
    if (this.isExpiredIntermediate(p)) {
      return this.expire(gatewayId, p);
    }
    return p;
  }

  /** True quando há uma OTA genuinamente em andamento (intermediária e não expirada). */
  isInProgress(gatewayId: string): boolean {
    const p = this.get(gatewayId);
    return !!p && INTERMEDIATE_STAGES.includes(p.stage);
  }

  private isExpiredIntermediate(p: GatewayOtaProgress): boolean {
    return (
      INTERMEDIATE_STAGES.includes(p.stage) &&
      Date.now() - new Date(p.receivedAt).getTime() >= OTA_EXPIRE_MS
    );
  }

  /** Transiciona um progresso intermediário abandonado para o terminal `expired`. */
  private expire(gatewayId: string, stale: GatewayOtaProgress): GatewayOtaProgress {
    const expired: GatewayOtaProgress = {
      ...stale,
      stage: 'expired',
      error: OTA_EXPIRED_MESSAGE,
    };
    this.logger.warn(
      `OTA do gateway ${gatewayId} expirou sem confirmação (último estágio: ${stale.stage}, v${stale.version})`,
    );
    // apply() persiste otaState/otaMessage/otaAt como em qualquer estágio final.
    this.apply(gatewayId, expired);
    return expired;
  }

  /** Varredura periódica: expira progressos intermediários abandonados. */
  private async sweepExpired(): Promise<void> {
    for (const [gatewayId, p] of this.progress) {
      if (this.isExpiredIntermediate(p)) this.expire(gatewayId, p);
    }

    // Resiliência a restart do backend: estágios intermediários persistidos no
    // banco (otaState) sem progresso em memória também expiram pelo prazo —
    // mesmo que o progresso original só tenha existido em memória antes do
    // restart, a transição de estágio já foi gravada com otaAt.
    try {
      const stale = await this.prisma.gateway.findMany({
        where: {
          otaState: { in: INTERMEDIATE_STAGES },
          otaAt: { lte: new Date(Date.now() - OTA_EXPIRE_MS) },
        },
        select: { id: true },
      });
      for (const g of stale) {
        if (this.progress.has(g.id)) continue; // memória cobre este gateway
        this.logger.warn(
          `OTA do gateway ${g.id} expirou sem confirmação (estágio intermediário persistido, backend reiniciado)`,
        );
        await this.prisma.gateway.update({
          where: { id: g.id },
          data: { otaState: 'expired', otaMessage: OTA_EXPIRED_MESSAGE, otaAt: new Date() },
        });
      }
    } catch (err) {
      this.logger.debug(
        `Varredura de OTAs expiradas no banco falhou: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Cancela/limpa uma atualização travada (ação explícita do operador).
   * Marca o estado terminal `expired` com a mensagem de cancelamento — em
   * memória (quando há progresso) e persistido — liberando o guard de novo
   * disparo. Retorna false quando não há atualização intermediária a cancelar.
   */
  async cancel(gatewayId: string): Promise<boolean> {
    const p = this.progress.get(gatewayId);
    if (p && INTERMEDIATE_STAGES.includes(p.stage)) {
      this.apply(gatewayId, { ...p, stage: 'expired', error: OTA_CANCELLED_MESSAGE });
      return true;
    }

    // Sem progresso em memória (ex.: backend reiniciado) — cancela o estágio
    // intermediário persistido, se houver.
    const gw = await this.prisma.gateway.findUnique({
      where: { id: gatewayId },
      select: { otaState: true },
    });
    if (gw && INTERMEDIATE_STAGES.includes((gw.otaState ?? '') as GatewayOtaStage)) {
      await this.prisma.gateway.update({
        where: { id: gatewayId },
        data: { otaState: 'expired', otaMessage: OTA_CANCELLED_MESSAGE, otaAt: new Date() },
      });
      return true;
    }
    return false;
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
