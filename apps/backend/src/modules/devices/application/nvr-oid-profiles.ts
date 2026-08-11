/**
 * Catálogo de perfis de OIDs de saúde para NVR/DVR (gravadores de vídeo).
 *
 * Estrutura espelha camera-oid-profiles.ts e access-controller-oid-profiles.ts.
 *
 * Este módulo cobre apenas as métricas ESCALARES (cpu, memory, temperature,
 * uptime) usadas pelo capability probe SNMP. As tabelas de disco e canal são
 * descobertas separadamente pelo NvrTableSyncService que usa os OID prefixos
 * definidos em NVR_TABLE_OIDS.
 *
 * Fabricantes suportados:
 *   - Hikvision (enterprise 39165 — mesmos OIDs escalares das câmeras)
 *   - Dahua     (enterprise 1004849 — sub-árvore 2.1.3.X)
 *   - Intelbras (OEM Dahua — bestEffort, sentinelas=[0])
 *   - Genérico  (MIB-II / UCD — fallback universal)
 */

// ─── Tipos ─────────────────────────────────────────────────────────────────────

/** Métricas escalares testadas no probe do NVR. */
export type NvrScalarMetric = 'cpu' | 'memory' | 'temperature';

export interface NvrHealthOidEntry {
  oid: string;
  scale: number;
  unit: string;
}

export interface NvrOidProfile {
  id: string;
  label: string;
  /** Padrões (case-insensitive) casados contra Device.config.manufacturer. */
  match: string[];
  oids: Partial<Record<NvrScalarMetric, NvrHealthOidEntry>>;
}

// ─── OIDs escalares de tabela — prefixos enviados ao gateway ─────────────────

/**
 * OIDs-prefixo da tabela de discos enviados ao gateway.
 *
 * Semântica de `usedGb` vs `freeGb`:
 *   - `usedGb`: OID reporta espaço USADO diretamente (Dahua/Intelbras).
 *   - `freeGb`: OID reporta espaço LIVRE (hikHddFreeSpace, Hikvision).
 *     O sync-disks normaliza: disk_used = capacityGb - freeGb.
 *     A telemetria contínua publica como metric `disk_free` (separado de disk_used).
 *
 * Regra: nunca fornecer ambos `usedGb` e `freeGb` — use um ou outro por perfil.
 */
export interface NvrDiskTableOids {
  status?: string;
  capacityGb?: string;
  /** OID do espaço USADO (Dahua/Intelbras). Mutuamente exclusivo com freeGb. */
  usedGb?: string;
  /** OID do espaço LIVRE/FREE (Hikvision hikHddFreeSpace). Mutuamente exclusivo com usedGb. */
  freeGb?: string;
  /**
   * Fator de escala aplicado sobre os valores brutos de capacidade/espaço-usado.
   *
   * Hikvision reporta em GB (scale = 1, padrão).
   * Dahua/Intelbras reportam em MB → scale = 0.001 converte para GB.
   *
   * O sync-disks multiplica o valor bruto por este fator antes de persistir
   * o lastValue e antes de gravar o `scale` no binding do ponto.
   * O gateway lê o `scale` do binding e aplica-o na telemetria contínua.
   */
  diskScale?: number;
  /**
   * Mapa raw→canônico para normalização de disk_status.
   *
   * Enum canônico (Hikvision = referência):
   *   0=sem disco, 1=normal, 2=erro, 3=não formatado, 4=inicializando
   *
   * Dahua/Intelbras raw:
   *   0=normal → 1, 1=erro → 2, 2=sem disco → 0
   *   3/4 passam inalterados (não formatado / formatando ~ inicializando)
   *
   * Campo nomeado `statusMap` (sem prefixo) para corresponder ao campo homônimo
   * da interface `NvrDiskTableOids` do gateway (snmp-nvr-tables.service.ts).
   * Enviado literalmente no MQTT payload → gateway aplica normalização antes de
   * retornar o resultado; driver contínuo usa o `enumNormalize` do perfil.
   */
  statusMap?: Record<number, number>;
}

/** OIDs-prefixo da tabela de canais enviados ao gateway. */
export interface NvrChannelTableOids {
  status?: string;
}

/**
 * OID-prefixos das tabelas de disco e canal por perfil.
 * Enviados pelo NvrTableSyncService ao gateway no comando discover_nvr_tables.
 * Perfis sem tabela suportada omitem as chaves — o gateway não walk esses OIDs.
 */
