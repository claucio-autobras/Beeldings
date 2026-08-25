/**
 * Modelo genérico de exibição dos cards de saúde SNMP (CFTV + SCA).
 *
 * Deriva, POR DADOS, a apresentação de cada ponto do device: categoria,
 * rótulo legível, unidade, importância e origem. Nenhuma lógica por
 * fabricante — o conhecimento vem do catálogo canônico, da semântica de
 * descoberta (snmp-oid-semantics), da MIB importada e do nome dado pelo
 * operador. O card renderiza o que o equipamento realmente expõe; métrica
 * coletada mas fora do catálogo também aparece (nada coletado fica
 * invisível).
 */

import {
  classifySnmpOid,
  SNMP_CATEGORY_LABELS,
  type SnmpImportance,
  type SnmpSemanticCategory,
} from './snmp-oid-semantics.js';

/** Origem do conhecimento sobre o ponto. */
export type SnmpCardOrigin = 'canonical' | 'semantic' | 'custom';

/** Categoria de exibição = categorias semânticas + 'other' (desconhecidos). */
export type SnmpCardCategory = SnmpSemanticCategory | 'other';

export const SNMP_CARD_CATEGORY_LABELS: Record<SnmpCardCategory, string> = {
  ...SNMP_CATEGORY_LABELS,
  other: 'Outras métricas',
};

/** Metadados de exibição de um ponto no card dinâmico. */
export interface SnmpCardDisplay {
  category: SnmpCardCategory;
  categoryLabel: string;
  /** Rótulo legível (pt-BR) — nome do operador tem precedência. */
  label: string;
  importance: SnmpImportance;
  origin: SnmpCardOrigin;
  valueKind: 'number' | 'text' | 'boolean';
  unit: string | null;
}

/**
 * Catálogo canônico das métricas de saúde (tags/metrics fixos dos pontos
 * padrão de câmeras e controladoras). Fonte única de categoria/importância.
 */
const CANONICAL_METRIC_DISPLAY: Record<
  string,
  { label: string; category: SnmpCardCategory; importance: SnmpImportance }
> = {
  // ─── Saúde base (câmeras + controladoras) ──────────────────────────────────
  cpu: { label: 'Uso de CPU', category: 'performance', importance: 'primary' },
  memory: { label: 'Memória', category: 'performance', importance: 'primary' },
  ram_total: { label: 'Memória RAM total', category: 'performance', importance: 'secondary' },
  storage: { label: 'Armazenamento', category: 'storage', importance: 'primary' },
  temperature: { label: 'Temperatura', category: 'hardware', importance: 'primary' },
  packet_loss: { label: 'Pacotes perdidos', category: 'network', importance: 'primary' },
  ping_loss: { label: 'Perda de ping', category: 'network', importance: 'secondary' },
  uptime: { label: 'Tempo ligado', category: 'system', importance: 'secondary' },
  // ─── Alcançabilidade / reachability ────────────────────────────────────────
  status: { label: 'Alcançabilidade', category: 'system', importance: 'primary' },
  reachability: { label: 'Alcançabilidade', category: 'system', importance: 'primary' },
  reachability_latency: { label: 'Latência SNMP', category: 'system', importance: 'secondary' },
  reachability_failure_rate: { label: 'Taxa de falha (5 min)', category: 'system', importance: 'secondary' },
  // ─── Catálogo canônico Fase 3 ───────────────────────────────────────────────
  cpu_usage: { label: 'Uso de CPU', category: 'performance', importance: 'primary' },
  cpu_usage_peak: { label: 'Pico de CPU', category: 'performance', importance: 'secondary' },
  cpu_temperature: { label: 'Temperatura da CPU', category: 'hardware', importance: 'primary' },
  memory_used_percent: { label: 'Memória usada', category: 'performance', importance: 'primary' },
  memory_total: { label: 'Memória total', category: 'performance', importance: 'secondary' },
  storage_used_percent: { label: 'Uso do volume', category: 'storage', importance: 'primary' },
  net_in_rate: { label: 'Taxa de entrada', category: 'network', importance: 'secondary' },
  net_out_rate: { label: 'Taxa de saída', category: 'network', importance: 'secondary' },
  net_error_rate: { label: 'Taxa de erros', category: 'network', importance: 'secondary' },
  net_discard_rate: { label: 'Taxa de descartes', category: 'network', importance: 'secondary' },
  interface_status: { label: 'Status da interface', category: 'network', importance: 'secondary' },
  // ─── Rede (IF-MIB) ─────────────────────────────────────────────────────────
  if_oper_status: { label: 'Status da interface', category: 'network', importance: 'secondary' },
  if_in_octets: { label: 'Bytes recebidos', category: 'network', importance: 'secondary' },
  if_out_octets: { label: 'Bytes enviados', category: 'network', importance: 'secondary' },
  // ─── Armazenamento ─────────────────────────────────────────────────────────
  disk_count: { label: 'Número de discos', category: 'storage', importance: 'secondary' },
  disk_free: { label: 'Espaço livre em disco', category: 'storage', importance: 'primary' },
  disk_capacity: { label: 'Capacidade do disco', category: 'storage', importance: 'secondary' },
  disk_status_raw: { label: 'Status do disco', category: 'storage', importance: 'primary' },
  disk_usage_pct: { label: 'Uso do disco (%)', category: 'storage', importance: 'primary' },
  // ─── Aplicação (NVR/câmera) ────────────────────────────────────────────────
  video_channels: { label: 'Canais de vídeo', category: 'application', importance: 'secondary' },
  channel_status_raw: { label: 'Status de canal', category: 'application', importance: 'secondary' },
  // ─── Identificação ─────────────────────────────────────────────────────────
  firmware_version: { label: 'Versão de firmware', category: 'identification', importance: 'info' },
  serial_number: { label: 'Número de série', category: 'identification', importance: 'info' },
  device_name: { label: 'Nome do equipamento', category: 'identification', importance: 'info' },
  product_type: { label: 'Tipo de produto', category: 'identification', importance: 'info' },
  // ─── Sistema / segurança (controladoras de acesso) ─────────────────────────
  load_average: { label: 'Carga do sistema', category: 'performance', importance: 'secondary' },
  memory_usage: { label: 'Uso de memória (%)', category: 'performance', importance: 'primary' },
  memory_available: { label: 'Memória disponível', category: 'performance', importance: 'primary' },
  device_status: { label: 'Status do dispositivo', category: 'system', importance: 'secondary' },
  device_online: { label: 'Equipamento online', category: 'system', importance: 'secondary' },
  antipassback_enabled: { label: 'Anti-passback ativo', category: 'security', importance: 'secondary' },
  door_sensor_alarm_enabled: { label: 'Alarme sensor de porta', category: 'security', importance: 'secondary' },
  sip_enabled: { label: 'SIP ativo', category: 'application', importance: 'secondary' },
};

