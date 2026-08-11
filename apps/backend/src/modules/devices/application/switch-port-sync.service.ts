/**
 * SwitchPortSyncService
 *
 * Descobre as portas de um switch gerenciável via gateway SNMP (IF-MIB walk).
 * Segue o mesmo padrão de request/response MQTT do SnmpDiagnoseService:
 *
 *   1. Registra a promessa pendente indexada por command_id ANTES do publish.
 *   2. Publica o comando `snmp.discover_ports` no tópico de comandos do gateway.
 *   3. Aguarda a resposta no tópico de resultado (timeout 30 s).
 *
 * O resultado é usado pelo CftvController para o endpoint POST /switches/:id/sync-ports.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MqttService } from '../../mqtt/mqtt.service.js';

/** Timeout do backend para descoberta de portas (30 s). */
const DISCOVER_TIMEOUT_MS = 30_000;

/** Informação de uma porta reportada pelo gateway. */
export interface GatewayPortInfo {
  ifIndex: number;
  ifDescr: string | null;
  ifAlias: string | null;
  ifType: number | null;
  ifHighSpeed: number | null;
  ifOperStatus: number | null;
}

/** Resultado da descoberta de portas. */
export type DiscoverPortsResult =
  | {
      success: true;
      sysDescr: string | null;
      ports: GatewayPortInfo[];
    }
  | {
      success: false;
      error: string;
    };

interface PendingDiscover {
  resolve: (result: DiscoverPortsResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface DiscoverResultPayload {
  command_id: string;
  success: boolean;
  error?: string;
  sysDescr?: string | null;
  ports?: GatewayPortInfo[];
}

@Injectable()
export class SwitchPortSyncService implements OnModuleInit {
  private readonly logger = new Logger(SwitchPortSyncService.name);
  private readonly pending = new Map<string, PendingDiscover>();

  constructor(private readonly mqttService: MqttService) {}

  onModuleInit(): void {
    this.mqttService.subscribe('bluebee/+/gateway/+/discovery/switch-ports-result', 0);
    this.mqttService.onMessage((topic: string, raw: Buffer) => {
      if (topic.endsWith('/discovery/switch-ports-result')) {
        this.handleResult(raw);
      }
    });
  }

  /**
   * Solicita ao gateway que descubra as portas de um switch via IF-MIB.
   */
  async discoverPorts(opts: {
    tenantId: string;
    gatewayId: string;
    ip: string;
    port: number;
    snmpVersion: '1' | '2c';
    community: string;
  }): Promise<DiscoverPortsResult> {
    const commandId = randomUUID();
    const commandTopic = `bluebee/${opts.tenantId}/gateway/${opts.gatewayId}/commands`;

    const payload = {
      command_id: commandId,
      tenant_id: opts.tenantId,
      device_id: 'switch-discover',
      protocol: 'snmp',
      action: 'discover_ports',
      params: {
        ip: opts.ip,
        port: opts.port,
        snmpVersion: opts.snmpVersion,
        community: opts.community,
      },
    };

    const result = await new Promise<DiscoverPortsResult>((resolve) => {
      // Registra ANTES do publish (evita race condition).
      // O timer é armazenado no PendingDiscover para que handleResult possa cancelá-lo
      // quando a resposta chegar, evitando timers órfãos.
      const timer = setTimeout(() => {
        if (this.pending.has(commandId)) {
          this.pending.delete(commandId);
          resolve({ success: false, error: 'timeout: gateway não respondeu em 30 s' });
        }
      }, DISCOVER_TIMEOUT_MS);

      this.pending.set(commandId, { resolve, timer });

      this.mqttService.publish(commandTopic, payload);
    });

    return result;
  }

  private handleResult(raw: Buffer): void {
    let payload: DiscoverResultPayload;
    try {
      payload = JSON.parse(raw.toString('utf8')) as DiscoverResultPayload;
    } catch {
      this.logger.warn('Resultado de switch-ports-result inválido (não é JSON)');
      return;
    }

    const { command_id, success, error, sysDescr, ports } = payload;
    const pending = this.pending.get(command_id);
    if (!pending) return; // já expirou ou não é nosso

    this.pending.delete(command_id);
    clearTimeout(pending.timer); // cancela o timeout de 30 s

    if (!success) {
      pending.resolve({ success: false, error: error ?? 'falha na descoberta' });
      return;
    }

    pending.resolve({
      success: true,
      sysDescr: sysDescr ?? null,
      ports: Array.isArray(ports) ? ports : [],
    });
  }
}
