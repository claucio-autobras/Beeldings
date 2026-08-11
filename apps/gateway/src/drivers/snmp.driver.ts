/**
 * SnmpDriver — coleta SNMP para dispositivos monitorados.
 *
 * Implementa a mesma lógica de 3 camadas do CameraTelemetryEngine, mas usando
 * o sistema de perfis declarativos (profile-registry) em vez do provider-registry
 * legado. As camadas são:
 *
 *   1. MIB-II (sysUpTime, ifInDiscards, ifInErrors) — universal, sempre no batch.
 *   2. Perfil do fabricante (OIDs enterprise) — adicionados ao batch quando o
 *      fabricante é identificado. OIDs do perfil VENDOR sobrescrevem o base.
 *   3. Ping/HTTP sintético (packet_loss por ping; uptime real por ISAPI).
 *
 * Para switches (SWITCH), adiciona camada de coleta de tabela IF-MIB:
 *   - Pontos com collectionType='table' e ifIndex definido são lidos via subtree
 *     walk (readTable) em vez de GET escalar.
 *   - Métricas de contador (if_in_octets, if_out_octets) são convertidas em taxa
 *     (B/s) usando amostras anteriores; wraps de Counter32 e reboots (uptime
 *     diminuiu) descartam a amostra sem gerar pico falso.
 *
 * Regras preservadas do engine:
 *   - OID do ponto vence o OID do perfil para a mesma métrica.
 *   - Ponto `unsupported` → publicado como null, excluído do GET.
 *   - Sentinelas de bug → `unreliable: true`, não omite o ponto.
 *   - Falha de um campo nunca derruba os demais (por-campo).
 *   - STATUS é sempre derivado da alcançabilidade, nunca de OID.
 *
 * IO é injetado via construtor — completamente testável sem rede.
 */

import type { SnmpTarget, SnmpTableEntry } from '../snmp/snmp-read.util';
import { LAYER1_OIDS } from '../cameras/provider-registry';
import {
  resolveProfile,
  type ResolveProfileInput,
} from '../profiles/profile-registry';
import type { DeviceKind, MetricMapping, ResolvedProfile } from '../profiles/types';
import type { CollectionDriver, CollectOutput, DriverTelemetryPoint } from './collection-driver.interface';

/**
 * Normaliza o campo `profileOverrides` vindo do backend (Device.config) para o
 * formato que `resolveProfile` espera: `Record<string, MetricMapping>`.
 *
 * O backend armazena os overrides como `Record<string, string>` (métrica → OID
 * string) por simplicidade de edição na UI. O gateway precisa converter para
 * MetricMapping antes de passar ao motor de perfis.
 *
 * Formatos aceitos:
 *   - string OID: `{ "cpu": "1.3.6.1.4.1.39165.1.7.0" }`
 *   - objeto parcial já convertido: `{ "cpu": { "oid": "...", "scale": 1 } }`
 */
export function normalizeProfileOverrides(
  overrides: Record<string, unknown> | null | undefined,
): Record<string, MetricMapping> | null {
  if (!overrides || typeof overrides !== 'object') return null;
  const result: Record<string, MetricMapping> = {};
  for (const [metric, value] of Object.entries(overrides)) {
    if (typeof value === 'string' && value) {
      // Backend envia string OID diretamente — converte para MetricMapping mínimo.
      result[metric] = { metricKey: metric, oid: value };
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      // Já é um objeto MetricMapping-like (forward-compat).
      result[metric] = { metricKey: metric, ...(value as Record<string, unknown>) } as MetricMapping;
    }
    // null/undefined/number/array → ignorado (OID inválido)
  }
  return Object.keys(result).length > 0 ? result : null;
}

/** IO injetável — mesmo padrão do CameraTelemetryEngine para compatibilidade com testes. */
export interface SnmpDriverIo {
  readNumbers(target: SnmpTarget, oids: string[]): Promise<Array<number | null> | null>;
  readStrings(target: SnmpTarget, oids: string[]): Promise<Array<string | null> | null>;
  pingLoss(ip: string): Promise<number | null>;
  isapiUptime(creds: {
    ip: string;
    port?: number;
    username: string;
    password: string;
  }): Promise<number | null>;
  /**
   * Walk de uma coluna de tabela SNMP (opcional — só injetado para switches).
   * Retorna null quando o equipamento NÃO responde (timeout).
   * Retorna [] quando a coluna está vazia (UNSUPPORTED para o probe).
   */
  readTable?(target: SnmpTarget, columnOidPrefix: string): Promise<SnmpTableEntry[] | null>;
}

