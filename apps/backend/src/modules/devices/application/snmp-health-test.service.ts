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
  snmpVersion: '1' | '2c';
  community: string;
  /** OIDs a ler no teste, keyed pela métrica ('cpu', 'memory', …). */
  oids: Record<string, string>;
}

export type SnmpHealthTestResult =
  | {
      success: true;
      /** A câmera respondeu ao SNMP. */
      reachable: boolean;
      /** Valor cru lido por métrica (null = OID sem resposta/não suportado). */
      values: Record<string, number | null>;
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
        oids: dto.oids,
      },
    };

    this.logger.log(
      `Publicando teste SNMP ${commandId} em ${commandTopic} (${dto.ip}:${dto.port})`,
    );

    try {
      await this.mqttService.publish(commandTopic, commandPayload, 1);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      this.logger.error(`Falha ao publicar teste SNMP: ${msg}`);
      return {
        success: false,
        error: 'Falha ao enviar o comando ao gateway. Tente novamente.',
      };
    }

    return new Promise<SnmpHealthTestResult>((resolve) => {
      const timeoutHandle = setTimeout(() => {
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

      this.pendingTests.set(commandId, {
        resolve: (result: SnmpHealthTestResult) => {
          clearTimeout(timeoutHandle);
          resolve(result);
        },
      });
    });
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
      });
    } else {
      pending.resolve({
        success: false,
        error: payload.error ?? 'Gateway reportou falha no teste SNMP',
      });
    }
  }
}
