import { BadRequestException } from '@nestjs/common';

// Mock do pdf-parse: cada teste controla o texto/total retornados sem depender
// de um PDF real (determinístico e rápido).
const getTextMock = jest.fn();
const getScreenshotMock = jest.fn();
const destroyMock = jest.fn().mockResolvedValue(undefined);
jest.mock('pdf-parse', () => ({
  PDFParse: jest.fn().mockImplementation(() => ({
    getText: getTextMock,
    getScreenshot: getScreenshotMock,
    destroy: destroyMock,
  })),
}));

// Mock da OpenAI (OCR de páginas escaneadas): cada teste controla a transcrição.
const ocrCreateMock = jest.fn();
jest.mock('openai', () =>
  jest.fn().mockImplementation(() => ({
    chat: { completions: { create: ocrCreateMock } },
  })),
);

import { PdfExtractService } from './pdf-extract.service';

// Buffer com assinatura %PDF válida (o conteúdo real vem do mock).
const pdfBuffer = () => Buffer.from('%PDF-1.4 conteudo-fake');

const LONG_TEXT =
  'Manual do equipamento. Este texto tem mais de quarenta caracteres para passar na validação.';

describe('PdfExtractService', () => {
  let service: PdfExtractService;

  beforeEach(() => {
    service = new PdfExtractService();
    getTextMock.mockReset();
    getScreenshotMock.mockReset();
    ocrCreateMock.mockReset();
    destroyMock.mockClear();
    process.env.OPENAI_API_KEY = 'test-key';
  });

  describe('validações de entrada', () => {
    it('rejeita buffer vazio com erro claro', async () => {
      await expect(service.extract(Buffer.alloc(0), 'a.pdf')).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.extract(Buffer.alloc(0), 'a.pdf')).rejects.toThrow(/vazio/i);
    });

    it('rejeita arquivo sem assinatura %PDF (não é PDF)', async () => {
      const fake = Buffer.from('isto é um txt qualquer, não um pdf');
      await expect(service.extract(fake, 'a.pdf')).rejects.toThrow(
        /não parece ser um PDF válido/i,
      );
      // Nem deve tentar parsear.
      expect(getTextMock).not.toHaveBeenCalled();
    });
  });

  describe('normalização do texto extraído', () => {
    it('remove NUL e demais caracteres de controle (Postgres rejeita 0x00)', async () => {
      getTextMock.mockResolvedValue({
        text: `Prime\u0000ira parte\u0001 do manual.\u0007 Continua\u001Fção com mais texto suficiente aqui.`,
        total: 1,
      });
      const r = await service.extract(pdfBuffer(), 'manual.pdf');
      expect(r.text).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/);
      expect(r.text).toContain('Primeira parte do manual.');
      expect(r.text).toContain('Continuação');
    });

    it('preserva \\n e \\t durante a limpeza de controles', async () => {
      getTextMock.mockResolvedValue({
        text: `Linha um do manual técnico.\n\tLinha dois indentada com conteúdo suficiente.`,
        total: 1,
      });
      const r = await service.extract(pdfBuffer(), 'manual.pdf');
      expect(r.text).toContain('\n\tLinha dois');
    });

    it('converte marcadores de página "-- N of M --" em quebras de parágrafo', async () => {
      getTextMock.mockResolvedValue({
        text: `Fim da página um com bastante texto informativo.\n-- 1 of 3 --\nInício da página dois também com texto.`,
        total: 3,
      });
      const r = await service.extract(pdfBuffer(), 'manual.pdf');
      expect(r.text).not.toMatch(/-- 1 of 3 --/);
      expect(r.text).toBe(
        'Fim da página um com bastante texto informativo.\n\nInício da página dois também com texto.',
      );
    });

    it('normaliza \\r\\n, espaços no fim de linha e colapsa 3+ quebras em 2', async () => {
      getTextMock.mockResolvedValue({
        text: `Primeira linha do manual técnico completo.   \r\n\r\n\r\n\r\nSegunda seção do documento em questão.`,
        total: 1,
      });
      const r = await service.extract(pdfBuffer(), 'manual.pdf');
      expect(r.text).toBe(
        'Primeira linha do manual técnico completo.\n\nSegunda seção do documento em questão.',
      );
    });
  });

  describe('PDF escaneado (sem camada de texto) → OCR', () => {
    const OCR_TEXT =
      'Página transcrita por OCR com conteúdo técnico suficiente para passar na validação.';
    const screenshotPages = (n: number) => ({
      pages: Array.from({ length: n }, (_, i) => ({
        pageNumber: i + 1,
        data: new Uint8Array([137, 80, 78, 71, i]),
      })),
    });

    it('roda OCR quando não há texto e retorna ocr=true com o texto transcrito', async () => {
      getTextMock.mockResolvedValue({ text: '', total: 2 });
      getScreenshotMock.mockResolvedValue(screenshotPages(2));
      ocrCreateMock.mockResolvedValue({
        choices: [{ message: { content: OCR_TEXT } }],
      });
      const r = await service.extract(pdfBuffer(), 'scan.pdf');
      expect(r.ocr).toBe(true);
      expect(r.ocrPages).toBe(2);
      expect(r.pages).toBe(2);
      expect(r.text).toContain('Página transcrita por OCR');
      expect(ocrCreateMock).toHaveBeenCalledTimes(2);
    });

    it('publica progresso página a página via getProgress e marca done ao final', async () => {
      getTextMock.mockResolvedValue({ text: '', total: 3 });
      getScreenshotMock.mockResolvedValue(screenshotPages(3));
      const seen: Array<{ phase: string; processed: number; total: number }> = [];
      ocrCreateMock.mockImplementation(async () => {
        const p = service.getProgress('ext-1');
        if (p) seen.push({ phase: p.phase, processed: p.processed, total: p.total });
        return { choices: [{ message: { content: OCR_TEXT } }] };
      });
      await service.extract(pdfBuffer(), 'scan.pdf', 'ext-1');
      // Durante o OCR a fase é 'ocr' e o total reflete as páginas renderizadas.
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((p) => p.phase === 'ocr' && p.total === 3)).toBe(true);
      // Ao final, progresso completo e done=true (frontend encerra o polling).
      const final = service.getProgress('ext-1');
      expect(final).toMatchObject({ phase: 'ocr', processed: 3, total: 3, done: true });
    });

    it('marca done mesmo quando a extração falha (renderização quebra)', async () => {
      getTextMock.mockResolvedValue({ text: '', total: 2 });
      getScreenshotMock.mockRejectedValue(new Error('render boom'));
      await expect(service.extract(pdfBuffer(), 'scan.pdf', 'ext-2')).rejects.toThrow();
      expect(service.getProgress('ext-2')?.done).toBe(true);
    });

    it('roda OCR também quando o texto é curto demais (< 40 chars)', async () => {
      getTextMock.mockResolvedValue({ text: 'pouco texto', total: 1 });
      getScreenshotMock.mockResolvedValue(screenshotPages(1));
      ocrCreateMock.mockResolvedValue({
        choices: [{ message: { content: OCR_TEXT } }],
      });
      const r = await service.extract(pdfBuffer(), 'scan.pdf');
      expect(r.ocr).toBe(true);
    });

    it('falha com mensagem clara quando o OCR não está configurado (sem chave)', async () => {
      delete process.env.OPENAI_API_KEY;
      getTextMock.mockResolvedValue({ text: '', total: 3 });
      await expect(service.extract(pdfBuffer(), 'scan.pdf')).rejects.toThrow(
        /escaneado.*OCR não está configurado/i,
      );
      expect(getScreenshotMock).not.toHaveBeenCalled();
    });

    it('falha com mensagem clara quando a renderização das páginas falha', async () => {
      getTextMock.mockResolvedValue({ text: '', total: 3 });
      getScreenshotMock.mockRejectedValue(new Error('render boom'));
      await expect(service.extract(pdfBuffer(), 'scan.pdf')).rejects.toThrow(
        /escaneado.*OCR/i,
      );
    });

    it('falha quando o serviço de OCR não responde em nenhuma página', async () => {
      getTextMock.mockResolvedValue({ text: '', total: 2 });
      getScreenshotMock.mockResolvedValue(screenshotPages(2));
      ocrCreateMock.mockRejectedValue(new Error('rate limit'));
      await expect(service.extract(pdfBuffer(), 'scan.pdf')).rejects.toThrow(
        /Falha no OCR/i,
      );
    });

    it('falha quando o OCR não encontra texto legível', async () => {
      getTextMock.mockResolvedValue({ text: '', total: 1 });
      getScreenshotMock.mockResolvedValue(screenshotPages(1));
      ocrCreateMock.mockResolvedValue({ choices: [{ message: { content: '' } }] });
      await expect(service.extract(pdfBuffer(), 'scan.pdf')).rejects.toThrow(
        /não encontrou texto legível/i,
      );
    });

    it('PDF com camada de texto retorna ocr=false sem chamar OCR', async () => {
      getTextMock.mockResolvedValue({ text: LONG_TEXT, total: 1 });
      const r = await service.extract(pdfBuffer(), 'manual.pdf');
      expect(r.ocr).toBe(false);
      expect(getScreenshotMock).not.toHaveBeenCalled();
      expect(ocrCreateMock).not.toHaveBeenCalled();
    });
  });

  describe('beginExtract (OCR em segundo plano)', () => {
    const OCR_TEXT =
      'Página transcrita por OCR com conteúdo técnico suficiente para passar na validação.';
    const screenshotPages = (n: number) => ({
      pages: Array.from({ length: n }, (_, i) => ({
        pageNumber: i + 1,
        data: new Uint8Array([137, 80, 78, 71, i]),
      })),
    });
    const waitJobDone = async (id: string) => {
      for (let i = 0; i < 200; i += 1) {
        const job = service.getJob(id);
        if (job && job.status !== 'pending') return job;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error('job não terminou');
    };

    it('PDF com camada de texto retorna síncrono (sem job)', async () => {
      getTextMock.mockResolvedValue({ text: LONG_TEXT, total: 3 });
      const outcome = await service.beginExtract(pdfBuffer(), 'manual.pdf', 'bg-0');
      expect(outcome.kind).toBe('sync');
      expect(service.getJob('bg-0')).toBeNull();
    });

    it('scan retorna pending e publica o resultado completo no job', async () => {
      getTextMock.mockResolvedValue({ text: '', total: 3 });
      getScreenshotMock.mockResolvedValue(screenshotPages(3));
      ocrCreateMock.mockResolvedValue({ choices: [{ message: { content: OCR_TEXT } }] });

      const outcome = await service.beginExtract(pdfBuffer(), 'scan.pdf', 'bg-1');
      expect(outcome).toMatchObject({ kind: 'pending', pages: 3 });
      expect(service.getJob('bg-1')?.status).toBe('pending');

      const job = await waitJobDone('bg-1');
      expect(job.status).toBe('done');
      if (job.status === 'done') {
        expect(job.result.ocr).toBe(true);
        expect(job.result.ocrPages).toBe(3);
        expect(job.result.text).toContain('Página transcrita por OCR');
      }
      // Progresso marcado como done → frontend encerra o polling.
      expect(service.getProgress('bg-1')?.done).toBe(true);
    });

    it('scan com falha de OCR publica erro claro no job (não some silenciosamente)', async () => {
      getTextMock.mockResolvedValue({ text: '', total: 2 });
      getScreenshotMock.mockRejectedValue(new Error('render boom'));
      const outcome = await service.beginExtract(pdfBuffer(), 'scan.pdf', 'bg-2');
      expect(outcome.kind).toBe('pending');
      const job = await waitJobDone('bg-2');
      expect(job.status).toBe('error');
      if (job.status === 'error') expect(job.message).toMatch(/escaneado/i);
    });

    it('sem OPENAI_API_KEY falha ainda no request (nunca vira pending)', async () => {
      delete process.env.OPENAI_API_KEY;
      getTextMock.mockResolvedValue({ text: '', total: 3 });
      await expect(service.beginExtract(pdfBuffer(), 'scan.pdf', 'bg-3')).rejects.toThrow(
        /OCR não está configurado/i,
      );
      expect(service.getJob('bg-3')).toBeNull();
    });

    it('sem extractId cai no modo síncrono (compatibilidade)', async () => {
      getTextMock.mockResolvedValue({ text: '', total: 1 });
      getScreenshotMock.mockResolvedValue(screenshotPages(1));
      ocrCreateMock.mockResolvedValue({ choices: [{ message: { content: OCR_TEXT } }] });
      const outcome = await service.beginExtract(pdfBuffer(), 'scan.pdf');
      expect(outcome.kind).toBe('sync');
    });
  });

  describe('OCR em lotes (manuais grandes)', () => {
    it('renderiza por faixas de páginas (partial) em vez do PDF inteiro de uma vez', async () => {
      const OCR_TEXT =
        'Página transcrita por OCR com conteúdo técnico suficiente para passar na validação.';
      getTextMock.mockResolvedValue({ text: '', total: 20 });
      getScreenshotMock.mockImplementation(async (opts: { partial?: number[] }) => ({
        pages: (opts.partial ?? []).map((n) => ({
          pageNumber: n,
          data: new Uint8Array([137, 80, 78, 71, n]),
        })),
      }));
      ocrCreateMock.mockResolvedValue({ choices: [{ message: { content: OCR_TEXT } }] });
      const r = await service.extract(pdfBuffer(), 'grande.pdf');
      expect(r.ocr).toBe(true);
      expect(r.ocrPages).toBe(20);
      // 20 páginas em lotes de 8 → 3 chamadas de render (1-8, 9-16, 17-20).
      expect(getScreenshotMock).toHaveBeenCalledTimes(3);
      expect(getScreenshotMock.mock.calls[0][0].partial).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(getScreenshotMock.mock.calls[2][0].partial).toEqual([17, 18, 19, 20]);
      expect(ocrCreateMock).toHaveBeenCalledTimes(20);
    });
  });

  describe('falha de parse', () => {
    it('converte erro do parser em BadRequest amigável (corrompido/senha)', async () => {
      getTextMock.mockRejectedValue(new Error('bad XRef entry'));
      await expect(service.extract(pdfBuffer(), 'quebrado.pdf')).rejects.toThrow(
        /corrompido ou protegido por senha/i,
      );
    });

    it('sempre destrói o parser, mesmo em erro', async () => {
      getTextMock.mockRejectedValue(new Error('boom'));
      await expect(service.extract(pdfBuffer(), 'x.pdf')).rejects.toThrow(
        BadRequestException,
      );
      expect(destroyMock).toHaveBeenCalled();
    });
  });

  describe('título sugerido a partir do nome do arquivo', () => {
    const extractTitle = async (name: string) => {
      getTextMock.mockResolvedValue({ text: LONG_TEXT, total: 1 });
      return (await service.extract(pdfBuffer(), name)).suggestedTitle;
    };

    it('troca underscores por espaço e remove extensão .pdf', async () => {
      expect(await extractTitle('MCP17_-_Manual_do_integrador.pdf')).toBe(
        'MCP17 - Manual do integrador',
      );
    });

    it('remove sufixo de timestamp de upload', async () => {
      expect(await extractTitle('Manual_do_integrador_1721990000000.pdf')).toBe(
        'Manual do integrador',
      );
    });

    it('preserva acentos (nome já decodificado como UTF-8)', async () => {
      expect(await extractTitle('Manual_de_Instalação_e_Operação.pdf')).toBe(
        'Manual de Instalação e Operação',
      );
    });

    it('usa "Documento" como fallback para nome vazio', async () => {
      expect(await extractTitle('.pdf')).toBe('Documento');
      expect(await extractTitle('')).toBe('Documento');
    });
  });

  it('retorna páginas e texto do parser', async () => {
    getTextMock.mockResolvedValue({ text: LONG_TEXT, total: 42 });
    const r = await service.extract(pdfBuffer(), 'manual.pdf');
    expect(r.pages).toBe(42);
    expect(r.text).toBe(LONG_TEXT.trim());
  });
});
