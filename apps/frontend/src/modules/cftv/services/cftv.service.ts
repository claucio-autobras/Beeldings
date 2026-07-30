import { apiGet, apiPost, apiPatch, apiDelete, sensitiveActionHeaders } from '@/lib/api-client';

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Ponto de saúde de uma câmera (SNMP). */
export interface CameraPoint {
  id: string;
  tag: string;
  objectName: string;
  metric: string;
  oid: string | null;
  /** OID comprovadamente inexistente na câmera (último diagnóstico SNMP). */
  unsupported?: boolean;
  /** Ponto marcado como ativo crítico (independente da câmera crítica). */
  critical?: boolean;
  unit: string;
  /** Último valor persistido no backend (seed antes da telemetria ao vivo). */
  lastValue: number | null;
  /** Momento da última leitura persistida (ISO) — null se nunca lida. */
  lastValueAt: string | null;
  /**
   * Estado da última leitura: 'waiting_event' | 'unsupported' | 'error' |
   * 'estimated' — null = leitura real do hardware.
   */
  lastValueState: string | null;
}

/** Métricas de saúde monitoradas via SNMP. */
export type HealthMetric =
  | 'cpu'
  | 'memory'
  | 'ram_total'
  | 'storage'
  | 'temperature'
  | 'packet_loss';

/** Canal SNMP opcional de saúde de uma câmera ONVIF (monitoramento híbrido). */
export interface CameraSnmpHealth {
  enabled: boolean;
  port: number;
  snmpVersion: '1' | '2c';
  community: string;
  /** OIDs efetivos por métrica (dos pontos criados). */
  oids: Partial<Record<HealthMetric, string>>;
}

/** Perfil de OIDs por fabricante (catálogo do backend). */
export interface OidProfile {
  id: string;
  label: string;
  oids: Partial<Record<HealthMetric, { oid: string; scale: number; unit: string }>>;
}

/** Informações lidas da câmera via ONVIF no cadastro (auto-preenchidas). */
export interface OnvifDeviceInfo {
  manufacturer: string | null;
  model: string | null;
  firmwareVersion: string | null;
  serialNumber: string | null;
}

/** Câmera CFTV (Device protocol 'snmp' ou 'onvif' mapeado pelo backend). */
export interface Camera {
  id: string;
  name: string;
  protocol: 'snmp' | 'onvif';
  /** Protocolo de monitoramento ('snmp' | 'onvif'). */
  monitoringProtocol: 'snmp' | 'onvif';
  /** Ativo crítico (card Ativos Críticos do dashboard). */
  critical?: boolean;
  /** Usuário ONVIF (senha NUNCA retorna na API). */
  onvifUsername: string | null;
  hasOnvifPassword: boolean;
  /** Fabricante/modelo/firmware/série lidos via ONVIF (null para SNMP). */
  deviceInfo: OnvifDeviceInfo | null;
  site: string;
  siteId: string | null;
  tenantId: string;
  gatewayId: string | null;
  ip: string;
  port: number;
  snmpVersion: '1' | '2c';
  community: string;
  rtspUrl: string | null;
  /** Intervalo de polling em segundos. */
  pollingInterval: number;
  status: 'online' | 'offline';
  lastCommunication: string | null;
  points: CameraPoint[];
  /** Canal SNMP de saúde (só câmeras ONVIF; null para SNMP puro). */
  snmpHealth: CameraSnmpHealth | null;
  /**
   * ONVIF: câmera salva sem probe bem-sucedido ("cadastrar mesmo assim") —
   * o backend re-tenta a validação em segundo plano e limpa a marcação.
   */
  pendingValidation: boolean;
  /** Fabricante (manual no SNMP; do probe no ONVIF) — null = desconhecido. */
  manufacturer: string | null;
  /**
   * "Online desde" estimado pelo backend (transições do ponto STATUS) —
   * base do "tempo online estimado" quando a câmera não expõe uptime real.
   */
  estimatedOnlineSince: string | null;
}

