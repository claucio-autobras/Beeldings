/**
 * SnmpSwitchPortsService — descobre portas de um switch via IF-MIB.
 *
 * Responde ao comando MQTT `snmp.discover_ports` roteado pelo
 * CommandDispatcherService. Executa um subtree walk em paralelo para as
 * colunas de descrição, alias, velocidade, tipo e status operacional do
 * IF-MIB, então publica o resultado no tópico de resposta da descoberta.
 *
 * Padrão idêntico ao SnmpDiagnoseService: o backend publica o comando e
 * aguarda a resposta no tópico de discovery com timeout de 30 s.
 *
 * Tópico de resultado:
 *   bluebee/{tenantId}/gateway/{gatewayId}/discovery/switch-ports-result
 */

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as snmp from 'net-snmp';

import { GatewayMqttService } from '../mqtt/gateway-mqtt.service';
import {
  readSnmpTable,
  readSnmpTableStrings,
} from './snmp-read.util';
import type { SnmpTarget } from './snmp-read.util';

/** Comando roteado pelo CommandDispatcher para descoberta de portas. */
export interface SwitchDiscoverPortsCommand {
  command_id: string;
  tenant_id: string;
  gateway_id: string;
  ip: string;
  port: number;
  snmpVersion: '1' | '2c';
  community: string;
}

/** Informação de uma porta descoberta. */
export interface PortInfo {
  /** Índice do IF-MIB (ifIndex). */
  ifIndex: number;
  /** ifDescr — nome da interface conforme firmware. */
  ifDescr: string | null;
  /** ifAlias — alias configurado pelo operador (IF-MIB extensão). */
  ifAlias: string | null;
  /** ifType — tipo de interface (ethernetCsmacd=6, softwareLoopback=24, …). */
  ifType: number | null;
  /** ifHighSpeed — velocidade em Mbps (IF-MIB extensão; 0 = não informado). */
  ifHighSpeed: number | null;
  /** ifOperStatus — 1=up, 2=down, 3=testing, 4=unknown, 5=dormant, …. */
  ifOperStatus: number | null;
}

/** Payload publicado no tópico de resultado. */
export interface SwitchDiscoverPortsResult {
  command_id: string;
  success: boolean;
  error?: string;
  /** sysDescr do equipamento (identidade do firmware). */
  sysDescr?: string | null;
  /** Lista de portas descobertas. */
  ports?: PortInfo[];
}

// ── OID-prefixos das colunas IF-MIB ─────────────────────────────────────────
const IF_DESCR_OID         = '1.3.6.1.2.1.2.2.1.2';
const IF_TYPE_OID          = '1.3.6.1.2.1.2.2.1.3';
const IF_OPER_STATUS_OID   = '1.3.6.1.2.1.2.2.1.8';
const IF_ALIAS_OID         = '1.3.6.1.2.1.31.1.1.1.18';
const IF_HIGH_SPEED_OID    = '1.3.6.1.2.1.31.1.1.1.15';
const SYS_DESCR_OID        = '1.3.6.1.2.1.1.1.0';

/** Timeout total da operação de descoberta de portas (ms). */
const DISCOVER_TIMEOUT_MS = 25_000;

/** Tempo máximo de espera por sessão GET do sysDescr (ms). */
const GET_TIMEOUT_MS = 3_000;

@Injectable()
export class SnmpSwitchPortsService {
  private readonly logger = new Logger(SnmpSwitchPortsService.name);

  constructor(private readonly mqtt: GatewayMqttService) {}

