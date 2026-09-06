import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { MqttService } from '../../mqtt/mqtt.service.js';

/**
 * Timeout do lado backend para o teste SNMP de saúde. O gateway tem timeout
 * próprio (~3s + retentativa por request); 20s cobre gateway/câmera lentos.
 */
const TEST_TIMEOUT_MS = 20_000;

export interface SnmpHealthTestDto {
  tenantId: string;
  gatewayId: string;
  ip: string;
  port: number;
  snmpVersion: '1' | '2c' | '3';
  community: string;
  /** Credenciais USM decifradas (SNMPv3) — só trafegam backend → gateway. */
  v3?: import('./snmp-diagnose.service.js').DiagnoseSnmpV3 | null;
  /** OIDs a ler no teste, keyed pela métrica ('cpu', 'memory', …). */
  oids: Record<string, string>;
  /** Solicita a resolução canônica usada pelo diagnóstico (cadastro SCA). */
  canonical?: boolean;
  manufacturer?: string | null;
  deviceType?: string | null;
  metricMeta?: Record<string, {
    unit: string;
    scale: number;
    unsupported?: boolean;
  }>;
}

/** Detalhe por OID (gateways ≥1.22 — ausente em gateways antigos). */
export interface SnmpTestDetail {
  value: number | null;
  raw: string | null;
  type: string | null;
  responded?: boolean;
  cause?: 'unsupported' | 'no_response' | 'community' | null;
}

export interface SnmpHealthMetricResult {
  canonicalKey: string;
  label: string;
  value: number | null;
  rawValue: number | null;
  selectedOid: string | null;
  unit: string;
  scale: number;
  state: 'SUPPORTED' | 'UNSUPPORTED' | 'TEMPORARY_ERROR' | 'NO_PERMISSION';
  cause: string | null;
  source: string | null;
}

export type SnmpHealthTestResult =
  | {
      success: true;
      /** A câmera respondeu ao SNMP. */
      reachable: boolean;
      /** Valor cru lido por métrica (null = OID sem resposta/não suportado). */
      values: Record<string, number | null>;
      /** Valor bruto + tipo ASN.1 por métrica (opcional — gateway novo). */
      details?: Record<string, SnmpTestDetail>;
      /** Resultado canônico por métrica (opcional — gateway novo). */
      metricResults?: Record<string, SnmpHealthMetricResult>;
      identity?: { sysDescr: string | null; sysObjectId: string | null };
      cause?: 'community' | 'no_response' | null;
    }
  | { success: false; error: string };

interface PendingTest {
  resolve: (result: SnmpHealthTestResult) => void;
}

interface TestResultPayload {
  command_id: string;
  success: boolean;
  reachable?: boolean;
  values?: Record<string, number | null>;
  details?: Record<string, SnmpTestDetail>;
  metricResults?: Record<string, SnmpHealthMetricResult>;
  identity?: { sysDescr: string | null; sysObjectId: string | null };
  cause?: 'community' | 'no_response' | null;
  error?: string;
}

/**
 * SnmpHealthTestService (backend)
 *
 * Pede ao gateway que teste o canal SNMP de uma câmera: lê os OIDs de saúde
 * informados e devolve os valores crus (pré-visualização no cadastro). Mesmo
 * padrão request/response dos probes: pendências por command_id + tópico de
 * resultado próprio. Câmera sem SNMP → reachable=false (nunca erro).
 */
@Injectable()
export class SnmpHealthTestService implements OnModuleInit {
  private readonly logger = new Logger(SnmpHealthTestService.name);

  private readonly pendingTests = new Map<string, PendingTest>();

  constructor(private readonly mqttService: MqttService) {}

  onModuleInit(): void {
    this.mqttService.subscribe('bluebee/+/gateway/+/discovery/snmp-test-result', 0);
    this.mqttService.onMessage((topic: string, rawPayload: Buffer) => {
      if (topic.endsWith('/discovery/snmp-test-result')) {
        this.handleTestResult(rawPayload);
      }
    });
  }

  async test(dto: SnmpHealthTestDto): Promise<SnmpHealthTestResult> {
    const commandId = randomUUID();
    const commandTopic = `bluebee/${dto.tenantId}/gateway/${dto.gatewayId}/commands`;
    let timeoutHandle: NodeJS.Timeout | undefined;
    const resultPromise = new Promise<SnmpHealthTestResult>((resolve) => {
      timeoutHandle = setTimeout(() => {
        if (this.pendingTests.has(commandId)) {
          this.pendingTests.delete(commandId);
          this.logger.warn(`Timeout do teste SNMP ${commandId} (gateway: ${dto.gatewayId})`);
          resolve({
            success: false,
            error:
              'O gateway não respondeu ao teste SNMP. Verifique se o gateway está online.',
          });
        }
      }, TEST_TIMEOUT_MS);

      // Register before publish. QoS1 can deliver the gateway response before
      // publish() resolves, especially when the gateway is on the same broker.
      this.pendingTests.set(commandId, {
        resolve: (result: SnmpHealthTestResult) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          resolve(result);
        },
      });
    });

    const commandPayload = {
      command_id: commandId,
      tenant_id: dto.tenantId,
      device_id: 'snmp-health-test',
      protocol: 'snmp',
      action: 'test',
      params: {
        ip: dto.ip,
        port: dto.port,
        snmpVersion: dto.snmpVersion,
        community: dto.community,
        // Credenciais v3 decifradas SÓ no payload MQTT ao gateway.
        ...(dto.snmpVersion === '3' && dto.v3 ? { v3: dto.v3 } : {}),
        oids: dto.oids,
        ...(dto.canonical ? { canonical: true } : {}),
        ...(dto.manufacturer ? { manufacturer: dto.manufacturer } : {}),
        ...(dto.deviceType ? { deviceType: dto.deviceType } : {}),
        ...(dto.metricMeta ? { metricMeta: dto.metricMeta } : {}),
      },
    };

    this.logger.log(
      `Publicando teste SNMP ${commandId} em ${commandTopic} (${dto.ip}:${dto.port})`,
    );

    try {
      await this.mqttService.publish(commandTopic, commandPayload, 1);
    } catch (err) {
      this.pendingTests.delete(commandId);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      const msg = (err as Error).message ?? String(err);
      this.logger.error(`Falha ao publicar teste SNMP: ${msg}`);
      return {
        success: false,
        error: 'Falha ao enviar o comando ao gateway. Tente novamente.',
      };
    }

    return resultPromise;
  }

  private handleTestResult(rawPayload: Buffer): void {
    let payload: TestResultPayload;
    try {
      payload = JSON.parse(rawPayload.toString()) as TestResultPayload;
    } catch {
      this.logger.error('Falha ao parsear payload do resultado de teste SNMP');
      return;
    }
    if (!payload.command_id) return;

    const pending = this.pendingTests.get(payload.command_id);
    if (!pending) return;
    this.pendingTests.delete(payload.command_id);

    if (payload.success) {
      pending.resolve({
        success: true,
        reachable: Boolean(payload.reachable),
        values: payload.values ?? {},
        ...(payload.details ? { details: payload.details } : {}),
        ...(payload.metricResults ? { metricResults: payload.metricResults } : {}),
        ...(payload.identity ? { identity: payload.identity } : {}),
        ...(payload.cause ? { cause: payload.cause } : {}),
      });
    } else {
      pending.resolve({
        success: false,
        error: payload.error ?? 'Gateway reportou falha no teste SNMP',
      });
    }
  }
}
