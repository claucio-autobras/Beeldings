import { readFile } from 'fs/promises';
import { join } from 'path';
import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { KnowledgeClass, KnowledgeType, KnowledgeStatus, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { EmbeddingsService } from './embeddings.service.js';
import {
  extractSeedRecords,
  normalizeSeedCase,
  type NormalizedSeedCase,
  type SeedFile,
} from './case-import.util.js';

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
  // ─── Metadados de caso técnico (type = CASE; null nos demais) ─────────────
  caseId: string | null;
  knowledgeClass: KnowledgeClass | null;
  caseSeverity: string | null;
  protocol: string | null;
  subsystem: string | null;
  vendorScope: string | null;
  symptom: string | null;
  sourceUrl: string | null;
}

/** Resultado da importação (idempotente) da seed de casos técnicos. */
export interface SeedImportResult {
  total: number;
  imported: number;
  skippedExisting: number;
  invalid: number;
}

/**
 * Estado de uma importação de seed em segundo plano. Em memória (mesma
 * premissa do OCR de PDF): o clique e o polling vêm do mesmo navegador; se o
 * poll cair em outra instância, o cliente mostra que o import segue em segundo
 * plano e recarrega a lista — a importação é idempotente, nada se perde.
 */
export type SeedImportJob =
  | { status: 'pending' }
  | { status: 'done'; result: SeedImportResult }
  | { status: 'error'; message: string };

/** Janela para o frontend buscar o resultado após o término do import. */
const SEED_JOB_TTL_MS = 10 * 60_000;

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

  // Importações de seed em segundo plano, por importId. O endpoint respondia
  // sincronamente, mas ~100 casos × embeddings passam dos 30s que o proxy de
  // produção tolera — o request estourava com 500 mesmo com o import concluindo.
  private readonly seedImportJobs = new Map<string, SeedImportJob>();

  /** Estado de uma importação de seed (null = desconhecido/expirado). */
  getSeedImportJob(importId: string): SeedImportJob | null {
    return this.seedImportJobs.get(importId) ?? null;
  }

  private setSeedImportJob(importId: string, job: SeedImportJob): void {
    this.seedImportJobs.set(importId, job);
    if (job.status !== 'pending') {
      setTimeout(() => this.seedImportJobs.delete(importId), SEED_JOB_TTL_MS).unref?.();
    }
  }

  /**
   * Dispara a importação da seed em segundo plano e retorna o id para polling.
   * A importação em si (importSeedCases) permanece idempotente.
   */
  beginImportSeedCases(userId: string | null): { importId: string } {
    const importId = randomUUID();
    this.setSeedImportJob(importId, { status: 'pending' });
    void this.importSeedCases(userId)
      .then((result) => this.setSeedImportJob(importId, { status: 'done', result }))
      .catch((err: Error) => {
        this.logger.error(`Importação da seed falhou: ${err.message}`);
        this.setSeedImportJob(importId, {
          status: 'error',
          message: 'Falha ao importar os casos técnicos. Tente novamente.',
        });
      });
    return { importId };
  }

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
        caseId: true,
        knowledgeClass: true,
        caseSeverity: true,
        protocol: true,
        subsystem: true,
        vendorScope: true,
        evidenceStrength: true,
        sourceUrl: true,
        tags: true,
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
        caseId: string | null;
        knowledgeClass: KnowledgeClass | null;
        caseSeverity: string | null;
        protocol: string | null;
        subsystem: string | null;
        vendorScope: string | null;
        symptom: string | null;
        sourceUrl: string | null;
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
        1 - (c."embedding" <=> ${vec}::vector) AS "similarity",
        d."case_id" AS "caseId",
        d."knowledge_class"::text AS "knowledgeClass",
        d."case_severity" AS "caseSeverity",
        d."protocol" AS "protocol",
        d."subsystem" AS "subsystem",
        d."vendor_scope" AS "vendorScope",
        d."symptom" AS "symptom",
        d."source_url" AS "sourceUrl"
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

  // ─── Importação da seed de casos técnicos ─────────────────────────────────

  /** Caminho do JSON da seed empacotado com o backend (asset do nest-cli). */
  private seedFilePath(): string {
    return join(__dirname, 'assets', 'bluebee-seed-kb-v1-100-bms-cases.json');
  }

  /**
   * Importa a seed de casos técnicos (BB-BMS-XXXX) empacotada com o app.
   * IDEMPOTENTE: deduplica por case_id — rodar de novo não duplica casos e
   * futuros lotes podem reaproveitar a mesma rota. Casos entram já APPROVED
   * (curadoria feita na origem da seed) e anonymized (conteúdo genérico, sem
   * dados de tenant).
   */
  async importSeedCases(userId: string | null): Promise<SeedImportResult> {
    const raw = await readFile(this.seedFilePath(), 'utf8');
    const records = extractSeedRecords(JSON.parse(raw) as SeedFile);

    const normalized: NormalizedSeedCase[] = [];
    let invalid = 0;
    const seen = new Set<string>();
    for (const rec of records) {
      const n = normalizeSeedCase(rec);
      if (!n || seen.has(n.caseId)) {
        invalid += 1;
        continue;
      }
      seen.add(n.caseId);
      normalized.push(n);
    }

    // Dedupe por case_id: só cria o que ainda não existe.
    const existing = await this.prisma.knowledgeDoc.findMany({
      where: { caseId: { in: normalized.map((n) => n.caseId) } },
      select: { caseId: true },
    });
    const existingIds = new Set(existing.map((e) => e.caseId));
    const toCreate = normalized.filter((n) => !existingIds.has(n.caseId));

    let imported = 0;
    for (const c of toCreate) {
      try {
        const doc = await this.prisma.knowledgeDoc.create({
          data: {
            type: KnowledgeType.CASE,
            title: c.title,
            content: c.content,
            equipmentType: c.equipmentType,
            source: c.source,
            anonymized: true,
            status: KnowledgeStatus.APPROVED,
            approvedByUserId: userId,
            approvedAt: new Date(),
            createdByUserId: userId,
            caseId: c.caseId,
            knowledgeClass: c.knowledgeClass,
            caseSeverity: c.caseSeverity,
            protocol: c.protocol,
            subsystem: c.subsystem,
            vendorScope: c.vendorScope,
            symptom: c.symptom,
            evidenceStrength: c.evidenceStrength,
            sourceUrl: c.sourceUrl,
            tags: c.tags,
          },
        });
        await this.reindex(doc.id, c.content);
        imported += 1;
      } catch (e: unknown) {
        // Corrida entre duas importações simultâneas: o índice único de
        // case_id rejeita o segundo insert → conta como já existente.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          existingIds.add(c.caseId);
          continue;
        }
        throw e;
      }
    }

    const result: SeedImportResult = {
      total: records.length,
      imported,
      skippedExisting: existingIds.size,
      invalid,
    };
    this.logger.log(
      `Seed de casos técnicos: ${imported} importado(s), ${result.skippedExisting} já existente(s), ${invalid} inválido(s).`,
    );
    return result;
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
