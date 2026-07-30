import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { OtaUpdateService } from '../src/ota/ota-update.service';

/**
 * Testes do download do pacote OTA:
 * - URL inválida rejeita com mensagem clara (sem token) em vez de "Invalid URL" solto
 * - redirects com Location relativo são resolvidos contra a URL original
 * - redirects absolutos continuam funcionando
 *
 * Fica em test/ (fora de src/) de propósito: os arquivos de src/ são hasheados
 * no gateway-manifest e empacotados na OTA — testes não devem ir a campo.
 * Rodar com: npx jest --config test/jest-unit.json
 */
describe('OtaUpdateService.download', () => {
  const svc = new OtaUpdateService({} as never, {} as never) as unknown as {
    download(url: string, redirects?: number): Promise<Buffer>;
  };

  let server: http.Server;
  let base: string;

  beforeAll((done) => {
    server = http.createServer((req, res) => {
      if (req.url?.startsWith('/relative-redirect')) {
        res.writeHead(302, { Location: '/file?token=SECRETTOKEN' });
        res.end();
      } else if (req.url?.startsWith('/absolute-redirect')) {
        res.writeHead(302, { Location: `${base}/file?token=SECRETTOKEN` });
        res.end();
      } else if (req.url?.startsWith('/file')) {
        res.writeHead(200);
        res.end('conteudo-do-pacote');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      base = `http://127.0.0.1:${port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(() => done());
  });

  it('rejeita URL inválida com mensagem clara (sem lançar exceção síncrona)', async () => {
    await expect(
      svc.download('sem-protocolo/gateways/update-package?token=SECRETTOKEN'),
    ).rejects.toThrow(/URL de download inválida/);
  });

  it('não expõe o token na mensagem de erro de URL inválida', async () => {
    await expect(
      svc.download('://host-quebrado/pacote?token=SECRETTOKEN'),
    ).rejects.not.toThrow(/SECRETTOKEN/);
  });

  it('segue redirect com Location relativo', async () => {
    const buf = await svc.download(`${base}/relative-redirect`);
    expect(buf.toString()).toBe('conteudo-do-pacote');
  });

  it('segue redirect com Location absoluto', async () => {
    const buf = await svc.download(`${base}/absolute-redirect`);
    expect(buf.toString()).toBe('conteudo-do-pacote');
  });

  it('erro HTTP inclui host/caminho tentado, sem o token', async () => {
    const err: Error = await svc
      .download(`${base}/nao-existe?token=SECRETTOKEN`)
      .then(() => {
        throw new Error('deveria ter falhado');
      })
      .catch((e: Error) => e);
    expect(err.message).toContain('HTTP 404');
    expect(err.message).toContain('/nao-existe');
    expect(err.message).not.toContain('SECRETTOKEN');
  });

  it('falha de rede (host inalcançável) inclui o host tentado', async () => {
    await expect(
      svc.download('http://127.0.0.1:1/pacote?token=SECRETTOKEN'),
    ).rejects.toThrow(/127\.0\.0\.1:1/);
  });
});
