/**
 * Catálogo de perfis de OIDs de saúde para controladoras de acesso (SCA).
 *
 * A estrutura espelha camera-oid-profiles.ts. Todos os perfis usam MIB-II
 * como base — OIDs proprietários das marcas serão adicionados a partir do
 * trabalho de campo com cada fabricante.
 *
 * Fabricantes-alvo:
 *   - Control iD  (empresa BR, enterprise 34475)
 *   - Intelbras   (linha de controle de acesso, enterprise 26330)
 *   - Hikvision   (line DS-K, enterprise 39165 — compartilhado com câmeras)
 */

/** Métricas de saúde cobertas pelos perfis. */
export type AcHealthMetric =
  | 'cpu'
  | 'memory'
  | 'ram_total'
  | 'temperature'
  | 'packet_loss';

export interface AcHealthOidEntry {
  oid: string;
  scale: number;
  unit: string;
}

export interface AcOidProfile {
  id: string;
  label: string;
  /** Padrões (case-insensitive) casados contra o campo manufacturer. */
  match: string[];
  oids: Partial<Record<AcHealthMetric, AcHealthOidEntry>>;
}

/**
 * OIDs genéricos (MIB-II / HOST-RESOURCES / UCD) — base para todos os perfis.
 * Controladoras com firmware Linux geralmente expõem estes OIDs.
 */
const GENERIC_AC_OIDS: Partial<Record<AcHealthMetric, AcHealthOidEntry>> = {
  // hrProcessorLoad da 1ª CPU (HOST-RESOURCES-MIB)
  cpu: { oid: '1.3.6.1.2.1.25.3.3.1.2.1', scale: 1, unit: '%' },
  // UCD memAvailReal (kB)
  memory: { oid: '1.3.6.1.4.1.2021.4.6.0', scale: 1, unit: 'kB' },
  // UCD lm-sensors (mili-°C → °C)
  temperature: { oid: '1.3.6.1.4.1.2021.13.16.2.1.3.1', scale: 0.001, unit: '°C' },
  // ifInDiscards da interface 1
  packet_loss: { oid: '1.3.6.1.2.1.2.2.1.13.1', scale: 1, unit: 'pkts' },
};

export const GENERIC_AC_PROFILE: AcOidProfile = {
  id: 'generic',
  label: 'Genérico (MIB padrão)',
  match: [],
  oids: GENERIC_AC_OIDS,
};

/**
 * Perfis por fabricante. Os OIDs proprietários estão marcados como TODOs
 * até serem levantados em campo — o fallback genérico MIB-II já funciona
 * em qualquer controladora com firmware Linux.
 */
export const ACCESS_CONTROLLER_OID_PROFILES: AcOidProfile[] = [
  {
    id: 'control-id',
    label: 'Control iD',
    match: ['control id', 'controlid', 'control-id'],
    oids: {
      // TODO(field): levantar OIDs proprietários da CONTROL-ID-MIB (enterprise 34475).
      // Enquanto isso o perfil genérico MIB-II é o fallback.
      ...GENERIC_AC_OIDS,
    },
  },
  {
    id: 'intelbras-ac',
    label: 'Intelbras (Controle de Acesso)',
    match: ['intelbras'],
    oids: {
      // TODO(field): levantar OIDs proprietários da linha de controle de acesso
      // Intelbras (enterprise 26330). A linha de câmeras usa Dahua — a de acesso
      // pode diferir. Fallback genérico MIB-II por ora.
      ...GENERIC_AC_OIDS,
    },
  },
  {
    id: 'hikvision-ac',
    label: 'Hikvision (Controle de Acesso)',
    match: ['hikvision'],
    oids: {
      // HIKVISION-MIB (enterprise 39165) — mesmos OIDs da linha de câmeras.
      cpu: { oid: '1.3.6.1.4.1.39165.1.7.0', scale: 1, unit: '%' },
      memory: { oid: '1.3.6.1.4.1.39165.1.11.0', scale: 1, unit: '%' },
      ram_total: { oid: '1.3.6.1.4.1.39165.1.10.0', scale: 1, unit: 'MB' },
      temperature: GENERIC_AC_OIDS.temperature,
      packet_loss: GENERIC_AC_OIDS.packet_loss,
    },
  },
  GENERIC_AC_PROFILE,
];

/** Metadados de exibição/cadastro de cada métrica de saúde. */
export const AC_HEALTH_METRIC_META: Record<
  AcHealthMetric,
  { tag: string; objectName: string }
> = {
  cpu: { tag: 'CPU', objectName: 'Uso de CPU' },
  memory: { tag: 'MEMORIA', objectName: 'Memória disponível' },
  ram_total: { tag: 'RAM_TOTAL', objectName: 'Memória RAM total' },
  temperature: { tag: 'TEMPERATURA', objectName: 'Temperatura' },
  packet_loss: { tag: 'PACOTES_PERDIDOS', objectName: 'Pacotes perdidos (descartes if1)' },
};

/** Seleciona o perfil pelo fabricante (fallback: genérico). */
export function resolveAcOidProfile(manufacturer?: string | null): AcOidProfile {
  const m = manufacturer?.toLowerCase() ?? '';
  if (m) {
    for (const profile of ACCESS_CONTROLLER_OID_PROFILES) {
      if (profile.match.some((pat) => m.includes(pat))) {
        return profile;
      }
    }
  }
  return GENERIC_AC_PROFILE;
}