/** Configuração de um ponto do device (espelho de SnmpPointConfig no serviço). */
export interface SnmpPointConfig {
  tag: string;
  metric: string;
  oid?: string | null;
  scale?: number;
  unit?: string | null;
  unsupported?: boolean;
  /**
   * Para pontos de tabela (switches — IF-MIB): índice da linha da tabela.
   * Ex.: ifIndex=3 → lê a coluna de OID-prefixo no row .3.
   */
  ifIndex?: number;
  /**
   * 'table' → ponto lido por subtree walk (readTable) em vez de GET escalar.
   * Ausente ou 'scalar' → comportamento histórico (GET em lote).
   */
  collectionType?: 'scalar' | 'table';
}

/** Configuração do device SNMP passada ao driver por ciclo. */
export interface SnmpDeviceConfig {
  deviceId: string;
  ip: string;
  snmp: SnmpTarget;
  /** Fabricante manual (Device.config.manufacturer) — auto-detect quando null. */
  manufacturer?: string | null;
  /** Tipo de dispositivo monitorado ('CAMERA', 'SWITCH', …). */
  monitoredDeviceType?: string | null;
  /** ID de perfil forçado (Device.config.profileId). */
  profileId?: string | null;
  /** Overrides de mapeamento por métrica (Device.config.profileOverrides). */
  profileOverrides?: Record<string, unknown> | null;
  /** Credenciais HTTP p/ fallback proprietário (ex.: ISAPI Hikvision). */
  http?: { username: string; password: string; port?: number } | null;
  points: SnmpPointConfig[];
}

const TICKS_TO_SECONDS = 0.01;

const PROVIDER_METRICS = new Set([
  'cpu',
  'memory',
  'ram_total',
  'storage',
  'temperature',
  'packet_loss',
  'uptime',
]);

/**
 * Métricas de tabela que são contadores (publicadas como taxa B/s após derivação).
 * O gateway mantém a amostra anterior e calcula Δvalue/Δt.
 */
const COUNTER_TABLE_METRICS = new Set(['if_in_octets', 'if_out_octets']);

/** Máximo de um contador Counter32 (4 bytes não-sinalizados). */
const COUNTER32_MAX = 4_294_967_295;

/** Amostra anterior de um contador para cálculo de taxa. */
export interface CounterSample {
  value: number;
  ts: number;          // wall-clock ms
  uptimeTicks: number; // sysUpTime ticks na leitura
}

/**
 * Calcula a taxa de variação de um contador SNMP entre dois ciclos.
 *
 * Exportada como função pura para ser testável sem construir um SnmpDriver.
 * O chamador é responsável por persistir `prev` e atualizar a linha de base.
 *
 * Regras de descarte (retornam null em vez de gerar pico falso):
 *   - Primeira amostra: `prev` é undefined — sem delta possível.
 *   - Reboot detectado: uptimeTicks atual < anterior (uptime decrementou).
 *   - Elapsed zero ou negativo: clock instável.
 *   - Counter64 ou tipo desconhecido com valor menor que anterior:
 *       qualquer diminuição é tratada como reset e descartada. NÃO aplica
 *       a fórmula de wrap de Counter32 — isso evita spikes de ~4 GB/s falsos
 *       (Counter64 roda até 2^64 e dificilmente dá a volta em campo).
 *
 * Counter32 wrap: valor atual < anterior → assume wrap em COUNTER32_MAX e
 * computa o delta correto. Só aplicado quando counterType === 'counter32'.
 *
 * Precisão com Counter64: valores acima de 2^53 (~9 PB por amostragem)
 * perdem precisão ao passar por Number. Na prática, portas de até 100 Gbps
 * com polling de 30s acumulam no máximo ~45 GB/intervalo — muito abaixo do
 * limite seguro. Documentado como bound aceitável sem conversão a BigInt.
 *
 * @returns bytes/s — a UI converte para KB/s, Mbps, etc.
 */