/** Payload de criação/edição de câmera. */
export interface CameraInput {
  name?: string;
  siteId?: string;
  tenantId?: string;
  gatewayId?: string;
  ip?: string;
  port?: number;
  monitoringProtocol?: 'snmp' | 'onvif';
  /** Credenciais ONVIF (senha vazia na edição = manter a atual). */
  onvifUsername?: string;
  onvifPassword?: string;
  snmpVersion?: '1' | '2c';
  community?: string;
  rtspUrl?: string | null;
  pollingInterval?: number;
  /** ONVIF: canal SNMP opcional de saúde (undefined = manter como está). */
  snmpHealth?: {
    enabled: boolean;
    community?: string;
    port?: number;
    snmpVersion?: '1' | '2c';
    oids?: Partial<Record<HealthMetric, string>>;
  };
  /** SNMP: overrides manuais de OID por ponto (saúde + uptime). */
  healthOids?: Partial<Record<HealthMetric | 'uptime', string>>;
  /**
   * SNMP: fabricante informado no cadastro (Hikvision/Dahua/Intelbras…) —
   * identifica o provider de telemetria no gateway. undefined = manter.
   */
  manufacturer?: string | null;
  /**
   * ONVIF: "Cadastrar/Salvar mesmo assim" — grava a câmera mesmo com o probe
   * falhando (validação fica pendente e é re-tentada em segundo plano).
   */
  forceCreate?: boolean;
}

/** Dispositivo encontrado no scan SNMP de rede. */
export interface DiscoveredSnmpDevice {
  ip: string;
  sysName: string | null;
  sysDescr: string | null;
  sysObjectId: string | null;
  uptimeSeconds: number | null;
  /** Combinação que respondeu (diagnóstico). */
  snmpVersion?: '1' | '2c';
  community?: string;
}

/** Resumo diagnóstico do scan SNMP. */
export interface SnmpScanSummary {
  probed: number;
  responded: number;
  timeouts: number;
  aliveNoSnmp: string[];
  durationMs: number;
}

/** Resultado completo do scan (dispositivos + diagnóstico). */
export interface SnmpScanOutcome {
  devices: DiscoveredSnmpDevice[];
  summary: SnmpScanSummary | null;
}

/** Câmera ONVIF encontrada via WS-Discovery no gateway. */
export interface DiscoveredOnvifDevice {
  ip: string;
  port: number;
  /** Nome anunciado pela câmera nos scopes ONVIF. */
  name: string | null;
  /** Hardware/modelo anunciado nos scopes. */
  hardware: string | null;
  /** URLs de serviço anunciadas (diagnóstico). */
  xaddrs: string[];
}

/** Progresso parcial de um scan em andamento. */
export interface SnmpScanProgress {
  scanned: number;
  total: number;
  found: number;
  done: boolean;
}

// ─── API ─────────────────────────────────────────────────────────────────────

export async function getCameras(tenantId?: string): Promise<Camera[]> {
  return apiGet<Camera[]>(`/cftv/cameras${tenantId ? `?tenantId=${tenantId}` : ''}`);
}

export async function createCamera(data: CameraInput): Promise<Camera> {
  return apiPost<Camera>('/cftv/cameras', data);
}

export async function updateCamera(id: string, data: CameraInput): Promise<Camera> {
  return apiPatch<Camera>(`/cftv/cameras/${id}`, data);
}

/** Exclusão crítica: exige o token de confirmação de senha do operador. */
export async function deleteCamera(id: string, confirmationToken: string): Promise<void> {
  await apiDelete(`/cftv/cameras/${id}`, { headers: sensitiveActionHeaders(confirmationToken) });
}

/**
 * Varre um range de IP via SNMP no gateway informado e retorna os
 * dispositivos que responderam (candidatos a câmera). Pode levar ~1 min
 * dependendo do tamanho do range.
 */
