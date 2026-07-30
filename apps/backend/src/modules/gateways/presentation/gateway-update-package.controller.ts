import {
  Controller,
  Get,
  NotFoundException,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { GatewayPackageService } from '../application/gateway-package.service.js';

/**
 * Download do pacote de ATUALIZAÇÃO (OTA) pelo próprio gateway.
 *
 * SEM JwtAuthGuard: o gateway não tem JWT de usuário — a autenticação é feita
 * por token de uso único, gerado no POST /gateways/:id/update (autenticado),
 * enviado ao gateway pelo canal MQTT autenticado e com validade de minutos.
 * O comando também carrega o SHA-256 do pacote, validado pelo gateway.
 */
@Controller('gateways')
export class GatewayUpdatePackageController {
  constructor(private readonly packages: GatewayPackageService) {}

  @Get('/update-package')
  downloadUpdatePackage(
    @Query('token') token: string | undefined,
    @Res() res: Response,
  ): void {
    const pkg = token ? this.packages.getUpdatePackage(token) : null;
    if (!pkg) {
      throw new NotFoundException('Token de atualização inválido ou expirado.');
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="bluebee-gateway-update-${pkg.version}.zip"`,
    );
    res.setHeader('Content-Length', pkg.buffer.length.toString());
    res.end(pkg.buffer);
  }
}
