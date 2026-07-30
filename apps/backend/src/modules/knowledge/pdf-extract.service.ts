import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';
import OpenAI from 'openai';

export interface PdfExtractionResult {
  /** Texto extraído, já normalizado (quebras de página viram parágrafos). */
  text: string;
  /** Total de páginas do PDF. */
  pages: number;
  /** Título sugerido a partir do nome do arquivo. */
  suggestedTitle: string;
  /** true quando o texto veio de OCR (PDF escaneado, somente imagem). */
  ocr: boolean;
  /** Quantas páginas passaram por OCR (pode ser menor que `pages` no limite). */
  ocrPages?: number;
}

// Limite defensivo: manuais técnicos raramente passam disso; evita payloads abusivos.
export const MAX_PDF_BYTES = 30 * 1024 * 1024;

// Teto de segurança do OCR por upload. O processamento roda em segundo plano
// (sem timeout de request), então o limite existe só para conter custo/abuso.
export const MAX_OCR_PAGES = 400;
// Quantas páginas OCRizamos em paralelo (equilíbrio entre latência e rate limit).
const OCR_CONCURRENCY = 4;
// Renderiza as páginas em lotes (não o PDF inteiro de uma vez) para manter o
// uso de memória estável em manuais de centenas de páginas.
const OCR_RENDER_BATCH = 8;
const OCR_MODEL = process.env.OPENAI_OCR_MODEL ?? 'gpt-4o-mini';

const OCR_PROMPT =
  'Transcreva TODO o texto legível desta página escaneada de um manual técnico, ' +
  'preservando títulos, listas e a ordem de leitura. Responda somente com o texto ' +
  'transcrito, sem comentários. Se a página não tiver texto legível, responda com uma linha vazia.';

// pdf-parse separa páginas com marcadores "-- N of M --"; convertemos em quebras
// de parágrafo para o chunking respeitar os limites de página.
const PAGE_MARKER = /^\s*-{1,3}\s*\d+\s+of\s+\d+\s*-{1,3}\s*$/gm;

/** Progresso parcial de uma extração em andamento (polling pelo frontend). */
export interface PdfExtractProgress {
  /** 'render' = preparando as páginas; 'ocr' = transcrevendo página a página. */
  phase: 'parse' | 'render' | 'ocr';
  /** Páginas já transcritas (fase 'ocr'). */
  processed: number;
  /** Total de páginas que passarão por OCR (0 enquanto desconhecido). */
  total: number;
  done: boolean;
}

/** Tempo que o progresso fica disponível após o término (janela p/ último poll). */
const PROGRESS_TTL_MS = 60_000;

/** Estado de uma extração em segundo plano (PDF escaneado → OCR). */
export type PdfExtractJob =
  | { status: 'pending' }
  | { status: 'done'; result: PdfExtractionResult }
  | { status: 'error'; message: string };

/** Janela para o frontend buscar o resultado após o término do job. */
const JOB_TTL_MS = 10 * 60_000;

/** Resultado imediato de beginExtract: síncrono (texto) ou job em background (OCR). */
export type BeginExtractOutcome =
  | { kind: 'sync'; result: PdfExtractionResult }
  | { kind: 'pending'; pages: number };

/**
 * Extrai o texto de PDFs para ingestão na base de conhecimento. PDFs com
 * camada de texto usam extração direta; PDFs escaneados (imagem pura) passam
 * por OCR (renderiza cada página e transcreve via modelo de visão). Falha de
 * OCR mantém erro claro para o usuário.
 */
@Injectable()
export class PdfExtractService {
  private readonly logger = new Logger(PdfExtractService.name);
  private openai: OpenAI | null = null;

  // Progresso por extractId (gerado pelo cliente). Em memória: o upload e o
  // polling vêm do mesmo navegador; se o poll cair em outra instância, o
  // frontend simplesmente mantém o texto genérico "Extraindo…".
  private readonly progressById = new Map<string, PdfExtractProgress>();

