import { spawn, ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { join } from 'node:path';

/**
 * Launcher OTA (agent/run.js) à prova de brick — roda o run.js REAL num
 * diretório temporário e cobre:
 *   - apply normal (staging → raiz, pending-verify só após a troca completa);
 *   - retentativa em erro transitório do Windows (EPERM/EBUSY simulados via
 *     BLUEBEE_LAUNCHER_TEST_FAULTS, injeção inerte fora dos testes);
 *   - falha DEFINITIVA no apply → desfaz os movimentos, mantém a versão atual
 *     rodando e grava ota-result.json (nunca crasha o launcher);
 *   - rollback com erro transitório no meio;
 *   - recuperação de estado meio-aplicado no boot (raiz sem dist/main.js),
 *     restaurando de previous/ ou promovendo staging/.
 *
 * Fica em test/ (fora de src/) de propósito — src/ é hasheado no
 * gateway-manifest e empacotado na OTA. Rodar com:
 *   npx jest --config test/jest-unit.json
 */

const RUN_JS = join(__dirname, '..', 'agent', 'run.js');

/** dist/main.js "antigo": marca que rodou e fica vivo. */
const OLD_MAIN = `
const fs = require('fs'); const path = require('path');
fs.writeFileSync(path.join(__dirname, '..', 'ran-old.txt'), 'old');
setInterval(() => {}, 1000);
`;

/** dist/main.js "novo" que confirma a atualização (apaga o pending-verify). */
const NEW_MAIN_OK = `
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
fs.writeFileSync(path.join(root, 'ran-new.txt'), 'new');
fs.rmSync(path.join(root, 'update', 'pending-verify.json'), { force: true });
setInterval(() => {}, 1000);
`;

/** dist/main.js "novo" quebrado: sai imediatamente sem confirmar. */
const NEW_MAIN_BAD = `process.exit(1);`;

/** Como o NEW_MAIN_OK, mas salva uma cópia do pending-verify antes de apagar
 * (para o teste inspecionar os avisos registrados pelo launcher). */
const NEW_MAIN_OK_SAVE_PENDING = `
const fs = require('fs'); const path = require('path');
const root = path.join(__dirname, '..');
const pending = path.join(root, 'update', 'pending-verify.json');
try { fs.copyFileSync(pending, path.join(root, 'pending-copy.json')); } catch {}
fs.writeFileSync(path.join(root, 'ran-new.txt'), 'new');
fs.rmSync(pending, { force: true });
setInterval(() => {}, 1000);
`;

const INFO = {
  command_id: 'cmd-1',
  tenant_id: 'tenant-a',
  gateway_id: 'gw-teste',
  version: '2.0.0',
  previousVersion: '1.0.0',
};

function writeInstall(dir: string, main: string, extraItems: string[] = []) {
  fs.mkdirSync(join(dir, 'dist'), { recursive: true });
  fs.writeFileSync(join(dir, 'dist', 'main.js'), main);
  fs.writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'gw', version: '0.0.0' }));
  for (const item of extraItems) {
    fs.mkdirSync(join(dir, item), { recursive: true });
    fs.writeFileSync(join(dir, item, 'placeholder.txt'), item);
  }
}

async function waitFor(pred: () => boolean, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return pred();
}

