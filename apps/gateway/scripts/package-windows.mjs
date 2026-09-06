/**
 * package-windows.mjs
 *
 * Monta a pasta de distribuição do gateway para Windows:
 *   release/
 *     ├─ bluebee-gateway.exe   (gateway empacotado com pkg — Node embutido)
 *     ├─ nssm.exe              (wrapper de serviço do Windows)
 *     ├─ install-service.bat   (instala como serviço via NSSM)
 *     ├─ uninstall-service.bat (remove o serviço)
 *     └─ .env.example          (modelo; o cliente coloca o .env real da plataforma)
 *
 * Uso: npm run package:win   (dentro de apps/gateway)
 */
import { execSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'); // apps/gateway
const release = join(root, 'release');
const vendor = join(root, 'vendor');
const service = join(root, 'service');
// nssm.cc costuma ficar instável (503); o Wayback serve como espelho de fallback.
const NSSM_URLS = [
  'https://web.archive.org/web/2020id_/https://nssm.cc/release/nssm-2.24.zip',
  'https://nssm.cc/release/nssm-2.24.zip',
];

function log(msg) {
  console.log(`\x1b[36m[package:win]\x1b[0m ${msg}`);
}

/**
 * Localiza o nssm.exe (wrapper de serviço). Ordem:
 *   1. service/nssm.exe  (vendorizado no repo — caminho normal/offline)
 *   2. vendor/nssm.exe   (cache local)
 *   3. download (Wayback → nssm.cc) para vendor/nssm.exe
 */
function ensureNssm() {
  const vendored = join(service, 'nssm.exe');
  if (existsSync(vendored)) {
    log('nssm.exe encontrado em service/ (vendorizado).');
    return vendored;
  }
  const cached = join(vendor, 'nssm.exe');
  if (existsSync(cached)) {
    log('nssm.exe encontrado em vendor/ (cache).');
    return cached;
  }

  mkdirSync(vendor, { recursive: true });
  log('nssm.exe ausente — tentando baixar...');
  const zip = join(tmpdir(), 'nssm-bluebee.zip');
  for (const url of NSSM_URLS) {
    try {
      const extract = join(tmpdir(), `nssm-bluebee-${Date.now()}`);
      const ps = [
        "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;",
        "$ErrorActionPreference='Stop';",
        `Invoke-WebRequest -Uri '${url}' -OutFile '${zip}' -UserAgent 'Mozilla/5.0' -TimeoutSec 30;`,
        `Expand-Archive -Path '${zip}' -DestinationPath '${extract}' -Force;`,
        `Copy-Item (Join-Path '${extract}' 'nssm-2.24\\win64\\nssm.exe') '${cached}' -Force;`,
      ].join(' ');
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { stdio: 'inherit' });
      try { rmSync(zip, { force: true }); rmSync(extract, { recursive: true, force: true }); } catch {}
      if (existsSync(cached)) { log(`nssm.exe baixado de ${url}`); return cached; }
    } catch (e) {
      log(`download falhou (${url}): ${e.message}`);
    }
  }
  throw new Error(
    'Nao foi possivel obter nssm.exe. Baixe de https://nssm.cc (win64) e coloque em apps/gateway/service/nssm.exe',
  );
}

async function main() {
  // 1. Compila o TypeScript -> dist/
  log('Compilando o gateway (nest build)...');
  execSync('npm run build', { cwd: root, stdio: 'inherit' });

  // 2. Empacota dist/main.js em um único .exe (Node embutido) via pkg
  mkdirSync(release, { recursive: true });
  const exeOut = join(release, 'bluebee-gateway.exe');
  log('Gerando bluebee-gateway.exe (pkg)...');
  const { exec } = await import('@yao-pkg/pkg');
  await exec([
    join(root, 'dist', 'main.js'),
    '--targets', 'node22-win-x64',
    '--output', exeOut,
  ]);
  if (!existsSync(exeOut)) throw new Error('pkg não gerou o executável.');

  // 3. Wrapper de serviço (NSSM)
  copyFileSync(ensureNssm(), join(release, 'nssm.exe'));

  // 4. Scripts de serviço + modelo de .env
  copyFileSync(join(root, 'service', 'install-service.bat'), join(release, 'install-service.bat'));
  copyFileSync(join(root, 'service', 'uninstall-service.bat'), join(release, 'uninstall-service.bat'));
  copyFileSync(join(root, '.env.example'), join(release, '.env.example'));

  log(`Pronto! Distribuição montada em: ${release}`);
  log('Conteúdo: bluebee-gateway.exe, nssm.exe, install-service.bat, uninstall-service.bat, .env.example');
  log('No cliente: coloque o .env (gerado pela plataforma) na mesma pasta e rode install-service.bat como Administrador.');
}

main().catch((err) => {
  console.error('\x1b[31m[package:win] ERRO:\x1b[0m', err.message);
  process.exit(1);
});
