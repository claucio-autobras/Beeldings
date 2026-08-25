#!/usr/bin/env node
/* ===========================================================================
 * Beeldings IoT Gateway — Launcher OTA (run.js)
 *
 * O serviço (systemd/NSSM) executa ESTE arquivo, não o dist/main.js direto.
 * Responsabilidades:
 *   1. Aplicar atualização preparada em update/staging (troca por rename:
 *      versão atual vai para previous/, staging vira a versão ativa).
 *   2. Iniciar o gateway (node dist/main.js) como processo filho e reiniciá-lo
 *      sempre que cair (além do Restart do próprio serviço).
 *   3. Watchdog pós-atualização: se o gateway cair antes de estabilizar
 *      (marcador update/pending-verify.json ainda presente), restaura a
 *      versão anterior automaticamente e registra o rollback em
 *      update/ota-result.json — o gateway restaurado reporta a falha à
 *      plataforma ao reconectar.
 *
 * À PROVA DE BRICK (regras deste arquivo):
 *   - O launcher NUNCA encerra por exceção: qualquer erro vira log + nova
 *     tentativa (handlers globais + try/catch no loop). Sem isso o NSSM entra
 *     em crash-loop e o Windows mostra "o serviço não retornou um erro".
 *   - Toda troca de pastas (rename/rm de node_modules, dist, ...) tolera os
 *     erros transitórios do Windows (EPERM/EBUSY/ENOTEMPTY por antivírus ou
 *     handles do processo recém-encerrado) com retentativas e backoff.
 *   - Quando o rename esgota as retentativas com erro transitório (pasta
 *     travada por antivírus/OneDrive/indexador), cai para CÓPIA recursiva com
 *     remoção da origem em melhor esforço — a atualização conclui mesmo com
 *     uma pasta presa.
 *   - Só os itens NECESSÁRIOS AO RUNTIME (dist, node_modules, package.json)
 *     podem abortar a atualização. Falha persistente em itens como src ou
 *     tsconfig* vira AVISO (registrado no pending-verify e publicado à
 *     plataforma na confirmação), nunca aborto.
 *   - O marcador pending-verify.json só é escrito quando a troca completou de
 *     fato; falha definitiva no apply desfaz os movimentos já feitos e mantém
 *     a versão atual rodando.
 *   - No boot, um estado meio-aplicado (raiz sem dist/main.js) é detectado e
 *     reparado a partir de previous/ ou staging/ quando houver cópia válida.
 *   - Qualquer desfecho anômalo gera update/ota-result.json com motivo claro
 *     (o gateway publica à plataforma ao reconectar) — nunca falha silenciosa.
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

/* Itens indispensáveis ao RUNTIME (o gateway roda node dist/main.js). Só a
 * falha persistente de um destes aborta a atualização; os demais (src,
 * tsconfig*, ...) viram aviso e a troca prossegue. */
const CRITICAL_ITEMS = new Set(['dist', 'node_modules', 'package.json']);

