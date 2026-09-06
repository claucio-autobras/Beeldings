/**
 * Tipos compartilhados do sistema de perfis declarativos.
 *
 * Os perfis descrevem como coletar cada métrica de cada tipo de dispositivo
 * monitorado (CAMERA, SWITCH, NVR). O motor de resolução funde camadas em
 * ordem de prioridade: base (0) → fabricante (10) → override por device (100).
 */

/** Tipo de dispositivo monitorado — extensível como String no banco. */
export type DeviceKind = 'CAMERA' | 'SWITCH' | 'NVR' | 'ACCESS_CONTROLLER';

/** Tipo de dado da métrica. */
export type MetricDataType = 'gauge' | 'counter' | 'enum' | 'string';

/** Driver de coleta responsável pela métrica. */
export type MetricDriverKind = 'snmp' | 'onvif' | 'ping' | 'http';

/** Tipo de coleta: escalar (valor único) ou tabela (walk / lista de índices). */
export type MetricCollectionType = 'scalar' | 'table';

/**
 * Estado de capacidade de uma métrica num device específico.
 * Resultado do probe; persiste em DeviceCapabilityMap.
 */
export type CapabilityState =
  | 'SUPPORTED'       // métrica respondeu com valor no probe
  | 'UNSUPPORTED'     // noSuchObject / noSuchName / capability ausente
  | 'TEMPORARY_ERROR' // timeout / falha de rede (retry no próximo probe)
  | 'NO_PERMISSION';  // authError SNMP / 401/403 HTTP

/** Camada de onde veio um mapeamento no perfil resolvido. */
export type ProfileLayer = 'base' | 'vendor' | 'override';

/**
 * Definição canônica de uma métrica — constante no catálogo por deviceType.
 * NÃO inclui como coletar: isso fica nos perfis.
 */
export interface MetricDefinition {
  /** Chave canônica: 'cpu', 'memory', 'uptime', 'if_in_discards', etc. */
  key: string;
  /** Nome amigável exibido na UI. */
  name: string;
  /** Unidade: '%', 'kB', 's', 'W', etc. */
  unit: string;
  dataType: MetricDataType;
  driver: MetricDriverKind;
  collectionType: MetricCollectionType;
}

/**
 * Mapeamento de uma métrica para um meio de coleta específico.
 * Campos opcionais por driver — apenas os relevantes são preenchidos.
 */
export interface MetricMapping {
  metricKey: string;

  // ── SNMP escalar ────────────────────────────────────────────────────────────
  /** OID lido no GET/GETBULK. */
  oid?: string;
  /** Fator aplicado ao valor cru (ex.: 0.01 para TimeTicks → segundos). */
  scale?: number;
  /**
   * Valores-sentinela de bug de firmware (ex.: campo que responde sempre 0).
   * Valor igual a uma sentinela → `unreliable: true` no ponto publicado.
   * Só relevante quando `bestEffort: true` no perfil.
   */
  sentinels?: number[];

  // ── SNMP tabela (IF-MIB / outras tabelas indexadas) ──────────────────────
  /**
   * Prefixo de OID da coluna da tabela (sem o índice final).
   * Ex.: '1.3.6.1.2.1.2.2.1.8' para ifOperStatus.
   * Quando presente, indica coleta por subtree walk em vez de GET escalar.
   */
  tableOidPrefix?: string;

  /**
   * Remapeamento de enum bruto → valor canônico.
   * Aplicado ao valor lido antes de publicar, campo a campo.
   *
   * Uso principal: disk_status Dahua/Intelbras (enum invertido vs Hikvision).
   *   Dahua raw 0=normal,1=erro,2=sem disco → canônico 1,2,0
   *   Chaves não mapeadas passam inalteradas (identidade).
   */
  enumNormalize?: Record<number, number>;

  // ── HTTP proprietário ────────────────────────────────────────────────────────
  /**
   * Tipo de endpoint HTTP proprietário suportado pelo driver.
   * 'isapi' = Hikvision ISAPI (GET /ISAPI/System/status, digest auth).
   */
  httpKind?: 'isapi';

  // ── ONVIF ───────────────────────────────────────────────────────────────────
  /** Chamada ONVIF responsável pela métrica (ex.: 'GetDeviceInformation'). */
  onvifCall?: string;
}

/**
 * Condição de auto-seleção de um perfil de fabricante.
 * Qualquer campo que case é suficiente (OR entre campos, AND dentro de arrays).
 */
export interface ProfileMatchCondition {
  /** Substrings (lowercase) casadas contra Device.config.manufacturer. */
  manufacturerContains?: string[];
  /** Substrings (lowercase) casadas contra sysDescr lido do equipamento. */
  sysDescrContains?: string[];
  /** Números enterprise (1.3.6.1.4.1.N) da MIB do fabricante. */
  enterpriseNumbers?: number[];
}

/**
 * Perfil declarativo de dispositivo.
 *
 * Arquivo TypeScript versionado no gateway — adicionar suporte a uma marca
 * nova = acrescentar um arquivo de perfil aqui, sem tocar no motor.
 */
export interface DeviceProfile {
  /** Identificador único do perfil (slug). */
  id: string;
  /** Nome exibido na UI. */
  label: string;
  /** Tipos de device a que este perfil se aplica. */
  deviceTypes: DeviceKind[];
  /**
   * Prioridade de seleção automática.
   * 0 = base (sempre aplicável); 10 = fabricante; 100 = override por device.
   */
  priority: number;
  /**
   * Condição de auto-match. Ausente = perfil se aplica a todos os devices
   * do tipo (usado no perfil base).
   */
  match?: ProfileMatchCondition;
  /**
   * Modo melhor-esforço: a árvore SNMP é compartilhada/derivada de outro
   * fabricante e pode responder valores-sentinela em campos válidos.
   * Quando true, sentinelas são checadas e o ponto é marcado `unreliable`.
   * A falha/sentinela de um campo NUNCA derruba os demais (por campo).
   */
  bestEffort?: boolean;
  /** Mapeamentos métrica → meio de coleta neste perfil. */
  mappings: MetricMapping[];
  /**
   * Conhecimento de DESCOBERTA aportado pelo perfil (aditivo — nunca altera
   * o motor genérico): subárvores proprietárias a percorrer no walk de
   * diagnóstico, além das raízes padrão (MIB-II, HOST-RESOURCES, ENTITY).
   * Perfil sem `discovery` → fallback automático para a enterprise extraída
   * do sysObjectID do equipamento.
   */
  discovery?: {
    /** Raízes de walk proprietárias (ex.: Control iD → '1.3.6.1.4.1.49617.1'). */
    walkRoots?: string[];
  };
}

/**
 * Mapeamento resolvido — inclui metadados de rastreabilidade para diagnóstico
 * e exibição na UI ("perfil aplicado: Hikvision (fabricante detectado)").
 */
export interface ResolvedMapping extends MetricMapping {
  profileLayer: ProfileLayer;
  profileId: string;
}

/**
 * Resultado da resolução de perfil para um device específico.
 * Mappings já fundidos: base → vendor → override.
 */
export interface ResolvedProfile {
  /** ID do perfil dominante (vendor, se matched; 'base-camera' otherwise). */
  id: string;
  /** Rótulo do perfil dominante. */
  label: string;
  /** true quando o perfil é `bestEffort` (sentinelas ativas). */
  bestEffort: boolean;
  /** Mapeamentos finais por metricKey. */
  mappings: Map<string, ResolvedMapping>;
}
