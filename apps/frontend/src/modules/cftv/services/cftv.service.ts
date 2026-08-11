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

/** Estado de capacidade de uma métrica por device. */
export type CapabilityState =
  | 'SUPPORTED'
  | 'UNSUPPORTED'
  | 'TEMPORARY_ERROR'
  | 'NO_PERMISSION';

/** Resultado de capacidade de uma métrica no DeviceCapabilityMap. */
export interface MetricCapability {
  metricKey: string;
  state: CapabilityState;
  probeValue: number | null;
  profileId: string | null;
  profileLayer: 'base' | 'vendor' | 'override' | null;
  lastProbeAt: string;
}

/** Mapa de capacidades de uma câmera (resultado do último probe). */
export interface CameraCapabilities {
  profileId: string | null;
  profileLabel: string;
  profileSource: 'detected' | 'manual' | 'generic';
  profileOverrides: Record<string, string> | null;
  capabilities: MetricCapability[];
}

/** Perfil de monitoramento disponível. */
export interface MonitoringProfile {
  id: string;
  label: string;
  metrics: Array<{
    metricKey: string;
    oid: string | null;
    scale: number;
    unit: string;
  }>;
}

/** Resultado do probe de capacidades. */
export interface ProbeCapabilitiesResult {
  reachable: boolean;
  cause?: 'community' | 'no_response' | null;
  sysDescr?: string | null;
  detectedProfileId: string;
  detectedProfileLabel: string;
  capabilities: MetricCapability[];
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
  /**
   * Usuário ONVIF (senha NUNCA retorna na API). Na câmera SNMP são as
   * credenciais opcionais de "Vídeo ao vivo".
   */
  onvifUsername: string | null;
  hasOnvifPassword: boolean;
  /** SNMP: porta do serviço ONVIF/vídeo (null em câmera ONVIF — usa a principal). */
  onvifPort: number | null;
  /**
   * "Ver ao vivo" disponível: ONVIF sempre; SNMP quando o cadastro tem
   * credenciais de vídeo ONVIF ou URL RTSP.
   */
  liveViewAvailable: boolean;
  /** Fabricante/modelo/firmware/série lidos via ONVIF (null para SNMP). */
  deviceInfo: OnvifDeviceInfo | null;
  site: string;
  siteId: string | null;
  tenantId: string;
  gatewayId: string | null;
  /**
   * Liveness do gateway responsável pela câmera no momento do carregamento
   * (sinal LWT/heartbeat do broker, via DeviceStatusService no backend).
   * null = câmera sem gatewayId cadastrado.
   * TODO(follow-up): atualizar em tempo real via socket 'gateway:status'.
   */
  gatewayOnline: boolean | null;
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
  /** ID do perfil de monitoramento (detectado ou manual). null = genérico. */
  profileId: string | null;
  /** Rótulo do perfil resolvido. Ex.: "Hikvision", "Genérico (MIB padrão)". */
  profileLabel: string;
  /** Origem do perfil: 'detected' = auto-detectado, 'manual' = operador, 'generic' = sem perfil. */
  profileSource: 'detected' | 'manual' | 'generic';
  /** Overrides manuais de OID por métrica. null = nenhum override. */
  profileOverrides: Record<string, string> | null;
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
  /**
   * Credenciais ONVIF (senha vazia na edição = manter a atual). Na câmera
   * SNMP são o canal opcional de "Vídeo ao vivo" (username vazio = limpar).
   */
  onvifUsername?: string;
  onvifPassword?: string;
  /** SNMP: porta do serviço ONVIF/vídeo (padrão 80). */
  onvifPort?: number;
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
  /**
   * Perfil de monitoramento selecionado manualmente.
   * null = limpar override e usar detecção automática.
   */
  profileId?: string | null;
  /**
   * Overrides de OID por métrica definidos pelo operador.
   * null = limpar todos os overrides.
   */
  profileOverrides?: Record<string, string> | null;
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

// ─── Perfil de monitoramento + capacidades ────────────────────────────────────

/** Lista os perfis de monitoramento disponíveis para um tipo de dispositivo. */
export async function getMonitoringProfiles(
  deviceType = 'CAMERA',
): Promise<MonitoringProfile[]> {
  return apiGet<MonitoringProfile[]>(`/cftv/profiles?deviceType=${deviceType}`);
}

/** Lê o mapa de capacidades da câmera (resultado do último probe). */
export async function getCameraCapabilities(
  cameraId: string,
): Promise<CameraCapabilities> {
  return apiGet<CameraCapabilities>(`/cftv/cameras/${cameraId}/capabilities`);
}

/**
 * Executa o probe de capacidades da câmera via gateway.
 * Aguarda o resultado (pode levar até ~120s em câmeras lentas).
 */
export async function probeCameraCapabilities(
  cameraId: string,
): Promise<ProbeCapabilitiesResult> {
  const data = await apiPost<
    | ({ success: true } & ProbeCapabilitiesResult)
    | { success: false; error?: string }
  >(`/cftv/cameras/${cameraId}/probe-capabilities`, {});
  if (!data.success) {
    throw new Error((data as { error?: string }).error ?? 'Erro desconhecido no probe de capacidades.');
  }
  return data as ProbeCapabilitiesResult;
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

// ─── Switches gerenciáveis (SNMP IF-MIB) ─────────────────────────────────────

/** Ponto escalar de um switch (STATUS, UPTIME, CPU). */
export interface SwitchScalarPoint {
  id: string;
  tag: string;
  objectName: string;
  metric: string;
  oid: string | null;
  unsupported: boolean;
  unit: string;
  critical?: boolean;
  lastValue: number | null;
  lastValueAt: string | null;
  lastValueState: string | null;
}

/** Referência a um ponto de porta embutida na resposta do switch. */
export interface SwitchPortPoint {
  id: string;
  tag: string;
  objectName: string;
  lastValue: number | null;
  lastValueAt: string | null;
}

/** Porta sincronizada de um switch (agrupamento dos 3 pontos por ifIndex). */
export interface SwitchPortEntry {
  ifIndex: number;
  statePoint: SwitchPortPoint | null;
  inPoint: SwitchPortPoint | null;
  outPoint: SwitchPortPoint | null;
}

/** Switch gerenciável (Device monitoredDeviceType='SWITCH'). */
export interface ManagedSwitch {
  id: string;
  name: string;
  ip: string;
  port: number;
  /** Sempre 'snmp' — discriminador para excluir de isCameraDevice. */
  protocol: 'snmp';
  /** Discriminador SWITCH — distingue de câmeras SNMP. */
  monitoredDeviceType: 'SWITCH';
  snmpVersion: '1' | '2c';
  community: string;
  pollingInterval: number;
  manufacturer: string | null;
  profileId: string | null;
  profileLabel: string;
  profileSource: 'detected' | 'manual' | 'generic';
  profileOverrides: Record<string, string> | null;
  site: string;
  siteId: string | null;
  tenantId: string;
  gatewayId: string | null;
  gatewayOnline: boolean | null;
  status: 'online' | 'offline';
  critical?: boolean;
  lastCommunication: string | null;
  /** Pontos escalares: STATUS, UPTIME, CPU. */
  points: SwitchScalarPoint[];
  /** Portas sincronizadas (vazio até o primeiro sync). */
  ports: SwitchPortEntry[];
}

/** Payload de criação/edição de switch. */
export interface SwitchInput {
  name?: string;
  ip?: string;
  port?: number;
  snmpVersion?: '1' | '2c';
  community?: string;
  pollingInterval?: number;
  siteId?: string;
  tenantId?: string;
  gatewayId?: string;
}

/** Porta descoberta pelo scan IF-MIB (resultado do sync). */
export interface DiscoveredPort {
  ifIndex: number;
  ifDescr: string;
  ifAlias: string | null;
  ifType: number | null;
  /** Velocidade máxima em Mbps (ifHighSpeed). null se não disponível. */
  ifHighSpeed: number | null;
  /** 1 = up, 2 = down. */
  ifOperStatus: number;
  existsInDb: boolean;
}

/** Resultado da sincronização de portas. */
export interface SwitchSyncResult {
  added: number;
  updated: number;
  removed: number[];
  sysDescr: string | null;
  ports: DiscoveredPort[];
}

export async function getSwitches(tenantId?: string): Promise<ManagedSwitch[]> {
  return apiGet<ManagedSwitch[]>(`/cftv/switches${tenantId ? `?tenantId=${tenantId}` : ''}`);
}

export async function createSwitch(data: SwitchInput): Promise<ManagedSwitch> {
  return apiPost<ManagedSwitch>('/cftv/switches', data);
}

export async function updateSwitch(id: string, data: SwitchInput): Promise<ManagedSwitch> {
  return apiPatch<ManagedSwitch>(`/cftv/switches/${id}`, data);
}

export async function deleteSwitch(id: string, confirmationToken: string): Promise<void> {
  await apiDelete(`/cftv/switches/${id}`, { headers: sensitiveActionHeaders(confirmationToken) });
}

export async function syncSwitchPorts(id: string): Promise<SwitchSyncResult> {
  const data = await apiPost<{ success: boolean; error?: string } & Partial<SwitchSyncResult>>(
    `/cftv/switches/${id}/sync-ports`,
    {},
  );
  if (!data.success) throw new Error(data.error ?? 'Erro ao sincronizar portas.');
  return {
    added: data.added ?? 0,
    updated: data.updated ?? 0,
    removed: data.removed ?? [],
    sysDescr: data.sysDescr ?? null,
    ports: data.ports ?? [],
  };
}

export async function deleteSwitchPort(
  id: string,
  ifIndex: number,
  confirmationToken: string,
): Promise<void> {
  await apiDelete(`/cftv/switches/${id}/ports/${ifIndex}`, {
    headers: sensitiveActionHeaders(confirmationToken),
  });
}

export async function probeSwitchCapabilities(id: string): Promise<ProbeCapabilitiesResult> {
  const data = await apiPost<
    | ({ success: true } & ProbeCapabilitiesResult)
    | { success: false; error?: string }
  >(`/cftv/switches/${id}/probe-capabilities`, {});
  if (!data.success) {
    throw new Error((data as { error?: string }).error ?? 'Erro desconhecido no probe.');
  }
  return data as ProbeCapabilitiesResult;
}

export async function getSwitchCapabilities(id: string): Promise<MetricCapability[]> {
  return apiGet<MetricCapability[]>(`/cftv/switches/${id}/capabilities`);
}

// ─── NVRs/DVRs gerenciáveis (SNMP) ───────────────────────────────────────────

/** Ponto escalar de um NVR (STATUS, UPTIME, CPU, etc.). */
export interface NvrScalarPoint {
  id: string;
  tag: string;
  objectName: string;
  metric: string;
  oid: string | null;
  unsupported: boolean;
  unit: string;
  critical?: boolean;
  lastValue: number | null;
  lastValueAt: string | null;
  lastValueState: string | null;
}

/** Ponto de status de disco. */
export interface NvrDiskStatusPoint {
  id: string;
  tag: string;
  lastValue: number | null;
  statusLabel: string | null;
}

/** Ponto de capacidade do disco. */
export interface NvrDiskCapPoint {
  id: string;
  tag: string;
  lastValue: number | null;
}

/** Entrada de disco sincronizada (slot com status + capacidade + espaço usado). */
export interface NvrDiskEntry {
  slotIndex: number;
  statusPoint: NvrDiskStatusPoint | null;
  capPoint: NvrDiskCapPoint | null;
  usedPoint: NvrDiskCapPoint | null;
}

/** Canal de gravação sincronizado. */
export interface NvrChannelEntry {
  channelIndex: number;
  pointId: string;
  lastValue: number | null;
  statusLabel: string | null;
}

/** NVR/DVR gerenciável (Device monitoredDeviceType='NVR'). */
export interface ManagedNvr {
  id: string;
  name: string;
  ip: string;
  port: number;
  protocol: 'snmp';
  monitoredDeviceType: 'NVR';
  snmpVersion: '1' | '2c';
  community: string;
  pollingInterval: number;
  manufacturer: string | null;
  profileId: string | null;
  profileLabel: string;
  profileSource: 'detected' | 'manual' | 'generic';
  profileOverrides: Record<string, string> | null;
  site: string;
  siteId: string | null;
  tenantId: string;
  gatewayId: string | null;
  gatewayOnline: boolean | null;
  status: 'online' | 'offline';
  critical?: boolean;
  lastCommunication: string | null;
  /** Pontos escalares: STATUS, UPTIME, CPU, MEMORIA, TEMPERATURA. */
  points: NvrScalarPoint[];
  /** Discos sincronizados (vazio até o primeiro sync). */
  disks: NvrDiskEntry[];
  /** Canais de gravação sincronizados (vazio até o primeiro sync). */
  channels: NvrChannelEntry[];
}

/** Payload de criação/edição de NVR. */
export interface NvrInput {
  name?: string;
  ip?: string;
  port?: number;
  snmpVersion?: '1' | '2c';
  community?: string;
  pollingInterval?: number;
  siteId?: string;
  tenantId?: string;
  gatewayId?: string;
  manufacturer?: string | null;
}

/** Disco descoberto na resposta do sync. */
export interface NvrSyncDisk {
  slotIndex: number;
  status: number | null;
  statusLabel: string | null;
  capacityGb: number | null;
  usedGb: number | null;
}

/** Canal descoberto na resposta do sync. */
export interface NvrSyncChannel {
  channelIndex: number;
  status: number | null;
  statusLabel: string | null;
}

/** Resultado da sincronização de discos/canais. */
export interface NvrSyncResult {
  added: number;
  updatedDisks: number;
  updatedChannels: number;
  sysDescr: string | null;
  disks: NvrSyncDisk[];
  channels: NvrSyncChannel[];
}

export async function getNvrs(tenantId?: string): Promise<ManagedNvr[]> {
  return apiGet<ManagedNvr[]>(`/cftv/nvrs${tenantId ? `?tenantId=${tenantId}` : ''}`);
}

export async function getNvr(id: string): Promise<ManagedNvr> {
  return apiGet<ManagedNvr>(`/cftv/nvrs/${id}`);
}

export async function createNvr(data: NvrInput): Promise<ManagedNvr> {
  return apiPost<ManagedNvr>('/cftv/nvrs', data);
}

export async function updateNvr(id: string, data: NvrInput): Promise<ManagedNvr> {
  return apiPatch<ManagedNvr>(`/cftv/nvrs/${id}`, data);
}

export async function deleteNvr(id: string, confirmationToken: string): Promise<void> {
  await apiDelete(`/cftv/nvrs/${id}`, { headers: sensitiveActionHeaders(confirmationToken) });
}

export async function syncNvrDisks(id: string): Promise<NvrSyncResult> {
  const data = await apiPost<{ success: boolean; error?: string } & Partial<NvrSyncResult>>(
    `/cftv/nvrs/${id}/sync-disks`,
    {},
  );
  if (!data.success) throw new Error(data.error ?? 'Erro ao sincronizar discos/canais.');
  return {
    added: data.added ?? 0,
    updatedDisks: data.updatedDisks ?? 0,
    updatedChannels: data.updatedChannels ?? 0,
    sysDescr: data.sysDescr ?? null,
    disks: data.disks ?? [],
    channels: data.channels ?? [],
  };
}

export async function probeNvrCapabilities(id: string): Promise<ProbeCapabilitiesResult> {
  const data = await apiPost<
    | ({ success: true } & ProbeCapabilitiesResult)
    | { success: false; error?: string }
  >(`/cftv/nvrs/${id}/probe-capabilities`, {});
  if (!data.success) {
    throw new Error((data as { error?: string }).error ?? 'Erro desconhecido no probe.');
  }
  return data as ProbeCapabilitiesResult;
}

export async function getNvrCapabilities(id: string): Promise<MetricCapability[]> {
  return apiGet<MetricCapability[]>(`/cftv/nvrs/${id}/capabilities`);
}

// ─── Visualização ao vivo (câmeras ONVIF) ────────────────────────────────────

/** Resposta do start da sessão de visualização ao vivo. */
export interface LiveViewSessionInfo {
  sessionId: string;
  /** Janela de expiração sem keep-alive (ms). */
  ttlMs: number;
  /** Cadência de renovação sugerida pelo backend (ms). */
  keepAliveIntervalMs: number;
}

/**
 * Inicia uma sessão de visualização ao vivo (frames JPEG via socket
 * /telemetry, evento `camera:frame`). UMA sessão por operador — um segundo
 * start substitui a anterior.
 */
export async function startLiveView(
  cameraId: string,
  tenantId?: string,
): Promise<LiveViewSessionInfo> {
  return apiPost<LiveViewSessionInfo>(
    `/cftv/cameras/${cameraId}/live-view`,
    tenantId ? { tenantId } : {},
  );
}

/** Renova a sessão ao vivo (espectador ainda presente). */
export async function keepAliveLiveView(sessionId: string): Promise<{ ttlMs: number }> {
  return apiPost<{ ttlMs: number }>(`/cftv/live-view/${sessionId}/keepalive`);
}

/** Encerra a sessão ao vivo explicitamente (fechamento do modal). */
export async function stopLiveView(sessionId: string): Promise<void> {
  await apiDelete(`/cftv/live-view/${sessionId}`);
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
