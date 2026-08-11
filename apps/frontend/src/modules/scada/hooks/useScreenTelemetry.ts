'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { useBacnetTelemetry } from '@/hooks/useBacnetTelemetry';
import type { TelemetryEntry } from '@/hooks/useBacnetTelemetry';
import { resolveTelemetryEntry } from './telemetry-lookup';
import {
  getPendingCommand,
  clearPendingCommand,
  subscribePendingCommands,
  pendingCommandsVersion,
} from '../store/pending-commands.store';
import type { ScreenDevice, VirtualPoint } from '../types/virtual.types';

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
 * Protocolos cujos pontos têm último valor persistido (DevicePoint.lastValue):
 * câmeras CFTV (snmp/onvif) e dispositivos MQTT comuns (publish-on-change,
 * ex.: Aeris — sem seed a tela ficaria "sem dados" por minutos).
 */
function hasPersistedSeed(protocol: string): boolean {
  return protocol === 'snmp' || protocol === 'onvif' || protocol === 'mqtt';
}

/**
 * Seed persistido de um ponto (lastValue/lastValueAt) — igual ao
 * `liveOrSeed` da área CFTV: mostra o status imediatamente ao abrir a tela,
 * antes do primeiro pacote de telemetria chegar. Sem leitura persistida
 * (lastValueAt null), retorna null — nunca inventa valor.
 */
function persistedSeed(point: unknown): PointReading | null {
  const p = point as { lastValue?: number | null; lastValueAt?: string | null };
  if (!p || typeof p !== 'object') return null;
  // Leitura persistida completa (valor + horário).
  if (p.lastValueAt) return { value: p.lastValue ?? null, timestamp: p.lastValueAt };
  // lastValue sem lastValueAt (registros antigos/ingestões parciais): ainda é
  // "com dado" — timestamp null deixa claro que o frescor é desconhecido.
  if (p.lastValue !== null && p.lastValue !== undefined) {
    return { value: p.lastValue, timestamp: null };
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
  const { telemetry, byDevice, connected } = useBacnetTelemetry({ enabled });

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

  /**
   * Resolve a entrada de telemetria AO VIVO de um ponto (ou null se não houver).
   * A regra de resolução (incluindo o isolamento por deviceId+tag que impede
   * dois devices de mesma tag de vazar valor um no outro) vive na função pura
   * `resolveTelemetryEntry` — coberta por testes em telemetry-lookup.spec.ts.
   */
  function lookup(deviceId: string, tag: string): TelemetryEntry | null {
    return resolveTelemetryEntry({ telemetry, byDevice }, devices, deviceId, tag);
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

    // Câmeras CFTV e dispositivos MQTT: fallback para o último valor persistido
    // no backend (seed) — o valor aparece imediatamente ao abrir a tela e a
    // telemetria ao vivo sempre sobrescreve (checagem `live` acima).
    if (hasPersistedSeed(resolved.dev.protocol)) {
      return persistedSeed(resolved.point)?.value ?? null;
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
    if (hasPersistedSeed(resolved.dev.protocol)) {
      return persistedSeed(resolved.point);
    }
    return null;
  }

  function getPointStatus(deviceId: string, tag: string): PointStatus {
    const resolved = resolvePoint(deviceId, tag);
    if (!resolved) return 'no-data';

    // Pontos virtuais têm sempre um valor autoritativo do cadastro → nunca "offline".
    if (resolved.dev.protocol === 'virtual') return 'live';

    const entry = lookup(deviceId, tag);

    // Seed persistido (câmeras e MQTT publish-on-change): o ponto TEM dado.
    // Vale como fallback SEMPRE que a leitura ao vivo estiver ausente, velha
    // ou o socket ainda estiver (re)conectando — sem isso a tela pisca o
    // badge de offline ao abrir e entre publicações normais de telemetria,
    // mesmo com último valor conhecido válido.
    const seeded = hasPersistedSeed(resolved.dev.protocol) && persistedSeed(resolved.point) !== null;

    if (!entry) return seeded ? 'live' : 'no-data';
    if (!connected) return seeded ? 'live' : 'stale';
    const ts = Date.parse(entry.timestamp);
    if (Number.isNaN(ts)) return seeded ? 'live' : 'stale';
    if (Date.now() - ts > STALE_AFTER_MS) return seeded ? 'live' : 'stale';
    return 'live';
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
