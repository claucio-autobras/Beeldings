import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EmqxProvisioningService } from './emqx-provisioning.service.js';
import type { CreateSiteDto } from './dtos/create-site.dto.js';
import type { UpdateSiteDto } from './dtos/update-site.dto.js';
import type { Site } from '@prisma/client';

@Injectable()
export class SitesService {
  private readonly logger = new Logger(SitesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emqx: EmqxProvisioningService,
  ) {}

  /**
   * Cria um Site (localidade física) pertencente diretamente ao cliente.
   * Os projetos — e seus gateways — são criados depois, dentro do site.
   */
  async create(dto: CreateSiteDto): Promise<Site> {
    if (!dto.name?.trim()) {
      throw new BadRequestException('name é obrigatório');
    }
    if (!dto.tenantId?.trim()) {
      throw new BadRequestException('tenantId é obrigatório');
    }

    const tenant = await this.prisma.tenant.findUnique({ where: { id: dto.tenantId } });
    if (!tenant) {
      throw new NotFoundException(`Tenant ${dto.tenantId} não encontrado`);
    }

    const location = dto.location?.trim() || null;
    const responsibleName = dto.responsibleName?.trim() || null;

    return this.prisma.site.create({
      data: {
        name: dto.name.trim(),
        tenantId: dto.tenantId,
        location,
        responsibleName,
      },
    });
  }

  async findAll(tenantId: string | undefined): Promise<Site[]> {
    return this.prisma.site.findMany({
      where: tenantId ? { tenantId } : undefined,
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { projects: true } },
      },
    });
  }

  async findOne(id: string, tenantId: string | undefined): Promise<Site> {
    const site = await this.prisma.site.findFirst({
      where: tenantId ? { id, tenantId } : { id },
    });

    if (!site) {
      throw new NotFoundException(`Site ${id} não encontrado`);
    }

    return site;
  }

  async update(id: string, tenantId: string | undefined, dto: UpdateSiteDto): Promise<Site> {
    const site = await this.prisma.site.findFirst({
      where: tenantId ? { id, tenantId } : { id },
    });
    if (!site) throw new NotFoundException(`Site ${id} não encontrado`);

    const data: { name?: string; location?: string | null; responsibleName?: string | null } = {};
    if (dto.name !== undefined) {
      const trimmed = dto.name.trim();
      if (trimmed.length === 0) throw new BadRequestException('name não pode ser vazio');
      data.name = trimmed;
    }
    if (dto.location !== undefined) {
      data.location = dto.location === '' ? null : (dto.location?.trim() ?? null);
    }
    if (dto.responsibleName !== undefined) {
      data.responsibleName = dto.responsibleName === '' ? null : (dto.responsibleName?.trim() ?? null);
    }

    if (Object.keys(data).length === 0) return site;

    return this.prisma.site.update({ where: { id }, data });
  }

  async delete(id: string, tenantId: string | undefined): Promise<void> {
    const site = await this.prisma.site.findFirst({
      where: tenantId ? { id, tenantId } : { id },
    });

    if (!site) throw new NotFoundException(`Site ${id} não encontrado`);

    // Gateways pertencem aos projetos do site — busca antes de deletar para
    // deprovisionar no EMQX.
    const gateways = await this.prisma.gateway.findMany({
      where: { projects: { some: { siteId: id } } },
      select: { id: true, tenantId: true },
    });
    const gatewayIds = gateways.map((g) => g.id);

    await this.prisma.$transaction([
      this.prisma.devicePoint.deleteMany({ where: { device: { siteId: id } } }),
      this.prisma.device.deleteMany({ where: { siteId: id } }),
      this.prisma.project.deleteMany({ where: { siteId: id } }),
      this.prisma.gateway.deleteMany({ where: { id: { in: gatewayIds } } }),
      this.prisma.site.delete({ where: { id } }),
    ]);

    for (const gw of gateways) {
      try {
        await this.emqx.deprovisionGateway(gw.id, gw.tenantId);
      } catch (err) {
        this.logger.warn(`Falha ao remover gateway ${gw.id} do EMQX: ${(err as Error).message}`);
      }
    }
  }
}
