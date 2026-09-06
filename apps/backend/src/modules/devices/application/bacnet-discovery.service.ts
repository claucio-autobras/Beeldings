import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MqttService } from '../../mqtt/mqtt.service.js';
import type {
  BacnetDiscoveredObject,
  BacnetDiscoveryResult,
  BacnetDiscoverySource,
  BacnetDiscoverySuccess,
  DiscoverBacnetDto,
} from '../domain/dtos/discover-bacnet.dto.js';

/**
 * Timeout do lado backend para aguardar a resposta do gateway.
 *
 * Via objectList (caminho ideal): proporcional ao nº real de objetos (~10-30s).
 * Via SCAN_MAP (fallback): 384 candidatos / 4 por lote × 1500ms ≈ 144s.
 * 240s (4 min) garante margem para SCAN_MAP completo em redes lentas.
 */
const DISCOVERY_TIMEOUT_MS = 240_000;

interface PendingDiscovery {
  resolve: (result: BacnetDiscoverySuccess) => void;
  reject: (err: Error) => void;
}

interface DiscoveryResultPayload {
  command_id: string;
  success: boolean;
  objects?: BacnetDiscoveredObject[];
  /** Como o gateway enumerou os objetos (objectList/objectListIndex/scan) */
  discoverySource?: BacnetDiscoverySource;
  /** Instância do device efetivamente usada (via Who-Is quando não informada) */
  deviceInstance?: number | null;
  /** Rota BACnet descoberta no I-Am (device MS/TP atrás de roteador) */
  net?: number | null;
  adr?: number[] | null;
  error?: string;
}

@Injectable()
export class BacnetDiscoveryService implements OnModuleInit {
  private readonly logger = new Logger(BacnetDiscoveryService.name);

  /**
   * Maps command_id → pending Promise handlers.
   * This allows the HTTP request to wait for the async MQTT response.
   */
  private readonly pendingDiscoveries = new Map<string, PendingDiscovery>();

  constructor(private readonly mqttService: MqttService) {}

  onModuleInit(): void {
    // Subscribe to all discovery result topics: bluebee/+/gateway/+/discovery/result
    this.mqttService.subscribe('bluebee/+/gateway/+/discovery/result', 0);

    this.mqttService.onMessage((topic: string, rawPayload: Buffer) => {
      if (!topic.endsWith('/discovery/result')) {
        return;
      }
      this.handleDiscoveryResult(rawPayload);
    });
  }

  async discoverBacnet(dto: DiscoverBacnetDto): Promise<BacnetDiscoveryResult> {
    if (!dto.tenantId || dto.tenantId.trim() === '') {
      return { success: false, error: 'tenantId é obrigatório' };
    }

    const commandId = randomUUID();
    const commandTopic = `bluebee/${dto.tenantId}/gateway/${dto.gatewayId}/commands`;

    const commandPayload = {
      command_id: commandId,
      tenant_id: dto.tenantId,
      device_id: 'discovery',
      protocol: 'bacnet',
      action: 'discover',
      params: {
        ip: dto.ip,
        port: dto.port,
        deviceInstance: dto.deviceInstance,
        // Rota BACnet (device MS/TP atrás de roteador) — o gateway endereça
        // via NPDU DNET/DADR quando presentes.
        net: dto.net ?? null,
        adr: dto.adr ?? null,
      },
    };

    this.logger.log(
      `Publishing BACnet discovery command ${commandId} to ${commandTopic}`,
    );

    try {
      await this.mqttService.publish(commandTopic, commandPayload, 1);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      this.logger.error(`Failed to publish discovery command: ${msg}`);
      return { success: false, error: `Falha ao publicar comando MQTT: ${msg}` };
    }

    return new Promise<BacnetDiscoveryResult>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        if (this.pendingDiscoveries.has(commandId)) {
          this.pendingDiscoveries.delete(commandId);
          this.logger.warn(
            `Discovery timeout for command ${commandId} (gateway: ${dto.gatewayId})`,
          );
          resolve({
            success: false,
            error: `Timeout - gateway nao respondeu em ${DISCOVERY_TIMEOUT_MS / 1000}s`,
          });
        }
      }, DISCOVERY_TIMEOUT_MS);

      this.pendingDiscoveries.set(commandId, {
        resolve: (result: BacnetDiscoverySuccess) => {
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

  private handleDiscoveryResult(rawPayload: Buffer): void {
    let payload: DiscoveryResultPayload;

    try {
      payload = JSON.parse(rawPayload.toString()) as DiscoveryResultPayload;
    } catch {
      this.logger.error('Failed to parse discovery result payload');
      return;
    }

    const { command_id } = payload;

    if (!command_id) {
      this.logger.warn('Discovery result missing command_id — ignoring');
      return;
    }

    const pending = this.pendingDiscoveries.get(command_id);

    if (!pending) {
      // Already timed out or unknown command — safe to ignore
      return;
    }

    this.pendingDiscoveries.delete(command_id);

    if (payload.success && Array.isArray(payload.objects)) {
      pending.resolve({
        success: true,
        command_id,
        objects: payload.objects,
        discoverySource: payload.discoverySource,
        deviceInstance: payload.deviceInstance ?? null,
        net: payload.net ?? null,
        adr: payload.adr ?? null,
      });
    } else {
      pending.reject(
        new Error(payload.error ?? 'Gateway reportou falha no discovery'),
      );
    }
  }
}
