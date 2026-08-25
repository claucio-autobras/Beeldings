import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as snmp from 'net-snmp';
import { GatewayMqttService } from '../mqtt/gateway-mqtt.service';
import {
  classifySnmpError,
  createSnmpSession,
  parseSnmpNumber,
  readSnmpOids,
  type SnmpTarget,
  type SnmpV3Credentials,
} from './snmp-read.util';
import { asn1TypeName, stringifySnmpValue } from './snmp-walk.util';

/** Comando de teste SNMP roteado pelo CommandDispatcher. */
export interface SnmpTestCommand {
  command_id: string;
  tenant_id: string;
  gateway_id: string;
  ip: string;
  port: number;
  snmpVersion: '1' | '2c' | '3';
  community: string;
  /** Credenciais USM (SNMPv3) — gateways antigos ignoram o campo. */
  v3?: SnmpV3Credentials | null;
  /** OIDs a ler, keyed pela métrica ('cpu', 'memory', …). */
  oids: Record<string, string>;
}

/** Detalhe por OID lido (aditivo — backends antigos ignoram). */
interface DetailedRead {
  value: number | null;
  raw: string | null;
  type: string | null;
}

/**
 * GET detalhado (valor normalizado + bruto + tipo ASN.1) — mesma semântica do
 * readSnmpOids: erro de agente com vários OIDs → fallback individual
 * (split-on-error, um OID inválido não derruba o lote no v1); silêncio → null.
 */
function readOidsDetailed(
  target: SnmpTarget,
  oids: string[],
): Promise<DetailedRead[] | null> {
  const createSession = () => createSnmpSession(target);

  const readOne = (oid: string): Promise<DetailedRead> =>
    new Promise((resolve) => {
      const session = createSession();
      let settled = false;
      const done = (r: DetailedRead) => {
        if (settled) return;
        settled = true;
        try {
          session.close();
        } catch {
          // best-effort
        }
        resolve(r);
      };
      session.get([oid], (error: Error | null, varbinds: snmp.VarBind[]) => {
        const vb = varbinds?.[0];
        if (error || !vb || snmp.isVarbindError(vb)) {
          done({ value: null, raw: null, type: null });
          return;
        }
        done({
          value: parseSnmpNumber(vb.value),
          raw: stringifySnmpValue(vb.value),
          type: asn1TypeName((vb as { type?: number }).type),
        });
      });
      session.on('error', () => done({ value: null, raw: null, type: null }));
    });

  return new Promise((resolve) => {
    const session = createSession();
    let settled = false;
    const done = (r: DetailedRead[] | null) => {
      if (settled) return;
      settled = true;
      try {
        session.close();
      } catch {
        // best-effort
      }
      resolve(r);
    };
    session.get(oids, async (error: Error | null, varbinds: snmp.VarBind[]) => {
      if (error) {
        if (classifySnmpError(error) === 'agent_error') {
          if (oids.length > 1) {
            settled = true;
            try {
              session.close();
            } catch {
              // best-effort
            }
            const out: DetailedRead[] = [];
            for (const oid of oids) {
              out.push(await readOne(oid));
            }
            resolve(out);
            return;
          }
          done(oids.map(() => ({ value: null, raw: null, type: null })));
          return;
        }
        done(null);
        return;
      }
      done(
        varbinds.map((vb) =>
          vb && !snmp.isVarbindError(vb)
            ? {
                value: parseSnmpNumber(vb.value),
                raw: stringifySnmpValue(vb.value),
                type: asn1TypeName((vb as { type?: number }).type),
              }
            : { value: null, raw: null, type: null },
        ),
      );
    });
    session.on('error', () => done(null));
  });
}

/**
 * SnmpTestService (gateway)
 *
 * Testa o canal SNMP de uma câmera/controladora sob demanda (botão "Testar
 * SNMP" do cadastro e teste de OID ao vivo da descoberta): lê os OIDs
 * informados e publica os valores crus por métrica — agora também com
 * `details` (valor bruto + tipo ASN.1) para o modo avançado da UI.
 * Equipamento sem SNMP → success=true, reachable=false (ausência é um dado,
 * não um erro).
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

    const target: SnmpTarget = {
      ip: command.ip,
      port: command.port,
      snmpVersion: command.snmpVersion,
      community: command.community,
      v3: command.v3 ?? undefined,
    };

    try {
      const detailed = oidList.length > 0 ? await readOidsDetailed(target, oidList) : [];
      // Compat: sem OIDs solicitados, o "ping" continua via sysUpTime.
      const reachable =
        oidList.length > 0
          ? detailed !== null
          : (await readSnmpOids(target, [])) !== null;

      const values: Record<string, number | null> = {};
      const details: Record<string, DetailedRead> = {};
      metrics.forEach((m, i) => {
        const d = detailed ? (detailed[i] ?? null) : null;
        values[m] = d?.value ?? null;
        details[m] = d ?? { value: null, raw: null, type: null };
      });

      this.mqttService.publish(resultTopic, {
        command_id: command.command_id,
        success: true,
        reachable,
        values,
        details,
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