function envNum(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/* A atualização SÓ é aceita quando o próprio gateway confirma que reconectou
 * ao MQTT (ele apaga o pending-verify.json nesse momento). O launcher nunca
 * aceita por tempo de vida do processo: se o pending-verify continuar presente
 * após VERIFY_TIMEOUT_MS (processo vivo mas sem reconectar) ou se o processo
 * cair com ele presente, faz rollback.
 * (Env overrides existem só para os testes automatizados.) */
const VERIFY_TIMEOUT_MS = envNum('BLUEBEE_VERIFY_TIMEOUT_MS', 10 * 60 * 1000);
const VERIFY_POLL_MS = envNum('BLUEBEE_VERIFY_POLL_MS', 15000);
const RESPAWN_DELAY_MS = envNum('BLUEBEE_RESPAWN_DELAY_MS', 5000);

/* Retentativas para erros transitórios do Windows nas trocas de pasta.
 * Os movimentos PRIMÁRIOS do apply usam um orçamento maior (~45s no pior
 * caso) porque bloqueios de antivírus costumam passar de 15s; undo/limpeza
 * usam o orçamento padrão para não atrasar demais o rollback. */
const SWAP_RETRY_ATTEMPTS = envNum('BLUEBEE_SWAP_RETRY_ATTEMPTS', 6);
const SWAP_PRIMARY_RETRY_ATTEMPTS = envNum('BLUEBEE_SWAP_PRIMARY_RETRY_ATTEMPTS', 8);
const SWAP_RETRY_BASE_MS = envNum('BLUEBEE_SWAP_RETRY_BASE_MS', 500);
const TRANSIENT_CODES = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY', 'EACCES', 'EMFILE', 'ENFILE', 'UNKNOWN']);

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

/* ---------------------------------------------------------------------------
 * Injeção de falhas SÓ PARA TESTES (BLUEBEE_LAUNCHER_TEST_FAULTS).
 * Formato: {"rename":{"match":"dist","times":2,"code":"EPERM"},"rm":{...}}
 * Fora dos testes o env não existe e este bloco é inerte.
 * ------------------------------------------------------------------------- */
const TEST_FAULTS = (() => {
  try {
    return process.env.BLUEBEE_LAUNCHER_TEST_FAULTS
      ? JSON.parse(process.env.BLUEBEE_LAUNCHER_TEST_FAULTS)
      : null;
  } catch {
    return null;
  }
})();
const faultCounters = {};
function maybeInjectFault(op, target) {
  if (!TEST_FAULTS || !TEST_FAULTS[op]) return;
  const f = TEST_FAULTS[op];
  if (f.match && !String(target).includes(f.match)) return;
  const used = faultCounters[op] || 0;
  if (typeof f.times === 'number' && used >= f.times) return;
  faultCounters[op] = used + 1;
  const err = new Error(`${f.code || 'EPERM'} injetado para teste em ${target}`);
  err.code = f.code || 'EPERM';
  throw err;
}

function rmRaw(p) {
  maybeInjectFault('rm', p);
  fs.rmSync(p, { recursive: true, force: true });
}
function renameRaw(from, to) {
  maybeInjectFault('rename', to);
  fs.renameSync(from, to);
}
function copyRaw(from, to) {
  maybeInjectFault('copy', to);
  fs.cpSync(from, to, { recursive: true, force: true });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Executa uma operação síncrona de FS com retentativas + backoff exponencial
 * para os erros transitórios do Windows. Erros não-transitórios (ou o esgotar
 * das tentativas) propagam — o chamador decide desfazer/registrar.
 */
async function withRetry(label, fn, attempts = SWAP_RETRY_ATTEMPTS) {
  let lastErr = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return fn();
    } catch (err) {
      lastErr = err;
      const code = err && err.code;
      if (!TRANSIENT_CODES.has(code) || attempt === attempts) break;
      const delay = Math.min(SWAP_RETRY_BASE_MS * 2 ** (attempt - 1), 15000);
      log(`${label}: erro transitorio ${code} (tentativa ${attempt}/${attempts}) — retry em ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

async function removeWithRetry(p, attempts) {
  await withRetry(`remover ${path.relative(ROOT, p) || p}`, () => rmRaw(p), attempts);
}

/**
 * Move from→to (removendo o destino antes). Retorna false se from não existe.
 *
 * Se o rename (ou a remoção do destino) esgotar as retentativas com erro
 * TRANSITÓRIO do Windows (pasta travada por antivírus/OneDrive/indexador),
 * cai para CÓPIA recursiva com sobrescrita — que costuma funcionar mesmo com
 * a pasta presa, porque o bloqueio é no handle do diretório, não nos
 * arquivos — e remove a origem em melhor esforço. A cópia sobre um destino
 * existente mescla (arquivos antigos que não existem na nova versão podem
 * sobrar); aceitável, pois main.js e afins são sobrescritos.
 */
async function moveWithRetry(from, to, opts = {}) {
  if (!fs.existsSync(from)) return false;
  const attempts = opts.attempts;
  const relFrom = path.relative(ROOT, from);
  const relTo = path.relative(ROOT, to);
  try {
    await removeWithRetry(to, attempts);
    await withRetry(`mover ${relFrom} -> ${relTo}`, () => renameRaw(from, to), attempts);
    return true;
  } catch (err) {
    if (!TRANSIENT_CODES.has(err && err.code)) throw err;
    log(`mover ${relFrom} -> ${relTo}: rename bloqueado (${err.code}) — fallback de copia`);
    await withRetry(`copiar ${relFrom} -> ${relTo}`, () => copyRaw(from, to), attempts);
    try {
      await removeWithRetry(from, 2);
    } catch (rmErr) {
      log(
        `AVISO: copia de ${relFrom} concluida mas a origem nao pode ser removida ` +
          `(${rmErr.code || rmErr.message}) — sera limpa depois (melhor esforco)`,
      );
    }
    return true;
  }
}

/** Uma pasta é uma instalação válida quando contém dist/main.js. */
function isValidInstall(dir) {
  return fs.existsSync(path.join(dir, 'dist', 'main.js'));
}

/** Grava update/ota-result.json — o gateway publica à plataforma ao reconectar. */
function writeResult(status, info, error) {
  try {
    fs.mkdirSync(UPDATE_DIR, { recursive: true });
    fs.writeFileSync(
      RESULT,
      JSON.stringify(
        {
          status,
          command_id: info.command_id || '',
          tenant_id: info.tenant_id || '',
          gateway_id: info.gateway_id || '',
          version: info.version || '',
          previousVersion: info.previousVersion || '',
          error,
          at: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (err) {
    log(`AVISO: nao foi possivel gravar ota-result.json: ${err.message}`);
  }
}

/** Aplica uma atualização preparada (update/staging → raiz). */
async function applyStagedUpdate() {
  if (!fs.existsSync(APPLY)) return;

  const info = readJson(APPLY);

  if (!isValidInstall(STAGING)) {
    // Se a raiz está íntegra, é só um pacote preparado inválido: descarta e
    // registra o desfecho. Se a raiz também está quebrada (crash no meio de um
    // apply anterior), deixa os artefatos para o reparo de boot decidir.
    if (isValidInstall(ROOT)) {
      log('apply.json presente mas staging invalido — descartando atualizacao');
      try {
        await removeWithRetry(STAGING);
        await removeWithRetry(APPLY);
      } catch (err) {
        log(`AVISO: falha ao descartar staging invalido: ${err.message}`);
      }
      writeResult(
        'failed',
        info,
        'Pacote preparado inválido (dist/main.js ausente no staging); atualização descartada e versão atual mantida.',
      );
    } else {
      log('apply.json presente, staging E raiz invalidos — deixando para o reparo de boot');
    }
    return;
  }

  log(`aplicando atualizacao para v${info.version || '?'}...`);

  const movedToPrevious = [];
  const movedToRoot = [];
  const warnings = [];
  try {
    await removeWithRetry(PREVIOUS);
    fs.mkdirSync(PREVIOUS, { recursive: true });

    // Movimentos primários com orçamento maior de retentativas (antivírus
    // pode segurar pastas por mais de 15s) + fallback de cópia no esgotar.
    // Só itens CRÍTICOS ao runtime abortam; os demais viram aviso.
    for (const item of ITEMS) {
      try {
        if (
          await moveWithRetry(path.join(ROOT, item), path.join(PREVIOUS, item), {
            attempts: SWAP_PRIMARY_RETRY_ATTEMPTS,
          })
        ) {
          movedToPrevious.push(item);
        }
      } catch (err) {
        if (CRITICAL_ITEMS.has(item)) throw err;
        warnings.push(`${item}: nao foi possivel mover para previous/ (${err.code || err.message})`);
        log(`AVISO: item nao critico ${item} travado (${err.code || err.message}) — a atualizacao segue`);
      }
    }
    for (const item of ITEMS) {
      try {
        if (
          await moveWithRetry(path.join(STAGING, item), path.join(ROOT, item), {
            attempts: SWAP_PRIMARY_RETRY_ATTEMPTS,
          })
        ) {
          movedToRoot.push(item);
        }
      } catch (err) {
        if (CRITICAL_ITEMS.has(item)) throw err;
        warnings.push(`${item}: nao atualizado (${err.code || err.message}) — versao anterior pode permanecer na raiz`);
        log(`AVISO: item nao critico ${item} nao atualizado (${err.code || err.message}) — a atualizacao segue`);
      }
    }

    // Só marca a verificação pendente quando a troca dos itens críticos
    // completou DE FATO. Avisos de itens não críticos vão junto para o
    // gateway publicar à plataforma na confirmação.
    if (warnings.length) {
      log(`atualizacao aplicada COM AVISOS: ${warnings.join('; ')}`);
    }
    fs.writeFileSync(
      PENDING,
      JSON.stringify(warnings.length ? Object.assign({}, info, { warnings }) : info, null, 2),
    );
    try {
      await removeWithRetry(STAGING);
      await removeWithRetry(APPLY);
    } catch (err) {
      log(`AVISO: troca concluida mas falhou a limpeza do staging: ${err.message}`);
    }
    log('atualizacao aplicada — iniciando a nova versao');
  } catch (err) {
    log(`ERRO ao aplicar atualizacao: ${err.message} — desfazendo movimentos`);

    // Desfaz na ordem inversa (best effort, com retentativas por item).
    for (const item of movedToRoot.reverse()) {
      try {
        await moveWithRetry(path.join(ROOT, item), path.join(STAGING, item));
      } catch (undoErr) {
        log(`AVISO: nao consegui devolver ${item} ao staging: ${undoErr.message}`);
      }
    }
    for (const item of movedToPrevious.reverse()) {
      try {
        await moveWithRetry(path.join(PREVIOUS, item), path.join(ROOT, item));
      } catch (undoErr) {
        log(`AVISO: nao consegui restaurar ${item} de previous/: ${undoErr.message}`);
      }
    }

    writeResult(
      'failed',
      info,
      `Falha ao aplicar a atualização (${err.message}); a troca foi desfeita e a versão atual foi mantida.` +
        (TRANSIENT_CODES.has(err && err.code)
          ? ' Dica: antivírus, OneDrive ou o indexador do Windows podem manter pastas travadas — ' +
            'prefira instalar o gateway fora de pastas sincronizadas (ex.: C:\\, não Documents) ' +
            'ou adicione uma exceção do antivírus para a pasta do gateway.'
          : ''),
    );

    // Descarta a atualização (não fica tentando a mesma troca para sempre).
    try {
      await removeWithRetry(STAGING);
      await removeWithRetry(APPLY);
      if (isValidInstall(ROOT)) await removeWithRetry(PREVIOUS);
    } catch (cleanupErr) {
      log(`AVISO: falha na limpeza pos-undo: ${cleanupErr.message}`);
    }

    if (isValidInstall(ROOT)) {
      log('troca desfeita — versao atual mantida em execucao');
    } else {
      log('AVISO: raiz ficou invalida apos o undo — o reparo de boot vai tentar recuperar');
    }
  }
}

/** Restaura a versão anterior após falha da nova versão. */
async function rollback(reason) {
  const info = readJson(PENDING);
  log(`ROLLBACK: nova versao nao estabilizou (${reason}) — restaurando anterior`);

  if (!isValidInstall(PREVIOUS)) {
    // Sem versão anterior válida não há o que restaurar — mas o desfecho NUNCA
    // pode sumir em silêncio: grava um resultado terminal de falha para o
    // gateway (se voltar a subir) publicar à plataforma no próximo boot.
    log('AVISO: previous/ nao contem uma versao valida; mantendo a atual');
    writeResult(
      'failed',
      info,
      `Nova versão não estabilizou (${reason}) e o rollback falhou: previous/ ausente ou inválido — instalação mantida como está; verifique o gateway no local.`,
    );
    try {
      await removeWithRetry(PENDING);
    } catch (err) {
      log(`AVISO: falha ao remover pending-verify: ${err.message}`);
    }
    return;
  }

  // Restaura item a item (best effort): a falha de um item não impede os demais.
  const failures = [];
  for (const item of ITEMS) {
    try {
      await removeWithRetry(path.join(ROOT, item));
      await moveWithRetry(path.join(PREVIOUS, item), path.join(ROOT, item));
    } catch (err) {
      failures.push(`${item} (${err.code || err.message})`);
      log(`AVISO: falha ao restaurar ${item}: ${err.message}`);
    }
  }

  try {
    await removeWithRetry(PENDING);
  } catch (err) {
    log(`AVISO: falha ao remover pending-verify: ${err.message}`);
  }

  if (isValidInstall(ROOT)) {
    try {
      await removeWithRetry(PREVIOUS);
    } catch (err) {
      log(`AVISO: falha ao limpar previous/: ${err.message}`);
    }
    writeResult(
      'rolled_back',
      info,
      `Nova versão caiu antes de estabilizar (${reason}); versão anterior restaurada.` +
        (failures.length ? ` Itens não restaurados: ${failures.join(', ')}.` : ''),
    );
    log('rollback concluido — versao anterior restaurada');
  } else {
    // Rollback incompleto: NÃO apaga previous/ (o reparo de boot ainda pode
    // usar o que sobrou) e registra o estado para a plataforma.
    writeResult(
      'failed',
      info,
      `Rollback incompleto após falha da nova versão (${reason}): ${failures.join(', ')} — o launcher segue tentando recuperar automaticamente.`,
    );
    log('AVISO: rollback incompleto — reparo de boot vai continuar tentando');
  }
}

/**
 * Reparo de boot: instalação inconsistente (raiz sem dist/main.js) é
 * restaurada a partir da melhor cópia disponível — previous/ (volta a versão
 * antiga) ou staging/ (promove a nova, que ainda passará pela verificação).
 * Retorna true quando a raiz voltou a ser válida.
 */
async function repairInstall() {
  if (isValidInstall(ROOT)) return true;

  const info = Object.assign({}, readJson(APPLY), readJson(PENDING));

  if (isValidInstall(PREVIOUS)) {
    log('REPARO: instalacao inconsistente — restaurando versao anterior de previous/');
    for (const item of ITEMS) {
      try {
        await removeWithRetry(path.join(ROOT, item));
        await moveWithRetry(path.join(PREVIOUS, item), path.join(ROOT, item));
      } catch (err) {
        log(`AVISO: reparo falhou ao restaurar ${item}: ${err.message}`);
      }
    }
    if (isValidInstall(ROOT)) {
      try {
        await removeWithRetry(PREVIOUS);
        await removeWithRetry(STAGING);
        await removeWithRetry(APPLY);
        await removeWithRetry(PENDING);
      } catch (err) {
        log(`AVISO: falha na limpeza pos-reparo: ${err.message}`);
      }
      writeResult(
        'rolled_back',
        info,
        'Instalação ficou inconsistente após uma falha na troca de versão; versão anterior restaurada automaticamente no boot.',
      );
      log('REPARO concluido — versao anterior restaurada');
      return true;
    }
  }

  if (isValidInstall(STAGING)) {
    log('REPARO: instalacao inconsistente — promovendo a copia valida de staging/');
    let ok = true;
    for (const item of ITEMS) {
      try {
        await moveWithRetry(path.join(STAGING, item), path.join(ROOT, item));
      } catch (err) {
        ok = false;
        log(`AVISO: reparo falhou ao promover ${item} do staging: ${err.message}`);
      }
    }
    if (isValidInstall(ROOT)) {
      // A versão promovida ainda precisa confirmar reconexão MQTT — passa pelo
      // fluxo normal de verificação (pending-verify + watchdog + rollback).
      try {
        fs.mkdirSync(UPDATE_DIR, { recursive: true });
        fs.writeFileSync(PENDING, JSON.stringify(info, null, 2));
        await removeWithRetry(STAGING);
        await removeWithRetry(APPLY);
      } catch (err) {
        log(`AVISO: falha na limpeza pos-promocao do staging: ${err.message}`);
      }
      log('REPARO concluido — nova versao promovida do staging (aguardando verificacao)');
      return true;
    }
    if (!ok) log('AVISO: promocao do staging incompleta');
  }

  // Sem cópia válida: registra o estado (uma única vez) e segue tentando —
  // manter o processo vivo permite recuperação se o antivírus liberar arquivos.
  if (!fs.existsSync(RESULT)) {
    writeResult(
      'failed',
      info,
      'Instalação inconsistente (dist/main.js ausente) e sem cópia válida em previous/ ou staging/ para restaurar — é necessária reinstalação do agente no local.',
    );
  }
  return false;
}

let child = null;
let loopTimer = null;
let loopRunning = false;

function scheduleLoop(delayMs) {
  if (loopTimer) clearTimeout(loopTimer);
  loopTimer = setTimeout(() => {
    loopTimer = null;
    void startLoop();
  }, delayMs);
}

async function startLoop() {
  if (loopRunning) return;
  loopRunning = true;
  try {
    await startIteration();
  } catch (err) {
    log(`ERRO inesperado no launcher: ${(err && err.stack) || err} — nova tentativa em 30s`);
    scheduleLoop(30000);
  } finally {
    loopRunning = false;
  }
}

async function startIteration() {
  await applyStagedUpdate();

  const main = path.join(ROOT, 'dist', 'main.js');
  if (!fs.existsSync(main)) {
    if (fs.existsSync(PENDING)) {
      await rollback('dist/main.js ausente');
      scheduleLoop(1000);
      return;
    }
    if (await repairInstall()) {
      scheduleLoop(1000);
      return;
    }
    log('ERRO: dist/main.js nao encontrado e sem copia valida; nova tentativa em 30s');
    scheduleLoop(30000);
    return;
  }

  const startedAt = Date.now();
  child = spawn(process.execPath, [main], {
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
      try {
        if (!fs.existsSync(PENDING)) {
          clearInterval(verifyTimer);
          verifyTimer = null;
          log('atualizacao confirmada pelo gateway (reconexao MQTT)');
          // A versão anterior não é mais necessária.
          try {
            fs.rmSync(PREVIOUS, { recursive: true, force: true });
          } catch (err) {
            log(`AVISO: falha ao limpar previous/ apos confirmacao: ${err.message}`);
          }
          return;
        }
        if (Date.now() - startedAt >= VERIFY_TIMEOUT_MS) {
          clearInterval(verifyTimer);
          verifyTimer = null;
          verifyTimedOut = true;
          log('nova versao nao confirmou reconexao MQTT dentro do prazo — encerrando para rollback');
          child.kill('SIGTERM');
          setTimeout(() => {
            try {
              child.kill('SIGKILL');
            } catch {}
          }, 10000).unref();
        }
      } catch (err) {
        log(`ERRO no watchdog de verificacao: ${err.message}`);
      }
    }, VERIFY_POLL_MS);
  }

  child.on('exit', (code, signal) => {
    child = null;
    if (verifyTimer) {
      clearInterval(verifyTimer);
      verifyTimer = null;
    }
    const uptime = Date.now() - startedAt;
    log(`gateway saiu (code=${code} signal=${signal}) apos ${Math.round(uptime / 1000)}s`);

    void (async () => {
      try {
        // Verificação pendente no momento da saída = atualização NUNCA
        // confirmada (o gateway apaga o pending-verify ao reconectar no MQTT)
        // → rollback.
        if (fs.existsSync(PENDING)) {
          await rollback(
            verifyTimedOut
              ? `sem reconexao MQTT em ${Math.round(VERIFY_TIMEOUT_MS / 60000)}min`
              : `saida code=${code} em ${Math.round(uptime / 1000)}s sem confirmar`,
          );
          scheduleLoop(1000);
          return;
        }
        scheduleLoop(RESPAWN_DELAY_MS);
      } catch (err) {
        log(`ERRO ao tratar saida do gateway: ${(err && err.stack) || err}`);
        scheduleLoop(RESPAWN_DELAY_MS);
      }
    })();
  });

  child.on('error', (err) => {
    log(`ERRO ao iniciar o gateway: ${err.message}`);
    child = null;
    scheduleLoop(RESPAWN_DELAY_MS);
  });
}

/* O launcher NUNCA morre por exceção — erro vira log + nova tentativa.
 * (Encerrar aqui derrubaria o serviço e o NSSM entraria em crash-loop.) */
process.on('uncaughtException', (err) => {
  log(`ERRO nao tratado no launcher: ${(err && err.stack) || err}`);
  if (!child && !loopTimer && !loopRunning) scheduleLoop(5000);
});
process.on('unhandledRejection', (reason) => {
  log(`Promise rejeitada sem tratamento no launcher: ${(reason && reason.stack) || reason}`);
  if (!child && !loopTimer && !loopRunning) scheduleLoop(5000);
});

process.on('SIGTERM', () => {
  try {
    if (child) child.kill('SIGTERM');
  } catch {}
  process.exit(0);
});
process.on('SIGINT', () => {
  try {
    if (child) child.kill('SIGINT');
  } catch {}
  process.exit(0);
});

void startLoop();
