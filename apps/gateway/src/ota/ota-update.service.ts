import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import AdmZip = require('adm-zip');
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import { join } from 'node:path';
import { GatewayMqttService } from '../mqtt/gateway-mqtt.service';
import {
  isOtaSupported,
  resolveGatewayVersion,
  resolveInstallRoot,
} from './gateway-version';

/** Comando de atualização OTA recebido via MQTT (protocol=system, action=ota_update). */
export interface OtaUpdateCommand {
  command_id: string;
  tenant_id: string;
  gateway_id: string;
  /** Versão do pacote sendo enviado pelo backend. */
  version: string;
  /** SHA-256 (hex) do zip, para validar o download. */
  checksum: string;
  /** URL completa (com token de uso único) para baixar o pacote. */
  url: string;
}

type OtaStage =
  | 'downloading'
  | 'applying'
  | 'restarting'
  | 'completed'
  | 'failed'
  | 'rolled_back';

/**
 * OtaUpdateService — atualização remota (OTA) do gateway.
 *
 * Fluxo:
 *   1. Backend publica comando {protocol:'system', action:'ota_update'} com
 *      versão, checksum e URL de download (token de uso único).
 *   2. Gateway baixa o zip, valida o SHA-256, extrai em update/staging e roda
 *      `npm install` + `npm run build` lá dentro (a instalação atual segue
 *      rodando intocada durante todo o processo).
 *   3. Se o build sai íntegro (dist/main.js), grava update/apply.json e encerra
 *      o processo. O launcher (run.js, sob systemd/NSSM) aplica a troca:
 *      move a versão atual para previous/ e o staging para a raiz.
 *   4. Watchdog do launcher: se o novo processo cair antes de estabilizar,
 *      restaura previous/ e grava update/ota-result.json — a versão antiga,
 *      ao reconectar, publica a falha (rolled_back) para o backend.
 *   5. Sucesso: o novo processo, ao conectar no MQTT, apaga o marcador
 *      pending-verify.json e publica 'completed'.
 *
 * Progresso publicado em: bluebee/{tenant}/gateway/{id}/ota
 */
@Injectable()
export class OtaUpdateService implements OnModuleInit {
  private readonly logger = new Logger(OtaUpdateService.name);
  private inProgress = false;

  constructor(
    private readonly config: ConfigService,
    private readonly mqtt: GatewayMqttService,
  ) {}

  /** Ao subir, confirma sucesso pendente ou reporta rollback da tentativa anterior. */
  onModuleInit(): void {
    this.reportPendingOutcome();
  }

