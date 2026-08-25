import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClusterService } from '../cluster/cluster.service.js';
import { EmqxProvisioningService } from '../sites/application/emqx-provisioning.service.js';

/** Resultado por categoria de credencial re-provisionada. */
export interface ReprovisionCounts {
  total: number;
  ok: number;
  failed: number;
}

/** Relatório de uma execução do re-provisionamento em massa. */
export interface EmqxReprovisionReport {
  /** O que disparou a execução. */
  trigger: 'manual' | 'boot';
  startedAt: string;
  finishedAt: string;
  /** EMQX gerenciado configurado? (sem EMQX_API_URL nada é feito). */
  configured: boolean;
  /** Usuário + ACL de cada gateway cadastrado. */
  gateways: ReprovisionCounts;
  /** Usuário de sensores (gateways com credencial de sensores emitida). */
  sensorUsers: ReprovisionCounts;
  /** Usuário dedicado + ACL de devices MQTT em modo "tópico raiz próprio". */
  rootDevices: ReprovisionCounts;
  /** ACL de tópicos raiz reaplicada no usuário do gateway. */
  gatewayRootAcls: ReprovisionCounts;
  /** Primeiros erros encontrados (limitado para não inflar a resposta). */
  errors: string[];
}

/** Bloco relevante da config JSON de um device MQTT (modo tópico raiz). */
interface MqttDeviceConfigJson {
  topicMode?: 'prefix' | 'root';
  rootTopic?: string;
  deviceMqttUser?: string;
  deviceMqttPass?: string;
}

const MAX_ERRORS_IN_REPORT = 20;
/** Espera pós-boot antes da verificação leve (deixa o boot assentar). */
const BOOT_CHECK_DELAY_MS = 15_000;
/** Quantos gateways checar na verificação leve do boot (amostra + todos se poucos). */
const BOOT_CHECK_SAMPLE = 25;

/**
 * EmqxReprovisionService — recuperação do estado do broker EMQX.
 *
 * O EMQX (nó único) guarda usuários MQTT, ACLs e retained messages em estado
 * interno (Mnesia). Se esse estado se perder (reinstalação, disco, upgrade),
 * TODOS os gateways e dispositivos passam a ser recusados na conexão e nada
 * reconstrói as credenciais sozinho. Este serviço percorre o banco (fonte da
 * verdade das credenciais: `gateway.mqttPass`, `gateway.sensorMqttPass`,
 * `config.deviceMqttPass` dos devices raiz) e recria usuários + ACLs de forma
 * idempotente (o provisionamento faz upsert: POST com fallback PUT no 409).
 *
 * Exposto como:
 *  1. Ação administrativa — POST /health/broker/reprovision (admin global);
 *  2. Verificação leve no boot (só na instância líder): checa se os usuários
 *     dos gateways existem no EMQX; se algum sumiu, dispara o re-provisionamento
 *     completo automaticamente e loga o ocorrido.
 */
