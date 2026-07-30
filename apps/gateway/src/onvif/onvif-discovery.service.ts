import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as dgram from 'dgram';
import * as os from 'os';
import { randomUUID } from 'crypto';
import { GatewayMqttService } from '../mqtt/gateway-mqtt.service';

/** Janela total de coleta de respostas do WS-Discovery (UDP 3702). */
const DISCOVERY_TIMEOUT_MS = 8_000;

/** Momentos (ms) em que o probe é reenviado dentro da janela — 3 tentativas. */
const PROBE_SEND_OFFSETS_MS = [0, 2_000, 4_000];

/** Endereço/porta multicast do WS-Discovery (ONVIF). */
const WS_DISCOVERY_ADDR = '239.255.255.250';
const WS_DISCOVERY_PORT = 3702;

/** Máximo de alvos unicast aceitos num comando (defesa extra à do backend). */
const MAX_UNICAST_TARGETS = 1024;

/** Comando de scan ONVIF roteado pelo CommandDispatcher. */
export interface OnvifScanCommand {
  command_id: string;
  tenant_id: string;
  gateway_id: string;
  /** IPs para sondagem unicast direta (opcional — além do multicast). */
  targets?: string[];
}

/** Câmera ONVIF encontrada via WS-Discovery. */
export interface DiscoveredOnvifDevice {
  ip: string;
  port: number;
  /** Nome anunciado nos scopes (onvif://www.onvif.org/name/...). */
  name: string | null;
  /** Hardware/modelo anunciado nos scopes. */
  hardware: string | null;
  /** URLs de serviço anunciadas (diagnóstico). */
  xaddrs: string[];
}

/** Resposta crua extraída de um datagrama ProbeMatch. */
interface RawMatch {
  xaddrs: string;
  scopes: string;
  /** IP de origem do datagrama (fallback quando as XAddrs não têm IPv4). */
  sourceIp: string;
}

/**
 * OnvifDiscoveryService
 *
 * Executa WS-Discovery (ONVIF, UDP 3702) na rede local do gateway sob demanda
 * do backend. Para tornar o scan confiável em redes reais:
 *  - o probe multicast é REENVIADO 3x dentro da janela (UDP se perde);
 *  - um socket é aberto POR INTERFACE IPv4 ativa (em PCs com várias redes o
 *    multicast sairia só pela interface padrão);
 *  - opcionalmente, o mesmo probe é enviado por UNICAST direto a uma lista de
 *    IPs (funciona mesmo com multicast filtrado no switch);
 *  - todas as respostas são agregadas e deduplicadas por IP.
 *
 * Publica o resultado em (mesmo padrão request/response dos demais scans):
 *   bluebee/{tenantId}/gateway/{gatewayId}/discovery/onvif-scan-result
 *
 * Sem credenciais: o WS-Discovery é anônimo por especificação — usuário e
 * senha só entram depois, no cadastro (probe).
 */
@Injectable()
export class OnvifDiscoveryService {
  private readonly logger = new Logger(OnvifDiscoveryService.name);

  constructor(private readonly mqttService: GatewayMqttService) {}

  @OnEvent('command.onvif.scan')
  async handleScanCommand(command: OnvifScanCommand): Promise<void> {
    const resultTopic =
      `bluebee/${command.tenant_id}/gateway/${command.gateway_id}` +
      `/discovery/onvif-scan-result`;

    const targets = this.sanitizeTargets(command.targets);
    this.logger.log(
      `Scan ONVIF (WS-Discovery) ${command.command_id} — janela de ` +
        `${DISCOVERY_TIMEOUT_MS / 1000}s, ${PROBE_SEND_OFFSETS_MS.length} envios` +
        (targets.length ? `, ${targets.length} alvo(s) unicast` : ''),
    );

    try {
      const devices = await this.runDiscovery(targets);
      this.logger.log(
        `Scan ONVIF ${command.command_id} concluído — ${devices.length} câmera(s) encontrada(s)`,
      );
      this.mqttService.publish(resultTopic, {
        command_id: command.command_id,
        success: true,
        devices,
      });
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      this.logger.warn(`Scan ONVIF ${command.command_id} falhou: ${msg}`);
      this.mqttService.publish(resultTopic, {
        command_id: command.command_id,
        success: false,
        error: 'Falha ao executar a descoberta ONVIF na rede do gateway.',
      });
    }
  }

