import { canonicalHealthKey, formatHealthValue, SNMP_HEALTH_LABELS } from '@/modules/cftv/utils/snmp-health';
import { formatTelemetryValue } from '../../hooks/useScreenTelemetry';
import { isCameraDevice, isNvrDevice, isSwitchDevice, type ScreenDevice } from '../../types/virtual.types';

export type AnyPoint = ScreenDevice['points'][number];

/** Identificador "bruto" do ponto: objectType BACnet, registerType Modbus, ou a chave `metric` (SNMP/switch/câmera). */
export function pointType(p: AnyPoint): string {
  if ('objectType' in p) return String(p.objectType);
  if ('registerType' in p) return p.registerType.toUpperCase();
  // Switch scalar + camera scalar points carry a `metric` field instead.
  const asAny = p as unknown as { metric?: unknown };
  if (typeof asAny.metric === 'string' && asAny.metric) return asAny.metric;
  return '';
}

/**
 * Unidade a anexar em valores analógicos. Modbus usa `registerType`; switch
 * pontos de porta carregam uma `unit` explícita (ex.: "B/s" para tráfego).
 */
export function pointUnit(p: AnyPoint): string | undefined {
  if ('registerType' in p) return p.unit || undefined;
  // Switch / camera scalar points may carry a unit field.
  const asAny = p as unknown as { unit?: unknown };
  if (typeof asAny.unit === 'string') return asAny.unit || undefined;
  return undefined;
}

/** Métrica SNMP do ponto (campo `metric`), quando existir — BACnet/Modbus/virtual não têm. */
function pointMetric(p: AnyPoint): string | undefined {
  const asAny = p as unknown as { metric?: unknown };
  return typeof asAny.metric === 'string' && asAny.metric ? asAny.metric : undefined;
}

const BYTE_LIKE_UNITS = new Set(['bytes', 'b', 'kb', 'kib', 'gb', 'gib']);

/**
 * Resolve a chave de saúde efetiva para exibição, desambiguando o alias
 * `metric: 'memory'`. No contrato compartilhado (`snmp-health.ts`), 'memory'
 * é tratado como `memory_used_percent` — convenção de câmeras CFTV
 * (Hikvision publica percentual sob esse nome). Controladoras SCA, porém,
 * registraram historicamente a MEMÓRIA DISPONÍVEL (kB/bytes/GB) sob o mesmo
 * alias 'memory'. Quando a unidade do ponto é claramente uma capacidade de
 * bytes (não '%'), tratamos como `memory_available` para não exibir um valor
 * de disponibilidade como se fosse percentual (ex.: "61028%"). Pontos já
 * migrados para o canônico `memory_available` (todo cadastro novo, e todo
 * ponto reaplicado via diagnóstico) não passam por este desvio.
 */
function effectiveHealthMetric(metric: string, unit?: string): string {
  if (metric === 'memory' && unit && BYTE_LIKE_UNITS.has(unit.trim().toLowerCase())) {
    return 'memory_available';
  }
  return metric;
}

/**
 * Rótulo do "tipo" exibido ao lado do ponto no seletor. Para métricas de
 * saúde SNMP reconhecidas (CPU, memória, temperatura…) usa o MESMO rótulo dos
 * cards/modais de telemetria (`SNMP_HEALTH_LABELS`) em vez da chave de métrica
 * bruta — o mesmo contrato de apresentação, não um texto reinventado aqui.
 */
export function pointBadgeLabel(p: AnyPoint): string {
  const metric = pointMetric(p);
  const key = metric ? canonicalHealthKey(effectiveHealthMetric(metric, pointUnit(p))) : null;
  return key ? SNMP_HEALTH_LABELS[key] : pointType(p);
}

/**
 * Formata o valor ao vivo de um ponto para exibição no seletor de binding.
 *
 * Pontos SNMP com métrica de saúde reconhecida (`canonicalHealthKey`) usam a
 * MESMA conversão exibida nos cards/modais de telemetria (`formatHealthValue`)
 * — memória em bytes/kB/GB sempre vira MB/GB, nunca um número bruto seguido
 * de "bytes". Os demais pontos (BACnet, Modbus, MQTT, virtual, ou SNMP sem
 * contrato de saúde — ex.: STATUS) caem no formatador genérico de telemetria.
 */
export function formatPointValue(p: AnyPoint, value: number | boolean | string | null): string {
  const rawMetric = pointMetric(p);
  const unit = pointUnit(p);
  const metric = rawMetric ? effectiveHealthMetric(rawMetric, unit) : undefined;
  const key = metric ? canonicalHealthKey(metric) : null;
  if (key && metric) {
    if (value === null || value === undefined) return '—';
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) return '—';
    return formatHealthValue(metric, num, unit) ?? '—';
  }
  return formatTelemetryValue(value, pointType(p), unit);
}

/**
 * Descarta pontos com `tag` duplicada dentro da MESMA lista, mantendo a
 * primeira ocorrência. A origem correta de uma tag duplicada é hig­iene no
 * cadastro (backend); isto é só uma rede de segurança para nunca gerar `key`
 * React duplicada nem apresentar o mesmo ponto duas vezes no seletor,
 * mesmo diante de um registro legado que ainda não foi consolidado.
 */
export function dedupePointsByTag(points: readonly AnyPoint[]): AnyPoint[] {
  const seen = new Set<string>();
  const out: AnyPoint[] = [];
  for (const p of points) {
    if (seen.has(p.tag)) continue;
    seen.add(p.tag);
    out.push(p);
  }
  return out;
}

/**
 * Rótulo do equipamento no seletor genérico de vínculo — distingue o tipo de
 * monitoramento (switch, NVR/DVR, câmera, bancada de testes) do mesmo jeito
 * que já existia para switches, agora estendido a NVR/DVR e câmeras (que
 * passam a aparecer também no seletor genérico, não só no modo câmera).
 */
export function deviceOptionLabel(d: ScreenDevice): string {
  if (d.protocol === 'virtual') return `🧪 ${d.name} (Bancada de Testes)`;
  if (isSwitchDevice(d)) return `🔌 ${d.name} (SWITCH SNMP)`;
  if (isNvrDevice(d)) return `💾 ${d.name} (NVR/DVR)`;
  if (isCameraDevice(d)) return `📷 ${d.name} (CÂMERA)`;
  return `${d.name} (${d.protocol.toUpperCase()})`;
}
