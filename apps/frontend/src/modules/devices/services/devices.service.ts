import type {
  BACnetDevice,
  BACnetPoint,
  BacnetDiscoverySource,
  Device,
  DiscoveredBACnetPoint,
  DiscoveredBacnetDevice,
  DiscoveredModbusPoint,
  ModbusDevice,
  ModbusPoint,
  MqttDevice,
  MqttPoint,
  MqttValueType,
  MqttWriteConfig,
} from '../types/device.types';

export type {
  BACnetDevice,
  BACnetPoint,
  BacnetDiscoverySource,
  Device,
  DiscoveredBACnetPoint,
  DiscoveredBacnetDevice,
  DiscoveredModbusPoint,
  ModbusDevice,
  ModbusPoint,
  MqttDevice,
  MqttPoint,
};

/** Ponto MQTT novo (sem campos derivados). */
export type NewMqttPoint = Omit<MqttPoint, 'id' | 'value' | 'status' | 'lastUpdate'>;

/** Amostra de payload capturada num tópico MQTT. */
export interface MqttSample {
  topic: string;
  payload: string;
  receivedAt: string;
}

import { apiGet, apiPost, apiPatch, apiDelete, sensitiveActionHeaders } from '@/lib/api-client';
import { translateDeviceError } from '@/modules/devices/utils/device-errors';

// ─── Listagem ─────────────────────────────────────────────────────────────────

export async function getDevices(tenantId?: string): Promise<Device[]> {
  return apiGet<Device[]>(`/devices${tenantId ? `?tenantId=${tenantId}` : ''}`);
}

// ─── Heartbeat — diagnóstico do dispositivo MQTT ─────────────────────────────

/** Diagnóstico do último heartbeat de um dispositivo MQTT (memória + cópia durável). */
export interface DeviceHeartbeatDiag {
  receivedAt: string;
  timeoutSeconds: number | null;
  rssi: number | null;
  ip: string | null;
  uptimeSeconds: number | null;
}

export async function getDeviceHeartbeat(deviceId: string): Promise<DeviceHeartbeatDiag | null> {
  const data = await apiGet<{ heartbeat: DeviceHeartbeatDiag | null }>(`/devices/${deviceId}/heartbeat`);
  return data.heartbeat ?? null;
}

// ─── BACnet — scan de rede (Who-Is broadcast) ────────────────────────────────

/**
 * Dispara um scan de rede BACnet no gateway informado (varredura unicast).
 * Retorna a lista de controladoras encontradas (IP, instance, fabricante/modelo)
 * para que o usuário escolha qual deseja adicionar.
 *
 * Pode levar até ~1 min — o gateway lê o Device Object de cada IP das subredes
 * locais (descobre inclusive controladoras que não respondem a Who-Is, como a
 * MCP46D).
 */
export async function scanBacnetNetwork(params: {
  tenantId: string;
  gatewayId: string;
}): Promise<DiscoveredBacnetDevice[]> {
  if (!params.tenantId || !params.gatewayId) {
    throw new Error('Selecione um site/local antes de escanear a rede.');
  }

  const data = await apiPost<{
    success: boolean;
    error?: string;
    devices?: DiscoveredBacnetDevice[];
  }>('/devices/scan-bacnet', params);

  if (!data.success) {
    throw new Error(data.error ?? 'Erro desconhecido ao escanear a rede.');
  }

  return data.devices ?? [];
}

// ─── BACnet — discovery de pontos ────────────────────────────────────────────

/** Resultado do discovery de pontos — inclui metadados de origem/rota. */
export interface BacnetDiscoveryOutcome {
  points: DiscoveredBACnetPoint[];
  /** Como o gateway enumerou os objetos (objectList = lista exata; scan = varredura heurística) */
  discoverySource?: BacnetDiscoverySource;
  /** Instância BACnet efetiva do device (resolvida via Who-Is quando não informada) */
  deviceInstance?: number | null;
  /** Rota BACnet (device MS/TP atrás de roteador) capturada do I-Am */
  net?: number | null;
  adr?: number[] | null;
}

