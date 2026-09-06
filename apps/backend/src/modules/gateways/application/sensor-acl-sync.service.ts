import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EmqxProvisioningService } from '../../sites/application/emqx-provisioning.service.js';

/** Bloco relevante da config JSON de um device MQTT (modo tópico raiz). */
interface MqttDeviceConfigJson {
  topicMode?: 'prefix' | 'root';
  rootTopic?: string;
}

/**
 * SensorAclSyncService
 *
 * No boot, reaplica as ACLs MQTT derivadas do cadastro em todos os gateways já
 * provisionados:
 *
 * 1. ACL do usuário de SENSORES (sensorMqttUser preenchido) — propaga novas
 *    regras (ex.: allow de SUBSCRIBE no sub-espaço de comando rpc/command) a
 *    gateways criados antes da mudança.
 * 2. ACL de TÓPICOS RAIZ do usuário do GATEWAY — dispositivos MQTT em modo
 *    "tópico raiz próprio" (ex.: Aeris `008065/`) exigem allow de subscribe
 *    fora de `bluebee/…`. Sem a reaplicação aqui, um EMQX re-provisionado (ou
 *    uma falha pontual na criação do device) deixava o bridge do gateway sem
 *    permissão nos roots PARA SEMPRE — telemetria e comandos negados em
 *    silêncio até alguém recriar o device.
 * 3. ACL do usuário dedicado de cada device raiz (dev-{id}) — publish sob o
 *    raiz + subscribe nos tópicos de comando dos pontos comandáveis.
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
    void this.syncRootAcls();
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

  /**
   * Reconstrói as ACLs do modo "tópico raiz próprio": por gateway, a ACL do
   * usuário do gateway com TODOS os roots dos seus devices MQTT; por device,
   * a ACL do usuário dedicado (publish no raiz + subscribe nos comandos).
   */
  async syncRootAcls(): Promise<void> {
    let devices: Array<{
      id: string;
      tenantId: string;
      gatewayId: string | null;
      config: unknown;
      points: Array<{ binding: unknown }>;
    }>;
    try {
      devices = await this.prisma.device.findMany({
        where: { protocol: 'mqtt' },
        select: {
          id: true,
          tenantId: true,
          gatewayId: true,
          config: true,
          points: { select: { binding: true } },
        },
      });
    } catch (err) {
      this.logger.warn(`Falha ao listar devices MQTT para sync de ACL de raiz: ${(err as Error).message}`);
      return;
    }

    // Só devices em modo raiz com gateway associado.
    const rootDevices = devices
      .map((d) => ({ ...d, root: this.rootTopicOf(d.config) }))
      .filter((d): d is typeof d & { root: string } => !!d.root && !!d.gatewayId);

    if (rootDevices.length === 0) return;

    // 1) ACL do usuário do gateway — agrupa roots por (gateway, tenant).
    const byGateway = new Map<string, { tenantId: string; roots: string[] }>();
    for (const d of rootDevices) {
      const entry = byGateway.get(d.gatewayId as string) ?? { tenantId: d.tenantId, roots: [] };
      entry.roots.push(d.root);
      byGateway.set(d.gatewayId as string, entry);
    }
    let gwOk = 0;
    for (const [gatewayId, { tenantId, roots }] of byGateway) {
      try {
        await this.emqxProvisioning.applyGatewayRootAcl(gatewayId, tenantId, roots);
        gwOk++;
      } catch (err) {
        this.logger.warn(
          `Falha ao reaplicar ACL de raiz do gateway ${gatewayId}: ${(err as Error).message}`,
        );
      }
    }

    // 2) ACL do usuário dedicado de cada device raiz.
    let devOk = 0;
    for (const d of rootDevices) {
      try {
        await this.emqxProvisioning.syncRootDeviceAcl(
          d.id,
          d.root,
          this.commandSubscribeTopics(d.points),
        );
        devOk++;
      } catch (err) {
        this.logger.warn(
          `Falha ao reaplicar ACL do device raiz ${d.id}: ${(err as Error).message}`,
        );
      }
    }
    this.logger.log(
      `ACLs de tópico raiz reaplicadas no boot: ${gwOk}/${byGateway.size} gateway(s), ` +
        `${devOk}/${rootDevices.length} device(s)`,
    );
  }

  /** rootTopic normalizado da config de um device MQTT (null fora do modo raiz). */
  private rootTopicOf(config: unknown): string | null {
    const cfg = (config ?? {}) as MqttDeviceConfigJson;
    const root = cfg.topicMode === 'root' ? (cfg.rootTopic ?? '').trim() : '';
    return root || null;
  }

  /** Tópicos de comando que o usuário dedicado do device precisa ASSINAR. */
  private commandSubscribeTopics(points: Array<{ binding: unknown }>): string[] {
    const topics: string[] = [];
    for (const p of points) {
      const b = (p.binding ?? {}) as { write?: { commandTopic?: string | null } | null };
      const t = b.write?.commandTopic?.trim();
      if (t) topics.push(t);
    }
    return topics;
  }
}
