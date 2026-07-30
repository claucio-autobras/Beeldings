'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useBacnetTelemetry, telemetryKey, deviceTelemetryKey, deviceTagKey } from '@/hooks/useBacnetTelemetry';
import type { TelemetryEntry } from '@/hooks/useBacnetTelemetry';
import {
  getPendingCommand,
  clearPendingCommand,
  subscribePendingCommands,
  pendingCommandsVersion,
} from '../store/pending-commands.store';
import type { ScreenDevice, VirtualPoint } from '../types/virtual.types';

/** BACnet objectType (string nos pontos) → número usado na chave de telemetria. */
const OBJECT_TYPE_NUM: Record<string, number> = {
  AI: 0, AO: 1, AV: 2, BI: 3, BO: 4, BV: 5, MSI: 13, MSO: 14,
};

/**
 * Janela de frescor: um ponto vira `stale` se a última leitura tiver mais que
 * isto. 3× o polling de 15s, alinhado ao threshold do backend `DeviceStatusService`.
 */
const STALE_AFTER_MS = 45_000;
/** Intervalo do tick que reavalia frescor mesmo sem novas telemetrias. */
const FRESHNESS_TICK_MS = 5_000;

/**
 * Status de comunicação de um ponto:
 * - `live`: leitura recente e socket conectado.
 * - `stale`: já houve leitura, mas ela está velha (>45s) ou o socket caiu.
 * - `no-data`: nunca houve leitura para este ponto.
 */
export type PointStatus = 'live' | 'stale' | 'no-data';

/** Leitura de um ponto: valor + horário (ISO) da leitura, quando conhecido. */
export interface PointReading {
  value: number | boolean | string | null;
  timestamp: string | null;
}

export interface ScreenTelemetry {
  /** Valor AO VIVO de um ponto, ou null se ainda não houve leitura. */
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  /** Leitura completa (valor + horário) de um ponto, ou null se nunca lido. */
  getReading: (deviceId: string, tag: string) => PointReading | null;
  /** Status de comunicação de um ponto (frescor + conexão). */
  getPointStatus: (deviceId: string, tag: string) => PointStatus;
  /** true quando conectado ao stream de telemetria do backend. */
  connected: boolean;
}

/**
 * Seed persistido de um ponto de câmera CFTV (lastValue/lastValueAt) — igual ao
 * `liveOrSeed` da área CFTV: mostra o status imediatamente ao abrir a tela,
 * antes do primeiro pacote de telemetria chegar.
 */
function cameraSeed(point: unknown): PointReading | null {
  const p = point as { lastValue?: number | null; lastValueAt?: string | null };
  if (p && typeof p === 'object' && 'lastValueAt' in p && p.lastValueAt) {
    return { value: p.lastValue ?? null, timestamp: p.lastValueAt };
  }
  return null;
}

/**
 * Resolve valores ao vivo dos pontos de um conjunto de devices.
 *
 * A telemetria chega via Socket.IO indexada por `objectType:objectInstance`
 * (ver useBacnetTelemetry) — NÃO pelo `value` do GET /devices, que é um
 * placeholder fixo (`false`/`0`). Aqui resolvemos tag → ponto (do cadastro) →
 * chave de telemetria → último valor recebido. Sem leitura, retorna null.
 */