export async function scanSnmpRange(params: {
  tenantId: string;
  gatewayId: string;
  ipStart: string;
  ipEnd: string;
  snmpVersion?: '1' | '2c';
  /** Uma ou mais communities separadas por vírgula (ex.: "public, private"). */
  community?: string;
  port?: number;
  /** ID gerado pelo cliente para acompanhar o progresso via getScanProgress. */
  scanId?: string;
}): Promise<SnmpScanOutcome> {
  const data = await apiPost<{
    success: boolean;
    error?: string;
    devices?: DiscoveredSnmpDevice[];
    summary?: SnmpScanSummary;
  }>('/cftv/scan', params);
  if (!data.success) {
    throw new Error(data.error ?? 'Erro desconhecido ao escanear a rede.');
  }
  return { devices: data.devices ?? [], summary: data.summary ?? null };
}

/**
 * Descoberta automática de câmeras ONVIF: o gateway roda o WS-Discovery
 * (multicast em todas as interfaces, com reenvio) e retorna as câmeras que se
 * anunciaram com IP e porta já detectados. Não requer credenciais.
 * `targets` (opcional): IP, CIDR ou intervalo — o gateway então sonda esses
 * endereços diretamente via unicast (funciona mesmo com multicast bloqueado).
 */
export async function scanOnvifNetwork(params: {
  tenantId: string;
  gatewayId: string;
  targets?: string;
}): Promise<DiscoveredOnvifDevice[]> {
  const data = await apiPost<{
    success: boolean;
    error?: string;
    devices?: DiscoveredOnvifDevice[];
  }>('/cftv/scan/onvif', params);
  if (!data.success) {
    throw new Error(data.error ?? 'Erro desconhecido ao descobrir câmeras ONVIF.');
  }
  return data.devices ?? [];
}

/** Catálogo de perfis de OIDs por fabricante. */
export async function getOidProfiles(): Promise<OidProfile[]> {
  return apiGet<OidProfile[]>('/cftv/oid-profiles');
}

/** Resultado do teste do canal SNMP de saúde (botão "Testar SNMP"). */
export interface SnmpHealthTestOutcome {
  reachable: boolean;
  /** Valores crus por métrica (null = OID sem resposta/não suportado). */
  values: Partial<Record<HealthMetric, number | null>>;
  /** OIDs efetivamente testados (perfil do fabricante + overrides). */
  oids: Partial<Record<HealthMetric, string>>;
}

/**
 * Testa o canal SNMP de saúde de uma câmera via gateway e pré-visualiza os
 * valores dos OIDs. Câmera sem SNMP → reachable=false (não é um erro).
 */
export async function testCameraSnmp(params: {
  tenantId: string;
  gatewayId: string;
  ip: string;
  port?: number;
  snmpVersion?: '1' | '2c';
  community?: string;
  manufacturer?: string | null;
  oids?: Partial<Record<HealthMetric, string>>;
}): Promise<SnmpHealthTestOutcome> {
  const data = await apiPost<{
    success: boolean;
    error?: string;
    reachable?: boolean;
    values?: Partial<Record<HealthMetric, number | null>>;
    oids?: Partial<Record<HealthMetric, string>>;
  }>('/cftv/test-snmp', params);
  if (!data.success) {
    throw new Error(data.error ?? 'Erro desconhecido ao testar o SNMP.');
  }
  return {
    reachable: Boolean(data.reachable),
    values: data.values ?? {},
    oids: data.oids ?? {},
  };
}

// ─── Diagnóstico SNMP da câmera ──────────────────────────────────────────────

/** Métricas cobertas pelo diagnóstico (saúde + uptime). */
export type DiagMetric = HealthMetric | 'uptime';

/** Candidato de OID testado no diagnóstico. */
export interface DiagnoseCandidate {
  oid: string;
  profileLabel: string;
  scale: number;
  unit: string;
  responded: boolean;
  value: number | null;
  raw: string | null;
  isCurrent: boolean;
}

/** Resultado por métrica do diagnóstico. */
export interface DiagnoseMetricResult {
  metric: DiagMetric;
  label: string;
  pointId: string | null;
  currentOid: string | null;
  currentResponded: boolean;
  currentValue: number | null;
  currentRaw: string | null;
  /** false = nenhum OID conhecido respondeu (métrica não suportada). */
  supported: boolean;
  candidates: DiagnoseCandidate[];
}

