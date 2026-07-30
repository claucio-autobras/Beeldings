import type { SnmpTarget } from '../snmp/snmp-read.util';
import {
  LAYER1_OIDS,
  resolveProvider,
  type CameraProvider,
} from './provider-registry';

/**
 * Motor genérico de telemetria de câmera — 3 camadas tentadas em ordem:
 *   1. MIB-II padrão (sysUpTime, ifInDiscards/ifInErrors) — universal;
 *   2. Provider do fabricante (SNMP enterprise e/ou HTTP proprietário/ISAPI);
 *   3. Fallback sintético do sistema (perda por ping; uptime estimado é
 *      derivado no backend a partir do histórico de disponibilidade).
 *
 * Regras centrais:
 *   - dado REAL do hardware sempre vence a estimativa (nunca o contrário);
 *   - fallback é POR CAMPO: a falha/sentinela de um campo não derruba os demais;
 *   - nenhuma lógica por marca aqui — tudo vem do provider-registry.
 */

export interface EnginePoint {
  tag: string;
  metric: string;
  oid?: string | null;
  scale?: number;
  unit?: string | null;
  unsupported?: boolean;
}

export interface EngineDevice {
  deviceId: string;
  ip: string;
  /** Fabricante do cadastro (config manual — precedência máxima). */
  manufacturer?: string | null;
  /** Canal SNMP (null = câmera sem SNMP; motor vai direto à Camada 3). */
  snmp?: SnmpTarget | null;
  /** Credenciais HTTP p/ fallback proprietário (ex.: ISAPI Hikvision). */
  http?: { username: string; password: string; port?: number } | null;
  points: EnginePoint[];
}

/** Estado de um ponto quando o valor não é uma leitura real do hardware. */
export type PointState = 'estimated' | 'unsupported';

export interface EngineTelemetryPoint {
  tag: string;
  value: number | null;
  unit: string | null;
  /** 'estimated' = valor sintético (Camada 3) / estimativa pendente no backend. */
  state?: PointState;
  /** true = valor casou com sentinela de bug conhecido ("dado não confiável"). */
  unreliable?: boolean;
  /** Camada/fonte vencedora (diagnóstico): mib2 | provider | http | ping | oid. */
  source?: string;
}

export interface EngineCycleOutput {
  /** true quando o canal SNMP respondeu (ou não há canal SNMP e o ping respondeu). */
  reachable: boolean;
  points: EngineTelemetryPoint[];
}

/** IO injetável — o motor em si é puro e testável. */
export interface EngineIo {
  readNumbers(target: SnmpTarget, oids: string[]): Promise<Array<number | null> | null>;
  readStrings(target: SnmpTarget, oids: string[]): Promise<Array<string | null> | null>;
  pingLoss(ip: string): Promise<number | null>;
  isapiUptime(creds: {
    ip: string;
    port?: number;
    username: string;
    password: string;
  }): Promise<number | null>;
}

/** Fator TimeTicks → segundos. */
const TICKS_TO_SECONDS = 0.01;

/** Métricas de saúde que podem vir de campo de provider (Camada 2). */
const PROVIDER_METRICS = new Set([
  'cpu',
  'memory',
  'ram_total',
  'storage',
  'temperature',
  'packet_loss',
  'uptime',
]);

export class CameraTelemetryEngine {
  /** Provider identificado (cache) — null = sem identificação (Camada 3). */
  private provider: CameraProvider | null = null;
  /** true depois que a identificação foi concluída (com ou sem match). */
  private identified = false;

  constructor(private readonly io: EngineIo) {}

  /** Provider atual (diagnóstico/log). */
  get providerId(): string | null {
    return this.provider?.id ?? null;
  }

  /**
   * Identificação automática do fabricante (uma vez, com retry enquanto a
   * câmera não responde): config manual > sysDescr/sysObjectID > enterprise
   * dos OIDs cadastrados. Sem identificação → Camada 3 apenas.
   */
  private async identify(device: EngineDevice): Promise<void> {
    if (this.identified) return;

    // 1) Config manual resolve sem consultar a câmera.
    const manual = resolveProvider({ manufacturer: device.manufacturer });
    if (manual) {
      this.provider = manual;
      this.identified = true;
      return;
    }

    let sysDescr: string | null = null;
    let sysObjectId: string | null = null;
    if (device.snmp) {
      const strings = await this.io.readStrings(device.snmp, [
        LAYER1_OIDS.sysDescr,
        LAYER1_OIDS.sysObjectId,
      ]);
      if (strings === null) {
        // Câmera não respondeu — tenta identificar de novo no próximo ciclo.
        return;
      }
      [sysDescr, sysObjectId] = strings;
    }

    this.provider = resolveProvider({
      manufacturer: device.manufacturer,
      sysDescr,
      sysObjectId,
      pointOids: device.points.map((p) => p.oid),
    });
    this.identified = true;
  }

