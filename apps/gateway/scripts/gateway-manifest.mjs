#!/usr/bin/env node
/**
 * Proteção contra OTA silencioso: o conteúdo do gateway (código que é
 * empacotado para instalação/atualização) é hasheado e registrado em
 * gateway-manifest.json junto com a versão do apps/gateway/package.json.
 *
 * - `node scripts/gateway-manifest.mjs` (ou --check): falha se o código do
 *   gateway mudou sem a versão ter sido alterada junto.
 * - `node scripts/gateway-manifest.mjs --update`: regrava o manifesto, mas
 *   RECUSA se o hash mudou e a versão continua igual à registrada (obriga o
 *   bump de versão antes de atualizar o manifesto).
 *
 * O conjunto de arquivos hasheados espelha o que o backend empacota
 * (GatewayPackageService): src/**, agent/**, package.json, tsconfig.json,
 * tsconfig.build.json, nest-cli.json, .env.example.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const gatewayRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = join(gatewayRoot, 'gateway-manifest.json');

const ROOT_FILES = [
  'package.json',
  'tsconfig.json',
  'tsconfig.build.json',
  'nest-cli.json',
  '.env.example',
];
const DIRS = ['src', 'agent'];

function collectFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectFiles(p));
    else if (entry.isFile()) out.push(p);
  }
  return out;
}

function computeManifest() {
  const files = [];
  for (const f of ROOT_FILES) {
    const p = join(gatewayRoot, f);
    if (existsSync(p)) files.push(p);
  }
  for (const d of DIRS) {
    const p = join(gatewayRoot, d);
    if (existsSync(p) && statSync(p).isDirectory()) files.push(...collectFiles(p));
  }
  files.sort((a, b) =>
    relative(gatewayRoot, a).localeCompare(relative(gatewayRoot, b)),
  );

  const hash = createHash('sha256');
  for (const p of files) {
    const rel = relative(gatewayRoot, p).split(sep).join('/');
    hash.update(rel);
    hash.update('\0');
    hash.update(readFileSync(p));
    hash.update('\0');
  }
  const pkg = JSON.parse(readFileSync(join(gatewayRoot, 'package.json'), 'utf8'));
  return { version: pkg.version, sha256: hash.digest('hex'), fileCount: files.length };
}

const current = computeManifest();
const update = process.argv.includes('--update');

let recorded = null;
if (existsSync(manifestPath)) {
  recorded = JSON.parse(readFileSync(manifestPath, 'utf8'));
}

if (update) {
  if (recorded && recorded.sha256 !== current.sha256 && recorded.version === current.version) {
    console.error(
      `ERRO: o código do gateway mudou, mas a versão continua v${current.version}.\n` +
        'Suba a versão em apps/gateway/package.json antes de rodar --update.',
    );
    process.exit(1);
  }
  writeFileSync(manifestPath, JSON.stringify(current, null, 2) + '\n');
  console.log(`gateway-manifest.json atualizado: v${current.version} (${current.fileCount} arquivos, sha256 ${current.sha256.slice(0, 12)}…)`);
  process.exit(0);
}

// modo check
if (!recorded) {
  console.error('ERRO: gateway-manifest.json não existe. Rode: node apps/gateway/scripts/gateway-manifest.mjs --update');
  process.exit(1);
}
if (recorded.version !== current.version) {
  console.error(
    `ERRO: versão do manifesto (v${recorded.version}) difere do package.json (v${current.version}).\n` +
      'Rode: node apps/gateway/scripts/gateway-manifest.mjs --update',
  );
  process.exit(1);
}
if (recorded.sha256 !== current.sha256) {
  console.error(
    `ERRO: o código do gateway mudou mas a versão continua v${current.version}.\n` +
      'Os gateways em campo NÃO vão receber a atualização OTA (a plataforma compara versões).\n' +
      '1) Suba a versão em apps/gateway/package.json (ex.: minor bump).\n' +
      '2) Rode: node apps/gateway/scripts/gateway-manifest.mjs --update',
  );
  process.exit(1);
}
console.log(`OK: gateway v${current.version} — manifesto em dia (${current.fileCount} arquivos).`);
