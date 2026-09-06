/**
 * SnmpNvrTablesService — descobre tabelas de discos e canais de um NVR/DVR.
 *
 * Responde ao comando MQTT `snmp.discover_nvr_tables` roteado pelo
 * CommandDispatcherService. Executa walks SNMP nos prefixos de tabela
 * fornecidos no payload (determinados pelo perfil do fabricante) e publica
 * o resultado no tópico de resposta.
 *
 * Padrão idêntico ao SnmpSwitchPortsService: registra a promessa ANTES do
 * publish para evitar race-condition, walk split-on-error automático via
 * readSnmpTable, parseSnmpNumber para normalizar OCTET STRING.
 *
 * Tópico de resultado:
 *   bluebee/{tenantId}/gateway/{gatewayId}/discovery/nvr-tables-result
 *
 * Regras de resiliência (memória bluebee-snmp-v1-batch):
 *   - SNMPv1: um OID inválido derruba o GET inteiro → readSnmpTable usa
 *     subtree walk (getNext), que é robusto mesmo em v1.
 *   - Tabela que não existe: o walk retorna 0 linhas → capability map marca
 *     UNSUPPORTED. Nunca propaga erro para o comando pai.
 *   - Prefixo vazio/nulo: campo ignorado, não incluso no resultado.
 */

import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as snmp from 'net-snmp';

import { GatewayMqttService } from '../mqtt/gateway-mqtt.service';
import { readSnmpTable } from './snmp-read.util';
import type { SnmpTarget } from './snmp-read.util';

// ─── Tipos públicos ────────────────────────────────────────────────────────

/** OIDs-prefixo de tabela de discos enviados pelo backend. */
export interface NvrDiskTableOids {
  /** tableOidPrefix da coluna disk_status. */
  status?: string | null;
  /** tableOidPrefix da coluna disk_capacity (GB ou MB — escala a cargo do perfil). */
  capacityGb?: string | null;
  /** tableOidPrefix da coluna disk_used (Dahua/Intelbras — espaço USADO direto). */
  usedGb?: string | null;
  /**
   * tableOidPrefix da coluna disk_free (Hikvision hikHddFreeSpace — espaço LIVRE).
   * Mutuamente exclusivo com usedGb. O backend normaliza: disk_used = capacity - freeGb.
   */
  freeGb?: string | null;
  /**
   * Mapa raw → canônico para normalizar disk_status ANTES de retornar ao backend.
   *
   * Enum canônico (Hikvision = referência):
   *   0=sem disco, 1=normal, 2=erro, 3=não formatado, 4=inicializando
   *
   * Dahua/Intelbras raw: 0=normal, 1=erro, 2=sem disco, 3=não formatado, 4=formatando
   *   → statusMap: { 0:1, 1:2, 2:0 }  (valores não listados passam inalterados)
   *
   * Hikvision: enum já é canônico, não enviar statusMap.
   */
  statusMap?: Record<number, number> | null;
}

/** OIDs-prefixo de tabela de canais. */
export interface NvrChannelTableOids {
  /** tableOidPrefix da coluna channel_status. */
  status?: string | null;
}

/** Comando roteado pelo CommandDispatcher. */
export interface NvrDiscoverTablesCommand {
  command_id: string;
  tenant_id: string;
  gateway_id: string;
  ip: string;
  port: number;
  snmpVersion: '1' | '2c';
  community: string;
  diskTableOids: NvrDiskTableOids;
  channelTableOids: NvrChannelTableOids;
}