  /** Executa um ciclo completo de coleta para a câmera. */
  async runCycle(device: EngineDevice): Promise<EngineCycleOutput> {
    await this.identify(device);
    const provider = this.provider;

    // ── Camada 3 (ping) em paralelo — só quando há ponto que a consome. ──
    const wantsPing = device.points.some((p) => p.metric === 'ping_loss');
    const pingPromise = wantsPing ? this.io.pingLoss(device.ip) : Promise.resolve(null);

    // ── Camada 2 HTTP (ISAPI) em paralelo — uptime real do fabricante. ──
    const wantsUptime = device.points.some((p) => p.metric === 'uptime');
    const isapiPromise =
      wantsUptime && provider?.httpUptime === 'isapi' && device.http?.username
        ? this.io
            .isapiUptime({
              ip: device.ip,
              port: device.http.port,
              username: device.http.username,
              password: device.http.password,
            })
            .catch(() => null)
        : Promise.resolve(null);

    // ── Camadas 1+2 SNMP num único GET (fallback por OID já é do util). ──
    // Ordem do batch: Camada 1 primeiro, depois provider, depois OIDs dos
    // pontos — deduplicado (mesmo OID lido uma vez).
    const layer1Oids = [
      LAYER1_OIDS.sysUpTime,
      LAYER1_OIDS.ifInDiscards,
      LAYER1_OIDS.ifInErrors,
    ];
    const providerOids = (provider?.fields ?? []).map((f) => f.oid);
    const pointOids = device.points
      .filter((p) => p.oid && !p.unsupported)
      .map((p) => p.oid as string);
    const batch = [...new Set([...layer1Oids, ...providerOids, ...pointOids])];

    let snmpValues: Map<string, number | null> | null = null;
    let snmpReachable = false;
    if (device.snmp) {
      const raw = await this.io.readNumbers(device.snmp, batch);
      if (raw !== null) {
        snmpReachable = true;
        snmpValues = new Map(batch.map((oid, i) => [oid, raw[i] ?? null]));
      }
    }

    const [pingLoss, isapiUptime] = await Promise.all([pingPromise, isapiPromise]);
    const reachable = device.snmp ? snmpReachable : pingLoss !== null && pingLoss < 100;

    const valueOf = (oid: string | null | undefined): number | null =>
      oid && snmpValues ? (snmpValues.get(oid) ?? null) : null;

    const providerField = (metric: string) =>
      provider?.fields.find((f) => f.metric === metric) ?? null;

    const points: EngineTelemetryPoint[] = device.points.map((p) => {
      const unit = p.unit ?? null;

      // Ponto STATUS: derivado da alcançabilidade — sem OID.
      if (p.metric === 'status') {
        return { tag: p.tag, value: reachable ? 1 : 0, unit };
      }

      // Camada 3: perda de pacotes por ping (sintético, qualquer marca).
      if (p.metric === 'ping_loss') {
        return {
          tag: p.tag,
          value: pingLoss,
          unit,
          ...(pingLoss !== null ? { state: 'estimated' as const, source: 'ping' } : {}),
        };
      }

      // Uptime: HTTP proprietário (real) > sysUpTime MIB-II (real) > OID do
      // ponto (real) > null com state 'estimated' (backend deriva a estimativa).
      if (p.metric === 'uptime') {
        if (isapiUptime !== null) {
          return { tag: p.tag, value: isapiUptime, unit, source: 'http' };
        }
        const sys = valueOf(LAYER1_OIDS.sysUpTime);
        if (sys !== null) {
          return {
            tag: p.tag,
            value: sys * TICKS_TO_SECONDS,
            unit,
            source: 'mib2',
          };
        }
        const own = valueOf(p.oid);
        if (own !== null) {
          return { tag: p.tag, value: own * (p.scale ?? 1), unit, source: 'oid' };
        }
        return { tag: p.tag, value: null, unit, state: 'estimated' };
      }

      // Demais métricas: OID do ponto > campo do provider > MIB-II equivalente.
      const field = PROVIDER_METRICS.has(p.metric) ? providerField(p.metric) : null;

      let value: number | null = null;
      let source: string | undefined;

      const own = p.unsupported ? null : valueOf(p.oid);
      if (own !== null) {
        value = own * (p.scale ?? 1);
        source = 'oid';
      } else if (field) {
        const fv = valueOf(field.oid);
        if (fv !== null) {
          value = fv * (field.scale ?? 1);
          source = 'provider';
        }
      }

      // Camada 1 (MIB-II): packet_loss sem valor cai p/ ifInDiscards+ifInErrors.
      if (value === null && p.metric === 'packet_loss') {
        const discards = valueOf(LAYER1_OIDS.ifInDiscards);
        const errors = valueOf(LAYER1_OIDS.ifInErrors);
        if (discards !== null || errors !== null) {
          value = (discards ?? 0) + (errors ?? 0);
          source = 'mib2';
        }
      }

      // Sentinelas de bug (melhor-esforço): valor casou → dado não confiável.
      // A falha/sentinela deste campo nunca afeta os demais (por-campo).
      const unreliable =
        value !== null &&
        provider?.bestEffort === true &&
        (field?.sentinels ?? []).includes(value);

      return {
        tag: p.tag,
        value,
        unit,
        ...(source ? { source } : {}),
        ...(unreliable ? { unreliable: true } : {}),
        ...(value === null && p.unsupported ? { state: 'unsupported' as const } : {}),
      };
    });

    return { reachable, points };
  }
}