export interface NvrTableOids {
  disk: NvrDiskTableOids;
  channel: NvrChannelTableOids;
}

/**
 * Mapeamento profileId → OID-prefixos de tabela.
 *
 * NOTAS DE RISCO (bestEffort — validar contra firmware real):
 *
 * Hikvision NVR (hikHddTable / hikChannelTable):
 *   OIDs extraídos da HIKVISION-NVR-MIB pública (DS-7xxx/DS-9xxx).
 *   Firmwares antigos ou modelos DVR podem usar sub-árvore diferente.
 *   hikHddFreeSpace (col 3) reporta espaço LIVRE, não usado — a UI deve
 *   calcular usado = capacidade - livre.
 *
 * Dahua NVR (dskTable / chnTable):
 *   OIDs levantados de dumps de MIB comunitários; pouco documentação pública.
 *   Col 2 em ambas as tabelas é o campo de índice real (col 1 = dskIndex/chnIndex);
 *   status na col 2, capacidade na col 3, usado na col 4.
 *   Unidade: MB (não GB) — scale nos pontos criados pelo backend.
 */
export const NVR_TABLE_OIDS: Record<string, NvrTableOids> = {
  'hikvision-nvr': {
    disk: {
      status:     '1.3.6.1.4.1.39165.1.4.1.1',
      capacityGb: '1.3.6.1.4.1.39165.1.4.1.2',
      // col 3 = hikHddFreeSpace — reporta espaço LIVRE, NÃO usado.
      // sync-disks normaliza: disk_used = capacity - freeGb.
      // Telemetria contínua fica no metric 'disk_free' (ponto separado).
      // A UI NUNCA precisa saber dessa inversão — todo output é "espaço usado".
      freeGb:     '1.3.6.1.4.1.39165.1.4.1.3',
      // usedGb: não disponível diretamente na HIKVISION-NVR-MIB
    },
    channel: {
      status: '1.3.6.1.4.1.39165.1.5.1.1',
    },
  },
  'dahua-nvr': {
    disk: {
      status:     '1.3.6.1.4.1.1004849.1.1.1.2',
      capacityGb: '1.3.6.1.4.1.1004849.1.1.1.3',
      usedGb:     '1.3.6.1.4.1.1004849.1.1.1.4',
      // Col 3/4 reportam MB — converter para GB na ingestão e na telemetria.
      diskScale:  0.001,
      // Enum disk_status Dahua raw: 0=normal,1=erro,2=sem disco
      // → Enum canônico:            1=normal,2=erro,0=sem disco
      // Campo `statusMap` (não diskStatusMap) — corresponde ao campo homônimo
      // na interface NvrDiskTableOids do gateway.
      statusMap: { 0: 1, 1: 2, 2: 0 },
    },
    channel: {
      status: '1.3.6.1.4.1.1004849.1.2.1.2',
    },
  },
  'intelbras-nvr': {
    // Intelbras é OEM Dahua — mesmos OIDs, mesma unidade (MB) e mesmo enum.
    disk: {
      status:     '1.3.6.1.4.1.1004849.1.1.1.2',
      capacityGb: '1.3.6.1.4.1.1004849.1.1.1.3',
      usedGb:     '1.3.6.1.4.1.1004849.1.1.1.4',
      diskScale:  0.001,
      statusMap: { 0: 1, 1: 2, 2: 0 },
    },
    channel: {
      status: '1.3.6.1.4.1.1004849.1.2.1.2',
    },
  },
};

/** Fallback: nenhuma tabela conhecida para o perfil. */
export const EMPTY_NVR_TABLE_OIDS: NvrTableOids = { disk: {}, channel: {} };

// ─── Perfis escalares ─────────────────────────────────────────────────────────

const GENERIC_NVR_OIDS: Partial<Record<NvrScalarMetric, NvrHealthOidEntry>> = {
  cpu:         { oid: '1.3.6.1.2.1.25.3.3.1.2.1',      scale: 1,     unit: '%'  },
  memory:      { oid: '1.3.6.1.4.1.2021.4.6.0',         scale: 1,     unit: 'kB' },
  temperature: { oid: '1.3.6.1.4.1.2021.13.16.2.1.3.1', scale: 0.001, unit: '°C' },
};