export function computeRate(
  prev: CounterSample | undefined,
  rawValue: number,
  nowMs: number,
  uptimeTicks: number,
  counterType: 'counter32' | 'counter64' | undefined,
): number | null {
  if (!prev) return null; // primeira amostra — sem delta

  // Reboot: uptime diminuiu → descarta (o delta não tem sentido).
  if (uptimeTicks < prev.uptimeTicks) return null;

  const elapsedMs = nowMs - prev.ts;
  if (elapsedMs <= 0) return null;

  if (rawValue < prev.value) {
    if (counterType === 'counter32') {
      // Counter32 deu a volta em 2^32: delta = distância até o teto + valor atual.
      const delta = COUNTER32_MAX - prev.value + rawValue + 1;
      return delta / (elapsedMs / 1000);
    }
    // Counter64 ou tipo desconhecido: qualquer diminuição = reset.
    // Descarta esta amostra; o chamador já salvou rawValue como nova linha de base.
    return null;
  }

  return (rawValue - prev.value) / (elapsedMs / 1000);
}

/**
 * SnmpDriver (uma instância por device).
 *
 * A identificação do fabricante é feita uma vez (com retry enquanto a câmera
 * não responde) e cacheada — mesma política do CameraTelemetryEngine.
 */
export class SnmpDriver implements CollectionDriver {
  readonly protocol = 'snmp';

  /** Perfil resolvido — cache entre ciclos. null = ainda não identificado. */
  private profile: ResolvedProfile | null = null;
  /** true após a identificação ser concluída (com ou sem match de fabricante). */
  private identified = false;
  private disposed = false;

  /**
   * Amostras anteriores de contadores por chave "{metricKey}:{ifIndex}".
   * Preservadas entre ciclos para calcular taxas (B/s).
   */
  private readonly counterSamples = new Map<string, CounterSample>();

  constructor(private readonly io: SnmpDriverIo) {}

  /** ID do perfil atual (diagnóstico/log). null quando ainda não identificado. */
  get profileId(): string | null {
    return this.profile?.id ?? null;
  }

  dispose(): void {
    this.disposed = true;
    this.counterSamples.clear();
  }

  // ─── Identificação ───────────────────────────────────────────────────────────

  /**
   * Identifica o fabricante/perfil do device (chamado no início de cada ciclo
   * mas executa de fato apenas na primeira vez, com retry se a câmera não
   * responde). Idêntico ao `identify()` do CameraTelemetryEngine.
   */
  private async identify(device: SnmpDeviceConfig): Promise<void> {
    if (this.identified) return;

    const input: ResolveProfileInput = {
      deviceType: (device.monitoredDeviceType ?? 'CAMERA') as DeviceKind,
      manufacturer: device.manufacturer ?? null,
      profileIdOverride: device.profileId ?? null,
      // Normaliza: backend envia Record<string, string> (OID directo), gateway espera MetricMapping.
      metricOverrides: normalizeProfileOverrides(device.profileOverrides),
    };

    // Tenta resolver com os dados disponíveis (sem SNMP ainda).
    const manual = resolveProfile(input);

    // Ids dos perfis base por tipo de device (priority === 0).
    // Um perfil base retornado significa que não houve match de fabricante —
    // pode valer a pena tentar sysDescr/sysObjectId para auto-detecção.
    const BASE_PROFILE_IDS = new Set(['base-camera', 'base-access-controller', 'base-switch', 'base-nvr']);
    const isBaseFallback = BASE_PROFILE_IDS.has(manual.id);

    if (!isBaseFallback) {
      // Perfil vendor identificado explicitamente (por profileIdOverride ou
      // por manufacturer manual que casou com um perfil vendor).
      this.profile = manual;
      this.identified = true;
      return;
    }

    if (device.manufacturer) {
      // Fabricante declarado, mas nenhum perfil vendor correspondente
      // (marca desconhecida). Usa o perfil base correto para o deviceType —
      // não faz sentido tentar sysDescr quando o operador já informou o fabricante.
      this.profile = manual;
      this.identified = true;
      return;
    }

    // Auto-detecção por sysDescr/sysObjectId.
    const strings = await this.io.readStrings(device.snmp, [
      LAYER1_OIDS.sysDescr,
      LAYER1_OIDS.sysObjectId,
    ]);
    if (strings === null) {
      // Câmera não respondeu — tenta de novo no próximo ciclo.
      return;
    }
    const [sysDescr, sysObjectId] = strings;

    this.profile = resolveProfile({
      ...input,
      sysDescr,
      sysObjectId,
      pointOids: device.points.map((p) => p.oid),
    });
    this.identified = true;
  }

