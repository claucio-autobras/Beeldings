/**
 * Heurísticas para sugerir a configuração de um ponto MQTT a partir de uma
 * amostra de payload capturada no tópico. Espelha a resolução de caminho do
 * gateway (notação por ponto, "$." opcional, índices "[0]") para que a
 * sugestão/validação aqui corresponda ao que o gateway realmente extrai.
 */

import type { MqttValueType } from '../types/device.types';

export interface MqttPointSuggestion {
  /** Caminho sugerido até o valor medido ('' = payload cru) */
  jsonPath: string;
  valueType: MqttValueType;
  unit: string;
  /** Nome de exibição sugerido (pode ser vazio) */
  displayName: string;
  /** Tag sugerida (pode ser vazia) */
  tag: string;
}

/** Campos de metadado que nunca devem ser sugeridos como valor medido. */
const METADATA_KEYS = new Set([
  'timestamp', 'ts', 'time', 'datetime', 'date', 'receivedat', 'sentat', 'createdat', 'updatedat',
  'deviceid', 'device_id', 'sensorid', 'sensor_id', 'gatewayid', 'gateway_id', 'clientid', 'client_id',
  'id', 'uuid', 'guid', 'seq', 'sequence', 'counter', 'msgid', 'messageid',
  'quality', 'qos', 'rssi', 'snr', 'battery', 'firmware', 'version',
  'unit', 'units', 'name', 'point', 'tag', 'label', 'description', 'type', 'topic',
]);

/** Navega um caminho tipo "a.b[0].c" (com "$." opcional) — igual ao gateway. */
export function resolveJsonPath(obj: unknown, path: string): unknown {
  const clean = path.replace(/^\$\.?/, '').replace(/\[(\d+)\]/g, '.$1');
  const parts = clean.split('.').filter((s) => s.length > 0);
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function tryParseJson(payload: string): { ok: boolean; value: unknown } {
  try {
    return { ok: true, value: JSON.parse(payload.trim()) };
  } catch {
    return { ok: false, value: undefined };
  }
}

/** Achata um objeto JSON em pares caminho→valor (notação por ponto). */
function flatten(obj: unknown, prefix = '', depth = 0): Array<{ path: string; value: unknown }> {
  if (depth > 4 || obj === null || obj === undefined) return [];
  if (typeof obj !== 'object') return prefix ? [{ path: prefix, value: obj }] : [];
  if (Array.isArray(obj)) {
    return obj.slice(0, 10).flatMap((v, i) =>
      flatten(v, prefix ? `${prefix}[${i}]` : `[${i}]`, depth + 1),
    );
  }
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object') return flatten(v, p, depth + 1);
    return [{ path: p, value: v }];
  });
}

function lastKeyOf(path: string): string {
  const clean = path.replace(/\[\d+\]/g, '');
  const parts = clean.split('.').filter(Boolean);
  return (parts[parts.length - 1] ?? '').toLowerCase();
}

function isMeasurable(value: unknown): boolean {
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (typeof value === 'string') {
    const s = value.trim();
    return s.length > 0 && Number.isFinite(Number(s));
  }
  return false;
}

function typeOf(value: unknown): MqttValueType {
  return typeof value === 'boolean' ? 'boolean' : 'number';
}

function toTagName(name: string): string {
  return name
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Analisa o payload capturado e sugere jsonPath, tipo, unidade e nome/tag.
 * @param payload texto cru da mensagem capturada
 * @param subTopic sub-tópico da amostra (usado como fallback de nome/tag)
 */
export function suggestMqttPoint(payload: string, subTopic = ''): MqttPointSuggestion {
  const topicLeaf = subTopic.split('/').filter(Boolean).pop() ?? '';

  const parsed = tryParseJson(payload);

  // Payload não-JSON ou primitivo JSON → valor cru, jsonPath vazio.
  if (!parsed.ok || parsed.value === null || typeof parsed.value !== 'object') {
    const raw = parsed.ok ? parsed.value : payload.trim();
    const valueType: MqttValueType = typeof raw === 'boolean' ? 'boolean' : 'number';
    return {
      jsonPath: '',
      valueType,
      unit: '',
      displayName: topicLeaf,
      tag: toTagName(topicLeaf),
    };
  }

  const entries = flatten(parsed.value);

  // 1) Campo chamado "value" (em qualquer nível; prioriza o menos profundo)
  const valueEntry = entries
    .filter((e) => lastKeyOf(e.path) === 'value' && isMeasurable(e.value))
    .sort((a, b) => a.path.length - b.path.length)[0];

  // 2) Senão, o campo numérico/booleano mais provável, ignorando metadados
  const candidate = valueEntry
    ?? entries
      .filter((e) => isMeasurable(e.value) && !METADATA_KEYS.has(lastKeyOf(e.path)))
      .sort((a, b) => {
        // Prefere booleanos/números nativos a strings numéricas; depois o menos profundo
        const na = typeof a.value === 'string' ? 1 : 0;
        const nb = typeof b.value === 'string' ? 1 : 0;
        if (na !== nb) return na - nb;
        return a.path.length - b.path.length;
      })[0];

  // Unidade: campo "unit"/"units" próximo do valor (mesmo nível) ou no topo
  const unitEntry = entries.find((e) => {
    const k = lastKeyOf(e.path);
    return (k === 'unit' || k === 'units') && typeof e.value === 'string';
  });

  // Nome: campos "name"/"point"/"label"/"tag" ou o sub-tópico
  const nameEntry = entries.find((e) => {
    const k = lastKeyOf(e.path);
    return ['name', 'point', 'label', 'tag'].includes(k)
      && typeof e.value === 'string' && (e.value as string).trim().length > 0;
  });
  const displayName = (nameEntry?.value as string | undefined)?.trim()
    || topicLeaf
    || (candidate ? lastKeyOf(candidate.path) : '');

  return {
    jsonPath: candidate?.path ?? '',
    valueType: candidate ? typeOf(candidate.value) : 'number',
    unit: (unitEntry?.value as string | undefined)?.trim() ?? '',
    displayName,
    tag: toTagName(displayName),
  };
}

/**
 * Valida um jsonPath digitado contra o payload capturado.
 * @returns 'ok' se o caminho resolve; 'missing' se o payload é JSON mas o
 *          caminho não existe; 'not-json' se o payload não é JSON (sem aviso).
 */
export function validateJsonPath(payload: string, jsonPath: string): 'ok' | 'missing' | 'not-json' {
  const trimmed = jsonPath.trim();
  if (!trimmed) return 'ok';
  const parsed = tryParseJson(payload);
  if (!parsed.ok || parsed.value === null || typeof parsed.value !== 'object') return 'not-json';
  return resolveJsonPath(parsed.value, trimmed) === undefined ? 'missing' : 'ok';
}