  @OnEvent('command.ota.update')
  async handleUpdate(command: OtaUpdateCommand): Promise<void> {
    const currentVersion = resolveGatewayVersion();

    if (!isOtaSupported()) {
      this.publishProgress(command, 'failed', currentVersion, {
        error:
          'Gateway sem launcher OTA (instalação antiga). É preciso uma reinstalação manual para habilitar a atualização remota.',
      });
      return;
    }

    if (this.inProgress) {
      this.logger.warn('Atualização OTA já em andamento — comando ignorado');
      return;
    }
    this.inProgress = true;

    const root = resolveInstallRoot();
    const updateDir = join(root, 'update');
    const stagingDir = join(updateDir, 'staging');

    try {
      fs.rmSync(updateDir, { recursive: true, force: true });
      fs.mkdirSync(stagingDir, { recursive: true });

      // 1) Download
      this.publishProgress(command, 'downloading', currentVersion);
      this.logger.log(`OTA: baixando pacote v${command.version}...`);
      const buffer = await this.download(command.url);

      // 2) Checksum
      const sha256 = createHash('sha256').update(buffer).digest('hex');
      if (sha256 !== command.checksum) {
        throw new Error(
          `Checksum inválido (esperado ${command.checksum.slice(0, 12)}…, obtido ${sha256.slice(0, 12)}…)`,
        );
      }

      // 3) Extrai e builda em staging (instalação atual intocada)
      this.publishProgress(command, 'applying', currentVersion);
      const zip = new AdmZip(buffer);
      zip.extractAllTo(stagingDir, true);

      if (!fs.existsSync(join(stagingDir, 'package.json'))) {
        throw new Error('Pacote inválido: package.json ausente após extração');
      }

      this.logger.log('OTA: npm install no staging...');
      await this.runNpm(['install', '--no-audit', '--no-fund'], stagingDir);
      this.logger.log('OTA: npm run build no staging...');
      await this.runNpm(['run', 'build'], stagingDir);

      if (!fs.existsSync(join(stagingDir, 'dist', 'main.js'))) {
        throw new Error('Build do pacote novo não gerou dist/main.js');
      }

      // 4) Marca a troca para o launcher aplicar e encerra o processo
      fs.writeFileSync(
        join(updateDir, 'apply.json'),
        JSON.stringify(
          {
            command_id: command.command_id,
            tenant_id: command.tenant_id,
            gateway_id: command.gateway_id,
            version: command.version,
            previousVersion: currentVersion,
            stagedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );

      this.publishProgress(command, 'restarting', currentVersion);
      this.logger.log('OTA: pacote pronto — reiniciando para aplicar a nova versão');

      // Dá tempo para a mensagem de progresso sair antes de encerrar.
      setTimeout(() => process.exit(0), 2000);
    } catch (err) {
      const message = (err as Error).message;
      this.logger.error(`OTA falhou antes da troca: ${message}`);
      fs.rmSync(updateDir, { recursive: true, force: true });
      this.publishProgress(command, 'failed', currentVersion, { error: message });
      this.inProgress = false;
    }
  }

  /**
   * Confirma o desfecho de uma atualização anterior assim que o MQTT conectar:
   *   - pending-verify.json presente → nova versão subiu: apaga o marcador
   *     (sinal de sucesso para o launcher) e publica 'completed'.
   *   - ota-result.json presente → launcher fez rollback: publica 'rolled_back'.
   */
  private reportPendingOutcome(): void {
    const root = resolveInstallRoot();
    const pendingPath = join(root, 'update', 'pending-verify.json');
    const resultPath = join(root, 'update', 'ota-result.json');
    if (!fs.existsSync(pendingPath) && !fs.existsSync(resultPath)) return;

    const started = Date.now();
    const timer = setInterval(() => {
      try {
        if (!this.mqtt.getConnectionStatus().connected) {
          // Desiste de reportar após 10 min (o launcher tem watchdog próprio).
          if (Date.now() - started > 10 * 60_000) clearInterval(timer);
          return;
        }
        clearInterval(timer);

        if (fs.existsSync(pendingPath)) {
          const info = this.readJson(pendingPath);
          // Apagar o marcador ANTES de publicar: é o sinal de "subiu com
          // sucesso" para o launcher não fazer rollback.
          fs.rmSync(pendingPath, { force: true });
          // O launcher pode registrar avisos (itens NÃO críticos travados por
          // antivírus/OneDrive que ficaram para trás); a atualização concluiu,
          // mas o aviso vai junto na mensagem para a plataforma.
          const warnings = Array.isArray(info.warnings)
            ? (info.warnings as unknown[]).map((w) => String(w)).filter(Boolean)
            : [];
          const version = String(info.version ?? resolveGatewayVersion());
          this.publishProgress(
            this.commandFromInfo(info),
            'completed',
            String(info.previousVersion ?? ''),
            {
              version,
              ...(warnings.length
                ? { error: `Atualizado para v${version} com avisos: ${warnings.join('; ')}` }
                : {}),
            },
          );
          if (warnings.length) {
            this.logger.warn(`OTA concluída com avisos: ${warnings.join('; ')}`);
          }
          this.logger.log(
            `OTA concluída: gateway agora na versão ${resolveGatewayVersion()}`,
          );
        }

        if (fs.existsSync(resultPath)) {
          const info = this.readJson(resultPath);
          fs.rmSync(resultPath, { force: true });
          // O launcher grava status 'failed' quando o rollback não encontrou
          // um previous/ válido (instalação mantida como está); nos demais
          // casos o resultado é o rollback clássico ('rolled_back').
          const stage: OtaStage = info.status === 'failed' ? 'failed' : 'rolled_back';
          this.publishProgress(
            this.commandFromInfo(info),
            stage,
            String(info.previousVersion ?? resolveGatewayVersion()),
            {
              version: String(info.version ?? ''),
              error: String(
                info.error ??
                  'Nova versão não estabilizou; versão anterior restaurada automaticamente.',
              ),
            },
          );
          if (stage === 'failed') {
            this.logger.error('OTA falhou sem rollback: previous/ inválido — instalação mantida');
          } else {
            this.logger.warn('OTA revertida: versão anterior restaurada pelo launcher');
          }
        }
      } catch (err) {
        clearInterval(timer);
        this.logger.error(`Falha ao reportar desfecho da OTA: ${(err as Error).message}`);
      }
    }, 3000);
    timer.unref?.();
  }

  private readJson(path: string): Record<string, unknown> {
    try {
      return JSON.parse(fs.readFileSync(path, 'utf8')) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private commandFromInfo(info: Record<string, unknown>): OtaUpdateCommand {
    return {
      command_id: String(info.command_id ?? ''),
      tenant_id: String(info.tenant_id ?? this.config.get('TENANT_ID', 'default')),
      gateway_id: String(info.gateway_id ?? this.config.get('GATEWAY_ID', 'gw-01')),
      version: String(info.version ?? ''),
      checksum: '',
      url: '',
    };
  }

  /** Publica o progresso da OTA em bluebee/{tenant}/gateway/{id}/ota. */
  private publishProgress(
    command: OtaUpdateCommand,
    stage: OtaStage,
    fromVersion: string,
    extra?: { error?: string; version?: string },
  ): void {
    const tenantId = command.tenant_id || this.config.get('TENANT_ID', 'default');
    const gatewayId = command.gateway_id || this.config.get('GATEWAY_ID', 'gw-01');
    const topic = `bluebee/${tenantId}/gateway/${gatewayId}/ota`;
    this.mqtt.publish(topic, {
      command_id: command.command_id,
      gatewayId,
      stage,
      version: extra?.version ?? command.version,
      fromVersion,
      error: extra?.error ?? null,
      ts: new Date().toISOString(),
    });
  }

  /** Descrição segura da URL para logs/erros: host + caminho, sem query (token). */
  private describeUrl(url: string): string {
    try {
      const u = new URL(url);
      return `${u.protocol}//${u.host}${u.pathname}`;
    } catch {
      return url.split('?')[0];
    }
  }

  private download(url: string, redirects = 0): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      if (redirects > 3) {
        reject(new Error('Muitos redirects ao baixar o pacote'));
        return;
      }
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        reject(
          new Error(
            `URL de download inválida ("${this.describeUrl(url)}") — verifique BACKEND_PUBLIC_URL no servidor.`,
          ),
        );
        return;
      }
      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.get(url, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          // Location pode ser relativo — resolve contra a URL original.
          let next: string;
          try {
            next = new URL(res.headers.location, url).toString();
          } catch {
            reject(
              new Error(
                `Redirect com Location inválido ("${res.headers.location.split('?')[0]}") ao baixar de ${this.describeUrl(url)}`,
              ),
            );
            return;
          }
          resolve(this.download(next, redirects + 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(
            new Error(`Download falhou (HTTP ${res.statusCode}) em ${this.describeUrl(url)}`),
          );
          return;
        }
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });
      req.setTimeout(120_000, () => {
        req.destroy(new Error(`Timeout ao baixar o pacote (120s) de ${this.describeUrl(url)}`));
      });
      req.on('error', (err) => {
        reject(
          new Error(
            `Falha de rede ao baixar de ${this.describeUrl(url)}: ${(err as Error).message}`,
          ),
        );
      });
    });
  }

  /** Roda npm no diretório indicado; rejeita se sair com código != 0. */
  private runNpm(args: string[], cwd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const isWin = process.platform === 'win32';
      const child = spawn(isWin ? 'npm.cmd' : 'npm', args, {
        cwd,
        shell: isWin,
        env: { ...process.env, NODE_ENV: undefined } as NodeJS.ProcessEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stderr = '';
      child.stderr?.on('data', (d: Buffer) => {
        stderr += d.toString();
        if (stderr.length > 4000) stderr = stderr.slice(-4000);
      });
      const timeout = setTimeout(
        () => {
          child.kill();
          reject(new Error(`npm ${args[0]} excedeu 15 minutos`));
        },
        15 * 60_000,
      );
      child.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      child.on('exit', (code) => {
        clearTimeout(timeout);
        if (code === 0) resolve();
        else
          reject(
            new Error(`npm ${args.join(' ')} falhou (código ${code}): ${stderr.slice(-500)}`),
          );
      });
    });
  }
}