@Injectable()
export class EmqxReprovisionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(EmqxReprovisionService.name);
  private inFlight: Promise<EmqxReprovisionReport> | null = null;
  private lastReport: EmqxReprovisionReport | null = null;
  private bootCheckDone = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly emqx: EmqxProvisioningService,
    private readonly cluster: ClusterService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.emqx.isConfigured()) return;
    // Verificação leve só na líder (uma por cluster) e uma vez por processo.
    this.cluster.onLeadership((isLeader) => {
      if (!isLeader || this.bootCheckDone) return;
      this.bootCheckDone = true;
      setTimeout(() => void this.bootCheck(), BOOT_CHECK_DELAY_MS);
    });
  }

  /** Último relatório de re-provisionamento desta instância (ou null). */
  getLastReport(): EmqxReprovisionReport | null {
    return this.lastReport;
  }

  /**
   * Verificação leve no boot: amostra os usuários MQTT dos gateways no EMQX.
   * Só age quando a API RESPONDE que o usuário não existe (404) — checagem
   * inconclusiva (API fora do ar) apenas loga, nunca dispara re-provisionamento.
   */
  async bootCheck(): Promise<void> {
    try {
      const gateways = await this.prisma.gateway.findMany({
        select: { id: true },
        take: BOOT_CHECK_SAMPLE,
        orderBy: { createdAt: 'asc' },
      });
      if (gateways.length === 0) return;

      let missing = 0;
      let inconclusive = 0;
      for (const gw of gateways) {
        const exists = await this.emqx.mqttUserExists(gw.id);
        if (exists === false) missing += 1;
        else if (exists === null) inconclusive += 1;
      }

      if (missing > 0) {
        this.logger.warn(
          `EMQX sem credencial de ${missing}/${gateways.length} gateway(s) verificados no boot — ` +
            'estado do broker provavelmente foi perdido. Iniciando re-provisionamento completo.',
        );
        const report = await this.reprovisionAll('boot');
        this.logger.warn(
          `Re-provisionamento automático concluído: gateways ${report.gateways.ok}/${report.gateways.total}, ` +
            `sensores ${report.sensorUsers.ok}/${report.sensorUsers.total}, ` +
            `devices raiz ${report.rootDevices.ok}/${report.rootDevices.total}`,
        );
      } else if (inconclusive === gateways.length) {
        this.logger.warn(
          'Verificação de credenciais no EMQX inconclusiva no boot (API não respondeu) — nada foi alterado.',
        );
      } else {
        this.logger.log(
          `Credenciais dos gateways presentes no EMQX (${gateways.length} verificadas no boot)`,
        );
      }
    } catch (err) {
      this.logger.warn(`Verificação de credenciais no boot falhou: ${(err as Error).message}`);
    }
  }

  /**
   * Re-provisiona TODAS as credenciais e ACLs derivadas do banco no EMQX.
   * Idempotente e serializado: uma execução por vez (chamadas concorrentes
   * aguardam a mesma execução).
   */
  reprovisionAll(trigger: 'manual' | 'boot' = 'manual'): Promise<EmqxReprovisionReport> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.run(trigger).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async run(trigger: 'manual' | 'boot'): Promise<EmqxReprovisionReport> {
    const startedAt = new Date().toISOString();
    const zero = (): ReprovisionCounts => ({ total: 0, ok: 0, failed: 0 });
    const report: EmqxReprovisionReport = {
      trigger,
      startedAt,
      finishedAt: startedAt,
      configured: this.emqx.isConfigured(),
      gateways: zero(),
      sensorUsers: zero(),
      rootDevices: zero(),
      gatewayRootAcls: zero(),
      errors: [],
    };
    const fail = (counts: ReprovisionCounts, msg: string) => {
      counts.failed += 1;
      if (report.errors.length < MAX_ERRORS_IN_REPORT) report.errors.push(msg);
    };

    if (!report.configured) {
      this.logger.warn('Re-provisionamento solicitado sem EMQX_API_URL configurado — nada a fazer.');
      report.finishedAt = new Date().toISOString();
      this.lastReport = report;
      return report;
    }

    this.logger.log(`Re-provisionamento EMQX iniciado (${trigger})`);

    // 1) Gateways: usuário + ACL base; usuário de sensores quando emitido.
    const gateways = await this.prisma.gateway.findMany({
      select: {
        id: true,
        tenantId: true,
        mqttPass: true,
        sensorMqttUser: true,
        sensorMqttPass: true,
      },
    });
    report.gateways.total = gateways.length;
    for (const gw of gateways) {
      try {
        await this.emqx.provisionGateway(gw.id, gw.mqttPass, gw.tenantId);
        report.gateways.ok += 1;
      } catch (err) {
        fail(report.gateways, `gateway ${gw.id}: ${(err as Error).message}`);
      }
      if (gw.sensorMqttUser && gw.sensorMqttPass) {
        report.sensorUsers.total += 1;
        try {
          await this.emqx.provisionSensorUser(gw.id, gw.tenantId, gw.sensorMqttPass);
          report.sensorUsers.ok += 1;
        } catch (err) {
          fail(report.sensorUsers, `sensores de ${gw.id}: ${(err as Error).message}`);
        }
      }
    }

    // 2) Devices MQTT em modo "tópico raiz próprio": usuário dedicado + ACL,
    //    e a ACL de subscribe dos roots no usuário de cada gateway.
    const devices = await this.prisma.device.findMany({
      where: { protocol: 'mqtt' },
      select: {
        id: true,
        tenantId: true,
        gatewayId: true,
        config: true,
        points: { select: { binding: true } },
      },
    });
    const rootDevices = devices
      .map((d) => {
        const cfg = (d.config ?? {}) as MqttDeviceConfigJson;
        const root = cfg.topicMode === 'root' ? (cfg.rootTopic ?? '').trim() : '';
        return { ...d, root, pass: cfg.deviceMqttPass ?? '' };
      })
      .filter((d) => !!d.root && !!d.gatewayId);

    report.rootDevices.total = rootDevices.length;
    for (const d of rootDevices) {
      try {
        if (!d.pass) {
          // Sem senha persistida não há como recriar o usuário — ACL ainda é
          // reaplicável, mas o equipamento precisará de credencial nova.
          await this.emqx.syncRootDeviceAcl(d.id, d.root, this.commandTopics(d.points));
          fail(
            report.rootDevices,
            `device raiz ${d.id}: sem senha persistida — ACL reaplicada, mas recrie a credencial no cadastro`,
          );
          continue;
        }
        await this.emqx.provisionRootDeviceUser(
          d.id,
          d.pass,
          d.root,
          this.commandTopics(d.points),
        );
        report.rootDevices.ok += 1;
      } catch (err) {
        fail(report.rootDevices, `device raiz ${d.id}: ${(err as Error).message}`);
      }
    }

    const byGateway = new Map<string, { tenantId: string; roots: string[] }>();
    for (const d of rootDevices) {
      const entry = byGateway.get(d.gatewayId as string) ?? { tenantId: d.tenantId, roots: [] };
      entry.roots.push(d.root);
      byGateway.set(d.gatewayId as string, entry);
    }
    report.gatewayRootAcls.total = byGateway.size;
    for (const [gatewayId, { tenantId, roots }] of byGateway) {
      try {
        await this.emqx.applyGatewayRootAcl(gatewayId, tenantId, roots);
        report.gatewayRootAcls.ok += 1;
      } catch (err) {
        fail(report.gatewayRootAcls, `ACL raiz do gateway ${gatewayId}: ${(err as Error).message}`);
      }
    }

    report.finishedAt = new Date().toISOString();
    this.lastReport = report;
    this.logger.log(
      `Re-provisionamento EMQX concluído (${trigger}): ` +
        `gateways ${report.gateways.ok}/${report.gateways.total}, ` +
        `sensores ${report.sensorUsers.ok}/${report.sensorUsers.total}, ` +
        `devices raiz ${report.rootDevices.ok}/${report.rootDevices.total}, ` +
        `ACLs raiz ${report.gatewayRootAcls.ok}/${report.gatewayRootAcls.total}` +
        (report.errors.length ? ` — ${report.errors.length} erro(s)` : ''),
    );
    return report;
  }

  /** Tópicos de comando que o usuário dedicado do device precisa ASSINAR. */
  private commandTopics(points: Array<{ binding: unknown }>): string[] {
    const topics: string[] = [];
    for (const p of points) {
      const b = (p.binding ?? {}) as { write?: { commandTopic?: string | null } | null };
      const t = b.write?.commandTopic?.trim();
      if (t) topics.push(t);
    }
    return topics;
  }
}