describe('launcher run.js — resiliência de apply/rollback (à prova de brick)', () => {
  let dir: string;
  let child: ChildProcess | null = null;

  function launch(env: Record<string, string> = {}): ChildProcess {
    child = spawn(process.execPath, [join(dir, 'run.js')], {
      cwd: dir,
      stdio: 'ignore',
      env: {
        ...process.env,
        // Acelera o teste sem mudar a lógica (mesmos caminhos de código).
        BLUEBEE_VERIFY_POLL_MS: '200',
        BLUEBEE_RESPAWN_DELAY_MS: '200',
        BLUEBEE_SWAP_RETRY_ATTEMPTS: '3',
        BLUEBEE_SWAP_PRIMARY_RETRY_ATTEMPTS: '3',
        BLUEBEE_SWAP_RETRY_BASE_MS: '50',
        ...env,
      },
    });
    return child;
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(join(os.tmpdir(), 'bluebee-launcher-'));
    fs.copyFileSync(RUN_JS, join(dir, 'run.js'));
  });

  afterEach(() => {
    child?.kill('SIGKILL');
    child = null;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('apply normal: troca staging → raiz, confirma e limpa previous/', async () => {
    writeInstall(dir, OLD_MAIN, ['node_modules']);
    fs.mkdirSync(join(dir, 'update', 'staging'), { recursive: true });
    writeInstall(join(dir, 'update', 'staging'), NEW_MAIN_OK, ['node_modules']);
    fs.writeFileSync(join(dir, 'update', 'apply.json'), JSON.stringify(INFO));

    launch();

    expect(await waitFor(() => fs.existsSync(join(dir, 'ran-new.txt')))).toBe(true);
    // pending-verify foi escrito após a troca e consumido pelo gateway novo.
    expect(fs.existsSync(join(dir, 'update', 'pending-verify.json'))).toBe(false);
    // staging e apply.json consumidos; previous/ limpo após a confirmação.
    expect(fs.existsSync(join(dir, 'update', 'staging'))).toBe(false);
    expect(fs.existsSync(join(dir, 'update', 'apply.json'))).toBe(false);
    expect(await waitFor(() => !fs.existsSync(join(dir, 'previous')))).toBe(true);
  }, 30_000);

  it('erro transitório (EPERM) durante o apply: retenta e completa a troca', async () => {
    writeInstall(dir, OLD_MAIN, ['node_modules']);
    fs.mkdirSync(join(dir, 'update', 'staging'), { recursive: true });
    writeInstall(join(dir, 'update', 'staging'), NEW_MAIN_OK, ['node_modules']);
    fs.writeFileSync(join(dir, 'update', 'apply.json'), JSON.stringify(INFO));

    launch({
      BLUEBEE_LAUNCHER_TEST_FAULTS: JSON.stringify({ rename: { times: 2, code: 'EPERM' } }),
    });

    expect(await waitFor(() => fs.existsSync(join(dir, 'ran-new.txt')))).toBe(true);
    expect(fs.existsSync(join(dir, 'update', 'staging'))).toBe(false);
  }, 30_000);

  it('falha DEFINITIVA no apply: desfaz movimentos, mantém a versão atual e grava ota-result', async () => {
    writeInstall(dir, OLD_MAIN, ['node_modules']);
    fs.mkdirSync(join(dir, 'update', 'staging'), { recursive: true });
    writeInstall(join(dir, 'update', 'staging'), NEW_MAIN_OK, ['node_modules']);
    fs.writeFileSync(join(dir, 'update', 'apply.json'), JSON.stringify(INFO));

    // Todo rename E toda cópia com destino contendo "node_modules" falham
    // SEMPRE (sem times) → esgota retentativas + fallback de cópia num item
    // CRÍTICO e força o caminho de undo.
    launch({
      BLUEBEE_LAUNCHER_TEST_FAULTS: JSON.stringify({
        rename: { match: 'node_modules', code: 'EPERM' },
        copy: { match: 'node_modules', code: 'EPERM' },
      }),
    });

    // O launcher NÃO morre: desfaz e inicia a versão atual normalmente.
    expect(await waitFor(() => fs.existsSync(join(dir, 'ran-old.txt')))).toBe(true);

    const resultPath = join(dir, 'update', 'ota-result.json');
    expect(await waitFor(() => fs.existsSync(resultPath))).toBe(true);
    const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    expect(result.status).toBe('failed');
    expect(result.command_id).toBe('cmd-1');
    expect(String(result.error)).toContain('desfeita');
    // Erro transitório persistente → a mensagem traz a dica de antivírus/OneDrive.
    expect(String(result.error)).toContain('antivírus');

    // Instalação atual íntegra e atualização descartada (não fica em loop).
    expect(fs.readFileSync(join(dir, 'dist', 'main.js'), 'utf8')).toContain('ran-old');
    expect(fs.existsSync(join(dir, 'update', 'apply.json'))).toBe(false);
    expect(fs.existsSync(join(dir, 'update', 'pending-verify.json'))).toBe(false);
  }, 30_000);

  it('EPERM persistente em item NÃO crítico (src): atualização conclui com aviso', async () => {
    writeInstall(dir, OLD_MAIN, ['node_modules', 'src']);
    fs.mkdirSync(join(dir, 'update', 'staging'), { recursive: true });
    writeInstall(join(dir, 'update', 'staging'), NEW_MAIN_OK_SAVE_PENDING, ['node_modules', 'src']);
    fs.writeFileSync(join(dir, 'update', 'apply.json'), JSON.stringify(INFO));

    // Pasta "src" travada para SEMPRE: rename e fallback de cópia falham.
    launch({
      BLUEBEE_LAUNCHER_TEST_FAULTS: JSON.stringify({
        rename: { match: 'src', code: 'EPERM' },
        copy: { match: 'src', code: 'EPERM' },
      }),
    });

    // A troca dos itens críticos prossegue e a nova versão sobe e confirma.
    expect(await waitFor(() => fs.existsSync(join(dir, 'ran-new.txt')))).toBe(true);
    expect(await waitFor(() => !fs.existsSync(join(dir, 'update', 'pending-verify.json')))).toBe(true);

    // O pending-verify levava os avisos sobre o item travado.
    const pending = JSON.parse(fs.readFileSync(join(dir, 'pending-copy.json'), 'utf8'));
    expect(Array.isArray(pending.warnings)).toBe(true);
    expect(pending.warnings.join(' ')).toContain('src');
    expect(pending.command_id).toBe('cmd-1');

    // Itens críticos trocados de fato; nada de rollback.
    expect(fs.readFileSync(join(dir, 'dist', 'main.js'), 'utf8')).toContain('ran-new');
    expect(fs.existsSync(join(dir, 'update', 'ota-result.json'))).toBe(false);
  }, 30_000);

  it('rename bloqueado em item crítico: fallback de CÓPIA completa a troca', async () => {
    writeInstall(dir, OLD_MAIN, ['node_modules']);
    fs.mkdirSync(join(dir, 'update', 'staging'), { recursive: true });
    writeInstall(join(dir, 'update', 'staging'), NEW_MAIN_OK, ['node_modules']);
    fs.writeFileSync(join(dir, 'update', 'staging', 'node_modules', 'novo.txt'), 'novo');
    fs.writeFileSync(join(dir, 'update', 'apply.json'), JSON.stringify(INFO));

    // Rename de node_modules falha SEMPRE (sem times) — só a cópia funciona.
    launch({
      BLUEBEE_LAUNCHER_TEST_FAULTS: JSON.stringify({
        rename: { match: 'node_modules', code: 'EPERM' },
      }),
    });

    expect(await waitFor(() => fs.existsSync(join(dir, 'ran-new.txt')))).toBe(true);
    // node_modules chegou à raiz por cópia, com o conteúdo da versão nova.
    expect(fs.existsSync(join(dir, 'node_modules', 'novo.txt'))).toBe(true);
    expect(await waitFor(() => !fs.existsSync(join(dir, 'update', 'pending-verify.json')))).toBe(true);
    expect(fs.existsSync(join(dir, 'update', 'ota-result.json'))).toBe(false);
  }, 30_000);

  it('rollback com erro transitório (EBUSY) no meio: retenta e restaura a anterior', async () => {
    // Estado pós-apply: raiz com a versão nova (quebrada), previous/ com a antiga.
    writeInstall(dir, NEW_MAIN_BAD, ['node_modules']);
    fs.mkdirSync(join(dir, 'previous'), { recursive: true });
    writeInstall(join(dir, 'previous'), OLD_MAIN, ['node_modules']);
    fs.mkdirSync(join(dir, 'update'), { recursive: true });
    fs.writeFileSync(join(dir, 'update', 'pending-verify.json'), JSON.stringify(INFO));

    launch({
      BLUEBEE_LAUNCHER_TEST_FAULTS: JSON.stringify({ rm: { times: 2, code: 'EBUSY' } }),
    });

    expect(await waitFor(() => fs.existsSync(join(dir, 'ran-old.txt')))).toBe(true);

    const result = JSON.parse(fs.readFileSync(join(dir, 'update', 'ota-result.json'), 'utf8'));
    expect(result.status).toBe('rolled_back');
    expect(result.version).toBe('2.0.0');
    expect(fs.existsSync(join(dir, 'update', 'pending-verify.json'))).toBe(false);
    expect(fs.existsSync(join(dir, 'previous'))).toBe(false);
  }, 30_000);

  it('boot meio-aplicado: raiz sem dist/main.js é reparada a partir de previous/', async () => {
    // Crash no meio da troca: raiz sem dist (sobrou lixo), previous/ válido,
    // sem marcadores (apply/pending perdidos no crash).
    fs.mkdirSync(join(dir, 'node_modules'), { recursive: true });
    fs.writeFileSync(join(dir, 'node_modules', 'leftover.txt'), 'x');
    fs.mkdirSync(join(dir, 'previous'), { recursive: true });
    writeInstall(join(dir, 'previous'), OLD_MAIN, ['node_modules']);

    launch();

    expect(await waitFor(() => fs.existsSync(join(dir, 'ran-old.txt')))).toBe(true);

    const result = JSON.parse(fs.readFileSync(join(dir, 'update', 'ota-result.json'), 'utf8'));
    expect(result.status).toBe('rolled_back');
    expect(String(result.error)).toContain('inconsistente');
    expect(fs.existsSync(join(dir, 'previous'))).toBe(false);
  }, 30_000);

  it('boot meio-aplicado sem previous/: promove a cópia válida de staging/ (com verificação)', async () => {
    // Raiz quebrada, só o staging tem uma cópia válida da versão nova.
    fs.mkdirSync(join(dir, 'update', 'staging'), { recursive: true });
    writeInstall(join(dir, 'update', 'staging'), NEW_MAIN_OK, ['node_modules']);
    fs.writeFileSync(join(dir, 'update', 'apply.json'), JSON.stringify(INFO));

    launch();

    // A versão promovida sobe e confirma (apaga o pending-verify recriado).
    expect(await waitFor(() => fs.existsSync(join(dir, 'ran-new.txt')))).toBe(true);
    expect(await waitFor(() => !fs.existsSync(join(dir, 'update', 'pending-verify.json')))).toBe(true);
    expect(fs.existsSync(join(dir, 'update', 'staging'))).toBe(false);
  }, 30_000);
});