/** Entrada de disco no resultado. */
export interface NvrDiskInfo {
  /** Índice da linha na tabela SNMP (slotIndex; começa em 1 na maioria dos NVRs). */
  slotIndex: number;
  /** disk_status: 0=sem disco,1=normal,2=erro,3=não formatado,4=inicializando. null=sem dado. */
  status: number | null;
  /** Capacidade total (GB ou MB conforme o fabricante). null=não suportado. */
  capacityValue: number | null;
  /**
   * Espaço USADO (Dahua/Intelbras — OID usedGb fornecido).
   * Mutuamente exclusivo com freeValue. null = OID não fornecido ou sem resposta.
   */
  usedValue: number | null;
  /**
   * Espaço LIVRE/FREE (Hikvision hikHddFreeSpace — OID freeGb fornecido).
   * Mutuamente exclusivo com usedValue. null = OID não fornecido ou sem resposta.
   * O backend normaliza: disk_used = capacityValue - freeValue.
   */
  freeValue: number | null;
}

/** Entrada de canal no resultado. */
export interface NvrChannelInfo {
  /** Índice do canal (começa em 1). */
  channelIndex: number;
  /** channel_status: 0=offline,1=idle/normal,2=gravando,3=motion/alarme. null=sem dado. */
  status: number | null;
}

/** Payload publicado no tópico de resultado. */
export interface NvrDiscoverTablesResult {
  command_id: string;
  success: boolean;
  error?: string;
  /** sysDescr do equipamento (identificação de firmware). */
  sysDescr?: string | null;
  /** Discos encontrados (vazio se tabela não suportada). */
  disks: NvrDiskInfo[];
  /** Canais encontrados (vazio se tabela não suportada). */
  channels: NvrChannelInfo[];
}

// ─── Constantes ────────────────────────────────────────────────────────────

const SYS_DESCR_OID    = '1.3.6.1.2.1.1.1.0';
const DISCOVER_TIMEOUT = 28_000;
const GET_TIMEOUT      = 3_000;

// ─── Serviço ──────────────────────────────────────────────────────────────────

@Injectable()
export class SnmpNvrTablesService {
  private readonly logger = new Logger(SnmpNvrTablesService.name);

  constructor(private readonly mqtt: GatewayMqttService) {}

