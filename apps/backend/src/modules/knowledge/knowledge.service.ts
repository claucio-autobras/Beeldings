import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { KnowledgeType, KnowledgeStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmbeddingsService } from './embeddings.service.js';

export interface CreateKnowledgeInput {
  type: KnowledgeType;
  title: string;
  content: string;
  equipmentType?: string | null;
  equipmentModel?: string | null;
  source?: string | null;
  anonymized?: boolean;
  /** SHA-256 do PDF de origem — bloqueia importação duplicada do mesmo arquivo. */
  fileHash?: string | null;
}

export interface UpdateKnowledgeInput {
  title?: string;
  content?: string;
  type?: KnowledgeType;
  equipmentType?: string | null;
  equipmentModel?: string | null;
  source?: string | null;
}

export interface KnowledgeSearchHit {
  chunkId: string;
  docId: string;
  title: string;
  type: KnowledgeType;
  source: string | null;
  equipmentType: string | null;
  equipmentModel: string | null;
  content: string;
  similarity: number;
}

// Alvo de tamanho por chunk (caracteres) e sobreposição para não cortar contexto
// no meio de uma ideia entre dois chunks vizinhos.
const CHUNK_TARGET = 1000;
const CHUNK_OVERLAP = 150;

/**
 * CRUD + indexação vetorial da base de conhecimento (RAG). Cada documento é
 * fatiado em chunks com embedding (pgvector). Só documentos APPROVED entram na
 * busca — a curadoria é o que mantém a base confiável e anonimizada.
 */
