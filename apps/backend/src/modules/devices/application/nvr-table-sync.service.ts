/**
 * NvrTableSyncService
 *
 * Solicita ao gateway a descoberta das tabelas indexadas de um NVR/DVR:
 *   - Tabela de discos (disk_status / disk_capacity / disk_used por slot)
 *   - Tabela de canais de gravação (channel_status por canal)
 *
 * Padrão idêntico ao SwitchPortSyncService:
 *   1. Registra a promessa pendente indexada por command_id ANTES do publish.
 *   2. Publica o comando `snmp.discover_nvr_tables` no tópico de comandos do gateway.
 *   3. Aguarda a resposta no tópico de resultado com timeout de 28 s.
 *
 * O resultado é usado pelo CapabilityProbeService para classificar
 * disk_status/disk_capacity/disk_used/channel_status como SUPPORTED/UNSUPPORTED.
 *
 * Tópico de resultado:
 *   bluebee/{tenantId}/gateway/{gatewayId}/discovery/nvr-tables-result
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MqttService } from '../../mqtt/mqtt.service.js';
import type { NvrDiskTableOids, NvrChannelTableOids } from './nvr-oid-profiles.js';

// Re-export dos tipos para uso externo sem duplicar
export type { NvrDiskTableOids, NvrChannelTableOids };

/** Timeout aguardando o gateway (ms). */
const DISCOVER_TIMEOUT_MS = 28_000;

// ─── Tipos de resultado ──────────────────────────────────────────────────────

export interface DiscoveredDisk {
  slotIndex: number;
  status: number | null;
  capacityValue: number | null;
  /** Espaço USADO (Dahua/Intelbras). Mutuamente exclusivo com freeValue. */
  usedValue: number | null;
  /**
   * Espaço LIVRE/FREE (Hikvision hikHddFreeSpace).
   * O caller normaliza: disk_used = capacityValue - freeValue.
   */
  freeValue: number | null;
}

export interface DiscoveredChannel {
  channelIndex: number;
  status: number | null;
}

export type DiscoverNvrTablesResult =
  | {
      success: true;
      sysDescr: string | null;
      disks: DiscoveredDisk[];
      channels: DiscoveredChannel[];
    }
  | {
      success: false;
      error: string;
    };

// ─── Payload do gateway ──────────────────────────────────────────────────────

interface GatewayNvrTablesPayload {
  command_id: string;
  success: boolean;
  error?: string;
  sysDescr?: string | null;
  disks?: DiscoveredDisk[];
  channels?: DiscoveredChannel[];
}

// ─── Promessa pendente ───────────────────────────────────────────────────────

interface PendingDiscover {
  resolve: (result: DiscoverNvrTablesResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ─── Serviço ────────────────────────────────────────────────────────────────

@Injectable()
export class NvrTableSyncService implements OnModuleInit {
  private readonly logger = new Logger(NvrTableSyncService.name);
  private readonly pending = new Map<string, PendingDiscover>();

  constructor(private readonly mqttService: MqttService) {}

  onModuleInit(): void {
    this.mqttService.subscribe('bluebee/+/gateway/+/discovery/nvr-tables-result', 0);
    this.mqttService.onMessage((topic: string, raw: Buffer) => {
      if (topic.endsWith('/discovery/nvr-tables-result')) {
        this.handleResult(raw);
      }
    });
  }

  /**
   * Solicita ao gateway que descubra tabelas de discos e canais do NVR.
   *
   * Os OID-prefixos das tabelas são determinados pelo perfil detectado e
   * passados no payload — o gateway faz o walk e devolve as linhas indexadas.
   * Prefixos ausentes/nulos são omitidos; o gateway não walk OIDs não enviados.
   */
  async discoverNvrTables(opts: {
    tenantId: string;
    gatewayId: string;
    ip: string;
    port: number;
    snmpVersion: '1' | '2c';
    community: string;
    diskTableOids: NvrDiskTableOids;
    channelTableOids: NvrChannelTableOids;
  }): Promise<DiscoverNvrTablesResult> {
    const commandId   = randomUUID();
    const commandTopic = `bluebee/${opts.tenantId}/gateway/${opts.gatewayId}/commands`;

    const payload = {
      command_id:  commandId,
      tenant_id:   opts.tenantId,
      device_id:   'nvr-discover',
      protocol:    'snmp',
      action:      'discover_nvr_tables',
      params: {
        ip:               opts.ip,
        port:             opts.port,
        snmpVersion:      opts.snmpVersion,
        community:        opts.community,
        // diskTableOids inclui statusMap (Dahua/Intelbras) para normalização
        // dos valores de disk_status no gateway ANTES de retornar ao backend.
        diskTableOids:    opts.diskTableOids,
        channelTableOids: opts.channelTableOids,
      },
    };

    return new Promise<DiscoverNvrTablesResult>((resolve) => {
      // Regista ANTES do publish — evita race-condition (mem: bluebee-bacnet-write-race)
      const timer = setTimeout(() => {
        if (this.pending.has(commandId)) {
          this.pending.delete(commandId);
          resolve({ success: false, error: 'timeout: gateway não respondeu em 28 s' });
        }
      }, DISCOVER_TIMEOUT_MS);

      this.pending.set(commandId, { resolve, timer });
      this.mqttService.publish(commandTopic, payload);
    });
  }

  private handleResult(raw: Buffer): void {
    let payload: GatewayNvrTablesPayload;
    try {
      payload = JSON.parse(raw.toString('utf8')) as GatewayNvrTablesPayload;
    } catch {
      this.logger.warn('Resultado de nvr-tables-result inválido (não é JSON)');
      return;
    }

    const { command_id, success, error, sysDescr, disks, channels } = payload;
    const pending = this.pending.get(command_id);
    if (!pending) return; // já expirou ou não é nosso

    this.pending.delete(command_id);
    clearTimeout(pending.timer);

    if (!success) {
      pending.resolve({ success: false, error: error ?? 'falha na descoberta de tabelas NVR' });
      return;
    }

    pending.resolve({
      success: true,
      sysDescr: sysDescr ?? null,
      disks:    Array.isArray(disks)    ? disks    : [],
      channels: Array.isArray(channels) ? channels : [],
    });
  }
}
