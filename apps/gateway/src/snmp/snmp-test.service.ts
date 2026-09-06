import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import * as snmp from 'net-snmp';
import { GatewayMqttService } from '../mqtt/gateway-mqtt.service';
import {
  classifySnmpError,
  createSnmpSession,
  parseSnmpNumber,
  type SnmpTarget,
  type SnmpV3Credentials,
} from './snmp-read.util';
import {
  asn1TypeName,
  stringifySnmpValue,
  resolveWalkRoots,
  walkSnmpSubtree,
  type WalkRoot,
} from './snmp-walk.util';
import { resolveDiscoveryWalkRoots } from '../profiles/profile-registry';
import { resolveCanonicalMetrics } from './snmp-canonical-resolver';

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
  /** Teste de cadastro: resolve também fontes canônicas e raízes de descoberta. */
  canonical?: boolean;
  manufacturer?: string | null;
  deviceType?: string | null;
  /** Metadados da fonte efetiva, enviados pelo backend (não pelo navegador). */
  metricMeta?: Record<string, {
    unit: string;
    scale: number;
    unsupported?: boolean;
  }>;
}

/** Detalhe por OID lido (aditivo — backends antigos ignoram). */
interface DetailedRead {
  value: number | null;
  raw: string | null;
  type: string | null;
  responded: boolean;
  cause: 'unsupported' | 'no_response' | 'community' | null;
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
          const agentError = error ? classifySnmpError(error) === 'agent_error' : Boolean(vb);
          done({
            value: null,
            raw: null,
            type: null,
            responded: agentError,
            cause: agentError ? 'unsupported' : 'no_response',
          });
          return;
        }
        done({
          value: parseSnmpNumber(vb.value),
          raw: stringifySnmpValue(vb.value),
          type: asn1TypeName((vb as { type?: number }).type),
          responded: true,
          cause: null,
        });
      });
      session.on('error', () => done({
        value: null,
        raw: null,
        type: null,
        responded: false,
        cause: 'no_response',
      }));
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
          done(oids.map(() => ({
            value: null,
            raw: null,
            type: null,
            responded: true,
            cause: 'unsupported',
          })));
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
                responded: true,
                cause: null,
              }
            : {
                value: null,
                raw: null,
                type: null,
                responded: true,
                cause: 'unsupported',
              },
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

    // Include profile-declared metrics without an OID (for example the
    // explicitly unsupported iDFlex temperature) so the caller gets a
    // capability state instead of mistaking an omitted row for a timeout.
    const metrics = [...new Set([
      ...Object.keys(command.oids).filter((m) => command.oids[m]),
      ...Object.keys(command.metricMeta ?? {}),
    ])];
    const oidMetrics = metrics.filter((m) => command.oids[m]);
    const oidList = oidMetrics.map((m) => command.oids[m]);

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
      const detailedByMetric = detailed
        ? Object.fromEntries(oidMetrics.map((metric, index) => [metric, detailed[index]]))
        : null;
      const agentResponded = detailed?.some((read) => read.responded) ?? false;
      // Compat: sem OIDs solicitados, o "ping" continua via sysUpTime.
      const reachable =
        oidList.length > 0
          ? agentResponded
          : (await readOidsDetailed(target, ['1.3.6.1.2.1.1.3.0']))?.some((read) => read.responded) ?? false;

      const values: Record<string, number | null> = {};
      const details: Record<string, DetailedRead> = {};
      metrics.forEach((m, i) => {
        const d = detailedByMetric?.[m] ?? null;
        values[m] = d?.value ?? null;
        details[m] = d ?? {
          value: null,
          raw: null,
          type: null,
          responded: false,
          cause: 'no_response',
        };
      });

      const canonical = command.canonical
        ? await this.resolveCanonicalTest(
            command,
            target,
            metrics,
            detailedByMetric,
            !agentResponded && command.snmpVersion !== '3' && command.community !== 'public'
              ? (await readOidsDetailed(
                  { ...target, community: 'public' },
                  ['1.3.6.1.2.1.1.3.0'],
                ))?.some((read) => read.responded)
                ? 'community'
                : 'no_response'
              : !agentResponded
                ? 'no_response'
                : null,
          )
        : null;

      this.mqttService.publish(resultTopic, {
        command_id: command.command_id,
        success: true,
        reachable,
        values,
        details,
        ...(canonical ? canonical : {}),
      });
    } catch (err) {
      this.mqttService.publish(resultTopic, {
        command_id: command.command_id,
        success: false,
        error: (err as Error).message ?? 'Erro interno no teste SNMP',
      });
    }
  }

  /**
   * Prévia do cadastro usando o mesmo resolvedor de fontes do diagnóstico.
   * O GET ainda preserva o contrato antigo; esta camada aditiva acrescenta
   * métricas canônicas e estados por item para clientes novos.
   */
  private async resolveCanonicalTest(
    command: SnmpTestCommand,
    target: SnmpTarget,
    metrics: string[],
    detailedByMetric: Record<string, DetailedRead> | null,
    unreachableCause: 'community' | 'no_response' | null,
  ): Promise<{
    metricResults: Record<string, {
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
    }>;
    identity: { sysDescr: string | null; sysObjectId: string | null };
    cause: 'community' | 'no_response' | null;
  }> {
    const readByOid: Record<string, DetailedRead> = {};
    metrics.forEach((metric, index) => {
      const oid = command.oids[metric];
      if (oid) readByOid[oid] = detailedByMetric?.[metric] ?? {
        value: null,
        raw: null,
        type: null,
        responded: false,
        cause: 'no_response',
      };
    });

    const identityOids = [
      '1.3.6.1.2.1.1.1.0',
      '1.3.6.1.2.1.1.2.0',
    ];
    if (detailedByMetric === null || unreachableCause !== null) {
      const metricResults: Record<string, {
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
      }> = {};
      for (const metric of metrics) {
        const meta = command.metricMeta?.[metric] ?? { unit: '', scale: 1 };
        metricResults[metric === 'memory' ? 'memory_available' : metric] = {
          canonicalKey: metric === 'cpu' ? 'cpu_usage' : metric,
          label: metric,
          value: null,
          rawValue: null,
          selectedOid: null,
          unit: meta.unit,
          scale: meta.scale,
          state: unreachableCause === 'community' ? 'NO_PERMISSION' : 'TEMPORARY_ERROR',
          cause: unreachableCause,
          source: null,
        };
      }
      return {
        metricResults,
        identity: { sysDescr: null, sysObjectId: null },
        cause: unreachableCause,
      };
    }

    const identityReads = await readOidsDetailed(target, identityOids);
    const sysDescr = identityReads?.[0]?.raw ?? null;
    const sysObjectId = identityReads?.[1]?.raw ?? null;
    const walkRoots: WalkRoot[] = resolveWalkRoots({
      profileRoots: resolveDiscoveryWalkRoots({
        deviceType: command.deviceType,
        manufacturer: command.manufacturer,
        sysDescr,
        sysObjectId,
      }),
      sysObjectId,
    }).filter((root) =>
      root.root === '1.3.6.1.2.1.2' ||
      root.root === '1.3.6.1.2.1.25' ||
      root.root.startsWith('1.3.6.1.4.1.'),
    );
    const walk: Array<{
      root: string;
      label: string;
      entries: Awaited<ReturnType<typeof walkSnmpSubtree>>['entries'];
      truncated: boolean;
      found: number;
      discarded: Record<string, number>;
      error: string | null;
      durationMs: number;
    }> = [];
    for (const root of walkRoots) {
      const result = await walkSnmpSubtree({
        ip: target.ip,
        port: target.port,
        version: target.snmpVersion,
        community: target.community,
        v3: target.v3,
      }, root.root, {
        maxEntries: 500,
        budgetMs: 4000,
        requestTimeoutMs: 2500,
      });
      walk.push({
        root: result.root,
        label: root.label,
        entries: result.entries,
        truncated: result.truncated,
        found: result.entries.length,
        discarded: result.discarded,
        error: result.error,
        durationMs: result.durationMs,
      });
    }

    const oidResults = Object.fromEntries(
      Object.entries(readByOid).map(([oid, read]) => [
        oid,
        {
          oid,
          responded: read.responded,
          value: read.value,
          raw: read.raw,
        },
      ]),
    );
    const canonical = resolveCanonicalMetrics(
      Boolean(identityReads),
      oidResults,
      walk,
    );
    const metricResults: Record<string, {
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
    }> = {};

    for (const metric of metrics) {
      const meta = command.metricMeta?.[metric] ?? { unit: '', scale: 1 };
      const canonicalKey =
        metric === 'cpu' ? 'cpu_usage' :
        metric === 'memory' || metric === 'memory_available' ? 'memory_available' :
        metric === 'temperature' ? 'cpu_temperature' : metric;
      const resolved = canonical[canonicalKey];
      const direct = readByOid[command.oids[metric]];
      let value = resolved?.value ?? null;
      let selectedOid = resolved?.selectedOid ?? null;
      let source = resolved?.source ?? null;
      let unit = resolved?.unit ?? meta.unit;
      let scale = resolved ? 1 : meta.scale;
      if (resolved?.value === null && direct?.value !== null) {
        value = direct.value * meta.scale;
        selectedOid = command.oids[metric] ?? null;
        source = 'fonte efetiva do perfil';
        unit = meta.unit;
        scale = meta.scale;
      }
      // An explicit empty mapping is a profile decision, not a missing
      // response. It must block a generic walk from reviving a metric that
      // the firmware is known not to expose (iDFlex temperature).
      if (meta.unsupported) {
        value = null;
        selectedOid = null;
        source = null;
        unit = meta.unit;
        scale = meta.scale;
      }
      const state = value !== null && Number.isFinite(value)
        ? 'SUPPORTED'
        : meta.unsupported
          ? 'UNSUPPORTED'
          : direct?.cause === 'unsupported'
            ? 'UNSUPPORTED'
            : direct?.cause === 'no_response' || !direct
              ? 'TEMPORARY_ERROR'
              : 'UNSUPPORTED';
      metricResults[metric === 'memory' ? 'memory_available' : metric] = {
        canonicalKey: metric === 'memory' ? 'memory_available' : canonicalKey,
        label: resolved?.label ?? metric,
        value: value !== null && Number.isFinite(value) ? value : null,
        rawValue: direct?.value ?? null,
        selectedOid,
        unit,
        scale,
        state,
        cause: state === 'SUPPORTED' ? null : direct?.cause ?? (meta.unsupported ? 'not_exposed_by_firmware' : 'no_response'),
        source,
      };
    }
    return { metricResults, identity: { sysDescr, sysObjectId }, cause: null };
  }
}
