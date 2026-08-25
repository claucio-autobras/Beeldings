/**
 * Catálogo declarativo de métricas por tipo de dispositivo monitorado.
 *
 * Cada entrada define O QUÊ é a métrica (chave, nome, unidade, tipo de dado
 * e driver responsável), independente de COMO coletar — isso fica nos perfis.
 *
 * Estender para um novo tipo: adicionar uma entrada em METRIC_CATALOG sem
 * alterar nenhuma outra parte do núcleo.
 */

import type { DeviceKind, MetricDefinition } from './types';

/** Métricas canônicas de câmeras IP (SNMP/ONVIF/ping). */
const CAMERA_METRICS: MetricDefinition[] = [
  // ── Disponibilidade ────────────────────────────────────────────────────────
  {
    key: 'status',
    name: 'Status (online/offline)',
    unit: '',
    dataType: 'enum',
    driver: 'snmp',
    collectionType: 'scalar',
  },
  {
    key: 'uptime',
    name: 'Tempo ligada',
    unit: 's',
    dataType: 'gauge',
    driver: 'snmp',
    collectionType: 'scalar',
  },
  {
    key: 'latency',
    name: 'Latência de resposta',
    unit: 'ms',
    dataType: 'gauge',
    driver: 'onvif',
    collectionType: 'scalar',
  },
  {
    key: 'ping_loss',
    name: 'Perda de pacotes (ping)',
    unit: '%',
    dataType: 'gauge',
    driver: 'ping',
    collectionType: 'scalar',
  },

  // ── Saúde do sistema ───────────────────────────────────────────────────────
  {
    key: 'cpu',
    name: 'Uso de CPU',
    unit: '%',
    dataType: 'gauge',
    driver: 'snmp',
    collectionType: 'scalar',
  },
  {
    key: 'memory',
    name: 'Memória livre/uso',
    unit: 'kB',
    dataType: 'gauge',
    driver: 'snmp',
    collectionType: 'scalar',
  },
  {
    key: 'ram_total',
    name: 'Memória RAM total',
    unit: 'MB',
    dataType: 'gauge',
    driver: 'snmp',
    collectionType: 'scalar',
  },
  {
    key: 'storage',
    name: 'Uso de armazenamento',
    unit: '%',
    dataType: 'gauge',
    driver: 'snmp',
    collectionType: 'scalar',
  },
  {
    key: 'temperature',
    name: 'Temperatura',
    unit: '°C',
    dataType: 'gauge',
    driver: 'snmp',
    collectionType: 'scalar',
  },
  {
    key: 'packet_loss',
    name: 'Pacotes perdidos (descartes if)',
    unit: 'pkts',
    dataType: 'counter',
    driver: 'snmp',
    collectionType: 'scalar',
  },

  // ── ONVIF ──────────────────────────────────────────────────────────────────
  {
    key: 'stream',
    name: 'Stream de vídeo (disponível)',
    unit: '',
    dataType: 'enum',
    driver: 'onvif',
    collectionType: 'scalar',
  },
  {
    key: 'motion',
    name: 'Detecção de movimento',
    unit: '',
    dataType: 'enum',
    driver: 'onvif',
    collectionType: 'scalar',
  },
  {
    key: 'tamper',
    name: 'Violação/tamper',
    unit: '',
    dataType: 'enum',
    driver: 'onvif',
    collectionType: 'scalar',
  },
  {
    key: 'video_loss',
    name: 'Perda de vídeo',
    unit: '',
    dataType: 'enum',
    driver: 'onvif',
    collectionType: 'scalar',
  },
  {
    key: 'last_motion',
    name: 'Tempo desde o último movimento',
    unit: 's',
    dataType: 'gauge',
    driver: 'onvif',
    collectionType: 'scalar',
  },
];

/**
 * Métricas de switch gerenciável (fase 2 — ainda sem implementação de coleta).
 * Declaradas aqui para que o motor de perfis já reconheça as chaves.
 */
const SWITCH_METRICS: MetricDefinition[] = [
  { key: 'status', name: 'Status (online/offline)', unit: '', dataType: 'enum', driver: 'snmp', collectionType: 'scalar' },
  { key: 'uptime', name: 'Uptime', unit: 's', dataType: 'gauge', driver: 'snmp', collectionType: 'scalar' },
  { key: 'cpu', name: 'Uso de CPU', unit: '%', dataType: 'gauge', driver: 'snmp', collectionType: 'scalar' },
  { key: 'memory_used_pct', name: 'Uso de memória', unit: '%', dataType: 'gauge', driver: 'snmp', collectionType: 'scalar' },
  // IF-MIB por porta (table — fase 2)
  { key: 'if_oper_status', name: 'Estado operacional da porta', unit: '', dataType: 'enum', driver: 'snmp', collectionType: 'table' },
  { key: 'if_in_octets', name: 'Bytes recebidos por porta', unit: 'B', dataType: 'counter', driver: 'snmp', collectionType: 'table' },
  { key: 'if_out_octets', name: 'Bytes enviados por porta', unit: 'B', dataType: 'counter', driver: 'snmp', collectionType: 'table' },
];

/**
 * Métricas de controladora de acesso IP (SNMP/ping — sem ONVIF).
 * Subconjunto das CAMERA_METRICS relevante para access controllers:
 * sem 'stream', 'motion', 'tamper', 'video_loss', 'last_motion', 'latency'.
 */
