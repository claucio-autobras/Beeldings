// ─── Tipos de domínio do módulo de Dispositivos ────────────────────────────────

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
  /** Ponto crítico (card Ativos Críticos do dashboard). */
  critical?: boolean;
  /** Papel operacional (status | mode | setpoint) — usado pelo card Ativos Críticos. */
  opRole?: 'status' | 'fault' | 'mode' | 'setpoint' | null;
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
  /** Ativo crítico (card Ativos Críticos do dashboard). */
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
  /** Ponto crítico (card Ativos Críticos do dashboard). */
  critical?: boolean;
  value: number | boolean;
  /** Papel operacional (status | mode | setpoint) — usado pelo card Ativos Críticos. */
  opRole?: 'status' | 'fault' | 'mode' | 'setpoint' | null;
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
  /** Ativo crítico (card Ativos Críticos do dashboard). */
  critical?: boolean;
  lastCommunication: string | null;
  points: ModbusPoint[];
}

// ─── MQTT-nativo ──────────────────────────────────────────────────────────────

export type MqttValueType = 'number' | 'boolean';

/** Binding de escrita de um ponto MQTT comandável (ex.: relé Shelly Gen4). */
export interface MqttWriteConfig {
  /** Tópico completo onde o comando é publicado (sob .../sensors/ do gateway). */
  commandTopic: string;
  /** Template do payload — placeholders {{value}} e {{id}}. */
  payloadTemplate: string;
  /** Tópico completo onde a confirmação chega (opcional). */
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
  /** Ponto crítico (card Ativos Críticos do dashboard). */
  critical?: boolean;
  /** Presente quando o ponto é comandável (escrita MQTT). */
  write?: MqttWriteConfig | null;
  value: number | boolean;
  /** Papel operacional (status | mode | setpoint) — usado pelo card Ativos Críticos. */
  opRole?: 'status' | 'fault' | 'mode' | 'setpoint' | null;
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
  /** Ativo crítico (card Ativos Críticos do dashboard). */
  critical?: boolean;
  lastCommunication: string | null;
  points: MqttPoint[];
  /** Config de tópico do dispositivo (modo raiz próprio + heartbeat). */
  mqttConfig?: MqttDeviceTopicConfig;
}

/** Config de tópico de um dispositivo MQTT (retornada pelo backend). */
export interface MqttDeviceTopicConfig {
  /** 'prefix' = namespace de sensores do gateway (padrão); 'root' = tópico raiz próprio. */
  topicMode: 'prefix' | 'root';
  rootTopic: string | null;
  heartbeatTopic: string | null;
  heartbeatTimeoutSeconds: number | null;
  /** Credencial dedicada do equipamento (só no modo raiz). */
  credential: {
    username: string;
    password: string;
    broker: string | null;
    topicPrefix: string;
  } | null;
}

export type Device = BACnetDevice | ModbusDevice | MqttDevice;

export type DiscoveredModbusPoint = Omit<ModbusPoint, 'id' | 'value' | 'status' | 'lastUpdate'>;

export type DiscoveredBACnetPoint = Omit<BACnetPoint, 'id' | 'status' | 'lastUpdate'> & {
  objectName: string;
  /** true quando o objeto não tinha nome no dispositivo — nome padrão "TYPE-instance" gerado */
  unnamed?: boolean;
};

/** Como o gateway enumerou os objetos da controladora. */
export type BacnetDiscoverySource = 'objectList' | 'objectListIndex' | 'scan';

/**
 * Controladora BACnet encontrada via scan de rede (Who-Is broadcast).
 * Usada na etapa de "Escanear rede" do AddBACnetDeviceModal.
 */
export interface DiscoveredBacnetDevice {
  instance: number;
  ip: string;
  /** Porta BACnet do dispositivo (quando diferente da padrão 47808) */
  port?: number;
  vendorId: number | null;
  vendorName: string | null;
  modelName: string | null;
  objectName: string | null;
  /** Rota BACnet (device MS/TP atrás de roteador) capturada do I-Am */
  net?: number | null;
  adr?: number[] | null;
}
