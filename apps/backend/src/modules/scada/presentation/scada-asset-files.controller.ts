import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  ScadaObjectStorageService,
  ScadaObjectNotFoundError,
} from '../infrastructure/scada-object-storage.service.js';

/** Cache imutável de 7 dias — nomes de arquivo são UUIDs, nunca sobrescritos. */
const CACHE_CONTROL = 'public, max-age=604800, immutable';

/** Só aceita segmentos seguros (tenant sanitizado + `<uuid>.<ext>`). */
const SAFE_SEGMENT = /^[a-zA-Z0-9_.-]+$/;

/**
 * Serve as imagens das telas SCADA por streaming direto do bucket do App
 * Storage, no mesmo prefixo público (`/scada-assets/<tenant>/<arquivo>`) que
 * antes era servido do disco — as URLs persistidas no JSON das telas
 * continuam válidas sem nenhuma alteração. Rota pública (as URLs são
 * imprevisíveis por UUID), como era com o `express.static`.
 */
@Controller('scada-assets')
export class ScadaAssetFilesController {
  constructor(private readonly storage: ScadaObjectStorageService) {}

  @Get(':tenant/:filename')
  async serve(
    @Param('tenant') tenant: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ): Promise<void> {
    if (!SAFE_SEGMENT.test(tenant) || !SAFE_SEGMENT.test(filename) || filename.includes('..')) {
      throw new NotFoundException('Asset não encontrado');
    }

    let resolved;
    try {
      resolved = await this.storage.getForRead(`${tenant}/${filename}`);
    } catch (error) {
      if (error instanceof ScadaObjectNotFoundError) {
        throw new NotFoundException('Asset não encontrado');
      }
      throw error;
    }

    res.setHeader('Content-Type', resolved.contentType);
    res.setHeader('Cache-Control', CACHE_CONTROL);
    // Helmet global já aplica CORP cross-origin; reforça aqui para o caso de a
    // rota ser servida fora da cadeia padrão.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (resolved.size) {
      res.setHeader('Content-Length', resolved.size);
    }

    const stream = resolved.file.createReadStream();
    stream.on('error', () => {
      if (!res.headersSent) {
        res.status(500).json({ message: 'Falha ao ler o asset do App Storage' });
      } else {
        res.destroy();
      }
    });
    stream.pipe(res);
  }
}