export async function discoverBACnetPoints(_params: {
  ip: string;
  port: number;
  deviceInstance?: number;
  /** Rota BACnet conhecida (ex.: vinda do scan de rede) */
  net?: number | null;
  adr?: number[] | null;
  tenantId: string;
  gatewayId: string;
}): Promise<BacnetDiscoveryOutcome> {
  if (!_params.tenantId || !_params.gatewayId) {
    throw new Error('Selecione um site/local antes de buscar os pontos.');
  }
  const data = await apiPost<{
    success: boolean;
    error?: string;
    discoverySource?: BacnetDiscoverySource;
    deviceInstance?: number | null;
    net?: number | null;
    adr?: number[] | null;
    objects?: Array<{
      objectType: number | string;
      objectInstance?: number;
      instance?: number;
      objectName?: string;
      unnamed?: boolean;
      unit?: string | null;
      unitCode?: number | null;
    }>;
  }>('/devices/discover-bacnet', _params);
  if (!data.success) {
    throw new Error(data.error ?? 'Erro desconhecido ao conectar ao dispositivo.');
  }

  const LABEL: Record<number, string> = {
    0: 'AI', 1: 'AO', 2: 'AV', 3: 'BI', 4: 'BO', 5: 'BV', 13: 'MSI', 14: 'MSO',
    19: 'MSV', 23: 'ACC', 24: 'PC', 40: 'CSV', 45: 'IV', 46: 'LAV', 48: 'PIV',
  };

  const points = (data.objects ?? []).map((o) => {
    const typeLabel = typeof o.objectType === 'number'
      ? (LABEL[o.objectType] ?? String(o.objectType))
      : String(o.objectType);
    const inst = o.objectInstance ?? o.instance ?? 0;
    const name = o.objectName?.trim() || `${typeLabel}-${inst}`;
    return {
      objectType: typeLabel as DiscoveredBACnetPoint['objectType'],
      instance:   inst,
      objectName: name,
      unnamed:    o.unnamed ?? !o.objectName?.trim(),
      tag:        toTagName(name),
      value:      false as boolean,
      unit:       o.unit ?? '',
    } satisfies DiscoveredBACnetPoint;
  });

  return {
    points,
    discoverySource: data.discoverySource,
    deviceInstance: data.deviceInstance ?? null,
    net: data.net ?? null,
    adr: data.adr ?? null,
  };
}

// ─── BACnet — criar dispositivo com pontos selecionados ──────────────────────

export async function createBACnetDevice(
  data: Omit<BACnetDevice, 'id' | 'status' | 'lastCommunication' | 'points'> & {
    selectedPoints: DiscoveredBACnetPoint[];
    /** Rota BACnet (device MS/TP atrás de roteador) — persistida em Device.config */
    net?: number | null;
    adr?: number[] | null;
  },
): Promise<BACnetDevice> {
  return apiPost<BACnetDevice>('/devices/bacnet', data);
}

// ─── Modbus — teste de conexão ───────────────────────────────────────────────

/**
 * Valida a comunicação Modbus TCP com o equipamento via gateway, antes de
 * liberar o cadastro de registradores (Modbus não tem discovery). Lança erro
 * com mensagem amigável se o gateway não conseguir conectar.
 */
export async function testModbusConnection(params: {
  tenantId: string;
  gatewayId: string;
  /** 'tcp' (rede) ou 'rtu' (serial RS485). Ausente = TCP. */
  connectionType?: 'tcp' | 'rtu';
  ip?: string;
  port?: number;
  unitId: number;
  /** Parâmetros da porta serial — obrigatório no modo RTU. */
  serial?: import('../types/device.types').ModbusSerialConfig;
}): Promise<void> {
  if (!params.tenantId || !params.gatewayId) {
    throw new Error('Selecione o cliente e o projeto (gateway) antes de testar a conexão.');
  }

  const data = await apiPost<{ success: boolean; error?: string }>(
    '/devices/modbus/test-connection',
    params,
  );

  if (!data.success) {
    throw new Error(data.error ?? 'Não foi possível conectar ao equipamento.');
  }
}

