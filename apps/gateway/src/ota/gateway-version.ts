import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Resolve a versão do gateway em execução a partir do package.json do diretório
 * de instalação. Tenta primeiro o cwd (WorkingDirectory do serviço aponta para
 * a raiz da instalação) e depois sobe a partir do dist (dev: dist/../).
 */
export function resolveGatewayVersion(): string {
  const candidates = [
    join(process.cwd(), 'package.json'),
    resolve(__dirname, '..', '..', 'package.json'),
    resolve(__dirname, '..', '..', '..', 'package.json'),
  ];
  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue;
      const pkg = JSON.parse(readFileSync(p, 'utf8')) as { name?: string; version?: string };
      if (pkg?.version && (!pkg.name || pkg.name.includes('gateway'))) {
        return pkg.version;
      }
    } catch {
      // ignora e tenta o próximo candidato
    }
  }
  return '0.0.0';
}

/** Raiz da instalação do gateway (onde ficam package.json, dist/, run.js). */
export function resolveInstallRoot(): string {
  const cwd = process.cwd();
  if (existsSync(join(cwd, 'package.json'))) return cwd;
  return resolve(__dirname, '..', '..');
}

/** True quando o processo foi iniciado pelo launcher OTA (run.js). */
export function isOtaSupported(): boolean {
  return process.env.BLUEBEE_OTA_LAUNCHER === '1';
}