export const GENERIC_NVR_PROFILE: NvrOidProfile = {
  id: 'base-nvr',
  label: 'Genérico (MIB padrão)',
  match: [],
  oids: GENERIC_NVR_OIDS,
};

/**
 * Todos os perfis NVR ordenados por prioridade de match.
 * GENERIC_NVR_PROFILE (match=[]) deve ser o último.
 */
export const NVR_OID_PROFILES: NvrOidProfile[] = [
  {
    id: 'hikvision-nvr',
    label: 'Hikvision NVR/DVR',
    match: ['hikvision'],
    oids: {
      cpu:         { oid: '1.3.6.1.4.1.39165.1.7.0',  scale: 1, unit: '%'  },
      memory:      { oid: '1.3.6.1.4.1.39165.1.11.0', scale: 1, unit: '%'  },
      temperature: GENERIC_NVR_OIDS.temperature,
    },
  },
  {
    id: 'dahua-nvr',
    label: 'Dahua NVR/DVR',
    match: ['dahua'],
    oids: {
      cpu:         { oid: '1.3.6.1.4.1.1004849.2.1.3.1.1.1', scale: 1, unit: '%'  },
      memory:      { oid: '1.3.6.1.4.1.1004849.2.1.3.2.1.1', scale: 1, unit: '%'  },
      temperature: { oid: '1.3.6.1.4.1.1004849.2.1.3.3.1.1', scale: 1, unit: '°C' },
    },
  },
  {
    id: 'intelbras-nvr',
    label: 'Intelbras NVR/DVR',
    match: ['intelbras'],
    oids: {
      cpu:         { oid: '1.3.6.1.4.1.1004849.2.1.3.1.1.1', scale: 1, unit: '%'  },
      memory:      { oid: '1.3.6.1.4.1.1004849.2.1.3.2.1.1', scale: 1, unit: '%'  },
      temperature: { oid: '1.3.6.1.4.1.1004849.2.1.3.3.1.1', scale: 1, unit: '°C' },
    },
  },
  GENERIC_NVR_PROFILE,
];

// ─── Enterprise number → profileId ─────────────────────────────────────────────

/**
 * Enterprise numbers → ID de perfil NVR.
 * 1004849 (Dahua/Intelbras) → intelbras-nvr (conservador, bestEffort).
 */
export const NVR_ENTERPRISE_TO_PROFILE: Record<number, string> = {
  39165:   'hikvision-nvr',
  1004849: 'intelbras-nvr',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Detecta o perfil NVR a partir dos dados lidos via SNMP.
 * Mesma prioridade do gateway: fabricante manual → sysDescr → enterprise number.
 */
export function detectNvrProfile(
  sysDescr: string | null,
  sysObjectId: string | null,
  manufacturerHint?: string | null,
): NvrOidProfile {
  const mfr  = (manufacturerHint ?? '').toLowerCase();
  const descr = (sysDescr ?? '').toLowerCase();

  // 1. Fabricante manual.
  if (mfr) {
    const byMfr = NVR_OID_PROFILES.find(
      (p) => p.match.length > 0 && p.match.some((pat) => mfr.includes(pat)),
    );
    if (byMfr) return byMfr;
  }

  // 2. sysDescr substring.
  if (descr) {
    const byDescr = NVR_OID_PROFILES.find(
      (p) => p.match.length > 0 && p.match.some((pat) => descr.includes(pat)),
    );
    if (byDescr) return byDescr;
  }

  // 3. Enterprise number via sysObjectId.
  if (sysObjectId) {
    const m = /^1\.3\.6\.1\.4\.1\.(\d+)/.exec(sysObjectId.trim());
    if (m) {
      const ent       = Number(m[1]);
      const profileId = NVR_ENTERPRISE_TO_PROFILE[ent];
      if (profileId) {
        const found = NVR_OID_PROFILES.find((p) => p.id === profileId);
        if (found) return found;
      }
    }
  }

  return GENERIC_NVR_PROFILE;
}

/** Resolve o rótulo de um profileId NVR (fallback: label do perfil genérico). */
export function resolveNvrProfileLabel(profileId: string | null | undefined): string {
  if (!profileId) return GENERIC_NVR_PROFILE.label;
  const found = NVR_OID_PROFILES.find((p) => p.id === profileId);
  return found?.label ?? GENERIC_NVR_PROFILE.label;
}