  // Resultado de extrações em segundo plano (OCR de scans). Em memória, mesma
  // premissa do progresso: upload e polling vêm do mesmo navegador/instância.
  private readonly jobById = new Map<string, PdfExtractJob>();

  /** Progresso parcial de uma extração (null quando desconhecido/expirado). */
  getProgress(extractId: string): PdfExtractProgress | null {
    return this.progressById.get(extractId) ?? null;
  }

  /** Estado/resultado de um job de OCR em segundo plano (null = desconhecido). */
  getJob(extractId: string): PdfExtractJob | null {
    return this.jobById.get(extractId) ?? null;
  }

  private setJob(extractId: string, job: PdfExtractJob): void {
    this.jobById.set(extractId, job);
    if (job.status !== 'pending') {
      setTimeout(() => this.jobById.delete(extractId), JOB_TTL_MS).unref?.();
    }
  }

  private setProgress(extractId: string | undefined, progress: PdfExtractProgress): void {
    if (!extractId) return;
    this.progressById.set(extractId, progress);
    if (progress.done) {
      setTimeout(() => this.progressById.delete(extractId), PROGRESS_TTL_MS).unref?.();
    }
  }

  private getOpenAi(): OpenAI | null {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;
    if (!this.openai) this.openai = new OpenAI({ apiKey });
    return this.openai;
  }

  /**
   * Extração síncrona (aguarda OCR inline). Mantida para testes e chamadas
   * internas; o endpoint HTTP usa beginExtract (OCR em segundo plano).
   */
  async extract(
    buffer: Buffer,
    originalName: string,
    extractId?: string,
  ): Promise<PdfExtractionResult> {
    const outcome = await this.begin(buffer, originalName, extractId, false);
    // background=false garante kind='sync'.
    return (outcome as { kind: 'sync'; result: PdfExtractionResult }).result;
  }

  /**
   * Inicia a extração. PDFs com camada de texto retornam na hora; PDFs
   * escaneados disparam o OCR em segundo plano (sem prender o request) e o
   * resultado é buscado depois via getJob(extractId).
   */
  async beginExtract(
    buffer: Buffer,
    originalName: string,
    extractId?: string,
  ): Promise<BeginExtractOutcome> {
    return this.begin(buffer, originalName, extractId, Boolean(extractId));
  }

  private async begin(
    buffer: Buffer,
    originalName: string,
    extractId: string | undefined,
    allowBackground: boolean,
  ): Promise<BeginExtractOutcome> {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('Arquivo PDF vazio.');
    }
    // Assinatura %PDF — rejeita cedo arquivos que não são PDF.
    if (!buffer.subarray(0, 1024).toString('latin1').includes('%PDF')) {
      throw new BadRequestException('O arquivo enviado não parece ser um PDF válido.');
    }

