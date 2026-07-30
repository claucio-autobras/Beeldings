#!/usr/bin/env node
/* ===========================================================================
 * BlueBee IoT Gateway — Launcher OTA (run.js)
 *
 * O serviço (systemd/NSSM) executa ESTE arquivo, não o dist/main.js direto.
 * Responsabilidades:
 *   1. Aplicar atualização preparada em update/staging (troca atômica por
 *      rename: versão atual vai para previous/, staging vira a versão ativa).
 *   2. Iniciar o gateway (node dist/main.js) como processo filho e reiniciá-lo
 *      sempre que cair (além do Restart do próprio serviço).
 *   3. Watchdog pós-atualização: se o gateway cair antes de estabilizar
 *      (marcador update/pending-verify.json ainda presente), restaura a
 *      versão anterior automaticamente e registra o rollback em
 *      update/ota-result.json — o gateway restaurado reporta a falha à
 *      plataforma ao reconectar.
 *
 * Este arquivo NÃO é substituído pela OTA (só uma reinstalação manual o
 * atualiza) — mantenha-o simples e sem dependências externas.
 * ========================================================================= */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const UPDATE_DIR = path.join(ROOT, 'update');
const STAGING = path.join(UPDATE_DIR, 'staging');
const APPLY = path.join(UPDATE_DIR, 'apply.json');
const PENDING = path.join(UPDATE_DIR, 'pending-verify.json');
const RESULT = path.join(UPDATE_DIR, 'ota-result.json');
const PREVIOUS = path.join(ROOT, 'previous');

/* Itens trocados numa atualização (o .env e o run.js ficam intocados). */
const ITEMS = [
  'src',
  'dist',
  'node_modules',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.build.json',
  'nest-cli.json',
];

/* A atualização SÓ é aceita quando o próprio gateway confirma que reconectou
 * ao MQTT (ele apaga o pending-verify.json nesse momento). O launcher nunca
 * aceita por tempo de vida do processo: se o pending-verify continuar presente
 * após VERIFY_TIMEOUT_MS (processo vivo mas sem reconectar) ou se o processo
 * cair com ele presente, faz rollback. */
const VERIFY_TIMEOUT_MS = 10 * 60 * 1000;
const VERIFY_POLL_MS = 15000;
const RESPAWN_DELAY_MS = 5000;

function log(msg) {
  console.log(`[launcher] ${new Date().toISOString()} ${msg}`);
}

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return {};
  }
}

function moveIfExists(from, to) {
  if (!fs.existsSync(from)) return;
  fs.rmSync(to, { recursive: true, force: true });
  fs.renameSync(from, to);
}

/** Aplica uma atualização preparada (update/staging → raiz). */
function applyStagedUpdate() {
  if (!fs.existsSync(APPLY)) return;
  if (!fs.existsSync(path.join(STAGING, 'dist', 'main.js'))) {
    log('apply.json presente mas staging invalido — descartando atualizacao');
    fs.rmSync(UPDATE_DIR, { recursive: true, force: true });
    return;
  }

  const info = readJson(APPLY);
  log(`aplicando atualizacao para v${info.version || '?'}...`);

  fs.rmSync(PREVIOUS, { recursive: true, force: true });
  fs.mkdirSync(PREVIOUS, { recursive: true });

  for (const item of ITEMS) {
    moveIfExists(path.join(ROOT, item), path.join(PREVIOUS, item));
  }
  for (const item of ITEMS) {
    moveIfExists(path.join(STAGING, item), path.join(ROOT, item));
  }

  fs.writeFileSync(PENDING, JSON.stringify(info, null, 2));
  fs.rmSync(STAGING, { recursive: true, force: true });
  fs.rmSync(APPLY, { force: true });
  log('atualizacao aplicada — iniciando a nova versao');
}

