import { Injectable } from '@nestjs/common';
import { Storage, type File } from '@google-cloud/storage';

/**
 * Endpoint do sidecar do Replit que fornece credenciais GCS para o App
 * Storage. A autenticação é gerenciada pela plataforma — não configurar
 * chaves manualmente.
 */
const REPLIT_SIDECAR_ENDPOINT = 'http://127.0.0.1:1106';

/** Erro explícito para objeto inexistente no bucket (vira 404 no controller). */
export class ScadaObjectNotFoundError extends Error {
  constructor(objectPath: string) {
    super(`Objeto não encontrado no App Storage: ${objectPath}`);
    this.name = 'ScadaObjectNotFoundError';
    Object.setPrototypeOf(this, ScadaObjectNotFoundError.prototype);
  }
}

/**
 * Camada fina sobre o App Storage do Replit (bucket GCS gerenciado) para os
 * assets das telas SCADA. Os objetos vivem em
 * `<PRIVATE_OBJECT_DIR>/scada/<tenant>/<uuid>.<ext>`, espelhando o layout
 * antigo de disco (`uploads/scada/<tenant>/<uuid>.<ext>`).
 */
@Injectable()
export class ScadaObjectStorageService {
  private readonly client = new Storage({
    credentials: {
      audience: 'replit',
      subject_token_type: 'access_token',
      token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
      type: 'external_account',
      credential_source: {
        url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
        format: {
          type: 'json',
          subject_token_field_name: 'access_token',
        },
      },
      universe_domain: 'googleapis.com',
    },
    projectId: '',
  });

  /**
   * Resolve `PRIVATE_OBJECT_DIR` (ex.: `/<bucket>/.private`) em bucket + prefixo.
   * Falha alto se a variável não existir — sem fallback silencioso para disco.
   */
  private resolveBase(): { bucketName: string; prefix: string } {
    const dir = process.env.PRIVATE_OBJECT_DIR ?? '';
    if (!dir) {
      throw new Error(
        'PRIVATE_OBJECT_DIR não definido. Provisione o App Storage do Replit e ' +
          'garanta a variável no ambiente (dev e deploy).',
      );
    }
    const parts = dir.replace(/^\/+/, '').split('/');
    const bucketName = parts[0];
    const prefix = parts.slice(1).join('/');
    if (!bucketName) {
      throw new Error(`PRIVATE_OBJECT_DIR inválido: ${dir}`);
    }
    return { bucketName, prefix };
  }

  /** Handle GCS para o objeto `scada/<relativePath>` dentro do dir privado. */
  private objectFor(relativePath: string): File {
    const { bucketName, prefix } = this.resolveBase();
    const objectName = [prefix, 'scada', relativePath].filter(Boolean).join('/');
    return this.client.bucket(bucketName).file(objectName);
  }

  /** Grava os bytes de um asset SCADA no bucket com o Content-Type correto. */
  async save(relativePath: string, buffer: Buffer, contentType: string): Promise<void> {
    await this.objectFor(relativePath).save(buffer, {
      contentType,
      resumable: false,
    });
  }

  /**
   * Remove TODOS os objetos sob `scada/<relativePrefix>/` no bucket.
   * Usado na exclusão de cliente para limpar imagens órfãs. Best-effort:
   * o chamador deve capturar erros e não bloquear a operação principal.
   * Retorna a quantidade de objetos removidos.
   */
  async deletePrefix(relativePrefix: string): Promise<number> {
    const { bucketName, prefix } = this.resolveBase();
    const cleaned = relativePrefix.replace(/^\/+|\/+$/g, '');
    if (!cleaned) {
      throw new Error('deletePrefix exige um prefixo não vazio');
    }
    const objectPrefix = [prefix, 'scada', cleaned].filter(Boolean).join('/') + '/';
    const bucket = this.client.bucket(bucketName);
    const [files] = await bucket.getFiles({ prefix: objectPrefix });
    let deleted = 0;
    for (const file of files) {
      await file.delete({ ignoreNotFound: true });
      deleted += 1;
    }
    return deleted;
  }

  /** True se o objeto já existe (usado pelo script de migração). */
  async exists(relativePath: string): Promise<boolean> {
    const [exists] = await this.objectFor(relativePath).exists();
    return exists;
  }

  /**
   * Resolve o objeto para leitura, devolvendo o handle + metadados.
   * Lança `ScadaObjectNotFoundError` se não existir.
   */
  async getForRead(relativePath: string): Promise<{ file: File; contentType: string; size?: string }> {
    const file = this.objectFor(relativePath);
    const [exists] = await file.exists();
    if (!exists) {
      throw new ScadaObjectNotFoundError(relativePath);
    }
    const [metadata] = await file.getMetadata();
    return {
      file,
      contentType: (metadata.contentType as string) || 'application/octet-stream',
      size: metadata.size ? String(metadata.size) : undefined,
    };
  }
}
