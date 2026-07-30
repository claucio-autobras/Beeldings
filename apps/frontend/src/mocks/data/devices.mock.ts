// ─── Tipos ──────────────────────────────────────────────────────────────────

export type BACnetObjectType =
  | 'AI' | 'AO' | 'BI' | 'BO' | 'AV' | 'BV' | 'MSI' | 'MSO'
  | 'MSV' | 'ACC' | 'PC' | 'CSV' | 'IV' | 'LAV' | 'PIV';
export type ModbusRegisterType = 'holding' | 'input' | 'coil' | 'discrete';
export type ModbusDataType = 'uint16' | 'int16' | 'float32' | 'boolean';
export type DeviceStatus = 'online' | 'offline';
export type PointStatus = 'normal' | 'alarm' | 'fault';
export type EquipmentType =
  | 'Multimedidor'
  | 'Gerador'
  | 'Chiller'
  | 'Bomba'
  | 'Ventilador'
  | 'Outro';

// ─── BACnet ─────────────────────────────────────────────────────────────────

export interface BACnetPoint {
  id: string;
  tag: string;
  objectName?: string;
  objectType: BACnetObjectType;
  instance: number;
  value: number | string | boolean;
  unit: string;
  /** Papel operacional (status | mode | setpoint) — usado pelo card Ativos Críticos. */
  opRole?: 'status' | 'mode' | 'setpoint' | null;
  status: PointStatus;
  lastUpdate: string;
}

export interface BACnetDevice {
  id: string;
  name: string;
  protocol: 'bacnet';
  site: string;
  siteId: string;
  tenantId: string;
  /** ID do gateway responsável pela comunicação com este dispositivo */
  gatewayId?: string;
  ip: string;
  port: number;
  deviceInstance?: number;
  status: DeviceStatus;
  /** Ativo crítico (card do dashboard). */
  critical?: boolean;
  lastCommunication: string | null;
  points: BACnetPoint[];
}

// ─── Modbus ──────────────────────────────────────────────────────────────────

export interface ModbusPoint {
  id: string;
  tag: string;
  displayName: string;
  register: number;
  registerType: ModbusRegisterType;
  dataType: ModbusDataType;
  scale: number;
  offset: number;
  unit: string;
  value: number | boolean;
  /** Papel operacional (status | mode | setpoint) — usado pelo card Ativos Críticos. */
  opRole?: 'status' | 'mode' | 'setpoint' | null;
  status: PointStatus;
  minExpected?: number;
  maxExpected?: number;
  lastUpdate: string;
}

/** Modo de conexão Modbus: TCP (rede) ou RTU (serial RS485). */
export type ModbusConnectionType = 'tcp' | 'rtu';

/** Parâmetros da porta serial RS485 (modo RTU). */
export interface ModbusSerialConfig {
  /** Caminho da porta: COM3 (Windows) ou /dev/ttyUSB0 (Linux). */
  path: string;
  baudRate: number;
  parity: 'none' | 'even' | 'odd';
  dataBits: 7 | 8;
  stopBits: 1 | 2;
}

export interface ModbusDevice {
  id: string;
  name: string;
  protocol: 'modbus';
  equipmentType: EquipmentType;
  site: string;
  siteId: string;
  tenantId: string;
  /** ID do gateway responsável pela comunicação com este dispositivo */
  gatewayId?: string;
  /** Ausente = 'tcp' (dispositivos antigos). */
  connectionType?: ModbusConnectionType;
  ip: string;
  port: number;
  /** Parâmetros da porta serial — só no modo RTU. */
  serial?: ModbusSerialConfig;
  unitId: number;
  pollingInterval: number;
  status: DeviceStatus;
  /** Ativo crítico (card do dashboard). */
  critical?: boolean;
  lastCommunication: string | null;
  points: ModbusPoint[];
}

// ─── MQTT-nativo ──────────────────────────────────────────────────────────────

export type MqttValueType = 'number' | 'boolean';

/** Binding de escrita de um ponto MQTT comandável (ex.: relé Shelly Gen4). */
export interface MqttWriteConfig {
  commandTopic: string;
  payloadTemplate: string;
  responseTopic?: string | null;
}

