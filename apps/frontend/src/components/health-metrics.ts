/**
 * Builder das tiles de saúde de hardware de um dispositivo SNMP.
 *
 * Compartilhado entre SCA (controladoras) e CFTV (câmeras/NVRs) — qualquer
 * dispositivo monitorado via SNMP usa as mesmas métricas canônicas. O builder
 * é DINÂMICO: gera tiles só para as métricas que o dispositivo tem ponto,
 * deriva "memória usada %" quando dá (disponível + total presentes) e
 * preserva os estados "sem dados" / "não suportado" por tile.
 *
 * Puro e testável: recebe os pontos + uma função de leitura de telemetria.
 */
import { normalizeHealthValue } from '@/modules/cftv/utils/snmp-health';


/** Ponto mínimo necessário para montar as tiles (shape de SCA e CFTV). */
export interface HealthPointLike {
  id?: string;
  tag: string;
  metric: string;
  unit: string;
  unsupported?: boolean;
  healthState?: string | null;
  healthReason?: string | null;
  removable?: boolean;
}

/** Capacidade é mais forte que qualquer valor residual persistido ou ao vivo. */
export function isUnsupportedHealthPoint(point: HealthPointLike): boolean {
  return Boolean(
    point.unsupported ||
      point.healthState === 'unsupported' ||
      point.healthReason === 'not_exposed_by_firmware',
  );
}

/** Leitura de telemetria de um ponto (subset do retorno de liveOrSeed). */
export interface HealthReading {
  value: number | string | null;
  unreliable?: boolean;
  /** Quando a leitura chegou (ISO) — usado para marcar a tile como desatualizada. */
  timestamp?: string | null;
}

/**
 * Limiar de "valor desatualizado" nas tiles de saúde — mesma janela usada
 * para câmera (CAMERA_STALE_MS em telemetry-format.ts / backend). Um ciclo
 * de coleta SNMP que não trouxe amostra nova para um ponto (equipamento
 * acessível) deve continuar mostrando o último valor bom, mas marcado como
 * desatualizado, até a próxima leitura real chegar.
 */
const HEALTH_TILE_STALE_MS = 5 * 60 * 1000; // 5 min

function isStaleReading(timestamp: string | null | undefined): boolean {
  if (!timestamp) return false;
  const age = Date.now() - Date.parse(timestamp);
  return Number.isFinite(age) && age > HEALTH_TILE_STALE_MS;
}

/** Tile pronta para renderização. */
export interface HealthTile {
  key: string;
  label: string;
  /** Identidade do ponto: usada somente pela ação administrativa de remoção. */
  pointId?: string;
  removable: boolean;
  /** Valor formatado ("20%", "31,0 MB") — ou null quando sem valor. */
  text: string | null;
  /** Estado quando text === null. */
  emptyState: 'sem dados' | 'não suportado' | null;
  /** Percentual 0–100 para a barra de progresso (null = sem barra). */
  pct: number | null;
  unreliable: boolean;
  /**
   * true quando `text` é o último valor bom conhecido, mas a leitura está
   * velha (> HEALTH_TILE_STALE_MS) — equipamento acessível, porém o ciclo de
   * coleta mais recente não trouxe amostra nova para este ponto específico.
   * Nunca true quando `text` é null (não há "valor velho" sem valor).
   */
  stale: boolean;
  /** Tooltip opcional (ex.: "31,0 MB livres de 117 MB"). */
  title?: string;
}

