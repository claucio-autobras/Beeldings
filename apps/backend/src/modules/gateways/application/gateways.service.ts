import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EmqxProvisioningService } from '../../sites/application/emqx-provisioning.service.js';
import { DeviceStatusService } from '../../mqtt/device-status.service.js';
import { GatewayHealthService } from '../../mqtt/gateway-health.service.js';
import type { GatewayHealthSummary } from '../../mqtt/gateway-health.service.js';
import { GatewayOtaService } from '../../mqtt/gateway-ota.service.js';
import type { GatewayOtaProgress } from '../../mqtt/gateway-ota.service.js';
import { MqttService } from '../../mqtt/mqtt.service.js';
import { GatewayPackageService } from './gateway-package.service.js';
import type { Gateway } from '@prisma/client';
import { randomUUID } from 'node:crypto';

/** Gateway enriquecido com saúde, versão e estado da atualização remota (OTA). */
export type GatewayWithHealth = Gateway & {
  health: GatewayHealthSummary | null;
  /** Versão do código do gateway disponível no servidor. */
  latestVersion: string;
  /** True quando o gateway roda sob o launcher OTA (reportado no health). */
  otaSupported: boolean;
  /** Progresso da OTA em andamento (em memória; null quando não há). */
  ota: GatewayOtaProgress | null;
};

@Injectable()
export class GatewaysService {
  private readonly logger = new Logger(GatewaysService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emqx: EmqxProvisioningService,
    private readonly deviceStatus: DeviceStatusService,
    private readonly gatewayHealth: GatewayHealthService,
    private readonly gatewayOta: GatewayOtaService,
    private readonly mqtt: MqttService,
    private readonly packages: GatewayPackageService,
  ) {}

  /**
   * Aplica o status/lastSeen AO VIVO (telemetria) — fonte única do sistema — e
   * anexa o último resumo de saúde recebido (fila offline, reconexões MQTT,
   * latência de polling). O resumo é aditivo: null quando ainda não chegou.
   */
  private withLiveStatus(gateway: Gateway): GatewayWithHealth {
    const liveSeen = this.deviceStatus.getLastSeen(gateway.id);
    const health = this.gatewayHealth.get(gateway.id);
    return {
      ...gateway,
      status: this.deviceStatus.getStatus(gateway.id),
      lastSeen: liveSeen ? new Date(liveSeen) : gateway.lastSeen,
      health,
      // Versão ao vivo (health) tem prioridade; a persistida cobre restart.
      reportedVersion: health?.version ?? gateway.reportedVersion,
      latestVersion: this.packages.getLatestVersion(),
      otaSupported: health?.otaSupported === true,
      ota: this.gatewayOta.get(gateway.id),
    };
  }

  /**
   * Dispara a atualização remota (OTA) de um gateway: prepara o pacote com o
   * código atual do servidor (token de download de uso único) e publica o
   * comando no tópico de comandos que o gateway já assina.
   */
  async triggerUpdate(
    id: string,
    tenantId: string | undefined,
    baseUrl: string,
  ): Promise<{ version: string }> {
    const gateway = await this.prisma.gateway.findFirst({
      where: tenantId ? { id, tenantId } : { id },
    });
    if (!gateway) throw new NotFoundException(`Gateway ${id} não encontrado`);

    if (this.deviceStatus.getStatus(gateway.id) !== 'online') {
      throw new ConflictException(
        'Gateway offline — ele precisa estar conectado para receber a atualização.',
      );
    }

    const health = this.gatewayHealth.get(gateway.id);
    if (health?.otaSupported !== true) {
      throw new ConflictException(
        'Este gateway não suporta atualização remota. É preciso uma última reinstalação manual (baixe o pacote atualizado) para habilitar a OTA.',
      );
    }

    // Bloqueia só enquanto há progresso genuinamente em andamento; o próprio
    // serviço de OTA expira estágios intermediários abandonados (>15 min),
    // liberando a nova tentativa imediatamente.
    if (this.gatewayOta.isInProgress(gateway.id)) {
      throw new ConflictException('Já existe uma atualização em andamento para este gateway.');
    }

    try {
      const parsed = new URL(baseUrl);
      if (!parsed.hostname) throw new Error('host ausente');
    } catch {
      throw new BadRequestException(
        `URL base do backend inválida ("${baseUrl}") — a atualização não foi enviada ao gateway. Configure BACKEND_PUBLIC_URL com uma URL completa (ex.: https://meu-backend.com).`,
      );
    }

    const { token, sha256, version } = this.packages.prepareUpdatePackage(gateway.id);
    const url = `${baseUrl}/gateways/update-package?token=${token}`;
    this.logger.log(
      `OTA: disparando atualização v${version} para gateway ${gateway.id} via ${baseUrl}/gateways/update-package (token omitido)`,
    );

    const commandTopic = `bluebee/${gateway.tenantId}/gateway/${gateway.id}/commands`;
    await this.mqtt.publish(commandTopic, {
      command_id: randomUUID(),
      tenant_id: gateway.tenantId,
      device_id: gateway.id,
      gateway_id: gateway.id,
      protocol: 'system',
      action: 'ota_update',
      params: { version, checksum: sha256, url },
    });

    return { version };
  }

