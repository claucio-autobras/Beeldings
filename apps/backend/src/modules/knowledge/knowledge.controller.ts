import { createHash } from 'crypto';
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { KnowledgeStatus, KnowledgeType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/presentation/guards/jwt-auth.guard.js';
import { RolesGuard } from '../auth/presentation/guards/roles.guard.js';
import { Roles } from '../auth/presentation/decorators/roles.decorator.js';
import { CurrentUser } from '../auth/presentation/decorators/current-user.decorator.js';
import { UserRole } from '../auth/domain/interfaces/auth.interface.js';
import type { AuthenticatedUser } from '../auth/domain/interfaces/auth.interface.js';
import { KnowledgeService } from './knowledge.service.js';
import { MAX_PDF_BYTES, PdfExtractService } from './pdf-extract.service.js';
import type { PdfExtractionResult } from './pdf-extract.service.js';

interface CreateBody {
  type?: string;
  title?: string;
  content?: string;
  equipmentType?: string | null;
  equipmentModel?: string | null;
  source?: string | null;
  anonymized?: boolean;
  fileHash?: string | null;
}

interface UpdateBody {
  type?: string;
  title?: string;
  content?: string;
  equipmentType?: string | null;
  equipmentModel?: string | null;
  source?: string | null;
}

const MAX_TITLE = 200;
// Manuais técnicos completos podem ter centenas de páginas; o teto alto garante
// indexação integral (o chunking fatia em pedaços pequenos antes do embedding).
const MAX_CONTENT = 1_500_000;

function parseType(value: unknown): KnowledgeType {
  if (typeof value === 'string' && value in KnowledgeType) {
    return KnowledgeType[value as keyof typeof KnowledgeType];
  }
  throw new BadRequestException("Tipo inválido. Use 'MANUAL', 'HOWTO' ou 'PLAYBOOK'.");
}

// Gestão da base de conhecimento — restrita à operação (não a clientes finais).
@Controller('knowledge')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.CCO, UserRole.SUPERVISOR)
export class KnowledgeController {
  constructor(
    private readonly knowledge: KnowledgeService,
    private readonly pdfExtract: PdfExtractService,
  ) {}

