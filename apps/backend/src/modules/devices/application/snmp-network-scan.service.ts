import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MqttService } from '../../mqtt/mqtt.service.js';

/**
 * Timeout do lado backend para aguardar a resposta do gateway ao scan SNMP.
 * O gateway varre o range em lotes com retentativas e fallback de versão/
 * community (~5s pior caso por lote de 32 hosts); 254 IPs levam ~40-60s no
 * pior caso — 180s dá margem para ranges maiores.
 */
const SCAN_TIMEOUT_MS = 180_000;

/** Tempo que o progresso de um scan fica disponível após o término. */
const PROGRESS_TTL_MS = 60_000;

/** Câmera/host SNMP encontrado no scan de range de IP. */
export interface DiscoveredSnmpDevice {
  ip: string;
  sysName?: string | null;
  sysDescr?: string | null;
  sysObjectId?: string | null;
  uptimeSeconds?: number | null;
  /** Combinação que respondeu (diagnóstico). */
  snmpVersion?: '1' | '2c';
  community?: string;
}

/** Resumo diagnóstico do scan reportado pelo gateway. */
export interface SnmpScanSummary {
  probed: number;
  responded: number;
  timeouts: number;
  aliveNoSnmp: string[];
  durationMs: number;
}

/** Progresso parcial de um scan em andamento. */
export interface SnmpScanProgress {
  scanned: number;
  total: number;
  found: number;
  done: boolean;
  /** Tenant dono do scan (do tópico MQTT) — usado p/ escopar o polling. */
  tenantId?: string;
}

export interface ScanSnmpDto {
  tenantId: string;
  gatewayId: string;
  /** Início do range de IP (inclusive), ex.: 192.168.0.1 */
  ipStart: string;
  /** Fim do range de IP (inclusive), ex.: 192.168.0.254 */
  ipEnd: string;
  snmpVersion?: '1' | '2c';
  /** Communities a tentar (fallback automático entre elas). */
  communities?: string[];
  port?: number;
  /** ID do scan gerado pelo cliente — permite acompanhar o progresso. */
  scanId?: string;
}

export interface SnmpScanSuccess {
  success: true;
  command_id: string;
  devices: DiscoveredSnmpDevice[];
  summary?: SnmpScanSummary;
}

export type SnmpScanResult = SnmpScanSuccess | { success: false; error: string };

interface PendingScan {
  resolve: (result: SnmpScanSuccess) => void;
  reject: (err: Error) => void;
}

interface ScanResultPayload {
  command_id: string;
  success: boolean;
  devices?: DiscoveredSnmpDevice[];
  summary?: SnmpScanSummary;
  error?: string;
}

interface ScanProgressPayload {
  command_id: string;
  scanned: number;
  total: number;
  found: number;
}

/**
 * SnmpNetworkScanService
 *
 * Dispara um scan SNMP por range de IP no gateway (comando MQTT) e aguarda a
 * lista de hosts que responderam (câmeras candidatas). Mesmo padrão request/
 * response do scan BACnet: pendingScans por command_id + tópico de resultado
 * próprio, com timeout no backend.
 *
 * Também acompanha o progresso parcial publicado pelo gateway
 * (snmp-scan-progress) e o expõe via getProgress() para o frontend fazer
 * polling durante o scan.
 */
@Injectable()
export class SnmpNetworkScanService implements OnModuleInit {
  private readonly logger = new Logger(SnmpNetworkScanService.name);

  /** command_id → handlers da Promise pendente. */
  private readonly pendingScans = new Map<string, PendingScan>();

  /** command_id → último progresso reportado pelo gateway. */
  private readonly progressByScan = new Map<string, SnmpScanProgress>();

  constructor(private readonly mqttService: MqttService) {}

  onModuleInit(): void {
    this.mqttService.subscribe('bluebee/+/gateway/+/discovery/snmp-scan-result', 0);
    this.mqttService.subscribe('bluebee/+/gateway/+/discovery/snmp-scan-progress', 0);

    this.mqttService.onMessage((topic: string, rawPayload: Buffer) => {
      if (topic.endsWith('/discovery/snmp-scan-result')) {
        this.handleScanResult(rawPayload);
      } else if (topic.endsWith('/discovery/snmp-scan-progress')) {
        this.handleScanProgress(topic, rawPayload);
      }
    });
  }

  /** Progresso atual de um scan (null se desconhecido/expirado). */
  getProgress(scanId: string): SnmpScanProgress | null {
    return this.progressByScan.get(scanId) ?? null;
  }