  /** Valida/limita os IPs de sondagem unicata vindos do comando. */
  private sanitizeTargets(targets: unknown): string[] {
    if (!Array.isArray(targets)) return [];
    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const out: string[] = [];
    for (const t of targets) {
      const ip = String(t).trim();
      const m = ipv4.exec(ip);
      if (!m) continue;
      if (m.slice(1).some((o) => Number(o) > 255)) continue;
      out.push(ip);
      if (out.length >= MAX_UNICAST_TARGETS) break;
    }
    return out;
  }

  /** Lista os endereços IPv4 locais (um por interface ativa, sem loopback). */
  private listIpv4Interfaces(): string[] {
    const addrs: string[] = [];
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const info of ifaces[name] ?? []) {
        if (info.family !== 'IPv4' || info.internal) continue;
        addrs.push(info.address);
      }
    }
    return addrs;
  }

  /** Monta o envelope SOAP do Probe WS-Discovery (NetworkVideoTransmitter). */
  private buildProbeMessage(): Buffer {
    const messageId = `urn:uuid:${randomUUID()}`;
    return Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?>' +
        '<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" ' +
        'xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing" ' +
        'xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" ' +
        'xmlns:dn="http://www.onvif.org/ver10/network/wsdl">' +
        '<e:Header>' +
        `<w:MessageID>${messageId}</w:MessageID>` +
        '<w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>' +
        '<w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>' +
        '</e:Header>' +
        '<e:Body>' +
        '<d:Probe><d:Types>dn:NetworkVideoTransmitter</d:Types></d:Probe>' +
        '</e:Body>' +
        '</e:Envelope>',
      'utf8',
    );
  }

  /**
   * Roda o WS-Discovery: abre um socket por interface IPv4 (multicast) e, se
   * houver alvos, um socket para os probes unicast. Reenvia o probe nos
   * offsets definidos e agrega todas as respostas até o fim da janela.
   */
  private runDiscovery(targets: string[]): Promise<DiscoveredOnvifDevice[]> {
    return new Promise((resolve) => {
      const matches: RawMatch[] = [];
      const sockets: dgram.Socket[] = [];
      const timers: NodeJS.Timeout[] = [];
      const message = this.buildProbeMessage();
      let settled = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        for (const t of timers) clearTimeout(t);
        for (const s of sockets) {
          try {
            s.close();
          } catch {
            // já fechado
          }
        }
        resolve(this.normalizeMatches(matches));
      };

      const onMessage = (msg: Buffer, rinfo: dgram.RemoteInfo) => {
        const parsed = this.parseProbeMatch(msg.toString('utf8'), rinfo.address);
        if (parsed) matches.push(parsed);
      };

      const openSocket = (
        bindAddress: string | undefined,
        send: (socket: dgram.Socket) => void,
      ) => {
        const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        sockets.push(socket);
        socket.on('error', (err) => {
          // Uma interface problemática não pode derrubar o scan inteiro.
          this.logger.debug(`Socket WS-Discovery (${bindAddress ?? 'default'}): ${err.message}`);
          try {
            socket.close();
          } catch {
            // ignore
          }
        });
        socket.on('message', onMessage);
        socket.bind({ address: bindAddress, port: 0 }, () => {
          try {
            socket.setBroadcast(true);
          } catch {
            // best-effort
          }
          for (const offset of PROBE_SEND_OFFSETS_MS) {
            timers.push(
              setTimeout(() => {
                if (settled) return;
                try {
                  send(socket);
                } catch (err) {
                  this.logger.debug(
                    `Envio WS-Discovery falhou (${bindAddress ?? 'default'}): ${(err as Error).message}`,
                  );
                }
              }, offset),
            );
          }
        });
      };

      // 1 socket multicast por interface IPv4 (fallback: interface padrão).
      const interfaces = this.listIpv4Interfaces();
      const multicastBinds = interfaces.length ? interfaces : [undefined];
      for (const addr of multicastBinds) {
        openSocket(addr, (socket) => {
          try {
            if (addr) socket.setMulticastInterface(addr);
          } catch {
            // best-effort
          }
          socket.send(message, 0, message.length, WS_DISCOVERY_PORT, WS_DISCOVERY_ADDR);
        });
      }

      // Socket único para os probes unicast (respostas chegam nele mesmo).
      if (targets.length) {
        openSocket(undefined, (socket) => {
          for (const ip of targets) {
            socket.send(message, 0, message.length, WS_DISCOVERY_PORT, ip);
          }
        });
      }

      timers.push(setTimeout(finish, DISCOVERY_TIMEOUT_MS));
    });
  }

  /**
   * Extrai XAddrs/Scopes de um datagrama ProbeMatch. Parse tolerante a
   * prefixos de namespace variados (d:, wsdd:, sem prefixo…), sem depender
   * de parser SOAP — só precisamos desses dois campos.
   */
  private parseProbeMatch(xml: string, sourceIp: string): RawMatch | null {
    if (!/ProbeMatch/i.test(xml)) return null;
    const xaddrs = /<(?:[\w-]+:)?XAddrs(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?XAddrs>/i.exec(xml);
    if (!xaddrs?.[1]?.trim()) return null;
    const scopes = /<(?:[\w-]+:)?Scopes(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?Scopes>/i.exec(xml);
    return {
      xaddrs: xaddrs[1].trim(),
      scopes: scopes?.[1]?.trim() ?? '',
      sourceIp,
    };
  }

  /** Converte respostas cruas em dispositivos com IP/porta/nome/hardware. */
  private normalizeMatches(matches: RawMatch[]): DiscoveredOnvifDevice[] {
    const byIp = new Map<string, DiscoveredOnvifDevice>();

    for (const match of matches) {
      const xaddrs = match.xaddrs
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const parsed = this.pickAddress(xaddrs) ?? { ip: match.sourceIp, port: 80 };

      const device: DiscoveredOnvifDevice = {
        ip: parsed.ip,
        port: parsed.port,
        name: this.scopeValue(match.scopes, 'name'),
        hardware: this.scopeValue(match.scopes, 'hardware'),
        xaddrs,
      };
      // Reenvios + múltiplas interfaces geram respostas duplicadas — 1 por IP.
      if (!byIp.has(device.ip)) byIp.set(device.ip, device);
    }

    return [...byIp.values()].sort((a, b) =>
      a.ip.localeCompare(b.ip, undefined, { numeric: true }),
    );
  }

  /** Extrai IP/porta da primeira XAddr IPv4 válida (ignora link-local IPv6). */
  private pickAddress(xaddrs: string[]): { ip: string; port: number } | null {
    for (const addr of xaddrs) {
      try {
        const u = new URL(addr);
        // IPv6 vem entre colchetes — priorizamos IPv4 (formato do cadastro).
        if (u.hostname.includes(':') || u.hostname.startsWith('[')) continue;
        const port = u.port ? Number(u.port) : 80;
        if (!u.hostname) continue;
        return { ip: u.hostname, port: Number.isFinite(port) ? port : 80 };
      } catch {
        continue;
      }
    }
    return null;
  }

  /** Lê um valor de scope ONVIF (onvif://www.onvif.org/<key>/<valor>). */
  private scopeValue(scopes: string, key: string): string | null {
    const prefix = `onvif://www.onvif.org/${key}/`;
    for (const scope of scopes.split(/\s+/)) {
      if (scope.startsWith(prefix)) {
        try {
          return decodeURIComponent(scope.slice(prefix.length)) || null;
        } catch {
          return scope.slice(prefix.length) || null;
        }
      }
    }
    return null;
  }
}