  /**
   * Cancela/limpa uma atualização OTA travada (ação explícita do operador).
   * Marca o estado terminal e libera o guard de novo disparo.
   */
  async cancelUpdate(id: string, tenantId: string | undefined): Promise<void> {
    const gateway = await this.prisma.gateway.findFirst({
      where: tenantId ? { id, tenantId } : { id },
    });
    if (!gateway) throw new NotFoundException(`Gateway ${id} não encontrado`);

    const cancelled = await this.gatewayOta.cancel(gateway.id);
    if (!cancelled) {
      throw new ConflictException('Não há atualização em andamento para cancelar neste gateway.');
    }
    this.logger.warn(`OTA do gateway ${gateway.id} cancelada manualmente pelo operador`);
  }

  /**
   * Enriquece as entradas de polling do resumo de saúde com o NOME do device,
   * consultado do cadastro (tabela Device) em LOTE — uma única query para o
   * conjunto de deviceIds (evita N+1). Aditivo: mantém o deviceId; deviceName
   * fica undefined quando o device não está no cadastro. Não muta o resumo em
   * memória (cria novos objetos), preservando o cache do GatewayHealthService.
   */
  private async attachDeviceNames(
    gateways: GatewayWithHealth[],
    tenantId: string | undefined,
  ): Promise<GatewayWithHealth[]> {
    const deviceIds = new Set<string>();
    for (const g of gateways) {
      for (const p of g.health?.polling ?? []) deviceIds.add(p.deviceId);
    }
    if (deviceIds.size === 0) return gateways;

    const devices = await this.prisma.device.findMany({
      where: {
        id: { in: [...deviceIds] },
        ...(tenantId ? { tenantId } : {}),
      },
      select: { id: true, name: true },
    });
    const nameById = new Map(devices.map((d) => [d.id, d.name]));

    return gateways.map((g) =>
      g.health
        ? {
            ...g,
            health: {
              ...g.health,
              // Filtra "fantasmas": entradas de devices que não existem mais no
              // cadastro (ex.: gateway antigo que ainda publica métricas de
              // devices apagados). Nunca repassa ID cru ao frontend.
              polling: g.health.polling
                .filter((p) => nameById.has(p.deviceId))
                .map((p) => ({
                  ...p,
                  deviceName: nameById.get(p.deviceId),
                })),
            },
          }
        : g,
    );
  }

  async findAll(tenantId: string | undefined): Promise<GatewayWithHealth[]> {
    const gateways = await this.prisma.gateway.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { createdAt: 'asc' },
    });
    return this.attachDeviceNames(
      gateways.map((g) => this.withLiveStatus(g)),
      tenantId,
    );
  }

  async findOne(id: string, tenantId: string | undefined): Promise<GatewayWithHealth> {
    const gateway = await this.prisma.gateway.findFirst({
      where: tenantId ? { id, tenantId } : { id },
    });

    if (!gateway) {
      throw new NotFoundException(`Gateway ${id} não encontrado`);
    }

    const [enriched] = await this.attachDeviceNames(
      [this.withLiveStatus(gateway)],
      tenantId,
    );
    return enriched;
  }

  async delete(id: string, tenantId: string | undefined): Promise<void> {
    const gateway = await this.prisma.gateway.findFirst({
      where: tenantId ? { id, tenantId } : { id },
    });

    if (!gateway) throw new NotFoundException(`Gateway ${id} não encontrado`);

    await this.prisma.gateway.delete({ where: { id } });

    // De-provisiona no broker (usuários/ACL) e limpa as retained messages do
    // gateway (status/health/config). Best-effort: falha no EMQX não desfaz a
    // exclusão no banco — só é logada.
    try {
      await this.emqx.deprovisionGateway(gateway.id, gateway.tenantId);
    } catch (err) {
      this.logger.warn(
        `Falha ao deprovisionar gateway ${gateway.id} no EMQX: ${(err as Error).message}`,
      );
    }
  }

  async reprovision(id: string, tenantId: string | undefined): Promise<void> {
    const gateway = await this.prisma.gateway.findFirst({
      where: tenantId ? { id, tenantId } : { id },
    });

    if (!gateway) throw new NotFoundException(`Gateway ${id} não encontrado`);

    await this.emqx.provisionGateway(gateway.id, gateway.mqttPass, gateway.tenantId);
  }

  /**
   * Resumo leve para o badge do menu: conta gateways ONLINE com versão
   * reportada menor que a versão mais recente disponível no servidor.
   * Gateways offline ou sem versão reportada NÃO são contados.
   */
  async getUpdateSummary(tenantId: string | undefined): Promise<{ updatable: number }> {
    const gateways = await this.prisma.gateway.findMany({
      where: tenantId ? { tenantId } : undefined,
      select: { id: true, reportedVersion: true },
    });

    const latestVersion = this.packages.getLatestVersion();

    let updatable = 0;
    for (const gw of gateways) {
      if (this.deviceStatus.getStatus(gw.id) !== 'online') continue;
      const reported = this.gatewayHealth.get(gw.id)?.version ?? gw.reportedVersion;
      if (!reported || !latestVersion) continue;
      const pa = reported.split('.').map((n) => parseInt(n, 10) || 0);
      const pb = latestVersion.split('.').map((n) => parseInt(n, 10) || 0);
      let outdated = false;
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pb[i] ?? 0) - (pa[i] ?? 0);
        if (d > 0) { outdated = true; break; }
        if (d < 0) break;
      }
      if (outdated) updatable++;
    }

    return { updatable };
  }
}
