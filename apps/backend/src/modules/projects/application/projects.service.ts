import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EmqxProvisioningService } from '../../sites/application/emqx-provisioning.service.js';
import { DeviceStatusService } from '../../mqtt/device-status.service.js';
import { EXCLUDE_VIRTUAL_DEVICES } from '../../prisma/device-filters.js';
import type { CreateProjectDto } from './dtos/create-project.dto.js';
import type { UpdateProjectDto } from './dtos/update-project.dto.js';
import type { Project, Gateway } from '@prisma/client';

export interface ProjectWithGateway extends Project {
  gateway: Gateway;
}

export interface GatewayConfigEnv {
  gatewayId: string;
  tenantId: string;
  mqttUser: string;
  mqttPass: string;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emqx: EmqxProvisioningService,
    private readonly deviceStatus: DeviceStatusService,
  ) {}

  /**
   * Sobrescreve status/lastSeen do gateway com o valor AO VIVO (telemetria),
   * fonte única usada em todo o sistema — evita inconsistência com o status
   * persistido no banco, que não reflete a comunicação real.
   */
  private withGatewayLiveStatus<T extends { id: string; lastSeen?: Date | null }>(
    gateway: T,
  ): T & { status: string; lastSeen: Date | null } {
    const liveSeen = this.deviceStatus.getLastSeen(gateway.id);
    return {
      ...gateway,
      status: this.deviceStatus.getStatus(gateway.id),
      lastSeen: liveSeen ? new Date(liveSeen) : (gateway.lastSeen ?? null),
    };
  }

  /**
   * Cria um Projeto dentro de um Site. O gateway pode ser:
   *  - existente (dto.gatewayId): vincula a um gateway do mesmo cliente (tenant),
   *    sem provisionar nada — permite compartilhar um gateway físico entre
   *    projetos de sites diferentes (ex.: torres que usam um rack central);
   *  - novo (padrão): provisiona um gateway dedicado com credenciais MQTT.
   */
  async create(dto: CreateProjectDto): Promise<ProjectWithGateway> {
    if (!dto.name?.trim()) {
      throw new BadRequestException('name é obrigatório');
    }
    if (!dto.siteId?.trim()) {
      throw new BadRequestException('siteId é obrigatório');
    }
    if (!dto.tenantId?.trim()) {
      throw new BadRequestException('tenantId é obrigatório');
    }

    const site = await this.prisma.site.findFirst({
      where: { id: dto.siteId, tenantId: dto.tenantId },
    });

    if (!site) {
      throw new NotFoundException(`Site ${dto.siteId} não encontrado`);
    }

    // Caminho 1 — vincular a gateway existente do mesmo cliente.
    if (dto.gatewayId?.trim()) {
      return this.createLinkedToExistingGateway(dto, dto.gatewayId.trim());
    }

    // Caminho 2 — provisionar um gateway novo dedicado.
    const suffix = randomBytes(4).toString('hex');
    const gatewayId = `gw-${slugify(site.name)}-${slugify(dto.name)}-${suffix}`;
    const mqttPass = randomBytes(16).toString('hex');

    const gateway = await this.prisma.gateway.create({
      data: {
        id: gatewayId,
        mqttUser: gatewayId,
        mqttPass,
        status: 'offline',
        tenantId: dto.tenantId,
      },
    });

    const project = await this.prisma.project.create({
      data: {
        name: dto.name.trim(),
        siteId: dto.siteId,
        tenantId: dto.tenantId,
        gatewayId: gateway.id,
      },
    });

    // Provisiona o gateway no EMQX (usuário MQTT + ACL por tenant).
    // Falha não bloqueia a criação — é possível reprovisionar manualmente.
    try {
      await this.emqx.provisionGateway(gatewayId, mqttPass, dto.tenantId);
    } catch (err) {
      this.logger.error(
        `Falha ao provisionar gateway ${gatewayId} no EMQX: ${(err as Error).message}. ` +
        'O projeto foi criado mas o gateway não tem credenciais MQTT ativas.',
      );
    }

    return { ...project, gateway };
  }

  /**
   * Cria um projeto vinculado a um gateway já existente do mesmo cliente.
   * O gateway pode estar em qualquer site do tenant — um gateway físico pode
   * atender vários sites (ex.: torres que compartilham um rack central). A única
   * exigência é pertencer ao mesmo cliente, garantindo o isolamento multi-tenant.
   */
  private async createLinkedToExistingGateway(
    dto: CreateProjectDto,
    gatewayId: string,
  ): Promise<ProjectWithGateway> {
    const gateway = await this.prisma.gateway.findFirst({
      where: { id: gatewayId, tenantId: dto.tenantId },
    });

    if (!gateway) {
      throw new NotFoundException(`Gateway ${gatewayId} não encontrado para este cliente`);
    }

    const project = await this.prisma.project.create({
      data: {
        name: dto.name.trim(),
        siteId: dto.siteId,
        tenantId: dto.tenantId,
        gatewayId: gateway.id,
      },
    });

    return { ...project, gateway };
  }

  async findAll(siteId: string | undefined, tenantId: string | undefined): Promise<Project[]> {
    const projects = await this.prisma.project.findMany({
      where: {
        ...(siteId ? { siteId } : {}),
        ...(tenantId ? { tenantId } : {}),
      },
      orderBy: { name: 'asc' },
      include: {
        gateway: {
          select: {
            id: true,
            status: true,
            lastSeen: true,
          },
        },
      },
    });

    // Compute device counts scoped to each project's own site (not the full
    // gateway count) — a gateway can be shared across sites, so raw
    // gateway._count.devices would include devices belonging to other sites.
    // Also exclude virtual/bancada devices consistent with the detail page.
    const gatewayIds = projects.map((p) => p.gatewayId).filter(Boolean) as string[];
    const siteIds = projects.map((p) => p.siteId).filter(Boolean) as string[];

    let deviceCountMap = new Map<string, Map<string, number>>(); // gatewayId → siteId → count
    if (gatewayIds.length > 0) {
      const rows = await this.prisma.device.groupBy({
        by: ['gatewayId', 'siteId'],
        where: {
          gatewayId: { in: gatewayIds },
          siteId: { in: siteIds },
          ...EXCLUDE_VIRTUAL_DEVICES,
        },
        _count: { id: true },
      });
      for (const row of rows) {
        if (!row.gatewayId || !row.siteId) continue;
        if (!deviceCountMap.has(row.gatewayId)) {
          deviceCountMap.set(row.gatewayId, new Map());
        }
        deviceCountMap.get(row.gatewayId)!.set(row.siteId, row._count.id);
      }
    }

    return projects.map((p) => {
      if (!p.gateway) return p;
      const count = deviceCountMap.get(p.gatewayId!)?.get(p.siteId) ?? 0;
      const gatewayWithCount = {
        ...p.gateway,
        _count: { devices: count },
      };
      return { ...p, gateway: this.withGatewayLiveStatus(gatewayWithCount) };
    });
  }

  async findOne(id: string, tenantId: string | undefined): Promise<Project> {
    const project = await this.prisma.project.findFirst({
      where: tenantId ? { id, tenantId } : { id },
      include: {
        gateway: true,
        site: { select: { id: true, name: true } },
      },
    });

    if (!project) {
      throw new NotFoundException(`Project ${id} não encontrado`);
    }

    if (project.gateway) {
      project.gateway = this.withGatewayLiveStatus(project.gateway);
    }
    return project;
  }

  /** Atualiza dados editáveis do projeto (apenas o nome — endereço/contato vivem no Site). */
  async update(
    id: string,
    tenantId: string | undefined,
    dto: UpdateProjectDto,
  ): Promise<Project> {
    const project = await this.prisma.project.findFirst({
      where: tenantId ? { id, tenantId } : { id },
      select: { id: true },
    });
    if (!project) throw new NotFoundException(`Project ${id} não encontrado`);

    if (dto.name !== undefined && !dto.name.trim()) {
      throw new BadRequestException('name não pode ser vazio');
    }

    return this.prisma.project.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      },
    });
  }

  /**
   * Dados do gateway usados pelo Guia de Integração MQTT (PDF): mesmos valores
   * que alimentam o gateway-config.env + credencial de sensores (usuário
   * -sensors, senha NUNCA exposta — só o fato de existir) e nomes de exibição.
   */
  async getMqttGuideData(
    projectId: string,
    tenantId: string | undefined,
  ): Promise<{
    projectName: string;
    siteName: string | null;
    tenantId: string;
    gatewayId: string;
    sensorMqttUser: string;
    credentialProvisioned: boolean;
  }> {
    const project = await this.prisma.project.findFirst({
      where: tenantId ? { id: projectId, tenantId } : { id: projectId },
      include: { gateway: true, site: true },
    });

    if (!project?.gateway) {
      throw new NotFoundException(`Gateway para o projeto ${projectId} não encontrado`);
    }

    const { gateway } = project;
    return {
      projectName: project.name,
      siteName: project.site?.name ?? null,
      tenantId: gateway.tenantId,
      gatewayId: gateway.id,
      // Antes do primeiro provisionamento o usuário ainda não existe no banco,
      // mas o nome é determinístico ({gatewayId}-sensors) — imprime o real.
      sensorMqttUser: gateway.sensorMqttUser ?? `${gateway.id}-sensors`,
      credentialProvisioned: Boolean(gateway.sensorMqttUser && gateway.sensorMqttPass),
    };
  }

  async getGatewayConfig(projectId: string, tenantId: string | undefined): Promise<GatewayConfigEnv> {
    const project = await this.prisma.project.findFirst({
      where: tenantId ? { id: projectId, tenantId } : { id: projectId },
      include: { gateway: true },
    });

    if (!project?.gateway) {
      throw new NotFoundException(`Gateway para o projeto ${projectId} não encontrado`);
    }

    const { gateway } = project;

    return {
      gatewayId: gateway.id,
      tenantId: gateway.tenantId,
      mqttUser: gateway.mqttUser,
      mqttPass: gateway.mqttPass,
    };
  }

  /**
   * Exclui um projeto. Como o gateway pode ser compartilhado por vários projetos,
   * apenas DESVINCULA por padrão; o gateway (e seus dispositivos) só é apagado e
   * desprovisionado do EMQX quando este era o ÚLTIMO projeto a usá-lo.
   */
  async delete(id: string, tenantId: string | undefined): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: tenantId ? { id, tenantId } : { id },
    });

    if (!project) throw new NotFoundException(`Project ${id} não encontrado`);

    const gatewayId = project.gatewayId;

    // Outros projetos ainda usam este gateway?
    const sharedWithOthers = gatewayId
      ? (await this.prisma.project.count({
          where: { gatewayId, id: { not: id } },
        })) > 0
      : false;

    if (!gatewayId || sharedWithOthers) {
      // Gateway compartilhado (ou projeto sem gateway): apenas remove o projeto.
      await this.prisma.project.delete({ where: { id } });
      return;
    }

    // Último projeto do gateway: remove projeto + gateway + dispositivos.
    await this.prisma.$transaction([
      this.prisma.devicePoint.deleteMany({ where: { device: { gatewayId } } }),
      this.prisma.device.deleteMany({ where: { gatewayId } }),
      this.prisma.project.delete({ where: { id } }),
      this.prisma.gateway.delete({ where: { id: gatewayId } }),
    ]);

    try {
      await this.emqx.deprovisionGateway(gatewayId);
    } catch (err) {
      this.logger.warn(`Falha ao remover gateway ${gatewayId} do EMQX: ${(err as Error).message}`);
    }
  }
}
