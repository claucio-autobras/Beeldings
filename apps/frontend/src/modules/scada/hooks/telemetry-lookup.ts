import {
  telemetryKey,
  deviceTelemetryKey,
  deviceTagKey,
} from '@/hooks/useBacnetTelemetry';
import type { TelemetryEntry, TelemetryMap } from '@/hooks/useBacnetTelemetry';
import type { ScreenDevice } from '../types/virtual.types';

/** BACnet objectType (string nos pontos) → número usado na chave de telemetria. */
export const OBJECT_TYPE_NUM: Record<string, number> = {
  AI: 0, AO: 1, AV: 2, BI: 3, BO: 4, BV: 5, MSI: 13, MSO: 14,
};

export interface TelemetryIndexes {
  /** Índice global BACnet: `{objectType}:{objectInstance}`. */
  telemetry: TelemetryMap;
  /** Índice ISOLADO por dispositivo: `{deviceId}:{ot}:{inst}` e `{deviceId}:tag:{tag}`. */
  byDevice: TelemetryMap;
}

/**
 * Resolve a entrada de telemetria AO VIVO de um ponto (ou null se não houver).
 *
 * Regra central anti-vazamento: para protocolos indexados por tag (MQTT,
 * Modbus, SNMP/CFTV) o lookup usa EXCLUSIVAMENTE a chave deviceId+tag do
 * índice `byDevice`. O antigo fallback global por tag (`byTag`) foi removido:
 * dois devices com a mesma tag (ex.: dois Shellys com "rele") vazavam o valor
 * um do outro em toda a interface SCADA. Toda telemetria por tag chega com
 * deviceId e alimenta `byDevice` — não há caso legítimo de tag sem device.
 */
export function resolveTelemetryEntry(
  indexes: TelemetryIndexes,
  devices: ScreenDevice[],
  deviceId: string,
  tag: string,
): TelemetryEntry | null {
  const dev = devices.find((d) => d.id === deviceId);
  if (!dev) return null;
  const point = dev.points.find((p) => p.tag === tag);
  if (!point) return null;

  // BACnet (e pontos virtuais): telemetria indexada por objectType:instance.
  if ('objectType' in point) {
    const num = OBJECT_TYPE_NUM[point.objectType as string];
    if (num === undefined) return null;
    // Pontos virtuais (bancada): telemetria ISOLADA por dispositivo, para não
    // casar (e "seguir") o valor de uma controladora real de mesmo objectType:instance.
    if (dev.protocol === 'virtual') {
      return indexes.byDevice.get(deviceTelemetryKey(deviceId, num, (point as { instance: number }).instance)) ?? null;
    }
    return indexes.telemetry.get(telemetryKey(num, (point as { instance: number }).instance)) ?? null;
  }

  // Protocolos sem objectType (SNMP, Modbus, MQTT): SOMENTE deviceId+tag.
  return indexes.byDevice.get(deviceTagKey(deviceId, tag)) ?? null;
}
