import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { GatewaysService } from '../application/gateways.service.js';
import type { GatewayWithHealth } from '../application/gateways.service.js';
import { GatewayPackageService } from '../application/gateway-package.service.js';
import { JwtAuthGuard } from '../../auth/presentation/guards/jwt-auth.guard.js';
import { SensitiveActionGuard } from '../../auth/presentation/guards/sensitive-action.guard.js';
import { CurrentUser } from '../../auth/presentation/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/domain/interfaces/auth.interface.js';
import { resolveTenantScope } from '../../auth/presentation/tenant-scope.util.js';

@Controller('gateways')
@UseGuards(JwtAuthGuard)
export class GatewaysController {
  constructor(
    private readonly gatewaysService: GatewaysService,
    private readonly packages: GatewayPackageService,
  ) {}

  @Get('/')
  async findAll(
    @Query('tenantId') queryTenantId: string | undefined,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<GatewayWithHealth[]> {
    // Globais: podem filtrar por tenant (ou ver todos). Demais: travados no próprio.
    const tenantId = resolveTenantScope(user, queryTenantId);
    return this.gatewaysService.findAll(tenantId);
  }

  /**
   * Monta sob demanda o pacote .zip do agente de gateway (código-fonte +
   * scripts de instalação como serviço + launcher OTA + guia INSTALL.md) para
   * o SO escolhido. O cliente extrai, roda `npm install`, `npm run build` e
   * instala o serviço.
   *
   * Precisa vir ANTES de `@Get('/:id')` para a rota estática não ser capturada
   * como se "agent-package" fosse um id.
   */
  @Get('/agent-package')
  async downloadAgentPackage(
    @Query('os') os: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const target =
      os === 'windows' ? 'windows' : os === 'linux' ? 'linux' : null;
    if (!target) {
      throw new BadRequestException(
        'Parâmetro "os" inválido. Use os=linux ou os=windows.',
      );
    }

    let buffer: Buffer;
    try {
      buffer = this.packages.buildAgentZip(target);
    } catch {
      throw new NotFoundException(
        'Código-fonte do gateway não encontrado no servidor.',
      );
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="bluebee-gateway-agent-${target}.zip"`,
    );
    res.setHeader('Content-Length', buffer.length.toString());
    res.end(buffer);
  }

  @Get('/:id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<GatewayWithHealth> {
    const tenantId = resolveTenantScope(user);
    return this.gatewaysService.findOne(id, tenantId);
  }

  @Delete('/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(SensitiveActionGuard)
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    if (user.role !== 'ADMIN' && user.role !== 'CCO') {
      throw new BadRequestException('Sem permissão para excluir gateways');
    }
    const tenantId = resolveTenantScope(user);
    return this.gatewaysService.delete(id, tenantId);
  }

  @Post('/:id/reprovision')
  @HttpCode(HttpStatus.NO_CONTENT)
  async reprovision(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    if (user.role !== 'ADMIN' && user.role !== 'CCO') {
      throw new BadRequestException('Sem permissão para reprovisionar gateways');
    }
    const tenantId = resolveTenantScope(user);
    return this.gatewaysService.reprovision(id, tenantId);
  }

  /**
   * Dispara a atualização remota (OTA) do gateway: prepara o pacote com a
   * versão atual do código no servidor e envia o comando via MQTT. O progresso
   * chega pelo tópico .../ota e aparece em GET /gateways (campo `ota`).
   */
  @Post('/:id/update')
  @HttpCode(HttpStatus.ACCEPTED)
  async triggerUpdate(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Req() req: Request,
  ): Promise<{ version: string }> {
    if (user.role !== 'ADMIN' && user.role !== 'CCO') {
      throw new BadRequestException('Sem permissão para atualizar gateways');
    }
    const tenantId = resolveTenantScope(user);
    return this.gatewaysService.triggerUpdate(id, tenantId, this.resolveBaseUrl(req));
  }

  /**
   * URL base pública do backend, usada pelo gateway para baixar o pacote OTA.
   * Prioriza BACKEND_PUBLIC_URL; senão deriva dos headers do próprio request
   * (o gateway alcança o backend pelo mesmo host que o navegador usou).
   *
   * IMPORTANTE: quando derivamos dos headers, o host público é o do FRONTEND
   * (Next.js) — o backend só é alcançável de fora através do proxy `/api/...`
   * do Next (rewrite para localhost:4000). Por isso o caminho `/api` é
   * anexado à base derivada. Sem ele, o download cai no Next, que redireciona
   * para /login com Location relativo — e o gateway falha com "Invalid URL".
   */
  private resolveBaseUrl(req: Request): string {
    const configured = process.env.BACKEND_PUBLIC_URL?.trim();
    let candidate: string;
    if (configured) {
      // Prefixa https:// quando a env veio sem protocolo (ex.: "meu-host.com").
      candidate = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
    } else {
      const proto =
        (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() ||
        req.protocol ||
        'https';
      const host =
        (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim() ||
        req.headers.host ||
        '';
      if (!host) {
        throw new BadRequestException(
          'Não foi possível determinar a URL pública do backend (host ausente no request). Configure BACKEND_PUBLIC_URL com uma URL completa (ex.: https://meu-backend.com) e tente novamente.',
        );
      }
      candidate = `${proto}://${host}/api`;
    }
    candidate = candidate.replace(/\/+$/, '');

    let parsed: URL;
    try {
      parsed = new URL(candidate);
    } catch {
      throw new BadRequestException(
        `URL base do backend inválida ("${candidate}"). Configure BACKEND_PUBLIC_URL com uma URL completa (ex.: https://meu-backend.com) e tente novamente.`,
      );
    }
    if (!parsed.hostname) {
      throw new BadRequestException(
        `URL base do backend sem host ("${candidate}"). Configure BACKEND_PUBLIC_URL com uma URL completa (ex.: https://meu-backend.com) e tente novamente.`,
      );
    }
    return candidate;
  }
}
