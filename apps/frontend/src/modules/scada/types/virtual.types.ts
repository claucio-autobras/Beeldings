import type { Device } from '@/modules/devices/services/devices.service';
import type { Camera, ManagedSwitch, ManagedNvr } from '@/modules/cftv/services/cftv.service';
import type { Controller } from '@/modules/sca/services/sca.service';

/** Tipo de um ponto virtual (bancada de testes do SCADA). */
export type VirtualKind = 'analog' | 'digital' | 'multistate';

/** Estado nomeado de um ponto multistate. */
export interface VirtualState {
  value: number;
  label: string;
}

/**
 * Ponto virtual (simulado). `objectType` segue o mapeamento BACnet usado pela
 * telemetria: analog→`AV`, digital→`BV`, multistate→`MSI`. O valor corrente vive
 * em `currentValue` (e também em `value` para compatibilidade com os widgets).
 */
export interface VirtualPoint {
  id: string;
  tag: string;
  objectName: string;
  objectType: 'AV' | 'BV' | 'MSI';
  instance: number;
  unit: string;
  kind: VirtualKind;
  currentValue: number | boolean;
  states: VirtualState[];
  value: number | boolean;
  status: string;
  lastUpdate: string;
}

/**
 * Dispositivo virtual — agrupa os pontos de teste de um projeto.
 * `protocol='virtual'` e `gatewayId=null` o isolam da produção.
 */
export interface VirtualDevice {
  id: string;
  name: string;
  protocol: 'virtual';
  siteId: string | null;
  tenantId: string;
  gatewayId: null;
  config?: { virtual?: boolean; projectId?: string } | null;
  points: VirtualPoint[];
}

/** Payload para criação de um novo ponto virtual. */
export interface NewVirtualPoint {
  tag: string;
  objectName?: string;
  kind: VirtualKind;
  unit?: string;
  states?: VirtualState[];
  initialValue?: number | boolean;
}

/**
 * Dispositivo de uma tela SCADA: real (Device), virtual (bancada), câmera
 * CFTV (protocol 'snmp'/'onvif'), switch gerenciável (monitoredDeviceType
 * 'SWITCH'), controladora de acesso SCA (protocol 'snmp') ou NVR/DVR
 * gerenciável (monitoredDeviceType 'NVR'). A telemetria casa por device+tag em
 * todos os casos.
 */
export type ScreenDevice = Device | VirtualDevice | Camera | ManagedSwitch | Controller | ManagedNvr;

/** True quando o dispositivo é um switch gerenciável SNMP. */
export function isSwitchDevice(dev: ScreenDevice): dev is ManagedSwitch {
  return (dev as ManagedSwitch).monitoredDeviceType === 'SWITCH';
}

/** True quando o dispositivo é um NVR/DVR gerenciável SNMP. */
export function isNvrDevice(dev: ScreenDevice): dev is ManagedNvr {
  return (dev as ManagedNvr).monitoredDeviceType === 'NVR';
}

/**
 * True quando o dispositivo é uma controladora de acesso SCA (Device
 * protocol='snmp'). O DTO de GET /sca/controllers não expõe
 * `monitoredDeviceType` — a distinção confiável é por exclusão dos demais
 * tipos SNMP (câmera, switch, NVR), que carregam seus próprios marcadores
 * (`monitoringProtocol` / `monitoredDeviceType`).
 */
export function isControllerDevice(dev: ScreenDevice): dev is Controller {
  if (isSwitchDevice(dev) || isNvrDevice(dev)) return false;
  if ('monitoringProtocol' in dev) return false; // Camera
  return dev.protocol === 'snmp';
}

/**
 * True quando o dispositivo é uma câmera CFTV (SNMP/ONVIF).
 * Exclui explicitamente switches (monitoredDeviceType='SWITCH'), NVRs
 * (monitoredDeviceType='NVR') e controladoras SCA — todos também podem ter
 * protocol='snmp'. Câmeras são o único tipo com o campo `monitoringProtocol`.
 */
export function isCameraDevice(dev: ScreenDevice): dev is Camera {
  if (isSwitchDevice(dev) || isNvrDevice(dev)) return false;
  if (dev.protocol !== 'snmp' && dev.protocol !== 'onvif') return false;
  return 'monitoringProtocol' in dev;
}
