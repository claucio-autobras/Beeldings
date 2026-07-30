import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as snmp from 'net-snmp';

import { GatewayMqttService } from '../mqtt/gateway-mqtt.service';
import { classifySnmpError, parseSnmpNumber } from './snmp-read.util';

/** OID candidato a testar (vem dos perfis de fabricante do backend). */
interface DiagnoseOidProbe {
  /** Métrica de saúde ('cpu', 'memory', 'temperature', 'packet_loss', 'uptime'). */
  metric: string;
  oid: string;
}

/** Comando de diagnóstico SNMP roteado pelo CommandDispatcher. */
export interface SnmpDiagnoseCommand {
  command_id: string;
  tenant_id: string;
  gateway_id: string;
  ip: string;
  port: number;
  snmpVersion: '1' | '2c';
  community: string;
  /** OIDs atualmente cadastrados nos pontos da câmera. */
  current: DiagnoseOidProbe[];
  /** OIDs candidatos de todos os perfis conhecidos (deduplicados no backend). */
  candidates: DiagnoseOidProbe[];
}

/** Resultado de um GET individual. */
interface OidReadResult {
  oid: string;
  responded: boolean;
  /** Valor numérico (null se não numérico ou sem resposta). */
  value: number | null;
  /** Representação textual do valor cru (diagnóstico). */
  raw: string | null;
}

/** Sessão SNMP compartilhada da fase de GETs (recriável sob erro). */
interface SharedSnmpSession {
  get: () => snmp.Session;
  markBroken: () => void;
  close: () => void;
}

interface WalkEntry {
  oid: string;
  value: string;
}

interface WalkSection {
  root: string;
  label: string;
  entries: WalkEntry[];
  truncated: boolean;
}

/** Timeout por request SNMP no diagnóstico. */
const DIAG_TIMEOUT_MS = 2500;

/**
 * Pausa entre GETs consecutivos. Firmwares de câmera (Hikvision inclusive)
 * descartam pacotes quando recebem rajadas de requests sem intervalo.
 */
const GET_INTERVAL_MS = 150;

/** Tentativas do ping inicial (sysUpTime) antes de declarar reachable=false. */
const PING_ATTEMPTS = 3;

/** Pausa entre tentativas do ping inicial. */
const PING_RETRY_INTERVAL_MS = 500;

/** Limite de entradas por subárvore no walk resumido. */
const WALK_MAX_ENTRIES = 150;

/** Tempo máximo por subárvore no walk (ms). */
const WALK_TIMEOUT_MS = 12_000;

const OID_SYS_DESCR = '1.3.6.1.2.1.1.1.0';
const OID_SYS_OBJECT_ID = '1.3.6.1.2.1.1.2.0';
const OID_SYS_UPTIME = '1.3.6.1.2.1.1.3.0';

/**
 * SnmpDiagnoseService (gateway)
 *
 * Diagnóstico sob demanda de uma câmera SNMP: testa via GET cada OID
 * cadastrado e cada OID candidato dos perfis de fabricante, e faz um walk
 * resumido (limitado em quantidade e tempo) das subárvores padrão — MIB-II
 * system/interfaces e a subárvore enterprise do fabricante detectado pelo
 * sysObjectID. Publica progresso parcial e o resultado final em:
 *
 *   bluebee/{tenantId}/gateway/{gatewayId}/discovery/snmp-diagnose-progress
 *   bluebee/{tenantId}/gateway/{gatewayId}/discovery/snmp-diagnose-result
 *
 * Câmera sem SNMP → success=true, reachable=false (ausência é um dado).
 */
@Injectable()
export class SnmpDiagnoseService {
  private readonly logger = new Logger(SnmpDiagnoseService.name);

  /** Lock: um diagnóstico por vez (walk é pesado para o gateway). */
  private diagnoseInProgress = false;

  constructor(private readonly mqttService: GatewayMqttService) {}