/** Restaura a versão anterior após falha da nova versão. */
function rollback(reason) {
  const info = readJson(PENDING);
  log(`ROLLBACK: nova versao nao estabilizou (${reason}) — restaurando anterior`);

  if (!fs.existsSync(path.join(PREVIOUS, 'dist', 'main.js'))) {
    log('AVISO: previous/ nao contem uma versao valida; mantendo a atual');
    fs.rmSync(PENDING, { force: true });
    return;
  }

  for (const item of ITEMS) {
    fs.rmSync(path.join(ROOT, item), { recursive: true, force: true });
    moveIfExists(path.join(PREVIOUS, item), path.join(ROOT, item));
  }
  fs.rmSync(PREVIOUS, { recursive: true, force: true });
  fs.rmSync(PENDING, { force: true });

  fs.mkdirSync(UPDATE_DIR, { recursive: true });
  fs.writeFileSync(
    RESULT,
    JSON.stringify(
      {
        status: 'rolled_back',
        command_id: info.command_id || '',
        tenant_id: info.tenant_id || '',
        gateway_id: info.gateway_id || '',
        version: info.version || '',
        previousVersion: info.previousVersion || '',
        error: `Nova versão caiu antes de estabilizar (${reason}); versão anterior restaurada.`,
        at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  log('rollback concluido — versao anterior restaurada');
}

function startLoop() {
  applyStagedUpdate();

  const main = path.join(ROOT, 'dist', 'main.js');
  if (!fs.existsSync(main)) {
    if (fs.existsSync(PENDING)) {
      rollback('dist/main.js ausente');
      setTimeout(startLoop, 1000);
      return;
    }
    log('ERRO: dist/main.js nao encontrado; nova tentativa em 30s');
    setTimeout(startLoop, 30000);
    return;
  }

  const startedAt = Date.now();
  const child = spawn(process.execPath, [main], {
    cwd: ROOT,
    stdio: 'inherit',
    env: Object.assign({}, process.env, { BLUEBEE_OTA_LAUNCHER: '1' }),
  });
  log(`gateway iniciado (pid ${child.pid})`);

  // Watchdog "vivo mas sem confirmar": após uma atualização, o gateway novo
  // precisa reconectar ao MQTT e apagar o pending-verify.json. Se ele ficar
  // rodando sem confirmar (ex.: regressão de conexão que não derruba o
  // processo), mata o processo e reverte.
  let verifyTimer = null;
  let verifyTimedOut = false;
  if (fs.existsSync(PENDING)) {
    verifyTimer = setInterval(() => {
      if (!fs.existsSync(PENDING)) {
        clearInterval(verifyTimer);
        verifyTimer = null;
        log('atualizacao confirmada pelo gateway (reconexao MQTT)');
        // A versão anterior não é mais necessária.
        fs.rmSync(PREVIOUS, { recursive: true, force: true });
        return;
      }
      if (Date.now() - startedAt >= VERIFY_TIMEOUT_MS) {
        clearInterval(verifyTimer);
        verifyTimer = null;
        verifyTimedOut = true;
        log('nova versao nao confirmou reconexao MQTT dentro do prazo — encerrando para rollback');
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 10000).unref();
      }
    }, VERIFY_POLL_MS);
  }

  child.on('exit', (code, signal) => {
    if (verifyTimer) {
      clearInterval(verifyTimer);
      verifyTimer = null;
    }
    const uptime = Date.now() - startedAt;
    log(`gateway saiu (code=${code} signal=${signal}) apos ${Math.round(uptime / 1000)}s`);

    // Verificação pendente no momento da saída = atualização NUNCA confirmada
    // (o gateway apaga o pending-verify ao reconectar no MQTT) → rollback.
    if (fs.existsSync(PENDING)) {
      rollback(
        verifyTimedOut
          ? `sem reconexao MQTT em ${Math.round(VERIFY_TIMEOUT_MS / 60000)}min`
          : `saida code=${code} em ${Math.round(uptime / 1000)}s sem confirmar`,
      );
      setTimeout(startLoop, 1000);
      return;
    }

    setTimeout(startLoop, RESPAWN_DELAY_MS);
  });
}

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));

startLoop();
