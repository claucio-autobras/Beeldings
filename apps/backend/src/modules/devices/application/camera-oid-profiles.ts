/**
 * Catálogo de perfis de OIDs de saúde de câmeras por fabricante.
 *
 * Cada perfil traz os OIDs conhecidos de CPU, memória, temperatura e rede.
 * O perfil é selecionado pelo fabricante detectado no probe ONVIF (ou o
 * genérico quando desconhecido) e serve apenas de PRÉ-PREENCHIMENTO — o
 * usuário pode editar/informar OIDs manualmente no cadastro. Câmeras que não
 * expõem um OID simplesmente respondem com erro naquele varbind e o gateway
 * publica null (a UI mostra "sem dados" — nunca erro nem offline).
 */

/** Métricas de saúde cobertas pelos perfis. */
export type HealthMetric =
  | 'cpu'
  | 'memory'
  | 'ram_total'
  | 'storage'
  | 'temperature'
  | 'packet_loss';

export interface HealthOidEntry {
  oid: string;
  /** Fator aplicado ao valor cru (ex.: 0.001 p/ mili-graus → °C). */
  scale: number;
  unit: string;
}

export interface CameraOidProfile {
  /** Identificador do perfil (slug). */
  id: string;
  /** Nome exibido na UI. */
  label: string;
  /** Padrões (case-insensitive) casados contra o fabricante do probe ONVIF. */
  match: string[];
  oids: Partial<Record<HealthMetric, HealthOidEntry>>;
}

/**
 * OIDs genéricos (MIB-II / HOST-RESOURCES / UCD) — funcionam em muitos
 * firmwares Linux de câmera. Usados quando o fabricante é desconhecido e
 * como fallback para métricas sem OID proprietário conhecido.
 */
const GENERIC_OIDS: Partial<Record<HealthMetric, HealthOidEntry>> = {
  // hrProcessorLoad da 1ª CPU (HOST-RESOURCES-MIB) — % de uso
  cpu: { oid: '1.3.6.1.2.1.25.3.3.1.2.1', scale: 1, unit: '%' },
  // UCD memAvailReal — memória livre em kB
  memory: { oid: '1.3.6.1.4.1.2021.4.6.0', scale: 1, unit: 'kB' },
  // UCD lm-sensors (mili-°C → °C)
  temperature: { oid: '1.3.6.1.4.1.2021.13.16.2.1.3.1', scale: 0.001, unit: '°C' },
  // ifInDiscards da interface 1 (contador acumulado)
  packet_loss: { oid: '1.3.6.1.2.1.2.2.1.13.1', scale: 1, unit: 'pkts' },
};

export const GENERIC_PROFILE: CameraOidProfile = {
  id: 'generic',
  label: 'Genérico (MIB padrão)',
  match: [],
  oids: GENERIC_OIDS,
};

/**
 * Perfis por fabricante. Os OIDs proprietários vêm das MIBs publicadas de
 * cada marca; variações de firmware podem não expor todos — por isso o teste
 * de SNMP no cadastro pré-visualiza os valores e o usuário pode ajustar.
 */
export const CAMERA_OID_PROFILES: CameraOidProfile[] = [
  {
    id: 'hikvision',
    label: 'Hikvision',
    match: ['hikvision'],
    oids: {
      // HIKVISION-MIB (1.3.6.1.4.1.39165.1.*): valores vêm como OCTET STRING
      // com sufixo de unidade ("45 PERCENT", "256 MB") — o gateway normaliza.
      cpu: { oid: '1.3.6.1.4.1.39165.1.7.0', scale: 1, unit: '%' },
      // Uso REAL de RAM (%) — .1.9.0 é uso de armazenamento (SD), não RAM.
      memory: { oid: '1.3.6.1.4.1.39165.1.11.0', scale: 1, unit: '%' },
      // RAM total instalada (MB)
      ram_total: { oid: '1.3.6.1.4.1.39165.1.10.0', scale: 1, unit: 'MB' },
      // Uso de armazenamento SD (%) — total em GB fica em .1.8.0
      storage: { oid: '1.3.6.1.4.1.39165.1.9.0', scale: 1, unit: '%' },
      temperature: GENERIC_OIDS.temperature,
      packet_loss: GENERIC_OIDS.packet_loss,
    },
  },
  {
    id: 'dahua',
    label: 'Dahua',
    match: ['dahua'],
    oids: {
      // OIDs OFICIAIS ("Dahua Product Management Information Library",
      // root 1.3.6.1.4.1.1004849.2): cpuUsage 2.1.3.0 (escalar 0–100),
      // memoryInfo.memoryUsage 2.1.9.2.0 (0–100 %).
      cpu: { oid: '1.3.6.1.4.1.1004849.2.1.3.0', scale: 1, unit: '%' },
      memory: { oid: '1.3.6.1.4.1.1004849.2.1.9.2.0', scale: 1, unit: '%' },
      // A doc oficial NÃO define objeto de temperatura — fallback UCD genérico
      // (o OID antigo 2.1.3.3.1.1 vinha de dump comunitário e contradiz a doc).
      temperature: GENERIC_OIDS.temperature,
      packet_loss: GENERIC_OIDS.packet_loss,
    },
  },
  {
    id: 'intelbras',
    label: 'Intelbras',
    match: ['intelbras'],
    oids: {
      // Firmware Intelbras deriva do Dahua — mesma árvore oficial 1004849.2.
      cpu: { oid: '1.3.6.1.4.1.1004849.2.1.3.0', scale: 1, unit: '%' },
      memory: { oid: '1.3.6.1.4.1.1004849.2.1.9.2.0', scale: 1, unit: '%' },
      temperature: GENERIC_OIDS.temperature,
      packet_loss: GENERIC_OIDS.packet_loss,
    },
  },
  {
    id: 'axis',
    label: 'Axis',
    match: ['axis'],
    oids: {
      cpu: GENERIC_OIDS.cpu,
      memory: GENERIC_OIDS.memory,
      // AXIS-VIDEO-MIB: tempSensorValue (°C)
      temperature: { oid: '1.3.6.1.4.1.368.4.1.3.1.4.1', scale: 1, unit: '°C' },
      packet_loss: GENERIC_OIDS.packet_loss,
    },
  },
  GENERIC_PROFILE,
];

/** Metadados de exibição/cadastro de cada métrica de saúde. */
export const HEALTH_METRIC_META: Record<
  HealthMetric,
  { tag: string; objectName: string }
> = {
  cpu: { tag: 'CPU', objectName: 'Uso de CPU' },
  memory: { tag: 'MEMORIA', objectName: 'Memória' },
  ram_total: { tag: 'RAM_TOTAL', objectName: 'Memória RAM total' },
  storage: { tag: 'ARMAZENAMENTO', objectName: 'Uso de armazenamento' },
  temperature: { tag: 'TEMPERATURA', objectName: 'Temperatura' },
  packet_loss: { tag: 'PACOTES_PERDIDOS', objectName: 'Pacotes perdidos (descartes if1)' },
};

/** Seleciona o perfil pelo fabricante detectado (fallback: genérico). */
export function resolveOidProfile(manufacturer?: string | null): CameraOidProfile {
  const m = manufacturer?.toLowerCase() ?? '';
  if (m) {
    for (const profile of CAMERA_OID_PROFILES) {
      if (profile.match.some((pat) => m.includes(pat))) {
        return profile;
      }
    }
  }
  return GENERIC_PROFILE;
}