// ─── Modbus — criar dispositivo com pontos selecionados ──────────────────────

export async function createModbusDeviceWithPoints(
  data: Omit<ModbusDevice, 'id' | 'status' | 'lastCommunication' | 'points'> & {
    selectedPoints: DiscoveredModbusPoint[];
  },
): Promise<ModbusDevice> {
  return apiPost<ModbusDevice>('/devices/modbus', data);
}

// ─── Modbus — adicionar ponto(s) manualmente ─────────────────────────────────

/**
 * Adiciona um registrador Modbus ao dispositivo (cadastro manual — Modbus não
 * tem discovery) e retorna o dispositivo atualizado com a lista completa de pontos.
 */
export async function addModbusPoint(
  deviceId: string,
  point: Omit<ModbusPoint, 'id' | 'value' | 'status' | 'lastUpdate'>,
): Promise<ModbusDevice> {
  return apiPost<ModbusDevice>(`/devices/${deviceId}/points`, { points: [point] });
}

/**
 * Atualiza a configuração técnica de um ponto Modbus (tag, nome, registrador,
 * tipo de registro, tipo de dado, escala, offset, unidade e limites esperados).
 * O backend valida (registrador inteiro único, escala não nula), atualiza o
 * MESMO registro (o id preserva trends/alarmes/favoritos) e republica a config
 * retida do device para o gateway passar a ler o novo registrador sem reinício.
 */
export async function updateModbusPoint(
  deviceId: string,
  pointId: string,
  data: {
    tag: string;
    objectName: string;
    register: number;
    registerType: string;
    dataType: string;
    scale: number;
    offset: number;
    unit: string;
    minExpected: number | null;
    maxExpected: number | null;
  },
): Promise<{ id: string; tag: string; objectName: string }> {
  return apiPatch<{ id: string; tag: string; objectName: string }>(
    `/devices/${deviceId}/points/${pointId}`,
    data,
  );
}

/**
 * Exclui um único ponto Modbus do dispositivo. O backend remove trends/regras
 * de alarme associados em cascata e republica a config de polling ao gateway.
 */
export async function deleteModbusPoint(deviceId: string, pointId: string): Promise<void> {
  await apiDelete(`/devices/${deviceId}/points/${pointId}`);
}

/**
 * Exclui um único ponto BACnet do dispositivo. Reutiliza a mesma rota genérica
 * de exclusão de ponto: o backend remove trends/regras de alarme em cascata e
 * republica a config de polling ao gateway (que para de ler o ponto).
 */
export async function deleteBACnetPoint(deviceId: string, pointId: string): Promise<void> {
  await apiDelete(`/devices/${deviceId}/points/${pointId}`);
}

/**
 * Renomeia apenas o nome de exibição (objectName) de um ponto — a tag permanece
 * imutável (é a chave de casamento da telemetria/alarmes). Não republica a config
 * ao gateway (o polling é por tag/objeto). Retorna o ponto atualizado.
 */
export async function renameDevicePoint(
  deviceId: string,
  pointId: string,
  objectName: string,
): Promise<{ id: string; objectName: string; tag: string }> {
  return apiPatch<{ id: string; objectName: string; tag: string }>(
    `/devices/${deviceId}/points/${pointId}`,
    { objectName },
  );
}

// ─── Ativos críticos ─────────────────────────────────────────────────────────

/** Marca/desmarca um dispositivo como ativo crítico (card do dashboard). */
export async function setDeviceCritical(deviceId: string, critical: boolean): Promise<void> {
  await apiPatch(`/devices/${deviceId}`, { critical });
}

/** Papel operacional de um ponto (contexto p/ card Ativos Críticos e IA). */
export type PointOpRole = 'status' | 'fault' | 'mode' | 'setpoint' | null;

