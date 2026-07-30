import { Injectable, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ScadaObjectStorageService } from '../infrastructure/scada-object-storage.service.js';

/** Prefixo público sob o qual os assets são servidos (ver ScadaAssetFilesController). */
export const SCADA_ASSET_ROUTE = '/scada-assets';

/** Extensões aceitas, indexadas pelo MIME do data URL. */
const MIME_EXT: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/svg+xml': 'svg',
  'image/gif': 'gif',
};

/** Teto por imagem — mantém o armazenamento e o tráfego sob controle. */
const MAX_BYTES = 5 * 1024 * 1024;

export interface SavedAsset {
  /** Caminho público relativo, ex.: `/scada-assets/<tenant>/<uuid>.png`. */
  url: string;
}

@Injectable()
export class ScadaAssetService {
  constructor(private readonly storage: ScadaObjectStorageService) {}

  /**
   * Decodifica um data URL base64 de imagem e grava no bucket do App Storage
   * (`scada/<tenant>/<uuid>.<ext>`), devolvendo a URL pública relativa. Move os
   * bytes da imagem para FORA do JSON da tela — o save passa a trafegar apenas
   * a URL, não a imagem inteira. As URLs sobrevivem a deploys porque o bucket é
   * externo ao filesystem do backend.
   */
  async saveDataUrl(tenantId: string | undefined, dataUrl: string): Promise<SavedAsset> {
    const match = /^data:([\w/+.-]+);base64,(.+)$/s.exec(dataUrl ?? '');
    if (!match) {
      throw new BadRequestException('Imagem inválida: esperado data URL base64');
    }
    const mime = match[1].toLowerCase();
    const ext = MIME_EXT[mime];
    if (!ext) {
      throw new BadRequestException(`Tipo de imagem não suportado: ${mime}`);
    }

    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.byteLength === 0) {
      throw new BadRequestException('Imagem vazia');
    }
    if (buffer.byteLength > MAX_BYTES) {
      throw new BadRequestException('Imagem excede o limite de 5 MB');
    }

    // Pasta por tenant é apenas organizacional; o nome do arquivo (UUID) é
    // imprevisível. Sanitiza para evitar path traversal.
    const safeTenant = (tenantId ?? '').replace(/[^a-zA-Z0-9_-]/g, '') || 'shared';
    const filename = `${randomUUID()}.${ext}`;

    await this.storage.save(`${safeTenant}/${filename}`, buffer, mime);

    return { url: `${SCADA_ASSET_ROUTE}/${safeTenant}/${filename}` };
  }
}