  // ─── Cálculo de taxa a partir de contador ────────────────────────────────────

  /**
   * Armazena nova linha de base e delega à função pura `computeRate`.
   * O histórico fica na instância; a lógica de decisão é totalmente testável
   * sem construir um SnmpDriver completo.
   */
  private getRate(
    key: string,
    rawValue: number,
    nowMs: number,
    uptimeTicks: number,
    counterType: 'counter32' | 'counter64' | undefined,
  ): number | null {
    const prev = this.counterSamples.get(key);
    this.counterSamples.set(key, { value: rawValue, ts: nowMs, uptimeTicks });
    return computeRate(prev, rawValue, nowMs, uptimeTicks, counterType);
  }

  // ─── Ciclo de coleta ─────────────────────────────────────────────────────────

  /**
   * Executa um ciclo completo de coleta para o device.
   * Aceita o config do device para permitir polling sem recriar o driver.
   */
  async runCycle(device: SnmpDeviceConfig): Promise<CollectOutput> {
    if (this.disposed) {
      return { reachable: false, points: device.points.map((p) => ({ tag: p.tag, value: null, unit: p.unit ?? null })) };
    }

    await this.identify(device);
    const profile = this.profile;

    // Separa pontos escalares de pontos de tabela
    const scalarPoints = device.points.filter((p) => p.collectionType !== 'table');
    const tablePoints = device.points.filter((p) => p.collectionType === 'table');

    // ── Camada 3 (ping) em paralelo ────────────────────────────────────────
    const wantsPing = scalarPoints.some((p) => p.metric === 'ping_loss');
    const pingPromise = wantsPing ? this.io.pingLoss(device.ip).catch(() => null) : Promise.resolve(null);

    // ── Camada 2 HTTP (ISAPI) em paralelo ──────────────────────────────────
    const wantsUptime = scalarPoints.some((p) => p.metric === 'uptime');
    const uptimeMapping = profile?.mappings.get('uptime');
    const wantsIsapi = wantsUptime && uptimeMapping?.httpKind === 'isapi' && !!device.http?.username;
    const isapiPromise = wantsIsapi
      ? this.io.isapiUptime({
          ip: device.ip,
          port: device.http!.port,
          username: device.http!.username,
          password: device.http!.password,
        }).catch(() => null)
      : Promise.resolve(null);

    // ── Batch SNMP escalar: Layer1 + OIDs vendor + OIDs dos pontos escalares ─
    const layer1Oids = [
      LAYER1_OIDS.sysUpTime,
      LAYER1_OIDS.ifInDiscards,
      LAYER1_OIDS.ifInErrors,
    ];

    // Pré-busca OIDs de perfil APENAS para métricas cujo binding tem oid=null.
    //
    // Motivação: quando p.oid é null (ex.: NVR cpu/ram_total/temperature com
    // DEFAULT_NVR_POINTS), o driver consulta mapping.oid para resolver o valor.
    // Se o OID do perfil não estiver no batch, valueOf(mapping.oid) retorna null
    // silenciosamente — sem erro, mas sem telemetria.
    //
    // Para câmeras/switches, o binding sempre tem OID concreto → nullOidMetrics
    // fica vazio → profileOids vazio → batch idêntico ao anterior (sem regressão).
    // Pontos unsupported são excluídos: não entram no batch de qualquer forma.
    const nullOidMetrics = new Set(
      scalarPoints.filter((p) => !p.oid && !p.unsupported).map((p) => p.metric),
    );
    const profileOids: string[] = [];
    if (profile && nullOidMetrics.size > 0) {
      for (const mapping of profile.mappings.values()) {
        if (
          nullOidMetrics.has(mapping.metricKey) &&
          mapping.oid &&
          !mapping.httpKind &&
          !mapping.tableOidPrefix
        ) {
          profileOids.push(mapping.oid);
        }
      }
    }

    const pointOids = scalarPoints
      .filter((p) => p.oid && !p.unsupported)
      .map((p) => p.oid as string);

    const batch = [...new Set([...layer1Oids, ...profileOids, ...pointOids])];

    let snmpValues: Map<string, number | null> | null = null;
    let snmpReachable = false;

    const raw = await this.io.readNumbers(device.snmp, batch);
    if (raw !== null) {
      snmpReachable = true;
      snmpValues = new Map(batch.map((oid, i) => [oid, raw[i] ?? null]));
    }

    const [pingLoss, isapiUptime] = await Promise.all([pingPromise, isapiPromise]);
    const reachable = snmpReachable;

    const valueOf = (oid: string | null | undefined): number | null =>
      oid && snmpValues ? (snmpValues.get(oid) ?? null) : null;

    // ── Tabela SNMP (switches e NVRs) ──────────────────────────────────────
    // Só lê tabelas quando o dispositivo respondeu ao scalar batch e há pontos
    // de tabela para coletar. Cada prefixo único é lido uma vez.
    //
    // NVR — dependências implícitas:
    //   Hikvision usa disk_free (col 3 = espaço livre) para derivar disk_used
    //   = disk_capacity - disk_free. O perfil hikvision-nvr mapeia disk_free
    //   com tableOidPrefix; disk_used não tem OID próprio nessa MIB.
    //   Para que a derivação funcione, disk_capacity e disk_free precisam ser
    //   lidos mesmo que o device só tenha pontos disk_used cadastrados.
    const nowMs = Date.now();
    const uptimeTicks = valueOf(LAYER1_OIDS.sysUpTime) ?? 0;

    /**
     * tableValues: metricKey → ifIndex → { value, counterType }
     * counterType vem do campo type do varbind (65=Counter32, 70=Counter64).
     */
    type TableCell = { value: number | null; counterType: 'counter32' | 'counter64' | undefined };
    const tableValues = new Map<string, Map<number, TableCell>>();

    if (tablePoints.length > 0 && reachable && this.io.readTable) {
      // Métricas explicitamente pedidas pelos pontos do device.
      const explicitMetrics = new Set(tablePoints.map((p) => p.metric));

      // Para NVRs com pontos disk_used: adicionar disk_capacity e disk_free
      // como dependências implícitas para normalização Hikvision (capacity-free).
      // Sem custo para Dahua/Intelbras — disk_free não tem tableOidPrefix nesses perfis.
      const implicitMetrics = new Set<string>();
      if (device.monitoredDeviceType === 'NVR' && explicitMetrics.has('disk_used')) {
        implicitMetrics.add('disk_capacity');
        implicitMetrics.add('disk_free');
      }

      const tableMetrics = [...new Set([...explicitMetrics, ...implicitMetrics])];

      await Promise.all(
        tableMetrics.map(async (metric) => {
          const mapping = profile?.mappings.get(metric);
          const prefix = mapping?.tableOidPrefix;
          if (!prefix) return; // sem prefixo definido no perfil → ignora

          const entries = await this.io.readTable!(device.snmp, prefix).catch(() => null);
          if (entries === null) return; // timeout — tableValues permanece vazio para esta métrica

          const byIndex = new Map<number, TableCell>();
          for (const e of entries) {
            byIndex.set(e.ifIndex, { value: e.value, counterType: e.counterType });
          }
          tableValues.set(metric, byIndex);
        }),
      );
    }

    // ── Construção dos pontos escalares ────────────────────────────────────
    const scalarResults: DriverTelemetryPoint[] = scalarPoints.map((p) => {
      const unit = p.unit ?? null;

      if (p.metric === 'status') {
        return { tag: p.tag, value: reachable ? 1 : 0, unit };
      }

      if (p.metric === 'ping_loss') {
        return {
          tag: p.tag,
          value: pingLoss,
          unit,
          ...(pingLoss !== null ? { state: 'estimated' as const, source: 'ping' } : {}),
        };
      }

      // Uptime: ISAPI (real) > sysUpTime MIB-II (real) > OID do ponto > estimado.
      if (p.metric === 'uptime') {
        if (isapiUptime !== null) {
          return { tag: p.tag, value: isapiUptime, unit, source: 'http' };
        }
        const sys = valueOf(LAYER1_OIDS.sysUpTime);
        if (sys !== null) {
          return { tag: p.tag, value: sys * TICKS_TO_SECONDS, unit, source: 'mib2' };
        }
        const own = valueOf(p.oid);
        if (own !== null) {
          return { tag: p.tag, value: own * (p.scale ?? 1), unit, source: 'oid' };
        }
        return { tag: p.tag, value: null, unit, state: 'estimated' };
      }

      // Demais métricas: OID do ponto > OID do perfil > MIB-II packet_loss.
      if (PROVIDER_METRICS.has(p.metric)) {
        const mapping = profile?.mappings.get(p.metric) ?? null;

        let value: number | null = null;
        let source: string | undefined;

        const own = p.unsupported ? null : valueOf(p.oid);
        if (own !== null) {
          value = own * (p.scale ?? 1);
          source = 'oid';
        } else if (mapping?.oid && !mapping.httpKind) {
          // Tenta o OID do perfil do fabricante (se não for o mesmo que p.oid).
          const pv = valueOf(mapping.oid);
          if (pv !== null) {
            value = pv * (mapping.scale ?? 1);
            source = mapping.profileLayer;
          }
        }

        // Fallback MIB-II para packet_loss.
        if (value === null && p.metric === 'packet_loss') {
          const discards = valueOf(LAYER1_OIDS.ifInDiscards);
          const errors = valueOf(LAYER1_OIDS.ifInErrors);
          if (discards !== null || errors !== null) {
            value = (discards ?? 0) + (errors ?? 0);
            source = 'mib2';
          }
        }

        // Sentinelas de bug de firmware (bestEffort).
        const unreliable =
          value !== null &&
          (profile?.bestEffort ?? false) &&
          (mapping?.sentinels ?? []).includes(value);

        return {
          tag: p.tag,
          value,
          unit,
          ...(source ? { source } : {}),
          ...(unreliable ? { unreliable: true } : {}),
          ...(value === null && p.unsupported ? { state: 'unsupported' as const } : {}),
        };
      }

      // Métricas fora do catálogo de provider: OID do ponto ou null.
      const own = p.unsupported ? null : valueOf(p.oid);
      if (own !== null) {
        return { tag: p.tag, value: own * (p.scale ?? 1), unit, source: 'oid' };
      }
      return {
        tag: p.tag,
        value: null,
        unit,
        ...(p.unsupported ? { state: 'unsupported' as const } : {}),
      };
    });

    // ── Construção dos pontos de tabela ────────────────────────────────────
    const tableResults: DriverTelemetryPoint[] = tablePoints.map((p) => {
      const unit = p.unit ?? null;

      if (p.ifIndex === undefined) {
        // Ponto mal configurado (sem ifIndex) — publica null silenciosamente.
        return { tag: p.tag, value: null, unit };
      }

      // ── NVR disk_used: normalização Hikvision capacity − free ───────────
      // Hikvision não expõe espaço usado diretamente — col 3 = disk_free.
      // Quando disk_used não tem tableOidPrefix no perfil mas disk_free e
      // disk_capacity foram lidas como dependências implícitas, calcula:
      //   disk_used = disk_capacity − disk_free (por slot).
      if (p.metric === 'disk_used') {
        const diskUsedMapping = profile?.mappings.get('disk_used');
        // Se o perfil não tem tableOidPrefix para disk_used → tenta derivar.
        if (!diskUsedMapping?.tableOidPrefix) {
          const capByIndex  = tableValues.get('disk_capacity');
          const freeByIndex = tableValues.get('disk_free');
          const capCell  = capByIndex?.get(p.ifIndex);
          const freeCell = freeByIndex?.get(p.ifIndex);
          if (
            capCell?.value !== null && capCell?.value !== undefined &&
            freeCell?.value !== null && freeCell?.value !== undefined
          ) {
            // Scale do perfil de capacidade (ex.: 0.001 MB→GB já aplicado na cap).
            // freeCell e capCell estão no mesmo raw unit → subtração antes da scale.
            const capMapping  = profile?.mappings.get('disk_capacity');
            const freeMapping = profile?.mappings.get('disk_free');
            const capScale  = capMapping?.scale  ?? 1;
            const freeScale = freeMapping?.scale ?? 1;
            // Normaliza cada lado separadamente (unidades podem diferir entre perfis).
            // Em Hikvision ambos são GB sem scale extra — freeScale = capScale = 1.
            const usedRaw = capCell.value * capScale - freeCell.value * freeScale;
            return { tag: p.tag, value: Math.max(0, usedRaw), unit };
          }
          // disk_free não disponível (NVR não respondeu) → publica null.
          return { tag: p.tag, value: null, unit };
        }
      }

      const byIndex = tableValues.get(p.metric);
      if (byIndex === undefined) {
        // Métrica não foi lida (sem prefixo no perfil ou host não respondeu).
        return { tag: p.tag, value: null, unit };
      }

      const cell = byIndex.get(p.ifIndex);

      if (cell === undefined) {
        // Porta não reportou este índice (UNSUPPORTED para este ifIndex).
        return {
          tag: p.tag,
          value: null,
          unit,
          ...(p.unsupported ? { state: 'unsupported' as const } : {}),
        };
      }

      const { value: rawValue, counterType } = cell;

      if (rawValue === null) {
        // Porta respondeu mas sem valor (ex.: OID presente, valor null).
        return {
          tag: p.tag,
          value: null,
          unit,
          ...(p.unsupported ? { state: 'unsupported' as const } : {}),
        };
      }

      // ── if_oper_status: normaliza 1=up→1, 2=down→0, demais→null ─────────
      if (p.metric === 'if_oper_status') {
        const normalized = rawValue === 1 ? 1 : rawValue === 2 ? 0 : null;
        return { tag: p.tag, value: normalized, unit };
      }

      // ── Contadores → taxa B/s ─────────────────────────────────────────────
      // counterType vem do varbind: 'counter32' aplica wrap 2^32;
      // 'counter64' ou undefined trata qualquer decréscimo como reset (→ null).
      if (COUNTER_TABLE_METRICS.has(p.metric)) {
        const key = `${p.metric}:${p.ifIndex}`;
        const rate = this.getRate(key, rawValue, nowMs, uptimeTicks, counterType);
        return {
          tag: p.tag,
          value: rate,
          unit: 'B/s',
          // null na primeira amostra, reboot ou reset — estado normal
          ...(rate === null ? { state: 'estimated' as const } : {}),
        };
      }

      const mapping = profile?.mappings.get(p.metric);

      // ── enumNormalize: normalização de enum raw → canônico ────────────────
      // Aplicada ANTES da scale (enums são integers, scale não faz sentido neles).
      // Uso principal: disk_status Dahua/Intelbras (0=normal,1=erro,2=sem disco)
      //   → enum canônico Hikvision (0=sem disco,1=normal,2=erro).
      // A normalization vem do perfil resolvido, não do binding — garantindo
      // que novos devices com perfil vendor errado também são corrigidos após
      // a reidentificação automática.
      if (mapping?.enumNormalize) {
        const normalized: number =
          Object.prototype.hasOwnProperty.call(mapping.enumNormalize, rawValue)
            ? (mapping.enumNormalize[rawValue] as number)
            : rawValue;
        return { tag: p.tag, value: normalized, unit };
      }

      // Outros pontos de tabela: aplica scale do ponto ou do perfil (Bug 3 — Dahua MB→GB).
      // p.scale vem do binding (DB); mapping.scale vem do perfil de fabricante.
      // Hierarquia: p.scale (binding explícito) > mapping.scale (perfil) > 1.
      const scale = p.scale !== undefined && p.scale !== 1 ? p.scale : (mapping?.scale ?? p.scale ?? 1);
      return { tag: p.tag, value: rawValue * scale, unit };
    });

    return { reachable, points: [...scalarResults, ...tableResults] };
  }

  /**
   * Implementação de CollectionDriver.collect() — wrapper stateless para
   * compatibilidade com o DriverRegistry. Em uso direto pelo SnmpPollingService
   * prefira chamar runCycle(device) passando a config.
   */
  collect(): Promise<CollectOutput> {
    // Não utilizado diretamente em fase 1 (o serviço chama runCycle).
    return Promise.resolve({ reachable: false, points: [] });
  }
}