/**
 * Define o papel operacional do ponto (Status/Falha/Modo/Setpoint/nenhum).
 * 'status' = ligado/desligado no card Ativos Críticos (com tempo de
 * funcionamento); 'fault' = valor ativo (≥0,5) mostra o item como "Em falha"
 * mesmo sem regra de alarme; 'mode'/'setpoint' = contexto para a IA.
 */
export async function setPointOpRole(
  deviceId: string,
  pointId: string,
  opRole: PointOpRole,
): Promise<void> {
  await apiPatch(`/devices/${deviceId}/points/${pointId}`, { opRole });
}

/** Marca/desmarca um ponto como ativo crítico (card do dashboard). */
export async function setPointCritical(
  deviceId: string,
  pointId: string,
  critical: boolean,
): Promise<void> {
  await apiPatch(`/devices/${deviceId}/points/${pointId}`, { critical });
}

// ─── MQTT — captura de amostra de payload ────────────────────────────────────

/**
 * Pede ao gateway para escutar um tópico MQTT-nativo por alguns segundos e
 * devolver uma amostra do payload — para o usuário ver a estrutura e escolher
 * o jsonPath. Lança erro com mensagem amigável se o gateway não responder.
 */
export async function sampleMqttTopic(params: {
  tenantId: string;
  gatewayId: string;
  topic: string;
  /** Tópico raiz próprio do equipamento (modo sem prefixo) — relaxa a validação de escopo. */
  rootTopic?: string;
}): Promise<MqttSample[]> {
  if (!params.tenantId || !params.gatewayId) {
    throw new Error('Selecione o cliente e o projeto (gateway) antes de capturar a amostra.');
  }
  const data = await apiPost<{ success: boolean; error?: string; samples?: MqttSample[] }>(
    '/devices/mqtt/sample-topic',
    params,
  );
  if (!data.success) {
    throw new Error(data.error ?? 'Não foi possível capturar amostra do tópico.');
  }
  return data.samples ?? [];
}

// ─── MQTT — credencial do sensor (publish-only) ──────────────────────────────

export interface MqttSensorCredential {
  username: string;
  password: string;
  broker: string | null;
  topicPrefix: string;
}

/**
 * Garante e retorna a credencial MQTT dedicada que o EQUIPAMENTO deve usar para
 * publicar (escopada por ACL nos tópicos de sensores do gateway). Cria sob demanda.
 */
export async function ensureMqttSensorCredential(params: {
  tenantId: string;
  gatewayId: string;
}): Promise<MqttSensorCredential> {
  return apiPost<MqttSensorCredential>('/devices/mqtt/sensor-credential', params);
}

// ─── MQTT — criar dispositivo com pontos ─────────────────────────────────────

export async function createMqttDeviceWithPoints(
  data: Omit<MqttDevice, 'id' | 'status' | 'lastCommunication' | 'points' | 'mqttConfig'> & {
    selectedPoints: NewMqttPoint[];
    /** 'root' = equipamento sem suporte a prefixo, publica no próprio namespace raiz. */
    topicMode?: 'prefix' | 'root';
    rootTopic?: string;
    heartbeatTopic?: string | null;
    heartbeatTimeoutSeconds?: number | null;
  },
): Promise<MqttDevice> {
  return apiPost<MqttDevice>('/devices/mqtt', data);
}

// ─── MQTT — adicionar ponto manualmente ──────────────────────────────────────

export async function addMqttPoint(
  deviceId: string,
  point: NewMqttPoint,
): Promise<MqttDevice> {
  return apiPost<MqttDevice>(`/devices/${deviceId}/points`, { points: [point] });
}

// ─── MQTT — editar/excluir ponto ─────────────────────────────────────────────

