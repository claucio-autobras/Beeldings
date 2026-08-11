import { apiGet, apiPost, apiPatch, apiDelete, sensitiveActionHeaders } from '@/lib/api-client';
import type {
  DiagMetric,
  DiagnoseCandidate,
  DiagnoseMetricResult,
  DiagnoseWalkSection,
  SnmpDiagnoseOutcome,
  SnmpDiagnoseProgress,
  SnmpUnreachableCause,
  MonitoringProfile,
} from '@/modules/cftv/services/cftv.service';

// Re-export shared types to avoid duplication
export type {
  DiagMetric,
  DiagnoseCandidate,
  DiagnoseMetricResult,
  DiagnoseWalkSection,
  SnmpDiagnoseOutcome,
  SnmpDiagnoseProgress,
  SnmpUnreachableCause,
  MonitoringProfile,
};

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Métricas de saúde monitoradas via SNMP numa controladora. */
export type AcHealthMetric =
  | 'cpu'
  | 'memory'
  | 'ram_total'
  | 'temperature'
  | 'packet_loss';

/** Ponto de saúde de uma controladora de acesso (SNMP). */
export interface ControllerPoint {
  id: string;
  tag: string;
  objectName: string;
  metric: string;
  oid: string | null;
  /** OID comprovadamente inexistente (último diagnóstico SNMP). */
  unsupported?: boolean;
  /** Ponto marcado como ativo crítico. */
  critical?: boolean;
  unit: string;
  /** Último valor persistido (seed antes da telemetria ao vivo). */
  lastValue: number | null;
  lastValueAt: string | null;
  lastValueState: string | null;
}

/** Perfil de OIDs por fabricante (catálogo do backend). */
export interface AcOidProfile {
  id: string;
  label: string;
  oids: Partial<Record<AcHealthMetric, { oid: string; scale: number; unit: string }>>;
}

/** Controladora de acesso (Device protocol 'snmp', monitoredDeviceType 'ACCESS_CONTROLLER'). */
export interface Controller {
  id: string;
  name: string;
  protocol: 'snmp';
  /** Ativo crítico. */
  critical?: boolean;
  site: string;
  siteId: string | null;
  tenantId: string;
  gatewayId: string | null;
  gatewayOnline: boolean | null;
  ip: string;
  port: number;
  snmpVersion: '1' | '2c';
  community: string;
  pollingInterval: number;
  manufacturer: string | null;
  status: 'online' | 'offline';
  lastCommunication: string | null;
  points: ControllerPoint[];
  profileId: string | null;
  profileLabel: string;
  profileSource: 'detected' | 'manual' | 'generic';
  profileOverrides: Record<string, string> | null;
}

/** Payload de criação/edição de controladora. */
export interface ControllerInput {
  name?: string;
  siteId?: string;
  tenantId?: string;
  gatewayId?: string;
  ip?: string;
  port?: number;
  snmpVersion?: '1' | '2c';
  community?: string;
  pollingInterval?: number;
  manufacturer?: string | null;
  /** Overrides manuais de OID por ponto. */
  healthOids?: Partial<Record<DiagMetric, string>>;
  profileId?: string | null;
  profileOverrides?: Record<string, string> | null;
}

/** Resultado do teste SNMP. */
export interface SnmpTestOutcome {
  reachable: boolean;
  values: Partial<Record<AcHealthMetric, number | null>>;
  oids: Partial<Record<AcHealthMetric, string>>;
}

/** Resultado de capacidade de uma métrica. */
export interface MetricCapability {
  metricKey: string;
  state: 'SUPPORTED' | 'UNSUPPORTED' | 'TEMPORARY_ERROR' | 'NO_PERMISSION';
  probeValue: number | null;
  profileId: string | null;
  profileLayer: 'base' | 'vendor' | 'override' | null;
  lastProbeAt: string;
}

