import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ScadaAssetService, type SavedAsset } from '../application/scada-asset.service.js';
import { JwtAuthGuard } from '../../auth/presentation/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../auth/presentation/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../auth/domain/interfaces/auth.interface.js';
import { UserRole } from '../../auth/domain/interfaces/auth.interface.js';

/** Mesmos perfis que podem editar telas (ver ScadaController) podem subir imagens. */
const GLOBAL_ROLES = new Set<UserRole>([UserRole.ADMIN, UserRole.CCO, UserRole.SUPERVISOR]);

interface UploadAssetDto {
  /** Data URL base64 da imagem (ex.: `data:image/png;base64,...`). */
  dataUrl: string;
  /** Tenant ao qual a tela pertence — apenas para organizar os arquivos. */
  tenantId?: string;
}

@Controller('scada/assets')
@UseGuards(JwtAuthGuard)
export class ScadaAssetsController {
  constructor(private readonly assets: ScadaAssetService) {}

  @Post('/')
  @HttpCode(HttpStatus.CREATED)
  async upload(
    @Body() body: UploadAssetDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<SavedAsset> {
    if (!GLOBAL_ROLES.has(user.role)) {
      throw new ForbiddenException('Sem permissão para enviar imagens ao SCADA');
    }
    // Perfis globais têm tenantId null; usam o tenant da tela (vindo no payload).
    const tenantId = body.tenantId ?? user.tenantId ?? undefined;
    return this.assets.saveDataUrl(tenantId, body.dataUrl);
  }
}