/**
 * Atualiza a configuração técnica de um ponto MQTT (tag, tópico, jsonPath,
 * tipo, unidade e binding de escrita). O backend valida (tag única, template
 * com {{value}}, tópicos sob o namespace do gateway) e republica a config
 * retida do device para o gateway aplicar sem reinício manual.
 */
export async function updateMqttPoint(
  deviceId: string,
  pointId: string,
  data: {
    tag: string;
    objectName: string;
    sourceTopic: string;
    jsonPath: string;
    valueType: MqttValueType;
    unit: string;
    write: MqttWriteConfig | null;
  },
): Promise<{ id: string; tag: string; objectName: string }> {
  return apiPatch<{ id: string; tag: string; objectName: string }>(
    `/devices/${deviceId}/points/${pointId}`,
    data,
  );
}

/**
 * Exclui um único ponto MQTT do dispositivo (mesma rota genérica das telas
 * BACnet/Modbus): remove trends/alarmes em cascata e republica a config ao gateway.
 */
export async function deleteMqttPoint(deviceId: string, pointId: string): Promise<void> {
  await apiDelete(`/devices/${deviceId}/points/${pointId}`);
}

// ─── MQTT — atualizar dispositivo (nome) ─────────────────────────────────────

export async function updateMqttDevice(
  deviceId: string,
  data: {
    name: string;
    /** Tópico de presença/heartbeat (null limpa). */
    heartbeatTopic?: string | null;
    heartbeatTimeoutSeconds?: number | null;
  },
): Promise<MqttDevice> {
  return apiPatch<MqttDevice>(`/devices/${deviceId}`, data);
}

// ─── BACnet — sincronizar pontos com a controladora ──────────────────────────

export interface SyncBACnetResult {
  /** Pontos já cadastrados no dispositivo */
  existing: BACnetPoint[];
  /** Total de pontos encontrados na controladora agora */
  foundCount: number;
  /** Pontos novos (encontrados na controladora mas não cadastrados) */
  newPoints: DiscoveredBACnetPoint[];
  /** Pontos cadastrados que NÃO existem mais na controladora (serão removidos no replace) */
  removedPoints: BACnetPoint[];
  /** Conjunto completo descoberto agora — fonte de verdade para "Atualizar todos os pontos" */
  discovered: DiscoveredBACnetPoint[];
  /** Como o gateway enumerou os objetos (objectList = lista exata; scan = varredura heurística) */
  discoverySource?: BacnetDiscoverySource;
}

/**
 * Executa um novo discovery na controladora e compara com os pontos já cadastrados.
 * Retorna os novos pontos encontrados sem duplicar o que já existe.
 */
export async function syncBACnetPoints(
  device: BACnetDevice,
  gatewayId?: string,
): Promise<SyncBACnetResult> {
  const effectiveGatewayId = gatewayId ?? device.gatewayId;
  if (!effectiveGatewayId) {
    throw new Error('gatewayId não disponível para este dispositivo. Recadastre o dispositivo para corrigir.');
  }
  const outcome = await discoverBACnetPoints({
    ip: device.ip,
    port: device.port,
    deviceInstance: device.deviceInstance,
    tenantId: device.tenantId,
    gatewayId: effectiveGatewayId,
  });
  const discovered = outcome.points;

  const existingKeys = new Set(
    device.points.map((p) => `${String(p.objectType)}:${p.instance}`)
  );

  const newPoints = discovered.filter(
    (dp) => !existingKeys.has(`${String(dp.objectType)}:${dp.instance}`)
  );

  // Pontos salvos cujo par objectType:instance não voltou no discovery — não
  // existem mais na controladora e devem sair da lista ao atualizar.
  const discoveredKeys = new Set(
    discovered.map((dp) => `${String(dp.objectType)}:${dp.instance}`)
  );
  const removedPoints = device.points.filter(
    (p) => !discoveredKeys.has(`${String(p.objectType)}:${p.instance}`)
  );

  return {
    existing: device.points,
    foundCount: discovered.length,
    newPoints,
    removedPoints,
    discovered,
    discoverySource: outcome.discoverySource,
  };
}