  async scanSnmp(dto: ScanSnmpDto): Promise<SnmpScanResult> {
    const commandId = dto.scanId?.trim() || randomUUID();
    const commandTopic = `bluebee/${dto.tenantId}/gateway/${dto.gatewayId}/commands`;

    const communities = (dto.communities ?? ['public'])
      .map((c) => c.trim())
      .filter(Boolean);

    const commandPayload = {
      command_id: commandId,
      tenant_id: dto.tenantId,
      device_id: 'snmp-network-scan',
      protocol: 'snmp',
      action: 'scan',
      params: {
        ipStart: dto.ipStart,
        ipEnd: dto.ipEnd,
        snmpVersion: dto.snmpVersion ?? '2c',
        // Compat: gateways antigos leem `community`; novos leem `communities`.
        community: communities[0] ?? 'public',
        communities: communities.length ? communities : ['public'],
        port: dto.port ?? 161,
      },
    };

    this.logger.log(
      `Publicando comando de scan SNMP ${commandId} em ${commandTopic} ` +
        `(${dto.ipStart} → ${dto.ipEnd}, communities: ${communities.join(', ') || 'public'})`,
    );

    // Progresso inicial (total desconhecido até o gateway reportar o 1º lote).
    this.progressByScan.set(commandId, { scanned: 0, total: 0, found: 0, done: false, tenantId: dto.tenantId });

    try {
      await this.mqttService.publish(commandTopic, commandPayload, 1);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      this.logger.error(`Falha ao publicar comando de scan SNMP: ${msg}`);
      this.scheduleProgressCleanup(commandId);
      return { success: false, error: `Falha ao publicar comando MQTT: ${msg}` };
    }

    return new Promise<SnmpScanResult>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        if (this.pendingScans.has(commandId)) {
          this.pendingScans.delete(commandId);
          this.finishProgress(commandId);
          this.logger.warn(
            `Timeout do scan SNMP ${commandId} (gateway: ${dto.gatewayId})`,
          );
          resolve({
            success: false,
            error: `Timeout - gateway nao respondeu em ${SCAN_TIMEOUT_MS / 1000}s`,
          });
        }
      }, SCAN_TIMEOUT_MS);

      this.pendingScans.set(commandId, {
        resolve: (result: SnmpScanSuccess) => {
          clearTimeout(timeoutHandle);
          resolve(result);
        },
        reject: (err: Error) => {
          clearTimeout(timeoutHandle);
          resolve({ success: false, error: err.message });
        },
      });
    });
  }

  private handleScanProgress(topic: string, rawPayload: Buffer): void {
    let payload: ScanProgressPayload;
    try {
      payload = JSON.parse(rawPayload.toString()) as ScanProgressPayload;
    } catch {
      return;
    }
    if (!payload.command_id) return;
    // Tenant vem do tópico (bluebee/<tenant>/gateway/...): vale em toda
    // instância do cluster, mesmo sem o comando local.
    const tenantId = topic.split('/')[1] || this.progressByScan.get(payload.command_id)?.tenantId;
    this.progressByScan.set(payload.command_id, {
      scanned: Number(payload.scanned) || 0,
      total: Number(payload.total) || 0,
      found: Number(payload.found) || 0,
      done: false,
      tenantId,
    });
  }

  /** Marca o progresso como concluído e agenda a limpeza. */
  private finishProgress(commandId: string): void {
    const current = this.progressByScan.get(commandId);
    if (current) {
      this.progressByScan.set(commandId, { ...current, done: true });
    }
    this.scheduleProgressCleanup(commandId);
  }

  private scheduleProgressCleanup(commandId: string): void {
    const handle = setTimeout(() => this.progressByScan.delete(commandId), PROGRESS_TTL_MS);
    handle.unref?.();
  }

  private handleScanResult(rawPayload: Buffer): void {
    let payload: ScanResultPayload;
    try {
      payload = JSON.parse(rawPayload.toString()) as ScanResultPayload;
    } catch {
      this.logger.error('Falha ao parsear payload do resultado de scan SNMP');
      return;
    }

    const { command_id } = payload;
    if (!command_id) {
      this.logger.warn('Resultado de scan SNMP sem command_id — ignorado');
      return;
    }

    const pending = this.pendingScans.get(command_id);
    if (!pending) {
      return; // já expirou ou comando desconhecido
    }
    this.pendingScans.delete(command_id);
    this.finishProgress(command_id);

    if (payload.success && Array.isArray(payload.devices)) {
      pending.resolve({
        success: true,
        command_id,
        devices: payload.devices,
        summary: payload.summary,
      });
    } else {
      pending.reject(
        new Error(payload.error ?? 'Gateway reportou falha no scan SNMP'),
      );
    }
  }
}
