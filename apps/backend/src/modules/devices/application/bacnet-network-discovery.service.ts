import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MqttService } from '../../mqtt/mqtt.service.js';
import type {
  BacnetScanResult,
  BacnetScanSuccess,
  DiscoveredBacnetDevice,
  ScanBacnetDto,
} from '../domain/dtos/scan-bacnet.dto.js';

/**
 * Timeout do lado backend para aguardar a resposta do gateway ao scan de rede.
 *
 * O gateway combina Who-Is broadcast (~8s) com varredura UNICAST das subredes
 * locais (Device Object por IP, em lotes) e passes extras de retry para redes
 * lentas (BACNET_SCAN_RETRY_PASSES). Uma /23 (~510 IPs) leva ~10-20s por passe;
 * com várias subredes + retry pode passar de um minuto — 120s dá margem.
 */
const SCAN_TIMEOUT_MS = 120_000;

interface PendingScan {
  resolve: (result: BacnetScanSuccess) => void;
  reject: (err: Error) => void;
}

interface ScanResultPayload {
  command_id: string;
  success: boolean;
  devices?: DiscoveredBacnetDevice[];
  error?: string;
}

/**
 * BacnetNetworkDiscoveryService
 *
 * Dispara um "scan de rede" BACnet (Who-Is broadcast) no gateway e aguarda
 * a lista de controladoras encontradas. Usado na tela de adicionar
 * dispositivo para descobrir controladoras sem precisar informar o IP.
 *
 * Diferente do BacnetDiscoveryService (que descobre os OBJETOS de uma
 * controladora já conhecida pelo IP), este serviço descobre as próprias
 * controladoras presentes na rede do gateway.
 */
@Injectable()
export class BacnetNetworkDiscoveryService implements OnModuleInit {
  private readonly logger = new Logger(BacnetNetworkDiscoveryService.name);

  /** Maps command_id → pending Promise handlers. */
  private readonly pendingScans = new Map<string, PendingScan>();

  constructor(private readonly mqttService: MqttService) {}

  onModuleInit(): void {
    // Subscribe to all scan result topics: bluebee/+/gateway/+/discovery/scan-result
    this.mqttService.subscribe('bluebee/+/gateway/+/discovery/scan-result', 0);

    this.mqttService.onMessage((topic: string, rawPayload: Buffer) => {
      if (!topic.endsWith('/discovery/scan-result')) {
        return;
      }
      this.handleScanResult(rawPayload);
    });
  }

  async scanBacnet(dto: ScanBacnetDto): Promise<BacnetScanResult> {
    if (!dto.tenantId || dto.tenantId.trim() === '') {
      return { success: false, error: 'tenantId é obrigatório' };
    }
    if (!dto.gatewayId || dto.gatewayId.trim() === '') {
      return { success: false, error: 'gatewayId é obrigatório' };
    }

    const commandId = randomUUID();
    const commandTopic = `bluebee/${dto.tenantId}/gateway/${dto.gatewayId}/commands`;

    const commandPayload = {
      command_id: commandId,
      tenant_id: dto.tenantId,
      device_id: 'network-scan',
      protocol: 'bacnet',
      action: 'scan',
      params: {},
    };

    this.logger.log(
      `Publishing BACnet network scan command ${commandId} to ${commandTopic}`,
    );

    try {
      await this.mqttService.publish(commandTopic, commandPayload, 1);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      this.logger.error(`Failed to publish scan command: ${msg}`);
      return { success: false, error: `Falha ao publicar comando MQTT: ${msg}` };
    }

    return new Promise<BacnetScanResult>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        if (this.pendingScans.has(commandId)) {
          this.pendingScans.delete(commandId);
          this.logger.warn(
            `Scan timeout for command ${commandId} (gateway: ${dto.gatewayId})`,
          );
          resolve({
            success: false,
            error: `Timeout - gateway nao respondeu em ${SCAN_TIMEOUT_MS / 1000}s`,
          });
        }
      }, SCAN_TIMEOUT_MS);

      this.pendingScans.set(commandId, {
        resolve: (result: BacnetScanSuccess) => {
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

  private handleScanResult(rawPayload: Buffer): void {
    let payload: ScanResultPayload;

    try {
      payload = JSON.parse(rawPayload.toString()) as ScanResultPayload;
    } catch {
      this.logger.error('Failed to parse scan result payload');
      return;
    }

    const { command_id } = payload;

    if (!command_id) {
      this.logger.warn('Scan result missing command_id — ignoring');
      return;
    }

    const pending = this.pendingScans.get(command_id);

    if (!pending) {
      // Already timed out or unknown command — safe to ignore
      return;
    }

    this.pendingScans.delete(command_id);

    if (payload.success && Array.isArray(payload.devices)) {
      pending.resolve({
        success: true,
        command_id,
        devices: payload.devices,
      });
    } else {
      pending.reject(
        new Error(payload.error ?? 'Gateway reportou falha no scan de rede'),
      );
    }
  }
}