  @OnEvent('command.snmp.discover_ports')
  async handleDiscoverPorts(cmd: SwitchDiscoverPortsCommand): Promise<void> {
    const { command_id, tenant_id, gateway_id, ip, port, snmpVersion, community } = cmd;
    const resultTopic = `bluebee/${tenant_id}/gateway/${gateway_id}/discovery/switch-ports-result`;

    this.logger.log(`Descoberta de portas — ${ip} command_id=${command_id}`);

    const publish = (result: SwitchDiscoverPortsResult) => {
      this.mqtt.publish(resultTopic, result);
    };

    const target: SnmpTarget = {
      ip,
      port: port || 161,
      snmpVersion: snmpVersion || '2c',
      community: community || 'public',
    };

    // Guarda de timeout total
    let timedOut = false;
    const totalTimer = setTimeout(() => {
      timedOut = true;
      publish({ command_id, success: false, error: 'timeout' });
    }, DISCOVER_TIMEOUT_MS);

    try {
      // ── sysDescr (não crítico — prossegue mesmo se falhar) ────────────────
      const sysDescr = await this.readSysDescr(target).catch(() => null);

      if (timedOut) return;

      // ── Walks das colunas em paralelo ────────────────────────────────────
      const [descrRows, typeRows, operRows, aliasRows, speedRows] = await Promise.all([
        readSnmpTableStrings(target, IF_DESCR_OID).catch(() => null),
        readSnmpTable(target, IF_TYPE_OID).catch(() => null),
        readSnmpTable(target, IF_OPER_STATUS_OID).catch(() => null),
        readSnmpTableStrings(target, IF_ALIAS_OID).catch(() => null),
        readSnmpTable(target, IF_HIGH_SPEED_OID).catch(() => null),
      ]);

      if (timedOut) return;

      // Se nem descr nem operStatus respondeu, o host não é alcançável
      if (descrRows === null && operRows === null) {
        clearTimeout(totalTimer);
        publish({ command_id, success: false, error: 'unreachable', sysDescr });
        return;
      }

      // ── Indexa por ifIndex para merge ─────────────────────────────────────
      const toMap = <T>(rows: Array<{ ifIndex: number; value: T }> | null) => {
        const m = new Map<number, T>();
        if (rows) for (const r of rows) m.set(r.ifIndex, r.value);
        return m;
      };

      const descrs    = toMap(descrRows);
      const types     = toMap(typeRows);
      const opers     = toMap(operRows);
      const aliases   = toMap(aliasRows);
      const speeds    = toMap(speedRows);

      // Conjunto de ifIndexes: união de todas as colunas que responderam
      const allIndexes = new Set([
        ...descrs.keys(),
        ...types.keys(),
        ...opers.keys(),
        ...speeds.keys(),
      ]);

      const ports: PortInfo[] = [];
      for (const ifIndex of [...allIndexes].sort((a, b) => a - b)) {
        ports.push({
          ifIndex,
          ifDescr:      descrs.get(ifIndex)  ?? null,
          ifAlias:      aliases.get(ifIndex) ?? null,
          ifType:       types.get(ifIndex)   ?? null,
          ifHighSpeed:  speeds.get(ifIndex)  ?? null,
          ifOperStatus: opers.get(ifIndex)   ?? null,
        });
      }

      clearTimeout(totalTimer);
      this.logger.log(
        `Descoberta de portas ${ip}: ${ports.length} porta(s) encontradas command_id=${command_id}`,
      );
      publish({ command_id, success: true, sysDescr, ports });
    } catch (err) {
      clearTimeout(totalTimer);
      if (!timedOut) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Erro ao descobrir portas ${ip}: ${message}`);
        publish({ command_id, success: false, error: message });
      }
    }
  }

  /**
   * Lê sysDescr (OID escalar) numa sessão SNMP efêmera.
   * Retorna null em caso de timeout ou erro.
   */
  private readSysDescr(target: SnmpTarget): Promise<string | null> {
    return new Promise((resolve) => {
      const session = snmp.createSession(target.ip, target.community || 'public', {
        port: target.port || 161,
        version: target.snmpVersion === '1' ? snmp.Version1 : snmp.Version2c,
        timeout: GET_TIMEOUT_MS,
        retries: 1,
      });

      session.get([SYS_DESCR_OID], (err: Error | null, varbinds: snmp.VarBind[]) => {
        try { session.close(); } catch { /* best-effort */ }
        if (err || !varbinds?.[0] || snmp.isVarbindError(varbinds[0])) {
          resolve(null);
          return;
        }
        const v = varbinds[0].value;
        if (Buffer.isBuffer(v)) {
          resolve(v.toString('utf8').trim() || null);
        } else if (typeof v === 'string') {
          resolve(v.trim() || null);
        } else {
          resolve(null);
        }
      });

      session.on('error', () => resolve(null));
    });
  }
}