  @OnEvent('command.snmp.discover_nvr_tables')
  async handleDiscoverNvrTables(cmd: NvrDiscoverTablesCommand): Promise<void> {
    const { command_id, tenant_id, gateway_id, ip, port, snmpVersion, community } = cmd;
    const resultTopic = `bluebee/${tenant_id}/gateway/${gateway_id}/discovery/nvr-tables-result`;

    this.logger.log(`Descoberta de tabelas NVR — ${ip} command_id=${command_id}`);

    const publish = (result: NvrDiscoverTablesResult) => {
      this.mqtt.publish(resultTopic, result);
    };

    const target: SnmpTarget = {
      ip,
      port: port || 161,
      snmpVersion: snmpVersion || '2c',
      community: community || 'public',
    };

    let timedOut = false;
    const totalTimer = setTimeout(() => {
      timedOut = true;
      publish({ command_id, success: false, error: 'timeout', disks: [], channels: [] });
    }, DISCOVER_TIMEOUT);

    try {
      // ── sysDescr (não crítico) ───────────────────────────────────────────
      const sysDescr = await this.readSysDescr(target).catch(() => null);
      if (timedOut) return;

      const diskOids  = cmd.diskTableOids    ?? {};
      const chanOids  = cmd.channelTableOids ?? {};

      // ── Walks em paralelo — só os prefixos fornecidos ────────────────────
      // readSnmpTable retorna Array<{ifIndex, value}> | null.
      // Prefixo ausente/nulo → skip (resultado vazio, nunca erro).
      const [
        diskStatusRows,
        diskCapRows,
        diskUsedRows,
        diskFreeRows,
        chanStatusRows,
      ] = await Promise.all([
        diskOids.status    ? readSnmpTable(target, diskOids.status).catch(() => null)    : Promise.resolve(null),
        diskOids.capacityGb? readSnmpTable(target, diskOids.capacityGb).catch(() => null): Promise.resolve(null),
        diskOids.usedGb    ? readSnmpTable(target, diskOids.usedGb).catch(() => null)    : Promise.resolve(null),
        diskOids.freeGb    ? readSnmpTable(target, diskOids.freeGb).catch(() => null)    : Promise.resolve(null),
        chanOids.status    ? readSnmpTable(target, chanOids.status).catch(() => null)    : Promise.resolve(null),
      ]);

      if (timedOut) return;

      // ── Merge de discos ────────────────────────────────────────────────────
      // União de todos os índices que qualquer coluna retornou.
      const diskIdx = new Set<number>([
        ...(diskStatusRows?.map((r) => r.ifIndex) ?? []),
        ...(diskCapRows?.map((r)    => r.ifIndex) ?? []),
        ...(diskUsedRows?.map((r)   => r.ifIndex) ?? []),
        ...(diskFreeRows?.map((r)   => r.ifIndex) ?? []),
      ]);

      // SnmpTableEntry.value é `number | null` (falha de leitura ou OID inexistente);
      // filtra entradas null para não propagar valores inválidos para a tabela.
      const toNumMap = (rows: Array<{ ifIndex: number; value: number | null }> | null) => {
        const m = new Map<number, number>();
        if (rows) {
          for (const r of rows) {
            if (r.value !== null) m.set(r.ifIndex, r.value);
          }
        }
        return m;
      };

      const statMap = toNumMap(diskStatusRows);
      const capMap  = toNumMap(diskCapRows);
      const usedMap = toNumMap(diskUsedRows);
      const freeMap = toNumMap(diskFreeRows);

      // Aplica o mapa de normalização de status (Dahua/Intelbras raw→canônico).
      // statusMap: { raw: canonical } — chaves não listadas passam inalteradas.
      // Enum canônico: 0=sem disco, 1=normal, 2=erro, 3=não formatado, 4=inicializando.
      const statusNorm = diskOids.statusMap ?? null;
      const normalizeStatus = (raw: number): number =>
        statusNorm && Object.prototype.hasOwnProperty.call(statusNorm, raw)
          ? (statusNorm[raw] as number)
          : raw;

      const disks: NvrDiskInfo[] = [...diskIdx]
        .sort((a, b) => a - b)
        .map((slotIndex) => {
          const rawStatus = statMap.has(slotIndex) ? (statMap.get(slotIndex) ?? null) : null;
          return {
            slotIndex,
            status:        rawStatus !== null ? normalizeStatus(rawStatus) : null,
            capacityValue: capMap.has(slotIndex)  ? (capMap.get(slotIndex)  ?? null) : null,
            usedValue:     usedMap.has(slotIndex) ? (usedMap.get(slotIndex) ?? null) : null,
            freeValue:     freeMap.has(slotIndex) ? (freeMap.get(slotIndex) ?? null) : null,
          };
        });

      // ── Merge de canais ────────────────────────────────────────────────────
      const chanStatMap = toNumMap(chanStatusRows);
      const channels: NvrChannelInfo[] = [...chanStatMap.entries()]
        .sort(([a], [b]) => a - b)
        .map(([channelIndex, status]) => ({ channelIndex, status }));

      clearTimeout(totalTimer);
      this.logger.log(
        `Descoberta NVR ${ip}: ${disks.length} disco(s), ${channels.length} canal(is) command_id=${command_id}`,
      );
      publish({ command_id, success: true, sysDescr, disks, channels });
    } catch (err) {
      clearTimeout(totalTimer);
      if (!timedOut) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.error(`Erro ao descobrir tabelas NVR ${ip}: ${message}`);
        publish({ command_id, success: false, error: message, disks: [], channels: [] });
      }
    }
  }

  /**
   * Lê sysDescr escalar numa sessão efêmera.
   * Retorna null em caso de timeout ou erro — identificação é best-effort.
   */
  private readSysDescr(target: SnmpTarget): Promise<string | null> {
    return new Promise((resolve) => {
      const session = snmp.createSession(target.ip, target.community || 'public', {
        port: target.port || 161,
        version: target.snmpVersion === '1' ? snmp.Version1 : snmp.Version2c,
        timeout: GET_TIMEOUT,
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