export interface MqttPoint {
  id: string;
  tag: string;
  displayName: string;
  sourceTopic: string;
  jsonPath: string;
  valueType: MqttValueType;
  unit: string;
  /** Presente quando o ponto é comandável (escrita MQTT). */
  write?: MqttWriteConfig | null;
  value: number | boolean;
  /** Papel operacional (status | mode | setpoint) — usado pelo card Ativos Críticos. */
  opRole?: 'status' | 'mode' | 'setpoint' | null;
  status: PointStatus;
  lastUpdate: string;
}

export interface MqttDevice {
  id: string;
  name: string;
  protocol: 'mqtt';
  site: string;
  siteId: string;
  tenantId: string;
  /** ID do gateway responsável pelo bridge deste dispositivo */
  gatewayId?: string;
  status: DeviceStatus;
  /** Ativo crítico (card do dashboard). */
  critical?: boolean;
  lastCommunication: string | null;
  points: MqttPoint[];
  /** Config de tópico do dispositivo (modo raiz próprio + heartbeat). */
  mqttConfig?: {
    topicMode: 'prefix' | 'root';
    rootTopic: string | null;
    heartbeatTopic: string | null;
    heartbeatTimeoutSeconds: number | null;
    credential: {
      username: string;
      password: string;
      broker: string | null;
      topicPrefix: string;
    } | null;
  };
}

export type Device = BACnetDevice | ModbusDevice | MqttDevice;

// ─── Clientes (tenants) disponíveis ─────────────────────────────────────────

export const mockClients = [
  { id: 'tenant-autobras', name: 'Autobras' },
  { id: 'tenant-shopb',    name: 'Shopping Boulevard' },
];

// ─── Sites disponíveis ───────────────────────────────────────────────────────

export const mockSites = [
  { id: 'site-001', name: 'Bloco A — Pavimento 3',  tenantId: 'tenant-autobras' },
  { id: 'site-002', name: 'Bloco B — Pavimento 1',  tenantId: 'tenant-autobras' },
  { id: 'site-003', name: 'Bloco A — Pavimento 1',  tenantId: 'tenant-autobras' },
  { id: 'site-004', name: 'Bloco A — Subsolo',       tenantId: 'tenant-autobras' },
  { id: 'site-005', name: 'Área de Vendas — Térreo', tenantId: 'tenant-shopb' },
  { id: 'site-006', name: 'Casa de Máquinas — Cob.', tenantId: 'tenant-shopb' },
  { id: 'site-007', name: 'Depósito — Subsolo',      tenantId: 'tenant-shopb' },
];

// ─── Pontos descobertos via Modbus scan (mock de discovery) ──────────────────

export type DiscoveredModbusPoint = Omit<ModbusPoint, 'id' | 'value' | 'status' | 'lastUpdate'>;

export const mockDiscoveredModbusPoints: DiscoveredModbusPoint[] = [
  { tag: 'tensao_fase_a',    displayName: 'Tensão Fase A',     register: 40001, registerType: 'holding', dataType: 'float32', scale: 0.1,   offset: 0, unit: 'V',    minExpected: 200, maxExpected: 240 },
  { tag: 'tensao_fase_b',    displayName: 'Tensão Fase B',     register: 40003, registerType: 'holding', dataType: 'float32', scale: 0.1,   offset: 0, unit: 'V',    minExpected: 200, maxExpected: 240 },
  { tag: 'tensao_fase_c',    displayName: 'Tensão Fase C',     register: 40005, registerType: 'holding', dataType: 'float32', scale: 0.1,   offset: 0, unit: 'V',    minExpected: 200, maxExpected: 240 },
  { tag: 'corrente_fase_a',  displayName: 'Corrente Fase A',   register: 40007, registerType: 'holding', dataType: 'float32', scale: 0.01,  offset: 0, unit: 'A',    minExpected: 0,   maxExpected: 200 },
  { tag: 'corrente_fase_b',  displayName: 'Corrente Fase B',   register: 40009, registerType: 'holding', dataType: 'float32', scale: 0.01,  offset: 0, unit: 'A',    minExpected: 0,   maxExpected: 200 },
  { tag: 'potencia_ativa',   displayName: 'Potência Ativa',    register: 40011, registerType: 'holding', dataType: 'float32', scale: 1,     offset: 0, unit: 'kW'  },
  { tag: 'potencia_reativa', displayName: 'Potência Reativa',  register: 40013, registerType: 'holding', dataType: 'float32', scale: 1,     offset: 0, unit: 'kVAR' },
  { tag: 'fator_potencia',   displayName: 'Fator de Potência', register: 40015, registerType: 'holding', dataType: 'float32', scale: 0.001, offset: 0, unit: ''     },
];