export function useScreenTelemetry(devices: ScreenDevice[], enabled = true): ScreenTelemetry {
  const { telemetry, byTag, byDevice, connected } = useBacnetTelemetry({ enabled });

  // Re-renderiza quando um comando pendente (otimista) é registrado/descartado,
  // para que TODOS os widgets do ponto reflitam o valor comandado na hora.
  useSyncExternalStore(subscribePendingCommands, pendingCommandsVersion, pendingCommandsVersion);

  // Tick periódico: reavalia frescor mesmo quando nenhuma telemetria nova chega,
  // forçando re-render para que `getPointStatus` recalcule com a hora atual.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTick((t) => t + 1), FRESHNESS_TICK_MS);
    return () => clearInterval(id);
  }, [enabled]);

  /** Resolve o dispositivo + ponto do cadastro (ou null se não achar). */
  function resolvePoint(deviceId: string, tag: string) {
    const dev = devices.find((d) => d.id === deviceId);
    if (!dev) return null;
    const point = dev.points.find((p) => p.tag === tag);
    if (!point) return null;
    return { dev, point };
  }

  /** Resolve a entrada de telemetria AO VIVO de um ponto (ou null se não houver). */
  function lookup(deviceId: string, tag: string): TelemetryEntry | null {
    const resolved = resolvePoint(deviceId, tag);
    if (!resolved) return null;
    const { dev, point } = resolved;

    // BACnet (e pontos virtuais): telemetria indexada por objectType:instance.
    if ('objectType' in point) {
      const num = OBJECT_TYPE_NUM[point.objectType];
      if (num === undefined) return null;
      // Pontos virtuais (bancada): telemetria ISOLADA por dispositivo, para não
      // casar (e "seguir") o valor de uma controladora real de mesmo objectType:instance.
      if (dev.protocol === 'virtual') {
        return byDevice.get(deviceTelemetryKey(deviceId, num, point.instance)) ?? null;
      }
      return telemetry.get(telemetryKey(num, point.instance)) ?? null;
    }

    // Protocolos sem objectType (SNMP, Modbus): primeiro o índice ISOLADO por
    // dispositivo (device+tag) — evita colisão entre devices com as mesmas tags
    // (toda câmera CFTV tem STATUS/UPTIME/...) — com fallback no índice global.
    return byDevice.get(deviceTagKey(deviceId, tag)) ?? byTag.get(tag) ?? null;
  }

  function getValue(deviceId: string, tag: string): number | boolean | string | null {
    const resolved = resolvePoint(deviceId, tag);
    if (!resolved) return null;

    const entry = lookup(deviceId, tag);
    const live = entry && entry.value !== null && entry.value !== undefined ? entry.value : null;

    // Valor otimista pendente (comando recém-enviado): tem prioridade sobre a
    // telemetria até o vivo confirmar o MESMO valor — aí é descartado e a
    // leitura ao vivo volta a ser a fonte da verdade.
    const pendingValue = getPendingCommand(deviceId, tag);
    if (pendingValue !== null) {
      if (live !== null && Number(live) === pendingValue) {
        // Confirmado pelo vivo — descarta o pendente FORA do render (o clear
        // notifica assinantes; setState durante render é proibido no React).
        setTimeout(() => clearPendingCommand(deviceId, tag), 0);
        return live;
      }
      return pendingValue;
    }

    if (live !== null) return live;

    // Pontos virtuais: sem leitura ao vivo (ex.: recém-carregada a tela), exibe o
    // valor CADASTRADO (currentValue/value). Pontos reais continuam dependendo da
    // telemetria ao vivo e retornam null quando não há leitura.
    if (resolved.dev.protocol === 'virtual') {
      const vp = resolved.point as VirtualPoint;
      return vp.currentValue ?? vp.value ?? null;
    }

    // Câmeras CFTV: fallback para o último valor persistido no backend (seed),
    // como na área CFTV — o STATUS aparece imediatamente ao abrir a tela.
    if (resolved.dev.protocol === 'snmp' || resolved.dev.protocol === 'onvif') {
      return cameraSeed(resolved.point)?.value ?? null;
    }
    return null;
  }

  function getReading(deviceId: string, tag: string): PointReading | null {
    const resolved = resolvePoint(deviceId, tag);
    if (!resolved) return null;

    const entry = lookup(deviceId, tag);
    if (entry && entry.value !== null && entry.value !== undefined) {
      return { value: entry.value, timestamp: entry.timestamp ?? null };
    }
    if (resolved.dev.protocol === 'virtual') {
      const vp = resolved.point as VirtualPoint;
      return { value: vp.currentValue ?? vp.value ?? null, timestamp: null };
    }
    if (resolved.dev.protocol === 'snmp' || resolved.dev.protocol === 'onvif') {
      return cameraSeed(resolved.point);
    }
    return null;
  }

  function getPointStatus(deviceId: string, tag: string): PointStatus {
    const resolved = resolvePoint(deviceId, tag);
    if (!resolved) return 'no-data';

    // Pontos virtuais têm sempre um valor autoritativo do cadastro → nunca "offline".
    if (resolved.dev.protocol === 'virtual') return 'live';

    const entry = lookup(deviceId, tag);
    if (!entry) return 'no-data';
    if (!connected) return 'stale';
    const ts = Date.parse(entry.timestamp);
    if (Number.isNaN(ts)) return 'stale';
    return Date.now() - ts > STALE_AFTER_MS ? 'stale' : 'live';
  }

  return { getValue, getReading, getPointStatus, connected };
}

/**
 * Formata um valor de telemetria para exibição.
 *
 * - BACnet binário (BI/BO/BV): ON/OFF.
 * - Modbus digital (coil/discrete): ATIVO/INATIVO — mesma convenção da tela de
 *   detalhe do dispositivo Modbus (`ModbusDeviceDetail`).
 * - Analógico/numérico: número (com a unidade quando informada).
 *
 * `pointType` é o identificador do ponto: objectType BACnet (ex.: `AI`, `BV`) ou
 * registerType Modbus em maiúsculas (ex.: `COIL`, `HOLDING`).
 */
export function formatTelemetryValue(
  value: number | boolean | string | null,
  pointType?: string,
  unit?: string,
): string {
  if (value === null || value === undefined) return '—';

  const type = pointType?.toUpperCase();

  // Modbus digital (coil/discrete) → ATIVO/INATIVO.
  if (type && (type.includes('COIL') || type.includes('DISCRETE'))) {
    return Number(value) !== 0 ? 'ATIVO' : 'INATIVO';
  }

  // BACnet binário → ON/OFF.
  const isBacnetBinary = type ? ['BI', 'BO', 'BV'].includes(type) : false;
  if (isBacnetBinary) return Number(value) !== 0 ? 'ON' : 'OFF';
  if (typeof value === 'boolean') return value ? 'ON' : 'OFF';

  if (typeof value === 'number') {
    const num = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
    return unit ? `${num} ${unit}` : num;
  }
  return String(value);
}