  // POST /knowledge/extract-pdf — extrai o texto de um PDF para revisão.
  // Não cria documento: o cliente revisa o texto e salva via POST /knowledge.
  @Post('extract-pdf')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_PDF_BYTES, files: 1 },
    }),
  )
  async extractPdf(
    @UploadedFile() file?: Express.Multer.File,
    @Query('extractId') extractId?: string,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('Envie um arquivo PDF no campo "file".');
    }
    // multer decodifica o nome do arquivo como latin1; reinterpreta como UTF-8
    // para não corromper acentos ("Serviço" → "ServiÃ§o").
    const originalName = Buffer.from(file.originalname ?? 'documento.pdf', 'latin1').toString('utf8');
    // Hash do arquivo bruto: se o mesmo PDF já foi importado, bloqueia antes de
    // gastar extração/OCR. O mesmo hash é reenviado no POST /knowledge, onde a
    // unicidade é garantida de novo (e pelo índice único no banco).
    const fileHash = createHash('sha256').update(file.buffer).digest('hex');
    const duplicate = await this.knowledge.findByFileHash(fileHash);
    if (duplicate) {
      throw new ConflictException(
        `Este PDF já foi importado no documento "${duplicate.title}". Exclua o documento existente antes de importar novamente.`,
      );
    }
    const id = typeof extractId === 'string' && extractId.trim() ? extractId.trim().slice(0, 64) : undefined;
    // PDFs com camada de texto respondem na hora. Scans (OCR) rodam em segundo
    // plano — manuais de 100+ páginas não cabem no timeout de um request — e o
    // cliente busca o resultado em GET extract-pdf/:extractId/result.
    const outcome = await this.pdfExtract.beginExtract(file.buffer, originalName, id);
    if (outcome.kind === 'pending') {
      return { pending: true as const, extractId: id, pages: outcome.pages, fileHash };
    }
    return { ...this.toExtractPayload(outcome.result), fileHash };
  }

  // fileHash é opcional (documentos manuais não têm PDF), mas se vier precisa
  // ser um SHA-256 hex válido — valor malformado é erro do cliente, não silêncio.
  private parseFileHash(value: unknown): string | null {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value.trim())) {
      return value.trim().toLowerCase();
    }
    throw new BadRequestException('fileHash inválido: esperado SHA-256 em hexadecimal.');
  }

  private toExtractPayload(result: PdfExtractionResult) {
    const truncated = result.text.length > MAX_CONTENT;
    return {
      suggestedTitle: result.suggestedTitle.slice(0, MAX_TITLE),
      content: truncated ? result.text.slice(0, MAX_CONTENT) : result.text,
      pages: result.pages,
      chars: result.text.length,
      truncated,
      ocr: result.ocr,
      ocrPages: result.ocrPages ?? null,
    };
  }

  // GET /knowledge/extract-pdf/:extractId/result — resultado do OCR em segundo
  // plano. 'pending' enquanto processa; 'unknown' quando o id expirou/é inválido.
  @Get('extract-pdf/:extractId/result')
  extractPdfResult(@Param('extractId') extractId: string) {
    const job = this.pdfExtract.getJob(extractId);
    if (!job) return { status: 'unknown' as const };
    if (job.status === 'pending') return { status: 'pending' as const };
    if (job.status === 'error') return { status: 'error' as const, message: job.message };
    return { status: 'done' as const, ...this.toExtractPayload(job.result) };
  }

  // GET /knowledge/extract-pdf/:extractId/progress — progresso do OCR (polling).
  // Retorna { active:false } quando o progresso é desconhecido (id inválido,
  // expirado ou poll caiu em outra instância) — o cliente mantém o texto genérico.
  @Get('extract-pdf/:extractId/progress')
  extractPdfProgress(@Param('extractId') extractId: string) {
    const progress = this.pdfExtract.getProgress(extractId);
    if (!progress) return { active: false as const };
    return { active: true as const, ...progress };
  }

  // GET /knowledge?status=&type= — lista documentos da base.
  @Get()
  async list(@Query('status') status?: string, @Query('type') type?: string) {
    const statusFilter =
      status && status in KnowledgeStatus
        ? KnowledgeStatus[status as keyof typeof KnowledgeStatus]
        : undefined;
    const typeFilter =
      type && type in KnowledgeType ? KnowledgeType[type as keyof typeof KnowledgeType] : undefined;
    return this.knowledge.list({ status: statusFilter, type: typeFilter });
  }

  // GET /knowledge/search?q=&k= — pré-visualiza o que o RAG recuperaria.
  @Get('search')
  async search(@Query('q') q?: string, @Query('k') k?: string) {
    const query = typeof q === 'string' ? q.trim() : '';
    if (!query) throw new BadRequestException('Informe o termo de busca (q).');
    const limit = k ? Number.parseInt(k, 10) : 5;
    return this.knowledge.search(query, Number.isFinite(limit) ? limit : 5);
  }

  // GET /knowledge/:id — detalhe de um documento.
  @Get(':id')
  async get(@Param('id') id: string) {
    return this.knowledge.get(id);
  }

  // POST /knowledge — cria um documento (entra como DRAFT).
  @Post()
  async create(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateBody) {
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    const content = typeof body?.content === 'string' ? body.content.trim() : '';
    if (!title) throw new BadRequestException('O título é obrigatório.');
    if (!content) throw new BadRequestException('O conteúdo é obrigatório.');

    return this.knowledge.create(
      {
        type: parseType(body?.type),
        title: title.slice(0, MAX_TITLE),
        content: content.slice(0, MAX_CONTENT),
        equipmentType: body?.equipmentType?.trim() || null,
        equipmentModel: body?.equipmentModel?.trim() || null,
        source: body?.source?.trim() || null,
        anonymized: body?.anonymized ?? true,
        fileHash: this.parseFileHash(body?.fileHash),
      },
      user.id,
    );
  }

  // PATCH /knowledge/:id — edita um documento (reindexação se o conteúdo mudar).
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: UpdateBody) {
    const title = typeof body?.title === 'string' ? body.title.trim() : undefined;
    const content = typeof body?.content === 'string' ? body.content.trim() : undefined;
    if (title !== undefined && !title) throw new BadRequestException('O título não pode ficar vazio.');
    if (content !== undefined && !content)
      throw new BadRequestException('O conteúdo não pode ficar vazio.');

    return this.knowledge.update(id, {
      title: title === undefined ? undefined : title.slice(0, MAX_TITLE),
      content: content === undefined ? undefined : content.slice(0, MAX_CONTENT),
      type: body?.type !== undefined ? parseType(body.type) : undefined,
      equipmentType: body?.equipmentType === undefined ? undefined : body.equipmentType?.trim() || null,
      equipmentModel:
        body?.equipmentModel === undefined ? undefined : body.equipmentModel?.trim() || null,
      source: body?.source === undefined ? undefined : body.source?.trim() || null,
    });
  }

  // POST /knowledge/:id/approve — publica na base (passa a ser usado pelo RAG).
  @Post(':id/approve')
  async approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.knowledge.approve(id, user.id);
  }

  // POST /knowledge/:id/unapprove — retira da base (volta a DRAFT).
  @Post(':id/unapprove')
  async unapprove(@Param('id') id: string) {
    return this.knowledge.unapprove(id);
  }

  // DELETE /knowledge/:id — remove o documento e seus chunks.
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.knowledge.remove(id);
    return { success: true };
  }
}
