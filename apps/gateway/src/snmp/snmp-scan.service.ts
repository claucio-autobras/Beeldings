import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as net from 'net';
import * as snmp from 'net-snmp';
import { GatewayMqttService } from '../mqtt/gateway-mqtt.service';

/** Comando de scan SNMP roteado pelo CommandDispatcher. */
export interface SnmpScanCommand {
  command_id: string;
  tenant_id: string;
  gateway_id: string;
  ipStart: string;
  ipEnd: string;
  snmpVersion: '1' | '2c';
  /** Communities a tentar, em ordem (a primeira é a preferida). */
  communities: string[];
  port: number;
}

interface DiscoveredSnmpDevice {
  ip: string;
  sysName: string | null;
  sysDescr: string | null;
  sysObjectId: string | null;
  uptimeSeconds: number | null;
  /** Combinação que respondeu (diagnóstico). */
  snmpVersion: '1' | '2c';
  community: string;
}

/** Resumo diagnóstico publicado junto com o resultado final. */
interface ScanSummary {
  probed: number;
  responded: number;
  timeouts: number;
  aliveNoSnmp: string[];
  durationMs: number;
}

/** OIDs consultados no probe de cada host do range. */
const OID_SYS_DESCR = '1.3.6.1.2.1.1.1.0';
const OID_SYS_OBJECT_ID = '1.3.6.1.2.1.1.2.0';
const OID_SYS_UPTIME = '1.3.6.1.2.1.1.3.0';
const OID_SYS_NAME = '1.3.6.1.2.1.1.5.0';

/**
 * Timeout por tentativa SNMP. Com 1 retentativa (retries: 1) o pior caso por
 * combinação é ~2×2500ms = 5s — tolerante a câmeras lentas e perda de pacote.
 */
const PROBE_TIMEOUT_MS = 2500;

/** Retentativas do net-snmp por tentativa (além da primeira). */
const PROBE_RETRIES = 1;

/**
 * Hosts consultados em paralelo por lote. As combinações (versão/community)
 * de cada host rodam em paralelo, então o pior caso por lote é ~5s.
 */
const BATCH_SIZE = 32;

/** Limite de IPs por scan (evita ranges absurdos travando o gateway). */
const MAX_RANGE_SIZE = 2048;

/** Portas TCP típicas de câmera testadas na checagem de "host vivo sem SNMP". */
const ALIVE_TCP_PORTS = [80, 443, 554];
const ALIVE_TCP_TIMEOUT_MS = 1200;

/**
 * SnmpScanService
 *
 * Varre um range de IP consultando os OIDs de sistema (MIB-II) de cada host.
 * Hosts que respondem são câmeras/dispositivos SNMP candidatos.
 *
 * Robustez: timeout maior + retentativas por host; fallback automático de
 * versão (v2c → v1) e de communities (lista informada pelo usuário); checagem
 * TCP leve para distinguir "host vivo sem SNMP" de "IP vazio".
 *
 * Publica progresso parcial por lote e o resultado final (com resumo
 * diagnóstico) em tópicos próprios (mesmo padrão do scan BACnet):
 *
 *   bluebee/{tenantId}/gateway/{gatewayId}/discovery/snmp-scan-progress
 *   bluebee/{tenantId}/gateway/{gatewayId}/discovery/snmp-scan-result
 */
@Injectable()
export class SnmpScanService {
  private readonly logger = new Logger(SnmpScanService.name);

  /** Lock: um scan por vez (mesmo padrão do scan BACnet). */
  private scanInProgress = false;

  constructor(private readonly mqttService: GatewayMqttService) {}