    this.setProgress(extractId, { phase: 'parse', processed: 0, total: 0, done: false });
    let parser: PDFParse | null = null;
    // true quando o parser foi entregue ao job em background (não destruir aqui).
    let handedOff = false;
    try {
      parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await parser.getText();
      const pages = result.total ?? 0;
      const text = this.normalize(result.text ?? '');

      if (!text || text.length < 40) {
        // PDF escaneado (somente imagem) → OCR. Valida a configuração ANTES de
        // responder "pending" para o erro chegar ainda no request de upload.
        const client = this.getOpenAi();
        if (!client) {
          throw new BadRequestException(
            'Este PDF parece ser escaneado (somente imagem) e o OCR não está configurado ' +
              '(defina a chave OPENAI_API_KEY). Converta para PDF com camada de texto ou cole o conteúdo manualmente.',
          );
        }
        if (allowBackground && extractId) {
          this.setJob(extractId, { status: 'pending' });
          handedOff = true;
          void this.runOcrJob(parser, pages, originalName, extractId);
          return { kind: 'pending', pages };
        }
        const ocrResult = await this.ocr(parser, pages, originalName, extractId);
        return {
          kind: 'sync',
          result: {
            text: ocrResult.text,
            pages,
            suggestedTitle: this.titleFromFilename(originalName),
            ocr: true,
            ocrPages: ocrResult.ocrPages,
          },
        };
      }
      return {
        kind: 'sync',
        result: { text, pages, suggestedTitle: this.titleFromFilename(originalName), ocr: false },
      };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.warn(`Falha ao extrair texto do PDF "${originalName}": ${(err as Error).message}`);
      throw new BadRequestException(
        'Falha ao ler o PDF. Verifique se o arquivo não está corrompido ou protegido por senha.',
      );
    } finally {
      if (!handedOff) {
        // Marca done com o último estado conhecido (sucesso ou falha) para o
        // frontend encerrar o polling.
        const last = extractId ? this.progressById.get(extractId) : null;
        this.setProgress(extractId, {
          phase: last?.phase ?? 'parse',
          processed: last?.processed ?? 0,
          total: last?.total ?? 0,
          done: true,
        });
        await parser?.destroy().catch(() => undefined);
      }
    }
  }

  /**
   * Job em segundo plano: OCR completo do scan, com resultado (ou erro claro)
   * publicado em getJob(extractId) para o frontend buscar via polling.
   */
  private async runOcrJob(
    parser: PDFParse,
    pages: number,
    originalName: string,
    extractId: string,
  ): Promise<void> {
    try {
      const ocrResult = await this.ocr(parser, pages, originalName, extractId);
      this.setJob(extractId, {
        status: 'done',
        result: {
          text: ocrResult.text,
          pages,
          suggestedTitle: this.titleFromFilename(originalName),
          ocr: true,
          ocrPages: ocrResult.ocrPages,
        },
      });
    } catch (err) {
      const message =
        err instanceof BadRequestException
          ? err.message
          : 'Falha ao processar o PDF escaneado. Tente novamente em instantes.';
      this.logger.warn(`OCR em background falhou para "${originalName}": ${(err as Error).message}`);
      this.setJob(extractId, { status: 'error', message });
    } finally {
      const last = this.progressById.get(extractId);
      this.setProgress(extractId, {
        phase: last?.phase ?? 'ocr',
        processed: last?.processed ?? 0,
        total: last?.total ?? 0,
        done: true,
      });
      await parser.destroy().catch(() => undefined);
    }
  }

  /**
   * OCR de PDF escaneado: renderiza cada página como imagem e transcreve via
   * modelo de visão. Lança BadRequest com mensagem clara em qualquer falha.
   */
  private async ocr(
    parser: PDFParse,
    pages: number,
    originalName: string,
    extractId?: string,
  ): Promise<{ text: string; ocrPages: number }> {
    const client = this.getOpenAi();
    if (!client) {
      throw new BadRequestException(
        'Este PDF parece ser escaneado (somente imagem) e o OCR não está configurado ' +
          '(defina a chave OPENAI_API_KEY). Converta para PDF com camada de texto ou cole o conteúdo manualmente.',
      );
    }

    const limit = Math.min(pages || MAX_OCR_PAGES, MAX_OCR_PAGES);
    this.setProgress(extractId, { phase: 'render', processed: 0, total: limit, done: false });
    this.logger.log(
      `OCR: transcrevendo até ${limit} página(s) de "${originalName}" (total ${pages}).`,
    );

    // Renderiza e transcreve em lotes: memória fica limitada a OCR_RENDER_BATCH
    // páginas por vez, viabilizando manuais de centenas de páginas.
    const texts: string[] = [];
    let failures = 0;
    let processed = 0;
    let rendered = 0;
    for (let start = 1; start <= limit; start += OCR_RENDER_BATCH) {
      const end = Math.min(start + OCR_RENDER_BATCH - 1, limit);
      const pageNumbers = Array.from({ length: end - start + 1 }, (_, k) => start + k);
      let screenshots: Array<{ pageNumber: number; data: Uint8Array }>;
      try {
        const shot = await parser.getScreenshot({
          partial: pageNumbers,
          desiredWidth: 1400,
          imageDataUrl: false,
          imageBuffer: true,
        });
        screenshots = (shot.pages ?? [])
          .filter((p) => p.data && p.data.length > 0)
          .map((p) => ({ pageNumber: p.pageNumber, data: p.data as Uint8Array }));
      } catch (err) {
        this.logger.warn(
          `OCR: falha ao renderizar páginas ${start}-${end} de "${originalName}": ${(err as Error).message}`,
        );
        if (rendered === 0) {
          throw new BadRequestException(
            'Este PDF parece ser escaneado (somente imagem) e não foi possível preparar as páginas para OCR. ' +
              'Verifique se o arquivo não está corrompido ou protegido por senha.',
          );
        }
        // Já transcrevemos parte do documento: entrega o que temos.
        break;
      }
      // Número de páginas desconhecido (pages=0): fim do documento alcançado.
      if (screenshots.length === 0) break;
      rendered += screenshots.length;

      // Transcreve o lote com concorrência limitada, preservando a ordem.
      this.setProgress(extractId, { phase: 'ocr', processed, total: limit, done: false });
      const batchTexts = new Array<string>(screenshots.length);
      for (let i = 0; i < screenshots.length; i += OCR_CONCURRENCY) {
        const batch = screenshots.slice(i, i + OCR_CONCURRENCY);
        await Promise.all(
          batch.map(async (page, j) => {
            try {
              batchTexts[i + j] = await this.ocrPage(client, page.data);
            } catch (err) {
              failures += 1;
              batchTexts[i + j] = '';
              this.logger.warn(
                `OCR: falha na página ${page.pageNumber} de "${originalName}": ${(err as Error).message}`,
              );
            } finally {
              processed += 1;
              this.setProgress(extractId, {
                phase: 'ocr',
                processed,
                total: limit,
                done: false,
              });
            }
          }),
        );
      }
      texts.push(...batchTexts);
    }

    if (rendered === 0) {
      throw new BadRequestException(
        'Este PDF parece ser escaneado (somente imagem) e não foi possível renderizar nenhuma página para OCR.',
      );
    }

    const text = this.normalize(texts.filter((t) => t.trim()).join('\n\n'));
    if (!text || text.length < 40) {
      throw new BadRequestException(
        failures > 0
          ? 'Falha no OCR deste PDF escaneado: o serviço de transcrição não respondeu. Tente novamente em instantes.'
          : 'O OCR não encontrou texto legível neste PDF escaneado. Verifique a qualidade do scan ou cole o conteúdo manualmente.',
      );
    }
    return { text, ocrPages: rendered };
  }

  /** Transcreve uma página (imagem PNG) via modelo de visão. */
  private async ocrPage(client: OpenAI, png: Uint8Array): Promise<string> {
    const res = await client.chat.completions.create({
      model: OCR_MODEL,
      temperature: 0,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: OCR_PROMPT },
            {
              type: 'image_url',
              image_url: { url: `data:image/png;base64,${Buffer.from(png).toString('base64')}` },
            },
          ],
        },
      ],
    });
    return res.choices[0]?.message?.content?.trim() ?? '';
  }

  /** Normaliza o texto extraído preservando estrutura razoável de seções. */
  private normalize(raw: string): string {
    return raw
      // Postgres rejeita 0x00 em text; remove NUL e demais controles (exceto \n\t).
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/\r\n/g, '\n')
      .replace(PAGE_MARKER, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /** "MCP17_-_Manual_do_integrador_123.pdf" → "MCP17 - Manual do integrador". */
  private titleFromFilename(name: string): string {
    const base = (name || 'Documento').replace(/\.pdf$/i, '');
    return (
      base
        .replace(/_\d{10,}$/, '') // sufixo de timestamp de upload
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || 'Documento'
    );
  }
}