  @OnEvent('command.snmp.diagnose')
  async handleDiagnoseCommand(command: SnmpDiagnoseCommand): Promise<void> {
    const topicBase =
      `bluebee/${command.tenant_id}/gateway/${command.gateway_id}/discovery`;
    const resultTopic = `${topicBase}/snmp-diagnose-result`;
    const progressTopic = `${topicBase}/snmp-diagnose-progress`;

    if (this.diagnoseInProgress) {
      this.mqttService.publish(resultTopic, {
        command_id: command.command_id,
        success: false,
        busy: true,
        error: 'Já existe um diagnóstico SNMP em andamento neste gateway',
      });
      return;
    }

    this.diagnoseInProgress = true;
    const startedAt = Date.now();

    try {
      // OIDs únicos a testar: sistema (detecção do fabricante) + cadastrados
      // + candidatos dos perfis.
      const uniqueOids = new Set<string>([
        OID_SYS_DESCR,
        OID_SYS_OBJECT_ID,
        OID_SYS_UPTIME,
      ]);
      for (const p of command.current) {
        if (p.oid) uniqueOids.add(p.oid);
      }
      for (const p of command.candidates) {
        if (p.oid) uniqueOids.add(p.oid);
      }
      const oidList = [...uniqueOids];

      this.logger.log(
        `Diagnóstico SNMP ${command.command_id}: ${command.ip}:${command.port} ` +
          `(v${command.snmpVersion}) — ${oidList.length} OID(s) + walk`,
      );

      // Progresso inicial (0/N) publicado IMEDIATAMENTE: garante que qualquer
      // instância do backend (não só a que originou o POST) tenha o progresso
      // no mapa via MQTT antes mesmo do primeiro lote de OIDs.
      this.mqttService.publish(progressTopic, {
        command_id: command.command_id,
        phase: 'oids',
        tested: 0,
        total: oidList.length,
      });

      // Sessão SNMP única para toda a fase de GETs: sessões efêmeras em
      // sequência (nova porta UDP por request) derrubam a taxa de resposta em
      // firmwares de câmera. Recriada sob demanda se der erro fatal.
      const shared = this.createSharedSession(command);

      // Fase 1: ping SNMP (sysUpTime). QUALQUER resposta do agente — mesmo
      // noSuchObject/noSuchName (câmera sem sysUpTime, como certas Hikvision)
      // — prova que a câmera fala SNMP. Só o silêncio total (timeout) conta
      // como "não respondeu". O ping tenta PING_ATTEMPTS vezes: um único
      // pacote UDP perdido não pode virar "câmera não tem SNMP".
      let ping: OidReadResult | null = null;
      for (let attempt = 1; attempt <= PING_ATTEMPTS; attempt++) {
        if (attempt > 1) await this.sleep(PING_RETRY_INTERVAL_MS);
        ping = await this.readOne(shared, OID_SYS_UPTIME);
        if (ping !== null) break; // respondeu (com valor OU com erro de OID)
        this.logger.warn(
          `Diagnóstico SNMP ${command.command_id}: ping sysUpTime sem ` +
            `resposta (tentativa ${attempt}/${PING_ATTEMPTS})`,
        );
      }

      // Silêncio total no GET: última chance com getNext na raiz da MIB —
      // alguns agentes respondem ao getNext mesmo quando o GET de um OID
      // específico é descartado.
      if (ping === null) {
        const answered = await this.getNextProbe(command, command.community);
        if (answered) {
          ping = { oid: OID_SYS_UPTIME, responded: false, value: null, raw: null };
        }
      }

      if (ping === null) {
        // Continua muda: distinguir "community errada" de "sem SNMP/sem rede".
        // Firmwares descartam silenciosamente pacotes com community errada —
        // se a câmera responde com a community padrão 'public', o problema é
        // a community configurada, não a rede.
        let cause: 'community' | 'no_response' = 'no_response';
        if ((command.community || 'public') !== 'public') {
          const publicAnswers = await this.getNextProbe(command, 'public');
          if (publicAnswers) cause = 'community';
        }
        shared.close();
        this.mqttService.publish(resultTopic, {
          command_id: command.command_id,
          success: true,
          reachable: false,
          cause,
          oidResults: {},
          walk: [],
          durationMs: Date.now() - startedAt,
        });
        return;
      }

      // Fase 2: GET de cada OID (um por vez, com pausa entre requests e
      // progresso por OID). O uptime já está resolvido pelo ping.
      const oidResults: Record<string, OidReadResult> = {
        [OID_SYS_UPTIME]: ping,
      };
      const remaining = oidList.filter((oid) => oid !== OID_SYS_UPTIME);
      let tested = 1;
      this.mqttService.publish(progressTopic, {
        command_id: command.command_id,
        phase: 'oids',
        tested,
        total: oidList.length,
      });
      for (const oid of remaining) {
        await this.sleep(GET_INTERVAL_MS);
        const r = await this.readOne(shared, oid);
        oidResults[oid] = r ?? { oid, responded: false, value: null, raw: null };
        tested += 1;
        this.mqttService.publish(progressTopic, {
          command_id: command.command_id,
          phase: 'oids',
          tested,
          total: oidList.length,
        });
      }

      // Segunda passada: re-testa uma vez só os OIDs que não responderam
      // (a câmera pode ter descartado pacotes pontualmente).
      const failedOids = remaining.filter((oid) => !oidResults[oid].responded);
      for (const oid of failedOids) {
        await this.sleep(GET_INTERVAL_MS);
        const r = await this.readOne(shared, oid);
        if (r?.responded) oidResults[oid] = r;
      }
      shared.close();

      // Fase 3: walk resumido das subárvores padrão + enterprise detectada.
      const sysObjectId = oidResults[OID_SYS_OBJECT_ID]?.raw ?? null;
      const walkRoots: Array<{ root: string; label: string }> = [
        { root: '1.3.6.1.2.1.1', label: 'MIB-II system' },
        { root: '1.3.6.1.2.1.2', label: 'MIB-II interfaces' },
      ];
      const enterpriseRoot = this.enterpriseRootOf(sysObjectId);
      if (enterpriseRoot) {
        walkRoots.push({
          root: enterpriseRoot,
          label: `Enterprise do fabricante (${enterpriseRoot})`,
        });
      }

      const walk: WalkSection[] = [];
      for (let i = 0; i < walkRoots.length; i++) {
        this.mqttService.publish(progressTopic, {
          command_id: command.command_id,
          phase: 'walk',
          tested: i,
          total: walkRoots.length,
        });
        const section = await this.walkSubtree(
          command,
          walkRoots[i].root,
          walkRoots[i].label,
        );
        walk.push(section);
      }

      // Cruzamento com o walk: OID testado que aparece no walk com valor foi
      // comprovadamente respondido pela câmera — nunca pode ficar como "não
      // respondeu" só porque o GET individual falhou (rajada/descarte).
      for (const section of walk) {
        for (const entry of section.entries) {
          const existing = oidResults[entry.oid];
          if (existing && !existing.responded) {
            const n = Number(entry.value);
            oidResults[entry.oid] = {
              oid: entry.oid,
              responded: true,
              value: Number.isFinite(n) ? n : null,
              raw: entry.value,
            };
          }
        }
      }

      this.mqttService.publish(resultTopic, {
        command_id: command.command_id,
        success: true,
        reachable: true,
        sysDescr: oidResults[OID_SYS_DESCR]?.raw ?? null,
        sysObjectId,
        oidResults,
        walk,
        durationMs: Date.now() - startedAt,
      });
      this.logger.log(
        `Diagnóstico SNMP ${command.command_id} concluído em ${Date.now() - startedAt}ms`,
      );
    } catch (err) {
      this.logger.error(`Diagnóstico SNMP falhou: ${(err as Error).message}`);
      this.mqttService.publish(resultTopic, {
        command_id: command.command_id,
        success: false,
        error: (err as Error).message ?? 'Erro interno no diagnóstico SNMP',
      });
    } finally {
      this.diagnoseInProgress = false;
    }
  }