@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: EmbeddingsService,
  ) {}

  /** Fatia o texto em pedaços ~CHUNK_TARGET, com sobreposição entre vizinhos. */
  private chunk(text: string): string[] {
    const clean = text.replace(/\r\n/g, '\n').trim();
    if (!clean) return [];
    if (clean.length <= CHUNK_TARGET) return [clean];

    const paras = clean.split(/\n{2,}/);
    const chunks: string[] = [];
    let buf = '';
    for (const p of paras) {
      const candidate = buf ? `${buf}\n\n${p}` : p;
      if (candidate.length > CHUNK_TARGET && buf) {
        chunks.push(buf.trim());
        const tail = buf.slice(Math.max(0, buf.length - CHUNK_OVERLAP));
        buf = `${tail}\n\n${p}`;
      } else {
        buf = candidate;
      }
    }
    if (buf.trim()) chunks.push(buf.trim());

    // Garante que nenhum chunk fique grande demais (parágrafo único longo).
    const final: string[] = [];
    for (const c of chunks) {
      if (c.length <= CHUNK_TARGET * 1.5) {
        final.push(c);
        continue;
      }
      for (let i = 0; i < c.length; i += CHUNK_TARGET) {
        final.push(c.slice(i, i + CHUNK_TARGET));
      }
    }
    return final;
  }

  /** Documento já importado a partir do mesmo arquivo PDF (hash), se existir. */
  async findByFileHash(fileHash: string) {
    return this.prisma.knowledgeDoc.findUnique({
      where: { fileHash },
      select: { id: true, title: true, status: true, createdAt: true },
    });
  }

  async create(input: CreateKnowledgeInput, userId: string | null) {
    if (input.fileHash) {
      const dup = await this.findByFileHash(input.fileHash);
      if (dup) {
        throw new ConflictException(
          `Este PDF já foi importado no documento "${dup.title}". Exclua o documento existente antes de importar novamente.`,
        );
      }
    }
    const doc = await this.prisma.knowledgeDoc
      .create({
        data: {
          type: input.type,
          title: input.title,
          content: input.content,
          equipmentType: input.equipmentType ?? null,
          equipmentModel: input.equipmentModel ?? null,
          source: input.source ?? null,
          fileHash: input.fileHash ?? null,
          anonymized: input.anonymized ?? true,
          createdByUserId: userId,
          status: KnowledgeStatus.DRAFT,
        },
      })
      .catch((e: unknown) => {
        // Corrida entre dois salvamentos simultâneos do mesmo PDF: o índice
        // único do banco rejeita o segundo insert → traduz para 409.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException(
            'Este PDF já foi importado em outro documento. Exclua o documento existente antes de importar novamente.',
          );
        }
        throw e;
      });
    await this.reindex(doc.id, input.content);
    return this.get(doc.id);
  }

  async update(id: string, input: UpdateKnowledgeInput) {
    const existing = await this.prisma.knowledgeDoc.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Documento não encontrado.');

    const doc = await this.prisma.knowledgeDoc.update({
      where: { id },
      data: {
        title: input.title ?? undefined,
        content: input.content ?? undefined,
        type: input.type ?? undefined,
        equipmentType: input.equipmentType === undefined ? undefined : input.equipmentType,
        equipmentModel: input.equipmentModel === undefined ? undefined : input.equipmentModel,
        source: input.source === undefined ? undefined : input.source,
      },
    });

    // Conteúdo mudou → recria os embeddings.
    if (input.content !== undefined && input.content !== existing.content) {
      await this.reindex(doc.id, input.content);
    }
    return this.get(doc.id);
  }

  /** Recria todos os chunks + embeddings de um documento. */
  async reindex(docId: string, content: string): Promise<void> {
    const pieces = this.chunk(content);
    const vectors = await this.embeddings.embed(pieces);

    // Manuais longos geram centenas de chunks: inserimos em lotes multi-linha
    // (e com timeout folgado) para não estourar o limite da transação.
    const INSERT_BATCH = 200;
    await this.prisma.$transaction(
      async (tx) => {
        await tx.knowledgeChunk.deleteMany({ where: { docId } });
        for (let start = 0; start < pieces.length; start += INSERT_BATCH) {
          const rows = pieces.slice(start, start + INSERT_BATCH).map((piece, j) => {
            const i = start + j;
            const vec = this.embeddings.toSqlVector(vectors[i]);
            return Prisma.sql`(${randomUUID()}, ${docId}, ${i}, ${piece}, ${vec}::vector, now())`;
          });
          await tx.$executeRaw`
            INSERT INTO "knowledge_chunks" ("id", "doc_id", "ord", "content", "embedding", "created_at")
            VALUES ${Prisma.join(rows)}
          `;
        }
      },
      { timeout: 120_000 },
    );
    this.logger.log(`Documento ${docId} reindexado em ${pieces.length} chunk(s).`);
  }

  async approve(id: string, userId: string | null) {
    const doc = await this.prisma.knowledgeDoc.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Documento não encontrado.');
    return this.prisma.knowledgeDoc.update({
      where: { id },
      data: {
        status: KnowledgeStatus.APPROVED,
        approvedByUserId: userId,
        approvedAt: new Date(),
      },
    });
  }

  async unapprove(id: string) {
    const doc = await this.prisma.knowledgeDoc.findUnique({ where: { id } });
    if (!doc) throw new NotFoundException('Documento não encontrado.');
    return this.prisma.knowledgeDoc.update({
      where: { id },
      data: { status: KnowledgeStatus.DRAFT, approvedByUserId: null, approvedAt: null },
    });
  }

  async remove(id: string): Promise<void> {
    const r = await this.prisma.knowledgeDoc.deleteMany({ where: { id } });
    if (r.count === 0) throw new NotFoundException('Documento não encontrado.');
  }

  async list(filters?: { status?: KnowledgeStatus; type?: KnowledgeType }) {
    return this.prisma.knowledgeDoc.findMany({
      where: { status: filters?.status, type: filters?.type },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        type: true,
        status: true,
        title: true,
        equipmentType: true,
        equipmentModel: true,
        source: true,
        anonymized: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { chunks: true } },
      },
    });
  }

  async get(id: string) {
    const doc = await this.prisma.knowledgeDoc.findUnique({
      where: { id },
      include: { _count: { select: { chunks: true } } },
    });
    if (!doc) throw new NotFoundException('Documento não encontrado.');
    return doc;
  }

  /**
   * Busca semântica nos chunks APPROVED. Retorna os k mais próximos da pergunta
   * por similaridade de cosseno (1 = idêntico). É a base do RAG do Chat IA.
   *
   * Isolamento multi-tenant: o conhecimento é global, portanto só documentos
   * marcados como `anonymized = true` são recuperáveis. Dados crus de um tenant
   * nunca devem vazar para outro através da KB. Opcionalmente filtra por `type`
   * (ex.: apenas PLAYBOOK para sugestões por equipamento).
   */
  async search(
    query: string,
    k = 5,
    opts?: { type?: KnowledgeType; boostModels?: string[] },
  ): Promise<KnowledgeSearchHit[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const vec = this.embeddings.toSqlVector(await this.embeddings.embedOne(trimmed));
    const limit = Math.max(1, Math.min(k, 20));
    const typeFilter = opts?.type ?? null;
    // Boost (não filtro): chunks dos modelos citados vêm primeiro; se não houver
    // chunks suficientes desses modelos, o restante do top-k é preenchido pelos
    // demais (fallback natural). Perguntas comparativas passam vários modelos.
    const boostModels = (opts?.boostModels ?? [])
      .map((m) => m.trim().toLowerCase())
      .filter(Boolean);

    const rows = await this.prisma.$queryRaw<
      Array<{
        chunkId: string;
        docId: string;
        title: string;
        type: KnowledgeType;
        source: string | null;
        equipmentType: string | null;
        equipmentModel: string | null;
        content: string;
        similarity: number;
      }>
    >`
      SELECT
        c."id" AS "chunkId",
        c."doc_id" AS "docId",
        d."title" AS "title",
        d."type" AS "type",
        d."source" AS "source",
        d."equipment_type" AS "equipmentType",
        d."equipment_model" AS "equipmentModel",
        c."content" AS "content",
        1 - (c."embedding" <=> ${vec}::vector) AS "similarity"
      FROM "knowledge_chunks" c
      JOIN "knowledge_docs" d ON d."id" = c."doc_id"
      WHERE d."status" = 'APPROVED'
        AND d."anonymized" = true
        AND (${typeFilter}::text IS NULL OR d."type"::text = ${typeFilter})
        AND c."embedding" IS NOT NULL
      ORDER BY
        CASE
          WHEN lower(coalesce(d."equipment_model", '')) = ANY(${boostModels}::text[]) THEN 0
          ELSE 1
        END,
        c."embedding" <=> ${vec}::vector
      LIMIT ${limit}
    `;

    return rows.map((r) => ({ ...r, similarity: Number(r.similarity) }));
  }

  /**
   * Modelos de equipamento distintos entre os documentos pesquisáveis
   * (APPROVED + anonymized). Usado pelo Chat IA para detectar qual modelo a
   * pergunta menciona e priorizar os chunks desse modelo na busca.
   */
  async listSearchableModels(): Promise<string[]> {
    const rows = await this.prisma.knowledgeDoc.findMany({
      where: {
        status: KnowledgeStatus.APPROVED,
        anonymized: true,
        equipmentModel: { not: null },
      },
      select: { equipmentModel: true },
      distinct: ['equipmentModel'],
    });
    return rows
      .map((r) => r.equipmentModel)
      .filter((m): m is string => Boolean(m && m.trim()));
  }
}
