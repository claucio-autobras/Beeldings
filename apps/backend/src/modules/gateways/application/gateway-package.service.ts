import { Injectable, Logger } from '@nestjs/common';
import AdmZip = require('adm-zip');
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Pacote de atualização OTA pronto para download por token de uso único. */
export interface PendingUpdatePackage {
  gatewayId: string;
  buffer: Buffer;
  sha256: string;
  version: string;
  expiresAt: number;
}

/** Validade do token de download do pacote OTA (janela para o gateway baixar). */
const UPDATE_TOKEN_TTL_MS = 15 * 60_000;

/**
 * GatewayPackageService
 *
 * Fonte única da montagem de pacotes do gateway a partir do código-fonte que
 * acompanha o backend (apps/gateway):
 *   - Pacote de INSTALAÇÃO (agent-package): fonte + instaladores + launcher.
 *   - Pacote de ATUALIZAÇÃO (OTA): apenas o código (sem instaladores/launcher),
 *     baixado pelo gateway via token de uso único enviado no comando MQTT.
 */
@Injectable()
export class GatewayPackageService {
  private readonly logger = new Logger(GatewayPackageService.name);
  /** Pacotes OTA aguardando download, indexados por token de uso único. */
  private readonly pendingUpdates = new Map<string, PendingUpdatePackage>();

  /** Versão atual do código do gateway no servidor (package.json). */
  getLatestVersion(): string {
    try {
      const root = this.resolveGatewayRoot();
      const pkg = JSON.parse(
        readFileSync(join(root, 'package.json'), 'utf8'),
      ) as { version?: string };
      return pkg.version ?? '0.0.0';
    } catch {
      return '0.0.0';
    }
  }

  /**
   * Monta o zip do pacote do agente (instalação manual) para o SO escolhido.
   * Inclui o launcher OTA (run.js) — novas instalações já saem com OTA.
   */
  buildAgentZip(target: 'linux' | 'windows'): Buffer {
    const gatewayRoot = this.resolveGatewayRoot();
    const agentDir = join(gatewayRoot, 'agent');
    const base = 'bluebee-gateway-agent';

    const zip = new AdmZip();
    zip.addLocalFolder(join(gatewayRoot, 'src'), `${base}/src`);
    this.addSourceFiles(zip, gatewayRoot, base);

    // Launcher OTA — o serviço executa run.js, que gerencia troca/rollback.
    const runJs = join(agentDir, 'run.js');
    if (existsSync(runJs)) {
      zip.addLocalFile(runJs, base);
    }

    const installMd = join(agentDir, 'INSTALL.md');
    if (existsSync(installMd)) {
      zip.addLocalFile(installMd, base);
    }

    if (target === 'windows') {
      zip.addLocalFile(join(agentDir, 'windows', 'instalar.bat'), base);
      zip.addLocalFile(join(agentDir, 'windows', 'remover.bat'), base);
      const nssm = join(gatewayRoot, 'service', 'nssm.exe');
      if (existsSync(nssm)) {
        zip.addLocalFile(nssm, base);
      }
    } else {
      zip.addLocalFile(join(agentDir, 'linux', 'instalar.sh'), base);
      zip.addLocalFile(join(agentDir, 'linux', 'remover.sh'), base);
    }

    return zip.toBuffer();
  }

  /**
   * Prepara um pacote de ATUALIZAÇÃO (OTA) para um gateway: monta o zip só com
   * o código (raiz do zip = raiz do staging), calcula o checksum e registra um
   * token de uso único com validade curta para o download autenticado.
   */
  prepareUpdatePackage(gatewayId: string): {
    token: string;
    sha256: string;
    version: string;
  } {
    const gatewayRoot = this.resolveGatewayRoot();
    const zip = new AdmZip();
    // Sem pasta-base: o gateway extrai direto no diretório de staging.
    zip.addLocalFolder(join(gatewayRoot, 'src'), 'src');
    this.addSourceFiles(zip, gatewayRoot, '');

    const buffer = zip.toBuffer();
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const version = this.getLatestVersion();
    const token = randomBytes(32).toString('hex');

    this.prunePendingUpdates();
    this.pendingUpdates.set(token, {
      gatewayId,
      buffer,
      sha256,
      version,
      expiresAt: Date.now() + UPDATE_TOKEN_TTL_MS,
    });

    this.logger.log(
      `Pacote OTA v${version} preparado para gateway ${gatewayId} (${buffer.length} bytes)`,
    );
    return { token, sha256, version };
  }

  /**
   * Resgata um pacote OTA pendente pelo token (null se inválido/expirado).
   * O token é de USO ÚNICO: é consumido (removido) no primeiro resgate.
   */
  getUpdatePackage(token: string): PendingUpdatePackage | null {
    this.prunePendingUpdates();
    const pkg = this.pendingUpdates.get(token);
    if (!pkg) return null;
    this.pendingUpdates.delete(token);
    if (pkg.expiresAt < Date.now()) return null;
    return pkg;
  }

  private prunePendingUpdates(): void {
    const now = Date.now();
    for (const [token, pkg] of this.pendingUpdates) {
      if (pkg.expiresAt < now) this.pendingUpdates.delete(token);
    }
  }

  /** Arquivos de projeto necessários para instalar/buildar o gateway. */
  private addSourceFiles(zip: AdmZip, gatewayRoot: string, base: string): void {
    for (const f of [
      'package.json',
      'tsconfig.json',
      'tsconfig.build.json',
      'nest-cli.json',
      '.env.example',
    ]) {
      const p = join(gatewayRoot, f);
      if (existsSync(p)) {
        zip.addLocalFile(p, base);
      }
    }
  }

  /**
   * Localiza a pasta apps/gateway (código-fonte do agente) a partir do diretório
   * de trabalho do backend, subindo na árvore até achar apps/gateway/package.json.
   */
  resolveGatewayRoot(): string {
    const candidates: string[] = [];
    let dir = process.cwd();
    for (let i = 0; i < 6; i++) {
      candidates.push(join(dir, 'apps', 'gateway'));
      dir = dirname(dir);
    }
    candidates.push(join(process.cwd(), '..', 'gateway'));

    for (const candidate of candidates) {
      if (
        existsSync(join(candidate, 'package.json')) &&
        existsSync(join(candidate, 'src'))
      ) {
        return candidate;
      }
    }
    throw new Error('apps/gateway não encontrado a partir de ' + process.cwd());
  }
}