const ACCESS_CONTROLLER_METRICS: MetricDefinition[] = [
  { key: 'status',       name: 'Status (online/offline)',        unit: '',    dataType: 'enum',    driver: 'snmp', collectionType: 'scalar' },
  { key: 'uptime',       name: 'Tempo ligada',                   unit: 's',   dataType: 'gauge',   driver: 'snmp', collectionType: 'scalar' },
  { key: 'ping_loss',    name: 'Perda de pacotes (ping)',         unit: '%',   dataType: 'gauge',   driver: 'ping', collectionType: 'scalar' },
  { key: 'cpu',          name: 'Uso de CPU',                     unit: '%',   dataType: 'gauge',   driver: 'snmp', collectionType: 'scalar' },
  { key: 'memory',       name: 'Memória disponível',             unit: 'kB',  dataType: 'gauge',   driver: 'snmp', collectionType: 'scalar' },
  { key: 'ram_total',    name: 'Memória RAM total',              unit: 'MB',  dataType: 'gauge',   driver: 'snmp', collectionType: 'scalar' },
  { key: 'temperature',  name: 'Temperatura',                    unit: '°C',  dataType: 'gauge',   driver: 'snmp', collectionType: 'scalar' },
  { key: 'packet_loss',  name: 'Pacotes perdidos (descartes if)', unit: 'pkts', dataType: 'counter', driver: 'snmp', collectionType: 'scalar' },
];

/**
 * Métricas de NVR/DVR (SNMP v1/v2c, somente leitura).
 *
 * Escalares de sistema: subconjunto das CAMERA_METRICS aplicável a gravadores.
 * Tabelas indexadas (uma entrada por slot/canal):
 *   disk_*       → coletadas via walk tableOidPrefix nos perfis de fabricante.
 *   channel_status → idem para canais de gravação.
 */
const NVR_METRICS: MetricDefinition[] = [
  // ── Disponibilidade ────────────────────────────────────────────────────────
  { key: 'status',      name: 'Status (online/offline)',   unit: '',   dataType: 'enum',  driver: 'snmp', collectionType: 'scalar' },
  { key: 'uptime',      name: 'Tempo ligado',              unit: 's',  dataType: 'gauge', driver: 'snmp', collectionType: 'scalar' },

  // ── Saúde do sistema ───────────────────────────────────────────────────────
  { key: 'cpu',         name: 'Uso de CPU',                unit: '%',  dataType: 'gauge', driver: 'snmp', collectionType: 'scalar' },
  { key: 'memory',      name: 'Memória livre/uso',         unit: 'kB', dataType: 'gauge', driver: 'snmp', collectionType: 'scalar' },
  { key: 'ram_total',   name: 'Memória RAM total',         unit: 'MB', dataType: 'gauge', driver: 'snmp', collectionType: 'scalar' },
  { key: 'temperature', name: 'Temperatura',               unit: '°C', dataType: 'gauge', driver: 'snmp', collectionType: 'scalar' },

  // ── Discos (tabela indexada por slot) ──────────────────────────────────────
  // disk_status: 0=sem disco, 1=normal, 2=erro, 3=não formatado, 4=inicializando.
  // disk_capacity: GB na saída — Hikvision (hikDiskTable oficial) reporta MB
  // (scale 0.001 no perfil); Dahua (physicalVolumeTotal oficial) já é GB nativo.
  // disk_used: Hikvision = GB derivado (capacidade − livre, no driver);
  // Dahua/Intelbras = USO EM % (physicalVolumeUsage) — unidade real fica no
  // ponto criado pelo backend ('%'), a unit abaixo é só default de exibição.
  { key: 'disk_status',   name: 'Estado do disco',         unit: '',   dataType: 'enum',  driver: 'snmp', collectionType: 'table' },
  { key: 'disk_capacity', name: 'Capacidade do disco',     unit: 'GB', dataType: 'gauge', driver: 'snmp', collectionType: 'table' },
  { key: 'disk_used',     name: 'Espaço usado/livre disco',unit: 'GB', dataType: 'gauge', driver: 'snmp', collectionType: 'table' },

  // ── Canais de gravação (tabela indexada por canal) ─────────────────────────
  // channel_status: 0=offline/sem câmera, 1=idle/normal, 2=gravando, 3=motion/alarme.
  { key: 'channel_status', name: 'Estado do canal de gravação', unit: '', dataType: 'enum', driver: 'snmp', collectionType: 'table' },
];

/** Catálogo completo indexado por tipo de device. */
const METRIC_CATALOG: Record<DeviceKind, MetricDefinition[]> = {
  CAMERA: CAMERA_METRICS,
  SWITCH: SWITCH_METRICS,
  NVR: NVR_METRICS,
  ACCESS_CONTROLLER: ACCESS_CONTROLLER_METRICS,
};

/**
 * Retorna as métricas definidas para um tipo de device.
 * Retorna [] para tipos desconhecidos (marca desconhecida nunca falha).
 */
export function getMetricsForType(kind: DeviceKind): MetricDefinition[] {
  return METRIC_CATALOG[kind] ?? [];
}

/**
 * Retorna a definição de uma métrica pelo tipo de device e chave.
 * Retorna undefined quando a chave não existe no catálogo do tipo.
 */
export function getMetricDefinition(
  kind: DeviceKind,
  key: string,
): MetricDefinition | undefined {
  return METRIC_CATALOG[kind]?.find((m) => m.key === key);
}

export { CAMERA_METRICS, SWITCH_METRICS };
