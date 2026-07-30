import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ScadaObjectStorageService } from '../scada/infrastructure/scada-object-storage.service.js';
import { ScadaAssetService } from '../scada/application/scada-asset.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ClusterService } from '../cluster/cluster.service.js';
import { TENANT_STATUS_CHANNEL } from '../mqtt/telemetry.gateway.js';
import { JwtAuthGuard } from '../auth/presentation/guards/jwt-auth.guard.js';
import { SensitiveActionGuard } from '../auth/presentation/guards/sensitive-action.guard.js';
import { CurrentUser } from '../auth/presentation/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../auth/domain/interfaces/auth.interface.js';

interface CreateTenantDto {
  name: string;
  slug: string;
}

@Controller('tenants')
@UseGuards(JwtAuthGuard)
export class TenantsController {
  private readonly logger = new Logger(TenantsController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cluster: ClusterService,
    private readonly scadaStorage: ScadaObjectStorageService,
    private readonly assetService: ScadaAssetService,
  ) {}

  /**
   * GET /tenants
   * Admin/CCO/Supervisor: retorna todos os tenants.
   * Cliente/Visualizador: retorna apenas o próprio tenant.
   */
  @Get('/')
  async getTenants(@CurrentUser() user: AuthenticatedUser) {
    const isGlobal = user.role === 'ADMIN' || user.role === 'CCO' || user.role === 'SUPERVISOR';

    if (isGlobal) {
      const tenants = await this.prisma.tenant.findMany({
        orderBy: { name: 'asc' },
        include: {
          _count: { select: { sites: true, devices: true } },
        },
      });
      return tenants.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        active: t.active,
        logoUrl: t.logoUrl,
        accentColor: t.accentColor,
        siteCount: t._count.sites,
        deviceCount: t._count.devices,
        createdAt: t.createdAt.toISOString(),
      }));
    }

    // Cliente: retorna só o próprio tenant
    if (!user.tenantId) return [];

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: user.tenantId },
      include: {
        _count: { select: { sites: true, devices: true } },
      },
    });

    if (!tenant) return [];

    return [{
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      active: tenant.active,
      logoUrl: tenant.logoUrl,
      accentColor: tenant.accentColor,
      siteCount: tenant._count.sites,
      deviceCount: tenant._count.devices,
      createdAt: tenant.createdAt.toISOString(),
    }];
  }

  /**
   * GET /tenants/:id
   */
  @Get(':id')
  async getTenant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    const isGlobal = user.role === 'ADMIN' || user.role === 'CCO' || user.role === 'SUPERVISOR';

    if (!isGlobal && user.tenantId !== id) {
      throw new BadRequestException('Acesso negado');
    }

    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        sites: { include: { projects: { include: { gateway: true } } } },
        _count: { select: { sites: true, devices: true } },
      },
    });

    if (!tenant) throw new BadRequestException('Tenant não encontrado');

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      active: tenant.active,
      logoUrl: tenant.logoUrl,
      accentColor: tenant.accentColor,
      autoTrendEnabled: tenant.autoTrendEnabled,
      siteCount: tenant._count.sites,
      deviceCount: tenant._count.devices,
      sites: tenant.sites,
      createdAt: tenant.createdAt.toISOString(),
    };
  }

  /**
   * PATCH /tenants/:id/status — ativa/inativa um cliente. Apenas ADMIN.
   * Ao inativar: publica no barramento do cluster para TODAS as instâncias
   * derrubarem os sockets do tenant e invalidarem o cache de status. Logins e
   * requisições autenticadas passam a ser recusados (login/JwtStrategy) e as
   * notificações de alarme são silenciadas — o histórico continua sendo gravado.
   */
  @Patch(':id/status')
  async setTenantStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { active?: boolean },
  ) {
    if (user.role !== 'ADMIN') {
      throw new BadRequestException('Apenas administradores podem alterar o status de clientes');
    }
    if (typeof body?.active !== 'boolean') {
      throw new BadRequestException('Informe o campo "active" (true/false)');
    }

    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Cliente não encontrado');

    const updated = await this.prisma.tenant.update({
      where: { id },
      data: { active: body.active },
      include: { _count: { select: { sites: true, devices: true } } },
    });

    // Notifica todas as instâncias (sockets são por instância) — fire-and-forget:
    // mesmo sem o aviso, o cache local expira em segundos e o JWT guard já bloqueia.
    try {
      await this.cluster.publish(
        TENANT_STATUS_CHANNEL,
        JSON.stringify({ tenantId: id, active: body.active }),
      );
    } catch {
      // Barramento indisponível: o TTL do cache garante a convergência.
    }

    return {
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      active: updated.active,
      siteCount: updated._count.sites,
      deviceCount: updated._count.devices,
      createdAt: updated.createdAt.toISOString(),
    };
  }

  /**
   * PATCH /tenants/:id/auto-trend — liga/desliga a cobertura automática de
   * trends (historização padrão em novos pontos). Apenas ADMIN. Não mexe nas
   * trends já criadas; afeta somente cadastros/syncs futuros.
   */
  @Patch(':id/auto-trend')
  async setAutoTrend(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { enabled?: boolean },
  ) {
    if (user.role !== 'ADMIN') {
      throw new BadRequestException('Apenas administradores podem alterar esta configuração');
    }
    if (typeof body?.enabled !== 'boolean') {
      throw new BadRequestException('Informe o campo "enabled" (true/false)');
    }
    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Cliente não encontrado');
    const updated = await this.prisma.tenant.update({
      where: { id },
      data: { autoTrendEnabled: body.enabled },
    });
    return { id: updated.id, autoTrendEnabled: updated.autoTrendEnabled };
  }

  /**
   * PATCH /tenants/:id/branding — identidade visual do cliente (topbar).
   * Apenas ADMIN. Aceita:
   *  - name: novo nome do cliente (trim, não vazio; slug NUNCA muda)
   *  - logoDataUrl: data URL base64 de imagem (troca o logo) | null (remove)
   *  - accentColor: '#rrggbb' | null (remove)
   * Campos omitidos não são alterados. O logo vai para o App Storage via o
   * mesmo pipeline dos assets SCADA (URL relativa estável, pública por UUID).
   */
  @Patch(':id/branding')
  async setTenantBranding(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() body: { name?: string; logoDataUrl?: string | null; accentColor?: string | null },
  ) {
    if (user.role !== 'ADMIN') {
      throw new BadRequestException('Apenas administradores podem alterar a identidade do cliente');
    }

    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Cliente não encontrado');

    const data: { name?: string; logoUrl?: string | null; accentColor?: string | null } = {};

    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        throw new BadRequestException('Nome do cliente não pode ser vazio');
      }
      data.name = body.name.trim();
    }

    if (body.accentColor !== undefined) {
      if (body.accentColor === null || body.accentColor === '') {
        data.accentColor = null;
      } else if (/^#[0-9a-fA-F]{6}$/.test(body.accentColor)) {
        data.accentColor = body.accentColor.toLowerCase();
      } else {
        throw new BadRequestException('Cor de destaque inválida: use o formato #rrggbb');
      }
    }

    let oldLogoToDelete: string | null = null;
    if (body.logoDataUrl !== undefined) {
      if (body.logoDataUrl === null || body.logoDataUrl === '') {
        data.logoUrl = null;
        oldLogoToDelete = tenant.logoUrl;
      } else {
        const saved = await this.assetService.saveDataUrl(id, body.logoDataUrl);
        data.logoUrl = saved.url;
        oldLogoToDelete = tenant.logoUrl;
      }
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Informe name, logoDataUrl e/ou accentColor');
    }

    const updated = await this.prisma.tenant.update({ where: { id }, data });

    // Limpeza best-effort do logo antigo no App Storage (nunca bloqueia).
    if (oldLogoToDelete && oldLogoToDelete !== updated.logoUrl) {
      const match = /^\/scada-assets\/([a-zA-Z0-9_-]+)\/([a-zA-Z0-9_.-]+)$/.exec(oldLogoToDelete);
      if (match) {
        try {
          const resolved = await this.scadaStorage.getForRead(`${match[1]}/${match[2]}`);
          await resolved.file.delete({ ignoreNotFound: true });
        } catch {
          // Objeto já inexistente ou bucket indisponível — ignorado.
        }
      }
    }

    return {
      id: updated.id,
      name: updated.name,
      logoUrl: updated.logoUrl,
      accentColor: updated.accentColor,
    };
  }

  /**
   * POST /tenants
   * Apenas ADMIN pode criar novos tenants.
   */
  @Post('/')
  async createTenant(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: CreateTenantDto,
  ) {
    if (user.role !== 'ADMIN') {
      throw new BadRequestException('Apenas administradores podem criar clientes');
    }

    if (!body.name?.trim()) throw new BadRequestException('name é obrigatório');
    if (!body.slug?.trim()) throw new BadRequestException('slug é obrigatório');

    const slug = body.slug
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');

    const existing = await this.prisma.tenant.findUnique({ where: { slug } });
    if (existing) throw new BadRequestException('Já existe um cliente com este slug');

    const tenant = await this.prisma.tenant.create({
      data: { name: body.name.trim(), slug },
    });

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      siteCount: 0,
      deviceCount: 0,
      createdAt: tenant.createdAt.toISOString(),
    };
  }

  /**
   * DELETE /tenants/:id
   * Apenas ADMIN pode excluir tenants.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SensitiveActionGuard)
  async deleteTenant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    if (user.role !== 'ADMIN') {
      throw new BadRequestException('Apenas administradores podem excluir clientes');
    }

    const tenant = await this.prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw new NotFoundException('Cliente não encontrado');

    try {
      await this.prisma.$transaction([
        // 1. device_points (CASCADE via device, but explicit for safety).
        //    alarm_rules/alarm_events e trends cascateiam a partir do ponto.
        this.prisma.devicePoint.deleteMany({ where: { device: { tenantId: id } } }),
        // 2. telas SCADA (referenciam tenant diretamente — sem cascade no banco)
        this.prisma.scadaScreen.deleteMany({ where: { tenantId: id } }),
        // 3. grupos de alarme (referenciam tenant diretamente; membros cascateiam)
        this.prisma.alarmGroup.deleteMany({ where: { tenantId: id } }),
        // 4. devices (reference tenant, site, gateway)
        this.prisma.device.deleteMany({ where: { tenantId: id } }),
        // 5. gateways (reference project; must delete before projects)
        this.prisma.gateway.deleteMany({ where: { tenantId: id } }),
        // 6. projects (reference site and tenant; must delete before sites)
        this.prisma.project.deleteMany({ where: { tenantId: id } }),
        // 7. sites (reference tenant; must delete before tenant)
        this.prisma.site.deleteMany({ where: { tenantId: id } }),
        // 8. users: remove apenas usuários "de tenant" (CLIENTE/VISUALIZADOR).
        //    Usuários globais (ADMIN/CCO/SUPERVISOR) NUNCA são excluídos —
        //    apenas desvinculados, para não apagar a própria conta do admin.
        this.prisma.user.deleteMany({
          where: { tenantId: id, role: { in: ['CLIENTE', 'VISUALIZADOR'] } },
        }),
        this.prisma.user.updateMany({
          where: { tenantId: id },
          data: { tenantId: null },
        }),
        // 9. tenant (AiConversation.tenantId é SetNull no banco — não bloqueia)
        this.prisma.tenant.delete({ where: { id } }),
      ]);
    } catch (err) {
      // P2003 = violação de FK: algum registro ainda aponta para o cliente.
      // Retorna erro claro em vez de "Internal server error".
      if ((err as { code?: string })?.code === 'P2003') {
        throw new ConflictException(
          'Não foi possível excluir o cliente: ainda existem dados vinculados a ele. ' +
            'Contate o suporte informando o cliente e o horário da tentativa.',
        );
      }
      throw err;
    }

    // Limpeza best-effort das imagens SCADA no App Storage (scada/<tenantId>/).
    // Nunca bloqueia a exclusão: se o bucket falhar, apenas loga o aviso.
    try {
      const deleted = await this.scadaStorage.deletePrefix(id);
      if (deleted > 0) {
        this.logger.log(
          `Removidos ${deleted} asset(s) SCADA do cliente ${id} no App Storage`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Falha ao limpar assets SCADA do cliente ${id} no App Storage (ignorado): ${
          (err as Error)?.message ?? err
        }`,
      );
    }
  }
}