/**
 * Adiciona novos pontos descobertos ao dispositivo (sincronização incremental).
 */
export async function applySyncNewPoints(
  deviceId: string,
  newPoints: DiscoveredBACnetPoint[],
): Promise<BACnetDevice> {
  return apiPost<BACnetDevice>(`/devices/${deviceId}/bacnet/sync`, { newPoints });
}

/**
 * Substitui todos os pontos do dispositivo pelos descobertos agora (sincronização total).
 */
export async function applyReplaceAllPoints(
  deviceId: string,
  allDiscovered: DiscoveredBACnetPoint[],
): Promise<BACnetDevice> {
  return apiPost<BACnetDevice>(`/devices/${deviceId}/bacnet/sync/replace`, { points: allDiscovered });
}

// ─── BACnet — atualizar dispositivo ──────────────────────────────────────────

export async function updateBACnetDevice(
  deviceId: string,
  data: Pick<BACnetDevice, 'name' | 'site' | 'siteId' | 'ip' | 'port' | 'deviceInstance'>,
): Promise<BACnetDevice> {
  return apiPatch<BACnetDevice>(`/devices/${deviceId}`, data);
}

// ─── Modbus — atualizar dispositivo ──────────────────────────────────────────

export async function updateModbusDevice(
  deviceId: string,
  data: Pick<ModbusDevice, 'name' | 'equipmentType' | 'site' | 'siteId' | 'ip' | 'port' | 'unitId' | 'pollingInterval'> &
    Partial<Pick<ModbusDevice, 'serial'>>,
): Promise<ModbusDevice> {
  return apiPatch<ModbusDevice>(`/devices/${deviceId}`, data);
}

// ─── Deletar dispositivo ──────────────────────────────────────────────────────

/** Exclusão crítica: exige o token de confirmação de senha do operador. */
export async function deleteDevice(deviceId: string, confirmationToken: string): Promise<void> {
  await apiDelete(`/devices/${deviceId}`, { headers: sensitiveActionHeaders(confirmationToken) });
}

// ─── BACnet — escrita de ponto (comando) ─────────────────────────────────────

export interface WriteBacnetPointParams {
  tenantId: string;
  gatewayId: string;
  ip: string;
  port: number;
  /** AO=1, AV=2, BO=4, BV=5, MSO=14 */
  objectType: number;
  objectInstance: number;
  value: number;
  priority?: number;
  /** Rótulo legível do ponto — usado na trilha de auditoria/dashboard. */
  pointLabel?: string;
  /** Id do Device comandado — usado só pela trilha de auditoria (site no dashboard). */
  deviceId?: string;
}

export interface WritePointResult {
  ok: boolean;
  error?: string;
  /**
   * Escritas MQTT com canal de confirmação: false quando o comando foi
   * publicado mas o dispositivo não confirmou (não é falha dura — o efeito
   * provavelmente foi aplicado). undefined = protocolo sem essa distinção.
   */
  confirmed?: boolean;
}

/**
 * Escreve um ponto BACnet (comando). O endpoint responde 200 mesmo em falha
 * lógica (timeout/recusa do gateway), por isso normalizamos para { ok, error }.
 */
export async function writeBacnetPoint(params: WriteBacnetPointParams): Promise<WritePointResult> {
  try {
    const data = await apiPost<{ success: boolean; error?: string; command_id?: string }>(
      '/devices/bacnet/write',
      params,
    );
    if (data.success) return { ok: true };
    return {
      ok: false,
      error: translateDeviceError(data.error, {
        ip: params.ip,
        port: params.port,
        fallback: 'Não foi possível enviar o comando ao dispositivo. Tente novamente.',
      }),
    };
  } catch (err) {
    return {
      ok: false,
      error: translateDeviceError(err, {
        ip: params.ip,
        port: params.port,
        fallback: 'Não foi possível enviar o comando ao dispositivo. Tente novamente.',
      }),
    };
  }
}