/** Rótulos legíveis p/ chaves semânticas fora do catálogo canônico. */
function humanizeMetricKey(metricKey: string): string {
  return metricKey
    .split(/[_-]/)
    .filter(Boolean)
    .map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

interface CardPointLike {
  tag: string;
  objectName: string | null;
  metric: string | null;
  oid: string | null;
  unit: string | null;
}

/**
 * Deriva os metadados de exibição de um ponto SNMP:
 * 1. métrica canônica → catálogo fixo (origem 'canonical');
 * 2. OID com semântica conhecida → nome/categoria/importância da descoberta
 *    (origem 'semantic'); chave semântica sem ponte também cai aqui;
 * 3. resto → origem 'custom': nome do operador (objectName), categoria
 *    'other' — visível do mesmo jeito.
 */
export function buildSnmpCardDisplay(point: CardPointLike): SnmpCardDisplay {
  const metric = point.metric ?? 'custom';
  const canonical = CANONICAL_METRIC_DISPLAY[metric];
  if (canonical) {
    return {
      category: canonical.category,
      categoryLabel: SNMP_CARD_CATEGORY_LABELS[canonical.category],
      // O nome do operador contém contexto que a chave canônica não carrega
      // (principalmente o hrStorageDescr de cada volume).
      label:
        point.objectName && !/^OID \d/.test(point.objectName)
          ? point.objectName
          : canonical.label,
      importance: canonical.importance,
      origin: 'canonical',
      valueKind: 'number',
      unit: point.unit || null,
    };
  }
  const semantic = point.oid ? classifySnmpOid(point.oid) : null;
  if (semantic) {
    const category = semantic.category;
    return {
      category,
      categoryLabel: SNMP_CARD_CATEGORY_LABELS[category],
      // Nome do operador (quando personalizado) tem precedência sobre o da
      // semântica; o fallback "OID x.y.z" NUNCA vence um nome conhecido.
      label:
        point.objectName && !/^OID \d/.test(point.objectName)
          ? point.objectName
          : semantic.name,
      importance: semantic.importance ?? 'secondary',
      origin: 'semantic',
      valueKind: semantic.valueKind ?? 'number',
      unit: point.unit || semantic.unit || null,
    };
  }
  // Métrica com chave semântica conhecida mas sem OID classificável.
  if (metric !== 'custom' && metric !== 'STATUS') {
    return {
      category: 'other',
      categoryLabel: SNMP_CARD_CATEGORY_LABELS.other,
      label: point.objectName || humanizeMetricKey(metric),
      importance: 'secondary',
      origin: 'semantic',
      valueKind: 'number',
      unit: point.unit || null,
    };
  }
  return {
    category: 'other',
    categoryLabel: SNMP_CARD_CATEGORY_LABELS.other,
    label: point.objectName || (point.oid ? `OID ${point.oid}` : point.tag),
    importance: 'secondary',
    origin: 'custom',
    valueKind: 'number',
    unit: point.unit || null,
  };
}

/**
 * Informação estática do equipamento (firmware, serial, data/hora, NTP…)
 * capturada no diagnóstico — telemetria numérica não transporta strings.
 * Persistida em Device.config.snmpInfo e exposta no payload do card.
 */
export interface SnmpInfoEntry {
  oid: string;
  label: string;
  value: string;
  category: SnmpCardCategory;
  /** ISO — quando a informação foi lida (diagnóstico). */
  capturedAt: string;
}

/**
 * Prefixos de OID que geram ruído de catálogo SNMP e NUNCA devem aparecer
 * em "Outras métricas" — são metadados do agente, não do equipamento.
 */
const INFO_NOISE_OID_PREFIXES: string[] = [
  '1.3.6.1.2.1.1.9.', // sysORTable — inventário de módulos MIB do agente
  '1.3.6.1.2.1.1.8.', // sysServices — bitmask OSI, sem valor textual útil
];

/**
 * Regex de string puramente hexadecimal longa (≥ 10 dígitos hex após remover
 * separadores): serial/MAC/dados binários exportados como OCTET STRING.
 * Aplicado APENAS a entradas desconhecidas (semântica confirmada as nomeia).
 */
const HEX_ONLY_RE = /^[0-9A-Fa-f]{10,}$/;

/** Detecta strings em hex puro (sem nome semântico, provavelmente binário). */
function isHexBinaryString(s: string): boolean {
  return HEX_ONLY_RE.test(s.replace(/[:\s]/g, ''));
}

/**
 * Detecta dumps de configuração: multi-linha ou strings com 3+ separadores
 * pipe (padrão key=val|key=val|…), independente do comprimento.
 */
function isConfigDump(s: string): boolean {
  return /[\r\n]/.test(s) || s.split('|').length > 3;
}

/**
 * Extrai dos objetos descobertos as informações textuais/booleanas para
 * persistir no config do device:
 * - semântica CONFIRMADA (importância 'info' ou valueKind não numérico), com
 *   booleanos INTEGER na convenção SNMP TruthValue (1=Sim, 0/2=Não);
 * - textos SEM semântica confiável (desconhecidos ou não confirmados) entram
 *   como informação nomeada pela MIB importada ou pelo próprio OID — exceto
 *   ruído de catálogo (sysOR*), strings hexadecimais e dumps de configuração.
 * Conhecidas têm prioridade; teto de 40 entradas no total.
 */
export function extractSnmpInfoEntries(
  discovered: Array<{
    oid: string;
    raw: string;
    /** Normalizado numérico do walk — null quando o valor é textual. */
    value?: number | null;
    mibName?: string | null;
    known: {
      name: string;
      category: SnmpSemanticCategory;
      valueKind: 'number' | 'text' | 'boolean';
      importance: SnmpImportance;
      confirmed: boolean;
    } | null;
  }>,
  capturedAt: Date,
): SnmpInfoEntry[] {
  const knownOut: SnmpInfoEntry[] = [];
  const unknownOut: SnmpInfoEntry[] = [];
  const at = capturedAt.toISOString();
  for (const d of discovered) {
    const raw = (d.raw ?? '').trim();
    if (raw === '') continue;
    if (d.known?.confirmed) {
      if (d.known.valueKind === 'number' && d.known.importance !== 'info') continue;
      let value = raw;
      if (d.known.valueKind === 'boolean') {
        // Convenção SNMP TruthValue: 1=true, 2=false (0 tratado como falso).
        if (raw === '1') value = 'Sim';
        else if (raw === '2' || raw === '0') value = 'Não';
      }
      knownOut.push({
        oid: d.oid,
        label: d.known.name,
        value,
        category: d.known.category,
        capturedAt: at,
      });
    } else {
      // Texto sem semântica confiável: numérico = candidato a métrica (fora);
      // string longa demais provavelmente é binário/dump (fora);
      // prefixos de catálogo MIB, hex puro e dumps de config = ruído (fora).
      if (d.value !== null && d.value !== undefined) continue;
      if (raw.length > 160) continue;
      if (INFO_NOISE_OID_PREFIXES.some((p) => d.oid.startsWith(p))) continue;
      if (isHexBinaryString(raw)) continue;
      if (isConfigDump(raw)) continue;
      unknownOut.push({
        oid: d.oid,
        // mibName quando disponível (MIB importada); fallback "Unknown OID"
        // — nunca o número cru sem prefixo em saídas não-avançadas.
        label: d.mibName || `Unknown OID ${d.oid}`,
        value: raw,
        category: 'other',
        capturedAt: at,
      });
    }
    if (knownOut.length >= 40) break;
  }
  return [...knownOut, ...unknownOut].slice(0, 40);
}
