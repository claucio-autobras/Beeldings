import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import OpenAI from 'openai';

// Dimensão fixa do modelo de embedding usado. Precisa casar com a coluna
// `vector(1536)` da tabela knowledge_chunks (ver migration add_knowledge_base).
export const EMBED_DIMENSIONS = 1536;

const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL ?? 'text-embedding-3-small';
// A API aceita lotes; mandamos em blocos para não estourar limites de payload.
const BATCH = 96;
// Corta textos muito longos por entrada (segurança; os chunks já são pequenos).
const MAX_CHARS = 8000;

/**
 * Gera embeddings via OpenAI. Usado tanto para indexar a base de conhecimento
 * quanto para embeddar a pergunta do usuário na busca semântica (RAG).
 */
@Injectable()
export class EmbeddingsService {
  private readonly logger = new Logger(EmbeddingsService.name);
  private client: OpenAI | null = null;

  private getClient(): OpenAI {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Serviço de embeddings não configurado: defina a chave OPENAI_API_KEY.',
      );
    }
    if (!this.client) {
      this.client = new OpenAI({ apiKey });
    }
    return this.client;
  }

  /** Gera os embeddings de uma lista de textos, preservando a ordem. */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const client = this.getClient();
    const out: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts
        .slice(i, i + BATCH)
        .map((t) => t.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS) || ' ');
      try {
        const res = await client.embeddings.create({
          model: EMBED_MODEL,
          input: batch,
          dimensions: EMBED_DIMENSIONS,
        });
        for (const item of res.data) {
          out.push(item.embedding as number[]);
        }
      } catch (err) {
        this.logger.error(`Falha ao gerar embeddings: ${(err as Error).message}`);
        throw new ServiceUnavailableException(
          'Não foi possível gerar os embeddings. Verifique a OPENAI_API_KEY e tente novamente.',
        );
      }
    }
    return out;
  }

  /** Embedding de um único texto. */
  async embedOne(text: string): Promise<number[]> {
    const [vec] = await this.embed([text]);
    return vec;
  }

  /** Formata um vetor para o literal aceito pelo pgvector: `[v1,v2,...]`. */
  toSqlVector(vec: number[]): string {
    return `[${vec.join(',')}]`;
  }
}
