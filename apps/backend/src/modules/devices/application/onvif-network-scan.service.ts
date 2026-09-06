import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MqttService } from '../../mqtt/mqtt.service.js';

/**
 * Timeout do lado backend para aguardar a resposta do gateway ao scan ONVIF.
 * O WS-Discovery no gateway coleta respostas por ~8s; 30s cobre gateway lento
 * (mesma margem do probe ONVIF).
 */
const SCAN_TIMEOUT_MS = 30_000;

/** Câmera ONVIF encontrada via WS-Discovery no gateway. */
export interface DiscoveredOnvifDevice {
  ip: string;
  port: number;
  /** Nome anunciado nos scopes ONVIF. */
  name: string | null;
  /** Hardware/modelo anunciado nos scopes. */
  hardware: string | null;
  /** URLs de serviço anunciadas (diagnóstico). */
  xaddrs: string[];
}

export interface ScanOnvifDto {
  tenantId: string;
  gatewayId: string;
  /** IPs para sondagem WS-Discovery unicast direta (opcional). */
  targets?: string[];
}

export interface OnvifScanSuccess {
  success: true;
  command_id: string;
  devices: DiscoveredOnvifDevice[];
}

export type OnvifScanResult = OnvifScanSuccess | { success: false; error: string };

interface PendingScan {
  resolve: (result: OnvifScanResult) => void;
}

interface ScanResultPayload {
  command_id: string;
  success: boolean;
  devices?: DiscoveredOnvifDevice[];
  error?: string;
}

/**
 * OnvifNetworkScanService
 *
 * Pede ao gateway que rode o WS-Discovery ONVIF (multicast na rede local) e
 * aguarda a lista de câmeras que se anunciaram — IP e porta já detectados,
 * prontos para o cadastro. Mesmo padrão request/response dos scans SNMP/BACnet:
 * pendências por command_id + tópico de resultado próprio + timeout no backend.
 *
 * Não trafega credenciais: o WS-Discovery é anônimo por especificação.
 */
@Injectable()
export class OnvifNetworkScanService implements OnModuleInit {
  private readonly logger = new Logger(OnvifNetworkScanService.name);

  /** command_id → handlers da Promise pendente. */
  private readonly pendingScans = new Map<string, PendingScan>();

  constructor(private readonly mqttService: MqttService) {}

  onModuleInit(): void {
    this.mqttService.subscribe('bluebee/+/gateway/+/discovery/onvif-scan-result', 0);
    this.mqttService.onMessage((topic: string, rawPayload: Buffer) => {
      if (topic.endsWith('/discovery/onvif-scan-result')) {
        this.handleScanResult(rawPayload);
      }
    });
  }

  async scanOnvif(dto: ScanOnvifDto): Promise<OnvifScanResult> {
    const commandId = randomUUID();
    const commandTopic = `bluebee/${dto.tenantId}/gateway/${dto.gatewayId}/commands`;

    const commandPayload = {
      command_id: commandId,
      tenant_id: dto.tenantId,
      device_id: 'onvif-network-scan',
      protocol: 'onvif',
      action: 'scan',
      params: dto.targets?.length ? { targets: dto.targets } : {},
    };

    this.logger.log(
      `Publicando comando de scan ONVIF ${commandId} em ${commandTopic}`,
    );

    try {
      await this.mqttService.publish(commandTopic, commandPayload, 1);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      this.logger.error(`Falha ao publicar comando de scan ONVIF: ${msg}`);
      return { success: false, error: `Falha ao publicar comando MQTT: ${msg}` };
    }

    return new Promise<OnvifScanResult>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        if (this.pendingScans.has(commandId)) {
          this.pendingScans.delete(commandId);
          this.logger.warn(
            `Timeout do scan ONVIF ${commandId} (gateway: ${dto.gatewayId})`,
          );
          resolve({
            success: false,
            error:
              'O gateway não respondeu à descoberta ONVIF. Verifique se ele está online.',
          });
        }
      }, SCAN_TIMEOUT_MS);

      this.pendingScans.set(commandId, {
        resolve: (result: OnvifScanResult) => {
          clearTimeout(timeoutHandle);
          resolve(result);
        },
      });
    });
  }

  private handleScanResult(rawPayload: Buffer): void {
    let payload: ScanResultPayload;
    try {
      payload = JSON.parse(rawPayload.toString()) as ScanResultPayload;
    } catch {
      this.logger.error('Falha ao parsear payload do resultado de scan ONVIF');
      return;
    }

    if (!payload.command_id) return;
    const pending = this.pendingScans.get(payload.command_id);
    if (!pending) return; // já expirou ou comando desconhecido
    this.pendingScans.delete(payload.command_id);

    if (payload.success && Array.isArray(payload.devices)) {
      pending.resolve({
        success: true,
        command_id: payload.command_id,
        devices: payload.devices,
      });
    } else {
      pending.resolve({
        success: false,
        error: payload.error ?? 'Gateway reportou falha no scan ONVIF',
      });
    }
  }
}