/** Seção do walk resumido (MIB-II system/interfaces + enterprise). */
export interface DiagnoseWalkSection {
  root: string;
  label: string;
  entries: Array<{ oid: string; value: string }>;
  truncated: boolean;
}

/** Causa provável quando a câmera não respondeu ao SNMP. */
export type SnmpUnreachableCause = 'community' | 'no_response';

export interface SnmpDiagnoseOutcome {
  reachable: boolean;
  /** Preenchido só quando reachable=false. */
  cause?: SnmpUnreachableCause | null;
  sysDescr: string | null;
  sysObjectId: string | null;
  durationMs: number;
  metrics: DiagnoseMetricResult[];
  walk: DiagnoseWalkSection[];
}

/** Progresso parcial do diagnóstico (polling). */
export interface SnmpDiagnoseProgress {
  phase: 'oids' | 'walk';
  tested: number;
  total: number;
  done: boolean;
}

/**
 * Roda o diagnóstico SNMP da câmera via gateway: testa o OID atual de cada
 * métrica + os candidatos de todos os perfis de fabricante e faz um walk
 * resumido. Pode levar ~1 min. Falha imediata se o gateway está offline.
 */
export async function diagnoseCameraSnmp(
  cameraId: string,
  diagnoseId?: string,
): Promise<SnmpDiagnoseOutcome> {
  const data = await apiPost<
    | ({ success: true } & SnmpDiagnoseOutcome)
    | { success: false; error?: string }
  >(`/cftv/cameras/${cameraId}/diagnose-snmp`, { diagnoseId });
  if (!data.success) {
    throw new Error(data.error ?? 'Erro desconhecido no diagnóstico SNMP.');
  }
  return data;
}

/** Progresso parcial do diagnóstico (polling durante a execução). */
export async function getDiagnoseProgress(
  diagnoseId: string,
): Promise<SnmpDiagnoseProgress | null> {
  const data = await apiGet<Partial<SnmpDiagnoseProgress> & { unknown?: true }>(
    `/cftv/diagnose/${diagnoseId}/progress`,
  );
  if (data.unknown) return null;
  return {
    phase: data.phase === 'walk' ? 'walk' : 'oids',
    tested: data.tested ?? 0,
    total: data.total ?? 0,
    done: data.done ?? false,
  };
}

/**
 * Aplica OIDs sugeridos pelo diagnóstico: atualiza o binding dos pontos
 * (IDs preservados — trends/alarmes sobrevivem) e republica a config no
 * gateway.
 */
export async function applySnmpOids(
  cameraId: string,
  oids: Partial<Record<DiagMetric, string>>,
): Promise<Camera> {
  return apiPost<Camera>(`/cftv/cameras/${cameraId}/apply-snmp-oids`, { oids });
}

/** Progresso parcial do scan (polling durante o scan). */
export async function getScanProgress(scanId: string): Promise<SnmpScanProgress | null> {
  const data = await apiGet<Partial<SnmpScanProgress> & { unknown?: true }>(
    `/cftv/scan/${scanId}/progress`,
  );
  if (data.unknown) return null;
  return {
    scanned: data.scanned ?? 0,
    total: data.total ?? 0,
    found: data.found ?? 0,
    done: data.done ?? false,
  };
}

/** Marca/desmarca a câmera como ativo crítico (a câmera é um Device). */
export async function setCameraCritical(cameraId: string, critical: boolean): Promise<void> {
  await apiPatch(`/devices/${cameraId}`, { critical });
}

/**
 * Marca/desmarca um ponto da câmera como ativo crítico — mesmo PATCH de ponto
 * usado pelas controladoras (a câmera é um Device e o ponto um DevicePoint).
 */
export async function setCameraPointCritical(
  cameraId: string,
  pointId: string,
  critical: boolean,
): Promise<void> {
  await apiPatch(`/devices/${cameraId}/points/${pointId}`, { critical });
}
