import { spawn, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';

/**
 * Rollback do launcher (agent/run.js) SEM um previous/ válido:
 * antes, o marcador pending-verify.json era removido em silêncio e o backend
 * nunca recebia um estado terminal. Agora o launcher grava um
 * update/ota-result.json com status 'failed' — publicado pelo gateway no
 * próximo boot.
 *
 * O teste roda o run.js real num diretório temporário: sem dist/main.js e com
 * pending-verify.json presente, o startLoop dispara rollback('dist/main.js
 * ausente') imediatamente.
 *
 * Fica em test/ (fora de src/) de propósito — ver nota em ota-download.spec.ts.
 */
describe('launcher run.js — rollback sem previous/ válido', () => {
  let dir: string;
  let child: ChildProcess | null = null;

  beforeEach(() => {
    dir = fs.mkdtempSync(join(os.tmpdir(), 'bluebee-launcher-'));
    fs.copyFileSync(join(__dirname, '..', 'agent', 'run.js'), join(dir, 'run.js'));
    fs.mkdirSync(join(dir, 'update'), { recursive: true });
    fs.writeFileSync(
      join(dir, 'update', 'pending-verify.json'),
      JSON.stringify({
        command_id: 'cmd-42',
        tenant_id: 'nis',
        gateway_id: 'gw-nis-nis-teste-bluebee',
        version: '1.11.1',
        previousVersion: '1.9.0',
      }),
    );
    // Sem dist/main.js e sem previous/ — cenário do rollback impossível.
  });

  afterEach(() => {
    child?.kill('SIGKILL');
    child = null;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('grava ota-result.json de falha em vez de sumir em silêncio', async () => {
    child = spawn(process.execPath, [join(dir, 'run.js')], {
      cwd: dir,
      stdio: 'ignore',
    });

    const resultPath = join(dir, 'update', 'ota-result.json');
    const deadline = Date.now() + 10_000;
    while (!fs.existsSync(resultPath) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(fs.existsSync(resultPath)).toBe(true);

    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    expect(result.status).toBe('failed');
    expect(result.command_id).toBe('cmd-42');
    expect(result.gateway_id).toBe('gw-nis-nis-teste-bluebee');
    expect(result.version).toBe('1.11.1');
    expect(String(result.error)).toContain('previous/');

    // O marcador de verificação foi consumido (não fica pendurado).
    expect(fs.existsSync(join(dir, 'update', 'pending-verify.json'))).toBe(false);
  }, 20_000);
});