  @OnEvent('command.snmp.scan')
  async handleScanCommand(command: SnmpScanCommand): Promise<void> {
    const topicBase =
      `bluebee/${command.tenant_id}/gateway/${command.gateway_id}/discovery`;
    const resultTopic = `${topicBase}/snmp-scan-result`;
    const progressTopic = `${topicBase}/snmp-scan-progress`;

    if (this.scanInProgress) {
      this.logger.warn('Scan SNMP já em andamento — comando rejeitado');
      this.mqttService.publish(resultTopic, {
        command_id: command.command_id,
        success: false,
        error: 'Já existe um scan SNMP em andamento neste gateway',
      });
      return;
    }

    const ips = this.expandRange(command.ipStart, command.ipEnd);
    if (!ips) {
      this.mqttService.publish(resultTopic, {
        command_id: command.command_id,
        success: false,
        error: `Range de IP inválido ou maior que ${MAX_RANGE_SIZE} hosts`,
      });
      return;
    }

    // Combinações de probe: versão selecionada primeiro, depois fallback de
    // versão (v2c → v1), cada uma com todas as communities informadas.
    const communities = (command.communities?.length ? command.communities : ['public'])
      .map((c) => c.trim())
      .filter((c, i, arr) => c.length > 0 && arr.indexOf(c) === i);
    const versions: Array<'1' | '2c'> =
      command.snmpVersion === '1' ? ['1', '2c'] : ['2c', '1'];
    const combos: Array<{ version: '1' | '2c'; community: string }> = [];
    for (const version of versions) {
      for (const community of communities) {
        combos.push({ version, community });
      }
    }

    this.scanInProgress = true;
    const startedAt = Date.now();
    this.logger.log(
      `Scan SNMP iniciado — ${ips.length} host(s) (${command.ipStart} → ${command.ipEnd}), ` +
        `${combos.length} combinação(ões) versão/community`,
    );

    try {
      const devices: DiscoveredSnmpDevice[] = [];
      const aliveNoSnmp: string[] = [];
      let timeouts = 0;
      let scanned = 0;

      for (let i = 0; i < ips.length; i += BATCH_SIZE) {
        const batch = ips.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map((ip) => this.probeHost(ip, combos, command.port || 161)),
        );
        for (const r of results) {
          if (r.device) {
            devices.push(r.device);
          } else {
            if (r.timedOut) timeouts++;
            if (r.aliveNoSnmp) aliveNoSnmp.push(r.ip);
          }
        }
        scanned += batch.length;
        this.mqttService.publish(progressTopic, {
          command_id: command.command_id,
          scanned,
          total: ips.length,
          found: devices.length,
        });
      }

      const summary: ScanSummary = {
        probed: ips.length,
        responded: devices.length,
        timeouts,
        aliveNoSnmp,
        durationMs: Date.now() - startedAt,
      };
      this.logger.log(
        `Scan SNMP concluído — ${devices.length} dispositivo(s), ` +
          `${aliveNoSnmp.length} vivo(s) sem SNMP, em ${summary.durationMs}ms`,
      );
      this.mqttService.publish(resultTopic, {
        command_id: command.command_id,
        success: true,
        devices,
        summary,
      });
    } catch (err) {
      this.logger.error(`Scan SNMP falhou: ${(err as Error).message}`);
      this.mqttService.publish(resultTopic, {
        command_id: command.command_id,
        success: false,
        error: (err as Error).message,
      });
    } finally {
      this.scanInProgress = false;
    }
  }

  /**
   * Sonda um host tentando todas as combinações versão/community em paralelo
   * (a primeira que responder vence). Se nenhuma responder, faz uma checagem
   * TCP leve para saber se o host está vivo na rede sem SNMP.
   */
  private async probeHost(
    ip: string,
    combos: Array<{ version: '1' | '2c'; community: string }>,
    port: number,
  ): Promise<{
    ip: string;
    device: DiscoveredSnmpDevice | null;
    timedOut: boolean;
    aliveNoSnmp: boolean;
  }> {
    const attempts = await Promise.all(
      combos.map((combo) => this.probe(ip, combo.version, combo.community, port)),
    );
    const success = attempts.find((a) => a.device !== null);
    if (success?.device) {
      return { ip, device: success.device, timedOut: false, aliveNoSnmp: false };
    }
    const timedOut = attempts.every((a) => a.timedOut);
    const alive = await this.isTcpAlive(ip);
    return { ip, device: null, timedOut, aliveNoSnmp: alive };
  }

  /** Consulta os OIDs de sistema com uma combinação versão/community. */
  private probe(
    ip: string,
    version: '1' | '2c',
    community: string,
    port: number,
  ): Promise<{ device: DiscoveredSnmpDevice | null; timedOut: boolean }> {
    return new Promise((resolve) => {
      const session = snmp.createSession(ip, community || 'public', {
        port,
        version: version === '1' ? snmp.Version1 : snmp.Version2c,
        timeout: PROBE_TIMEOUT_MS,
        retries: PROBE_RETRIES,
      });

      let settled = false;
      const done = (device: DiscoveredSnmpDevice | null, timedOut: boolean) => {
        if (settled) return;
        settled = true;
        try {
          session.close();
        } catch {
          // best-effort
        }
        resolve({ device, timedOut });
      };

      session.get(
        [OID_SYS_DESCR, OID_SYS_OBJECT_ID, OID_SYS_UPTIME, OID_SYS_NAME],
        (error: Error | null, varbinds: snmp.VarBind[]) => {
          if (error) {
            done(null, error.name === 'RequestTimedOutError');
            return;
          }
          const str = (vb: snmp.VarBind): string | null =>
            snmp.isVarbindError(vb) ? null : String(vb.value);
          const uptimeRaw = snmp.isVarbindError(varbinds[2])
            ? null
            : Number(varbinds[2].value);
          done(
            {
              ip,
              sysDescr: str(varbinds[0]),
              sysObjectId: str(varbinds[1]),
              uptimeSeconds:
                uptimeRaw !== null && Number.isFinite(uptimeRaw)
                  ? Math.round(uptimeRaw / 100)
                  : null,
              sysName: str(varbinds[3]),
              snmpVersion: version,
              community,
            },
            false,
          );
        },
      );

      session.on('error', () => done(null, false));
    });
  }

  /**
   * Checagem leve de vida: tenta conectar TCP nas portas típicas de câmera
   * (HTTP/HTTPS/RTSP). Conexão aceita OU recusada (RST) = host vivo;
   * apenas timeout em todas = provavelmente IP vazio.
   */
  private async isTcpAlive(ip: string): Promise<boolean> {
    const checks = ALIVE_TCP_PORTS.map(
      (port) =>
        new Promise<boolean>((resolve) => {
          const socket = new net.Socket();
          let finished = false;
          const finish = (alive: boolean) => {
            if (finished) return;
            finished = true;
            socket.destroy();
            resolve(alive);
          };
          socket.setTimeout(ALIVE_TCP_TIMEOUT_MS);
          socket.once('connect', () => finish(true));
          socket.once('error', (err: NodeJS.ErrnoException) => {
            // ECONNREFUSED = há alguém respondendo RST → host vivo.
            finish(err.code === 'ECONNREFUSED');
          });
          socket.once('timeout', () => finish(false));
          socket.connect(port, ip);
        }),
    );
    const results = await Promise.all(checks);
    return results.some(Boolean);
  }

  /** Expande ipStart..ipEnd (IPv4, inclusive) — null se inválido/grande demais. */
  private expandRange(ipStart: string, ipEnd: string): string[] | null {
    const start = this.ipToNumber(ipStart);
    const end = this.ipToNumber(ipEnd);
    if (start === null || end === null || end < start) {
      return null;
    }
    const count = end - start + 1;
    if (count > MAX_RANGE_SIZE) {
      return null;
    }
    const ips: string[] = [];
    for (let n = start; n <= end; n++) {
      ips.push(this.numberToIp(n));
    }
    return ips;
  }

  private ipToNumber(ip: string): number | null {
    const parts = (ip ?? '').trim().split('.');
    if (parts.length !== 4) {
      return null;
    }
    let n = 0;
    for (const part of parts) {
      const b = Number(part);
      if (!Number.isInteger(b) || b < 0 || b > 255) {
        return null;
      }
      n = n * 256 + b;
    }
    return n;
  }

  private numberToIp(n: number): string {
    return [
      Math.floor(n / 16777216) % 256,
      Math.floor(n / 65536) % 256,
      Math.floor(n / 256) % 256,
      n % 256,
    ].join('.');
  }
}