/** Mapa de capacidades da controladora. */
export interface ControllerCapabilities {
  profileId: string | null;
  profileLabel: string;
  profileSource: 'detected' | 'manual' | 'generic';
  profileOverrides: Record<string, string> | null;
  capabilities: MetricCapability[];
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

// ─── API ─────────────────────────────────────────────────────────────────────

export async function getControllers(tenantId?: string): Promise<Controller[]> {
  return apiGet<Controller[]>(`/sca/controllers${tenantId ? `?tenantId=${tenantId}` : ''}`);
}

export async function createController(data: ControllerInput): Promise<Controller> {
  return apiPost<Controller>('/sca/controllers', data);
}

export async function updateController(id: string, data: ControllerInput): Promise<Controller> {
  return apiPatch<Controller>(`/sca/controllers/${id}`, data);
}

/** Exclusão crítica: exige o token de confirmação de senha do operador. */
export async function deleteController(id: string, confirmationToken: string): Promise<void> {
  await apiDelete(`/sca/controllers/${id}`, {
    headers: sensitiveActionHeaders(confirmationToken),
  });
}

/** Lista os perfis de monitoramento disponíveis para ACCESS_CONTROLLER. */
export async function getMonitoringProfiles(): Promise<MonitoringProfile[]> {
  return apiGet<MonitoringProfile[]>('/sca/profiles?deviceType=ACCESS_CONTROLLER');
}

/** Catálogo de perfis de OIDs por fabricante. */
export async function getAcOidProfiles(): Promise<AcOidProfile[]> {
  return apiGet<AcOidProfile[]>('/sca/oid-profiles');
}

/** Lê o mapa de capacidades da controladora. */
export async function getControllerCapabilities(
  controllerId: string,
): Promise<ControllerCapabilities> {
  return apiGet<ControllerCapabilities>(`/sca/controllers/${controllerId}/capabilities`);
}

/** Executa o probe de capacidades via gateway. */
export async function probeControllerCapabilities(
  controllerId: string,
): Promise<ProbeCapabilitiesResult> {
  const data = await apiPost<
    | ({ success: true } & ProbeCapabilitiesResult)
    | { success: false; error?: string }
  >(`/sca/controllers/${controllerId}/probe-capabilities`, {});
  if (!data.success) {
    throw new Error((data as { error?: string }).error ?? 'Erro desconhecido no probe.');
  }
  return data as ProbeCapabilitiesResult;
}

/**
 * Testa o SNMP de uma controladora via gateway e pré-visualiza os valores.
 */
export async function testControllerSnmp(params: {
  tenantId: string;
  gatewayId: string;
  ip: string;
  port?: number;
  snmpVersion?: '1' | '2c';
  community?: string;
  manufacturer?: string | null;
  oids?: Partial<Record<AcHealthMetric, string>>;
}): Promise<SnmpTestOutcome> {
  const data = await apiPost<{
    success: boolean;
    error?: string;
    reachable?: boolean;
    values?: Partial<Record<AcHealthMetric, number | null>>;
    oids?: Partial<Record<AcHealthMetric, string>>;
  }>('/sca/test-snmp', params);
  if (!data.success) {
    throw new Error(data.error ?? 'Erro desconhecido ao testar o SNMP.');
  }
  return {
    reachable: Boolean(data.reachable),
    values: data.values ?? {},
    oids: data.oids ?? {},
  };
}

/**
 * Roda o diagnóstico SNMP da controladora via gateway.
 */
export async function diagnoseControllerSnmp(
  controllerId: string,
  diagnoseId?: string,
): Promise<SnmpDiagnoseOutcome> {
  const data = await apiPost<
    | ({ success: true } & SnmpDiagnoseOutcome)
    | { success: false; error?: string }
  >(`/sca/controllers/${controllerId}/diagnose-snmp`, { diagnoseId });
  if (!data.success) {
    throw new Error(data.error ?? 'Erro desconhecido no diagnóstico SNMP.');
  }
  return data;
}

/** Progresso parcial do diagnóstico (polling). */
export async function getDiagnoseProgress(
  diagnoseId: string,
): Promise<SnmpDiagnoseProgress | null> {
  const data = await apiGet<Partial<SnmpDiagnoseProgress> & { unknown?: true }>(
    `/sca/diagnose/${diagnoseId}/progress`,
  );
  if (data.unknown) return null;
  return {
    phase: data.phase === 'walk' ? 'walk' : 'oids',
    tested: data.tested ?? 0,
    total: data.total ?? 0,
    done: data.done ?? false,
  };
}

/** Aplica OIDs sugeridos pelo diagnóstico. */
export async function applySnmpOids(
  controllerId: string,
  oids: Partial<Record<DiagMetric, string>>,
): Promise<Controller> {
  return apiPost<Controller>(`/sca/controllers/${controllerId}/apply-snmp-oids`, { oids });
}
