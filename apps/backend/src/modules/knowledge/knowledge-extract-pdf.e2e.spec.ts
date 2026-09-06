import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

// Mock do pdf-parse (mesma estratégia do spec unitário): controla o texto
// extraído sem PDFs reais, mantendo o restante do fluxo HTTP real (multer,
// limites de tamanho, decodificação do filename).
const getTextMock = jest.fn();
const getScreenshotMock = jest.fn();
jest.mock('pdf-parse', () => ({
  PDFParse: jest.fn().mockImplementation(() => ({
    getText: getTextMock,
    getScreenshot: getScreenshotMock,
    destroy: jest.fn().mockResolvedValue(undefined),
  })),
}));

// Mock da OpenAI (OCR): os testes de scan controlam a transcrição.
const ocrCreateMock = jest.fn();
jest.mock('openai', () =>
  jest.fn().mockImplementation(() => ({
    chat: { completions: { create: ocrCreateMock } },
  })),
);

import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { MAX_PDF_BYTES, PdfExtractService } from './pdf-extract.service';
import { JwtAuthGuard } from '../auth/presentation/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/presentation/guards/roles.guard';

const LONG_TEXT =
  'Manual técnico completo do equipamento com instruções de instalação e operação suficientes.';

describe('POST /knowledge/extract-pdf (HTTP)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [KnowledgeController],
      providers: [
        PdfExtractService,
        // O endpoint extract-pdf não usa o KnowledgeService; stub vazio basta.
        { provide: KnowledgeService, useValue: {} },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    getTextMock.mockReset();
    getScreenshotMock.mockReset();
    ocrCreateMock.mockReset();
    process.env.OPENAI_API_KEY = 'test-key';
  });

  const server = () => app.getHttpServer();
  const pdfBytes = (pad = 0) =>
    Buffer.concat([Buffer.from('%PDF-1.4 fake'), Buffer.alloc(pad, 0x20)]);

  it('400 quando nenhum arquivo é enviado', async () => {
    const res = await request(server()).post('/knowledge/extract-pdf').expect(400);
    expect(res.body.message).toMatch(/campo "file"/i);
  });

  it('400 para arquivo que não é PDF', async () => {
    const res = await request(server())
      .post('/knowledge/extract-pdf')
      .attach('file', Buffer.from('só texto, sem assinatura'), 'notas.txt')
      .expect(400);
    expect(res.body.message).toMatch(/não parece ser um PDF válido/i);
  });

  it('400 com mensagem clara quando o OCR de um PDF escaneado falha', async () => {
    getTextMock.mockResolvedValue({ text: '', total: 5 });
    getScreenshotMock.mockRejectedValue(new Error('render boom'));
    const res = await request(server())
      .post('/knowledge/extract-pdf')
      .attach('file', pdfBytes(), 'scan.pdf')
      .expect(400);
    expect(res.body.message).toMatch(/escaneado/i);
  });

  it('200 com ocr=true quando um PDF escaneado passa por OCR', async () => {
    getTextMock.mockResolvedValue({ text: '', total: 2 });
    getScreenshotMock.mockResolvedValue({
      pages: [
        { pageNumber: 1, data: new Uint8Array([1, 2, 3]) },
        { pageNumber: 2, data: new Uint8Array([4, 5, 6]) },
      ],
    });
    ocrCreateMock.mockResolvedValue({
      choices: [
        {
          message: {
            content:
              'Texto transcrito por OCR desta página do manual, com conteúdo suficiente.',
          },
        },
      ],
    });
    const res = await request(server())
      .post('/knowledge/extract-pdf')
      .attach('file', pdfBytes(), 'scan.pdf')
      .expect(201);
    expect(res.body.ocr).toBe(true);
    expect(res.body.ocrPages).toBe(2);
    expect(res.body.pages).toBe(2);
    expect(res.body.content).toContain('Texto transcrito por OCR');
  });

  it('200 para PDF válido, com título, texto e páginas', async () => {
    getTextMock.mockResolvedValue({ text: LONG_TEXT, total: 7 });
    const res = await request(server())
      .post('/knowledge/extract-pdf')
      .attach('file', pdfBytes(), 'Manual_do_Integrador.pdf')
      .expect(201);
    expect(res.body).toMatchObject({
      suggestedTitle: 'Manual do Integrador',
      pages: 7,
      truncated: false,
    });
    expect(res.body.content).toContain('Manual técnico completo');
    expect(res.body.chars).toBe(res.body.content.length);
  });

  it('corrige acentos do filename decodificado como latin1 pelo multer', async () => {
    getTextMock.mockResolvedValue({ text: LONG_TEXT, total: 1 });
    // O cliente envia o nome em UTF-8; o multer decodifica como latin1
    // ("Serviço" chega como "ServiÃ§o") e o controller reverte.
    const res = await request(server())
      .post('/knowledge/extract-pdf')
      .attach('file', pdfBytes(), 'Manual_de_Operação.pdf')
      .expect(201);
    expect(res.body.suggestedTitle).toBe('Manual de Operação');
  });

  it('com extractId, scan responde pending e o resultado sai no endpoint /result', async () => {
    getTextMock.mockResolvedValue({ text: '', total: 2 });
    getScreenshotMock.mockImplementation(async (opts: { partial?: number[] }) => ({
      pages: (opts.partial ?? [1, 2]).slice(0, 2).map((n) => ({
        pageNumber: n,
        data: new Uint8Array([1, 2, n]),
      })),
    }));
    ocrCreateMock.mockResolvedValue({
      choices: [
        {
          message: {
            content:
              'Texto transcrito por OCR desta página do manual, com conteúdo suficiente.',
          },
        },
      ],
    });

    const res = await request(server())
      .post('/knowledge/extract-pdf?extractId=e2e-bg-1')
      .attach('file', pdfBytes(), 'scan.pdf')
      .expect(201);
    expect(res.body).toMatchObject({ pending: true, extractId: 'e2e-bg-1', pages: 2 });

    // Polling até o job terminar (OCR roda em segundo plano).
    let result: Record<string, unknown> = {};
    for (let i = 0; i < 100; i += 1) {
      const rr = await request(server()).get('/knowledge/extract-pdf/e2e-bg-1/result').expect(200);
      result = rr.body;
      if (result.status !== 'pending') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(result.status).toBe('done');
    expect(result.ocr).toBe(true);
    expect(result.ocrPages).toBe(2);
    expect(String(result.content)).toContain('Texto transcrito por OCR');
  });

  it('resultado desconhecido responde status unknown (id inválido/expirado)', async () => {
    const rr = await request(server()).get('/knowledge/extract-pdf/nao-existe/result').expect(200);
    expect(rr.body).toEqual({ status: 'unknown' });
  });

  it('413 para arquivo acima do limite de tamanho', async () => {
    // 1 byte acima do teto — o multer corta antes de chegar ao service.
    await request(server())
      .post('/knowledge/extract-pdf')
      .attach('file', pdfBytes(MAX_PDF_BYTES + 1), 'gigante.pdf')
      .expect(413);
    expect(getTextMock).not.toHaveBeenCalled();
  });
});