  /**
   * Sessão SNMP compartilhada para a fase de GETs do diagnóstico. Uma única
   * sessão (mesma porta UDP de origem) para todos os GETs; se a sessão der
   * erro fatal, é recriada de forma transparente na próxima leitura.
   */
  private createSharedSession(target: {
    ip: string;
    port: number;
    snmpVersion: '1' | '2c';
    community: string;
  }): SharedSnmpSession {
    let session: snmp.Session | null = null;
    let broken = true;

    const ensure = (): snmp.Session => {
      if (session && !broken) return session;
      if (session) {
        try {
          session.close();
        } catch {
          // best-effort
        }
      }
      session = snmp.createSession(target.ip, target.community || 'public', {
        port: target.port || 161,
        version: target.snmpVersion === '1' ? snmp.Version1 : snmp.Version2c,
        timeout: DIAG_TIMEOUT_MS,
        retries: 1,
      });
      broken = false;
      session.on('error', () => {
        broken = true;
      });
      return session;
    };

    return {
      get: ensure,
      markBroken: () => {
        broken = true;
      },
      close: () => {
        if (!session) return;
        try {
          session.close();
        } catch {
          // best-effort
        }
        session = null;
        broken = true;
      },
    };
  }

  /**
   * GET de um OID na sessão compartilhada. Retorna null quando o host não
   * respondeu (timeout/erro de sessão); senão, o resultado do OID (varbind
   * com erro = responded=false — a câmera vive, mas não expõe aquele OID).
   */
  private readOne(shared: SharedSnmpSession, oid: string): Promise<OidReadResult | null> {
    return new Promise((resolve) => {
      let settled = false;
      const done = (result: OidReadResult | null) => {
        if (settled) return;
        settled = true;
        resolve(result);
      };

      let session: snmp.Session;
      try {
        session = shared.get();
      } catch {
        done(null);
        return;
      }

      session.get([oid], (error: Error | null, varbinds: snmp.VarBind[]) => {
        if (error) {
          // Erro de protocolo (ex.: noSuchName no SNMPv1) = o agente
          // RESPONDEU: câmera viva, OID inexistente. A sessão segue boa.
          if (classifySnmpError(error) === 'agent_error') {
            done({ oid, responded: false, value: null, raw: null });
            return;
          }
          // Timeout/erro de rede: a sessão pode ter ficado inutilizável —
          // força recriação na próxima leitura.
          shared.markBroken();
          done(null);
          return;
        }
        const vb = varbinds[0];
        if (!vb || snmp.isVarbindError(vb)) {
          done({ oid, responded: false, value: null, raw: null });
          return;
        }
        const raw = this.stringifyValue(vb.value);
        done({
          oid,
          responded: true,
          // Mesmo pipeline de normalização do polling ("45 PERCENT" → 45).
          value: parseSnmpNumber(vb.value),
          raw,
        });
      });
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * "Ping" alternativo: getNext a partir da raiz da MIB (1.3.6.1). QUALQUER
   * datagrama de volta — valor, endOfMibView ou erro de protocolo — prova que
   * o agente SNMP existe e aceita a community. Timeout = silêncio.
   */
  private getNextProbe(
    target: { ip: string; port: number; snmpVersion: '1' | '2c' },
    community: string,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      const session = snmp.createSession(target.ip, community || 'public', {
        port: target.port || 161,
        version: target.snmpVersion === '1' ? snmp.Version1 : snmp.Version2c,
        timeout: DIAG_TIMEOUT_MS,
        retries: 1,
      });
      let settled = false;
      const done = (answered: boolean) => {
        if (settled) return;
        settled = true;
        try {
          session.close();
        } catch {
          // best-effort
        }
        resolve(answered);
      };
      (session as unknown as {
        getNext: (
          oids: string[],
          cb: (error: Error | null, varbinds: snmp.VarBind[]) => void,
        ) => void;
      }).getNext(['1.3.6.1'], (error: Error | null) => {
        if (error) {
          done(classifySnmpError(error) === 'agent_error');
          return;
        }
        done(true);
      });
      session.on('error', () => done(false));
    });
  }

  /**
   * Walk (subtree) limitado em quantidade e tempo — não trava o gateway em
   * subárvores gigantes. Truncamento é sinalizado no resultado.
   */
  private walkSubtree(
    target: { ip: string; port: number; snmpVersion: '1' | '2c'; community: string },
    root: string,
    label: string,
  ): Promise<WalkSection> {
    return new Promise((resolve) => {
      const session = snmp.createSession(target.ip, target.community || 'public', {
        port: target.port || 161,
        version: target.snmpVersion === '1' ? snmp.Version1 : snmp.Version2c,
        timeout: DIAG_TIMEOUT_MS,
        retries: 0,
      });

      const entries: WalkEntry[] = [];
      let truncated = false;
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutHandle);
        try {
          session.close();
        } catch {
          // best-effort
        }
        resolve({ root, label, entries, truncated });
      };

      const timeoutHandle = setTimeout(() => {
        truncated = true;
        finish();
      }, WALK_TIMEOUT_MS);

      // `subtree` existe em runtime mas falta nas typings do net-snmp.
      (session as unknown as {
        subtree: (
          oid: string,
          maxRepetitions: number,
          feedCb: (varbinds: snmp.VarBind[]) => void,
          doneCb: (error?: Error | null) => void,
        ) => void;
      }).subtree(
        root,
        20,
        (varbinds: snmp.VarBind[]) => {
          for (const vb of varbinds) {
            if (snmp.isVarbindError(vb)) continue;
            if (entries.length >= WALK_MAX_ENTRIES) {
              truncated = true;
              finish();
              return;
            }
            entries.push({
              oid: String(vb.oid),
              value: this.stringifyValue(vb.value),
            });
          }
        },
        () => finish(),
      );

      session.on('error', () => finish());
    });
  }

  /**
   * Deriva a raiz enterprise (1.3.6.1.4.1.<n>) do sysObjectID reportado pela
   * câmera — null quando desconhecido/fora do padrão.
   */
  private enterpriseRootOf(sysObjectId: string | null): string | null {
    if (!sysObjectId) return null;
    const m = /^1\.3\.6\.1\.4\.1\.(\d+)/.exec(sysObjectId.trim());
    return m ? `1.3.6.1.4.1.${m[1]}` : null;
  }

  /** Representação textual segura de um valor de varbind (Buffer, número, …). */
  private stringifyValue(value: unknown): string {
    if (Buffer.isBuffer(value)) {
      // Buffers binários viram hex; texto legível fica como string.
      const s = value.toString('utf8');
      return /^[\x20-\x7e\s]*$/.test(s) ? s : value.toString('hex');
    }
    return String(value);
  }
}