/** Formata megabytes com auto-escala ("31,0 MB", "1,2 GB"). */
export function formatMb(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

/** Limita a [0, 100] para a barra de progresso. */
function clampPct(value: number): number {
  return Math.max(0, Math.min(100, value));
}

interface MetricValue {
  point: HealthPointLike;
  value: number | null;
  unreliable: boolean;
  /** true quando `value` veio de uma leitura velha (ver HEALTH_TILE_STALE_MS). */
  stale: boolean;
}

/**
 * Monta as tiles na ordem canônica:
 *   CPU → Memória usada % → Memória RAM (total) → Memória disp. →
 *   Temperatura → Pacotes perdidos → Perda ping → Armazenamento.
 *
 * "Memória usada %" é derivada de disponível (kB) + total (MB) quando ambos
 * existem — ou vem direta quando o ponto memory é percentual (Hikvision).
 * Nesse caso a tile "Memória disp." é omitida para não duplicar informação.
 */
export function buildHealthTiles(
  points: HealthPointLike[],
  read: (tag: string) => HealthReading | null | undefined,
): HealthTile[] {
  // O diagnóstico grava os nomes canônicos; instalações mais antigas ainda
  // podem ter aliases legados. A prioridade abaixo garante que ambos renderem
  // a mesma tile sem depender da ordem dos pontos no payload.
  const metricOf = (...metrics: string[]): MetricValue | null => {
    const point = metrics
      .map((metric) => points.find((candidate) => candidate.metric === metric))
      .find((candidate): candidate is HealthPointLike => candidate !== undefined);
    if (!point) return null;
    const unsupported = isUnsupportedHealthPoint(point);
    const entry = unsupported ? null : read(point.tag);
    const numeric = Number(entry?.value);
    const hasValue =
      entry?.value !== null &&
      entry?.value !== undefined &&
      Number.isFinite(numeric);
    const validatedValue =
      hasValue && (point.metric === 'temperature' || point.metric === 'cpu_temperature' || point.metric === 'cpu')
        ? normalizeHealthValue(point.metric, numeric, point.unit)
        : hasValue
          ? numeric
          : null;
    return {
      point,
      value: validatedValue,
      unreliable: validatedValue !== null && entry?.unreliable === true,
      stale: validatedValue !== null && isStaleReading(entry?.timestamp),
    };
  };

  const toMb = (value: number | null, unit: string): number | null => {
    if (value === null) return null;
    switch (unit.trim().toLowerCase()) {
      case 'b':
      case 'byte':
      case 'bytes':
        return value / (1024 * 1024);
      case 'kb':
      case 'kib':
        return value / 1024;
      case 'gb':
      case 'gib':
        return value * 1024;
      default:
        return value;
    }
  };

  const tile = (
    key: string,
    label: string,
    metric: MetricValue,
    text: string | null,
    pct: number | null = null,
    title?: string,
    // Usado só quando a tile deriva de mais de uma métrica (ex.: memória
    // usada % combinando disponível+total) — combina a staleness de ambas em
    // vez de usar a de uma única MetricValue.
    staleOverride?: boolean,
  ): HealthTile => ({
    key,
    label,
    pointId: metric.point.id,
    removable: metric.point.removable !== false && metric.point.tag !== 'STATUS' && metric.point.metric !== 'status',
    text,
    emptyState: text !== null
      ? null
      : isUnsupportedHealthPoint(metric.point)
        ? 'não suportado'
        : 'sem dados',
    pct,
    unreliable: metric.unreliable,
    stale: text !== null && (staleOverride ?? metric.stale),
    title,
  });

  const tiles: HealthTile[] = [];

  const cpu = metricOf('cpu_usage', 'cpu');
  if (cpu) {
    tiles.push(
      tile(
        'cpu',
        'Uso de CPU',
        cpu,
        cpu.value !== null ? `${Math.round(cpu.value)}%` : null,
        cpu.value !== null ? clampPct(cpu.value) : null,
      ),
    );
  }

  const memoryUsedPercent = metricOf('memory_used_percent');
  const memoryAvailable = metricOf('memory_available', 'memory');
  const ramTotal = metricOf('memory_total', 'ram_total');
  const memoryIsPct =
    memoryUsedPercent !== null ||
    (memoryAvailable !== null && memoryAvailable.point.unit.trim() === '%');
  // SNMP bindings are canonical bytes at the collector boundary. Keep the
  // legacy kB/MB fallback only for old points; never convert a canonical
  // value twice.
  const totalMb = ramTotal ? toMb(ramTotal.value, ramTotal.point.unit) : null;
  const availableMb =
    memoryAvailable && !memoryIsPct
      ? toMb(memoryAvailable.value, memoryAvailable.point.unit)
      : null;

  if (memoryIsPct && (memoryUsedPercent ?? memoryAvailable)) {
    const metric = memoryUsedPercent ?? memoryAvailable!;
    // Uma leitura de capacidade/disponibilidade em bytes chegando por um
    // alias/configuração legada incompatível (unit '%' aplicado a um valor
    // que na verdade é bytes) nunca deve virar "63107072%": um percentual
    // plausível está sempre em [0, 100]. Fora disso, não há semântica
    // confiável — a tile cai em "sem dados" em vez de inventar um valor.
    const plausiblePct =
      metric.value !== null && metric.value >= 0 && metric.value <= 100
        ? metric.value
        : null;
    tiles.push(
      tile(
        'memory_used',
        'Memória usada',
        metric,
        plausiblePct !== null ? `${Math.round(plausiblePct)}%` : null,
        plausiblePct !== null ? clampPct(plausiblePct) : null,
      ),
    );
  } else if (memoryAvailable && availableMb !== null && totalMb !== null && totalMb > 0) {
    const usedPct = clampPct(100 * (1 - availableMb / totalMb));
    tiles.push(
      tile(
        'memory_used',
        'Memória usada',
        memoryAvailable,
        `${Math.round(usedPct)}%`,
        usedPct,
        `${formatMb(availableMb)} livres de ${formatMb(totalMb)}`,
        // Tile deriva de dois pontos (disponível + total) — desatualizada se
        // qualquer um dos dois não teve leitura nova neste ciclo.
        memoryAvailable.stale || (ramTotal?.stale ?? false),
      ),
    );
  } else if (memoryAvailable) {
    tiles.push(
      tile(
        'memory_avail',
        'Memória disp.',
        memoryAvailable,
        availableMb !== null ? formatMb(availableMb) : null,
      ),
    );
  }

  if (ramTotal) {
    tiles.push(
      tile(
        'ram_total',
        'Memória RAM',
        ramTotal,
        totalMb !== null ? formatMb(totalMb) : null,
      ),
    );
  }

  const temperature = metricOf('cpu_temperature', 'temperature');
  if (temperature) {
    tiles.push(
      tile(
        'temperature',
        'Temperatura',
        temperature,
        temperature.value !== null ? `${temperature.value.toFixed(1)}°C` : null,
      ),
    );
  }

  const packetLoss = metricOf('net_discard_rate', 'packet_loss');
  if (packetLoss) {
    tiles.push(
      tile(
        'packet_loss',
        'Pacotes perdidos',
        packetLoss,
        packetLoss.value !== null ? `${Math.round(packetLoss.value)} pkts` : null,
      ),
    );
  }

  const pingLoss = metricOf('ping_loss');
  if (pingLoss) {
    tiles.push(
      tile(
        'ping_loss',
        'Perda ping',
        pingLoss,
        pingLoss.value !== null ? `${Math.round(pingLoss.value)}%` : null,
        pingLoss.value !== null ? clampPct(pingLoss.value) : null,
      ),
    );
  }

  const storage = metricOf('storage_used_percent', 'storage');
  if (storage) {
    tiles.push(
      tile(
        'storage',
        'Armazenamento',
        storage,
        storage.value !== null ? `${Math.round(storage.value)}%` : null,
        storage.value !== null ? clampPct(storage.value) : null,
      ),
    );
  }

  return tiles;
}

/** Ação administrativa disponível somente para pontos persistidos e removíveis. */
export function isHealthTileRemovable(tile: HealthTile): boolean {
  return Boolean(tile.pointId && tile.removable);
}