// ─── Pontos descobertos via BACnet Who-Is (mock de discovery) ────────────────

export type DiscoveredBACnetPoint = Omit<BACnetPoint, 'id' | 'status' | 'lastUpdate'> & {
  objectName: string;
  /** true quando o objeto não tinha nome no dispositivo — nome padrão "TYPE-instance" gerado */
  unnamed?: boolean;
};

export const mockDiscoveredBACnetPoints: DiscoveredBACnetPoint[] = [
  { objectName: 'NTC 01',             tag: 'NTC_01',              objectType: 'AI',  instance: 0, value: 22.5,           unit: '°C'  },
  { objectName: 'NTC 02',             tag: 'NTC_02',              objectType: 'AI',  instance: 1, value: 14.8,           unit: '°C'  },
  { objectName: 'TEMP AGUA GELADA',   tag: 'TEMP_AGUA_GELADA',    objectType: 'AI',  instance: 2, value: 7.2,            unit: '°C'  },
  { objectName: 'PRESSAO SUCCAO',     tag: 'PRESSAO_SUCCAO',      objectType: 'AI',  instance: 3, value: 4.8,            unit: 'bar' },
  { objectName: 'SETPOINT TEMP',      tag: 'SETPOINT_TEMP',       objectType: 'AV',  instance: 0, value: 22.0,           unit: '°C'  },
  { objectName: 'VALVULA EXPANSAO 1', tag: 'VALVULA_EXPANSAO_1',  objectType: 'AO',  instance: 0, value: 68.5,           unit: '%'   },
  { objectName: 'MODO OPERACAO',      tag: 'MODO_OPERACAO',       objectType: 'MSI', instance: 0, value: 'Resfriamento', unit: ''    },
  { objectName: 'STATUS COMPRESSOR 1',tag: 'STATUS_COMPRESSOR_1', objectType: 'BI',  instance: 0, value: true,           unit: ''    },
  { objectName: 'STATUS COMPRESSOR 2',tag: 'STATUS_COMPRESSOR_2', objectType: 'BI',  instance: 1, value: false,          unit: ''    },
  { objectName: 'FALHA BOMBA 1',      tag: 'FALHA_BOMBA_1',       objectType: 'BI',  instance: 2, value: false,          unit: ''    },
  { objectName: 'ALARME GERAL',       tag: 'ALARME_GERAL',        objectType: 'BV',  instance: 0, value: false,          unit: ''    },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ago = (minutes: number): string =>
  new Date(Date.now() - minutes * 60 * 1000).toISOString();

const secsAgo = (secs: number): string =>
  new Date(Date.now() - secs * 1000).toISOString();

// ─── Dispositivos mock ───────────────────────────────────────────────────────

export const mockDevices: Device[] = [
  // ── BACnet 1: Johnson Controls FX-PCG — Empresa Demo ──────────────────────
  {
    id: 'dev-001',
    name: 'MCP-46D',
    protocol: 'bacnet',
    site: 'Bloco A — Pavimento 3',
    siteId: 'site-001',
    tenantId: 'tenant-autobras',
    ip: '192.168.1.100',
    port: 47808,
    deviceInstance: 1001,
    status: 'online',
    lastCommunication: ago(2),
    points: [
      { id: 'p-001', tag: 'temp_retorno',        objectType: 'AI',  instance: 1, value: 22.4,          unit: '°C', status: 'normal', lastUpdate: secsAgo(30) },
      { id: 'p-002', tag: 'temp_insuflamento',   objectType: 'AI',  instance: 2, value: 14.2,          unit: '°C', status: 'normal', lastUpdate: secsAgo(30) },
      { id: 'p-003', tag: 'setpoint_temp',       objectType: 'AV',  instance: 1, value: 22.0,          unit: '°C', status: 'normal', lastUpdate: secsAgo(30) },
      { id: 'p-004', tag: 'modo_operacao',       objectType: 'MSI', instance: 1, value: 'Resfriamento', unit: '',   status: 'normal', lastUpdate: secsAgo(30) },
      { id: 'p-005', tag: 'status_compressor_1', objectType: 'BI',  instance: 1, value: true,          unit: '',   status: 'normal', lastUpdate: secsAgo(30) },
      { id: 'p-006', tag: 'status_compressor_2', objectType: 'BI',  instance: 2, value: false,         unit: '',   status: 'normal', lastUpdate: secsAgo(30) },
      { id: 'p-007', tag: 'valvula_expansao_1',  objectType: 'AO',  instance: 1, value: 75.5,          unit: '%',  status: 'normal', lastUpdate: secsAgo(30) },
      { id: 'p-008', tag: 'alarme_geral',        objectType: 'BV',  instance: 1, value: false,         unit: '',   status: 'normal', lastUpdate: secsAgo(30) },
    ],
  },

  // ── BACnet 2: Distech ECB-PTU — Empresa Demo ──────────────────────────────
  {
    id: 'dev-002',
    name: 'MCP-46D',
    protocol: 'bacnet',
    site: 'Bloco B — Pavimento 1',
    siteId: 'site-002',
    tenantId: 'tenant-autobras',
    ip: '192.168.1.101',
    port: 47808,
    deviceInstance: 1002,
    status: 'online',
    lastCommunication: ago(5),
    points: [
      { id: 'p-009', tag: 'temp_ambiente',        objectType: 'AI',  instance: 1, value: 23.1,    unit: '°C', status: 'normal', lastUpdate: ago(1) },
      { id: 'p-010', tag: 'setpoint_conforto',    objectType: 'AV',  instance: 1, value: 22.5,    unit: '°C', status: 'normal', lastUpdate: ago(1) },
      { id: 'p-011', tag: 'status_ventilador',    objectType: 'BI',  instance: 1, value: true,    unit: '',   status: 'normal', lastUpdate: ago(1) },
      { id: 'p-012', tag: 'velocidade_ventilador', objectType: 'AO', instance: 1, value: 60.0,    unit: '%',  status: 'normal', lastUpdate: ago(1) },
      { id: 'p-013', tag: 'modo_ocupacao',        objectType: 'MSI', instance: 1, value: 'Ocupado', unit: '', status: 'normal', lastUpdate: ago(1) },
      { id: 'p-014', tag: 'alarme_temperatura',   objectType: 'BV',  instance: 1, value: false,   unit: '',   status: 'normal', lastUpdate: ago(1) },
    ],
  },

  // ── Modbus 1: PowerLogic PM5560 — Empresa Demo ────────────────────────────
  {
    id: 'dev-003',
    name: 'Gerador 01',
    protocol: 'modbus',
    equipmentType: 'Gerador',
    site: 'Bloco A — Pavimento 1',
    siteId: 'site-003',
    tenantId: 'tenant-autobras',
    ip: '192.168.1.50',
    port: 502,
    unitId: 1,
    pollingInterval: 1,
    status: 'online',
    lastCommunication: ago(1),
    points: [
      { id: 'p-015', tag: 'tensao_fase_a',    displayName: 'Tensão Fase A',       register: 3028, registerType: 'input', dataType: 'float32', scale: 1,   offset: 0, unit: 'V',   value: 220.4,   status: 'normal', minExpected: 190,  maxExpected: 240,  lastUpdate: ago(1) },
      { id: 'p-016', tag: 'corrente_fase_a',  displayName: 'Corrente Fase A',     register: 3000, registerType: 'input', dataType: 'float32', scale: 1,   offset: 0, unit: 'A',   value: 45.2,    status: 'normal', minExpected: 0,    maxExpected: 100,  lastUpdate: ago(1) },
      { id: 'p-017', tag: 'potencia_ativa',   displayName: 'Potência Ativa Total',register: 3054, registerType: 'input', dataType: 'float32', scale: 1,   offset: 0, unit: 'kW',  value: 28.6,    status: 'normal', minExpected: 0,    maxExpected: 150,  lastUpdate: ago(1) },
      { id: 'p-018', tag: 'fator_potencia',   displayName: 'Fator de Potência',   register: 3084, registerType: 'input', dataType: 'float32', scale: 1,   offset: 0, unit: 'PF',  value: 0.92,    status: 'normal', minExpected: 0.85, maxExpected: 1.0,  lastUpdate: ago(1) },
      { id: 'p-019', tag: 'frequencia',       displayName: 'Frequência',          register: 3110, registerType: 'input', dataType: 'float32', scale: 1,   offset: 0, unit: 'Hz',  value: 60.0,    status: 'normal', minExpected: 59.5, maxExpected: 60.5, lastUpdate: ago(1) },
      { id: 'p-020', tag: 'energia_acumulada',displayName: 'Energia Acumulada',   register: 3204, registerType: 'input', dataType: 'float32', scale: 1,   offset: 0, unit: 'kWh', value: 12450.8, status: 'normal',                                        lastUpdate: ago(1) },
    ],
  },

  // ── Modbus 2: Gerador Cummins C110D5 — Empresa Demo ───────────────────────
  {
    id: 'dev-004',
    name: 'Gerador 02',
    protocol: 'modbus',
    equipmentType: 'Gerador',
    site: 'Bloco A — Subsolo',
    siteId: 'site-004',
    tenantId: 'tenant-autobras',
    ip: '192.168.1.51',
    port: 502,
    unitId: 2,
    pollingInterval: 1,
    status: 'offline',
    lastCommunication: ago(45),
    points: [
      { id: 'p-021', tag: 'status_gerador', displayName: 'Status do Gerador',    register: 40001, registerType: 'holding', dataType: 'boolean', scale: 1,   offset: 0, unit: '',    value: false, status: 'fault',                               lastUpdate: ago(45) },
      { id: 'p-022', tag: 'tensao_saida',   displayName: 'Tensão de Saída',      register: 40002, registerType: 'holding', dataType: 'uint16',  scale: 1,   offset: 0, unit: 'V',   value: 0,     status: 'fault', minExpected: 200, maxExpected: 240, lastUpdate: ago(45) },
      { id: 'p-023', tag: 'corrente',       displayName: 'Corrente',             register: 40003, registerType: 'holding', dataType: 'uint16',  scale: 1,   offset: 0, unit: 'A',   value: 0,     status: 'fault', minExpected: 0,   maxExpected: 200, lastUpdate: ago(45) },
      { id: 'p-024', tag: 'rpm',            displayName: 'Rotação (RPM)',        register: 40004, registerType: 'holding', dataType: 'uint16',  scale: 1,   offset: 0, unit: 'RPM', value: 0,     status: 'fault', minExpected: 1800,maxExpected: 1860,lastUpdate: ago(45) },
      { id: 'p-025', tag: 'temp_motor',     displayName: 'Temperatura do Motor', register: 40005, registerType: 'holding', dataType: 'int16',   scale: 0.1, offset: 0, unit: '°C',  value: 0,     status: 'fault', minExpected: 60,  maxExpected: 95,  lastUpdate: ago(45) },
    ],
  },

  // ── BACnet 3: Distech ECB-VAV — Shop B Ltda ───────────────────────────────
  {
    id: 'shopb-ecb-01',
    name: 'MCP-46D',
    protocol: 'bacnet',
    site: 'Área de Vendas — Térreo',
    siteId: 'site-005',
    tenantId: 'tenant-shopb',
    ip: '10.0.1.100',
    port: 47808,
    deviceInstance: 2001,
    status: 'online',
    lastCommunication: ago(3),
    points: [
      { id: 'sp-001', tag: 'temp_ambiente',        objectType: 'AI',  instance: 1, value: 31.2,      unit: '°C', status: 'alarm',  lastUpdate: secsAgo(45) },
      { id: 'sp-002', tag: 'setpoint_conforto',    objectType: 'AV',  instance: 1, value: 22.0,      unit: '°C', status: 'normal', lastUpdate: secsAgo(45) },
      { id: 'sp-003', tag: 'status_ventilador',    objectType: 'BI',  instance: 1, value: true,      unit: '',   status: 'normal', lastUpdate: secsAgo(45) },
      { id: 'sp-004', tag: 'abertura_damper',      objectType: 'AO',  instance: 1, value: 100.0,     unit: '%',  status: 'normal', lastUpdate: secsAgo(45) },
      { id: 'sp-005', tag: 'modo_ocupacao',        objectType: 'MSI', instance: 1, value: 'Ocupado', unit: '',   status: 'normal', lastUpdate: secsAgo(45) },
      { id: 'sp-006', tag: 'alarme_temperatura',   objectType: 'BV',  instance: 1, value: true,      unit: '',   status: 'alarm',  lastUpdate: secsAgo(45) },
    ],
  },

  // ── BACnet 4: Johnson Controls FX-PCG — Shop B Ltda (Casa de Máquinas) ───
  {
    id: 'shopb-fx-01',
    name: 'MCP-46D',
    protocol: 'bacnet',
    site: 'Casa de Máquinas — Cob.',
    siteId: 'site-006',
    tenantId: 'tenant-shopb',
    ip: '10.0.1.101',
    port: 47808,
    deviceInstance: 2002,
    status: 'online',
    lastCommunication: ago(1),
    points: [
      { id: 'sp-007', tag: 'temp_saida_chiller',   objectType: 'AI',  instance: 1, value: 12.8,           unit: '°C',  status: 'alarm',  lastUpdate: secsAgo(30) },
      { id: 'sp-008', tag: 'setpoint_chiller',     objectType: 'AV',  instance: 1, value: 7.0,            unit: '°C',  status: 'normal', lastUpdate: secsAgo(30) },
      { id: 'sp-009', tag: 'pressao_succao',        objectType: 'AI',  instance: 2, value: 3.8,            unit: 'bar', status: 'normal', lastUpdate: secsAgo(30) },
      { id: 'sp-010', tag: 'status_compressor',    objectType: 'BI',  instance: 1, value: true,           unit: '',    status: 'normal', lastUpdate: secsAgo(30) },
      { id: 'sp-011', tag: 'modo_operacao',        objectType: 'MSI', instance: 1, value: 'Resfriamento', unit: '',    status: 'normal', lastUpdate: secsAgo(30) },
      { id: 'sp-012', tag: 'alarme_geral',         objectType: 'BV',  instance: 1, value: true,           unit: '',    status: 'alarm',  lastUpdate: secsAgo(30) },
    ],
  },

  // ── BACnet 5: Trane CH530 — Empresa Demo (offline) ───────────────────────
  {
    id: 'dev-005',
    name: 'MCP-46A',
    protocol: 'bacnet',
    site: 'Bloco A — 3° Pavimento',
    siteId: 'site-001',
    tenantId: 'tenant-autobras',
    ip: '192.168.1.102',
    port: 47808,
    deviceInstance: 1003,
    status: 'offline',
    lastCommunication: ago(12),
    points: [],
  },

  // ── BACnet 6: MCP-18 — Empresa Demo (offline) ────────────────────────────
  {
    id: 'dev-006',
    name: 'MCP-18',
    protocol: 'bacnet',
    site: 'Quadro Elétrico — Bloco C Térreo',
    siteId: 'site-003',
    tenantId: 'tenant-autobras',
    ip: '192.168.1.103',
    port: 47808,
    deviceInstance: 1004,
    status: 'offline',
    lastCommunication: ago(67),
    points: [],
  },

  // ── Modbus 3: Multimedidor PowerLogic — Shop B Ltda (Depósito) ────────────
  {
    id: 'shopb-pm-01',
    name: 'Multimedidor 1',
    protocol: 'modbus',
    equipmentType: 'Multimedidor',
    site: 'Depósito — Subsolo',
    siteId: 'site-007',
    tenantId: 'tenant-shopb',
    ip: '10.0.1.50',
    port: 502,
    unitId: 1,
    pollingInterval: 5,
    status: 'offline',
    lastCommunication: ago(8),
    points: [
      { id: 'sp-013', tag: 'tensao_fase_a',    displayName: 'Tensão Fase A',    register: 3028, registerType: 'input', dataType: 'float32', scale: 1, offset: 0, unit: 'V',   value: 217.8, status: 'normal', minExpected: 190, maxExpected: 240, lastUpdate: ago(8) },
      { id: 'sp-014', tag: 'corrente_fase_a',  displayName: 'Corrente Fase A',  register: 3000, registerType: 'input', dataType: 'float32', scale: 1, offset: 0, unit: 'A',   value: 38.4,  status: 'normal', minExpected: 0,   maxExpected: 100, lastUpdate: ago(8) },
      { id: 'sp-015', tag: 'potencia_ativa',   displayName: 'Potência Ativa',   register: 3054, registerType: 'input', dataType: 'float32', scale: 1, offset: 0, unit: 'kW',  value: 21.3,  status: 'normal', minExpected: 0,   maxExpected: 150, lastUpdate: ago(8) },
      { id: 'sp-016', tag: 'fator_potencia',   displayName: 'Fator de Potência',register: 3084, registerType: 'input', dataType: 'float32', scale: 1, offset: 0, unit: 'PF',  value: 0.88,  status: 'normal', minExpected: 0.85,maxExpected: 1.0, lastUpdate: ago(8) },
    ],
  },
];
