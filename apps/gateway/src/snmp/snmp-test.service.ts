import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { GatewayMqttService } from '../mqtt/gateway-mqtt.service';
import { readSnmpOids } from './snmp-read.util';

/** Comando de teste SNMP roteado pelo CommandDispatcher. */
export interface SnmpTestCommand {
  command_id: string;
  tenant_id: string;
  gateway_id: string;
  ip: string;
  port: number;
  snmpVersion: '1' | '2c';
  community: string;
  /** OIDs a ler, keyed pela métrica ('cpu', 'memory', …). */
  oids: Record<string, string>;
}

/**
 * SnmpTestService (gateway)
 *
 * Testa o canal SNMP de uma câmera sob demanda (botão "Testar SNMP" do
 * cadastro): lê sysUpTime como ping + os OIDs de saúde informados e publica
 * os valores crus por métrica. Câmera sem SNMP → success=true,
 * reachable=false (ausência é um dado, não um erro).
 *
 * Resultado em:
 *   bluebee/{tenantId}/gateway/{gatewayId}/discovery/snmp-test-result
 */
@Injectable()
export class SnmpTestService {
  private readonly logger = new Logger(SnmpTestService.name);

  constructor(private readonly mqttService: GatewayMqttService) {}

  @OnEvent('command.snmp.test')
  async handleTestCommand(command: SnmpTestCommand): Promise<void> {
    const resultTopic =
      `bluebee/${command.tenant_id}/gateway/${command.gateway_id}/discovery/snmp-test-result`;

    const metrics = Object.keys(command.oids).filter((m) => command.oids[m]);
    const oidList = metrics.map((m) => command.oids[m]);

    this.logger.log(
      `Teste SNMP ${command.command_id}: ${command.ip}:${command.port} ` +
        `(v${command.snmpVersion}, ${oidList.length} OID(s))`,
    );

    try {
      const raw = await readSnmpOids(
        {
          ip: command.ip,
          port: command.port,
          snmpVersion: command.snmpVersion,
          community: command.community,
        },
        oidList,
      );

      const values: Record<string, number | null> = {};
      metrics.forEach((m, i) => {
        values[m] = raw ? (raw[i] ?? null) : null;
      });

      this.mqttService.publish(resultTopic, {
        command_id: command.command_id,
        success: true,
        reachable: raw !== null,
        values,
      });
    } catch (err) {
      this.mqttService.publish(resultTopic, {
        command_id: command.command_id,
        success: false,
        error: (err as Error).message ?? 'Erro interno no teste SNMP',
      });
    }
  }
}