export interface WriteMqttPointParams {
  deviceId: string;
  pointId: string;
  value: number | boolean;
  /** Rótulo legível do ponto — usado na trilha de auditoria/dashboard. */
  pointLabel?: string;
}

/**
 * Escreve um ponto MQTT-nativo comandável (ex.: relé Shelly Gen4). O binding
 * de escrita (tópico/payload) é resolvido pelo backend a partir do cadastro do
 * ponto. Como no BACnet, o endpoint responde 200 mesmo em falha lógica.
 */
export async function writeMqttPoint(params: WriteMqttPointParams): Promise<WritePointResult> {
  try {
    const data = await apiPost<{ success: boolean; error?: string; command_id?: string; confirmed?: boolean }>(
      '/devices/mqtt/write',
      params,
    );
    if (data.success) return { ok: true, confirmed: data.confirmed };
    return {
      ok: false,
      error: translateDeviceError(data.error, {
        fallback: 'Não foi possível enviar o comando ao dispositivo. Tente novamente.',
      }),
    };
  } catch (err) {
    return {
      ok: false,
      error: translateDeviceError(err, {
        fallback: 'Não foi possível enviar o comando ao dispositivo. Tente novamente.',
      }),
    };
  }
}

export interface WriteModbusPointParams {
  deviceId: string;
  pointId: string;
  value: number | boolean;
  /** Rótulo legível do ponto — usado na trilha de auditoria/dashboard. */
  pointLabel?: string;
}

/**
 * Escreve um ponto Modbus comandável (holding register ou coil). O binding do
 * registrador e a conexão (TCP/RTU) são resolvidos pelo backend a partir do
 * cadastro. Como no BACnet, o endpoint responde 200 mesmo em falha lógica.
 */
export async function writeModbusPoint(params: WriteModbusPointParams): Promise<WritePointResult> {
  try {
    const data = await apiPost<{ success: boolean; error?: string; command_id?: string }>(
      '/devices/modbus/write',
      params,
    );
    if (data.success) return { ok: true };
    return {
      ok: false,
      error: translateDeviceError(data.error, {
        fallback: 'Não foi possível enviar o comando ao dispositivo. Tente novamente.',
      }),
    };
  } catch (err) {
    return {
      ok: false,
      error: translateDeviceError(err, {
        fallback: 'Não foi possível enviar o comando ao dispositivo. Tente novamente.',
      }),
    };
  }
}

// ─── Utilitários ──────────────────────────────────────────────────────────────

function toTagName(name: string): string {
  return name
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

// ─── Linha do tempo do equipamento (telemetria + alarmes + comandos) ─────────

export interface TimelineEvent {
  id: string;
  type: 'alarm_activated' | 'alarm_normalized' | 'command';
  at: string;
  severity: string | null;
  title: string;
  detail: string | null;
}

export interface TimelinePointRef {
  id: string;
  name: string;
  tag: string;
  unit: string | null;
}

export interface DeviceTimelineResponse {
  device: { id: string; name: string };
  point: (TimelinePointRef & { hasTrend: boolean }) | null;
  trendedPoints: TimelinePointRef[];
  from: string;
  to: string;
  bucket: 'minute' | 'hour';
  chartPoints: { t: string; value: number; min: number; max: number }[];
  events: TimelineEvent[];
}

/** Linha do tempo do equipamento: telemetria + alarmes + comandos no mesmo eixo. */
export async function getDeviceTimeline(
  deviceId: string,
  opts: { from?: string; to?: string; pointId?: string } = {},
): Promise<DeviceTimelineResponse> {
  const params = new URLSearchParams();
  if (opts.from) params.set('from', opts.from);
  if (opts.to) params.set('to', opts.to);
  if (opts.pointId) params.set('pointId', opts.pointId);
  const qs = params.toString();
  return apiGet<DeviceTimelineResponse>(`/devices/${deviceId}/timeline${qs ? `?${qs}` : ''}`);
}
