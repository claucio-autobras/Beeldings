'use client';

import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import { useAuthStore } from '@/modules/auth/store/auth.store';
import { useTenantFilter } from '@/hooks/useTenantFilter';
import {
  acquireTelemetrySocket,
  releaseTelemetrySocket,
  setTelemetryScope,
} from '@/lib/telemetry-socket';

/**
 * Um ponto de telemetria recebido via Socket.IO do backend.
 */
export interface TelemetryPoint {
  tag: string;
  /** Presentes em pontos BACnet/virtuais; ausentes em protocolos por tag (Modbus, SNMP). */
  objectType?: number;
  objectInstance?: number;
  /** Numérico na maioria dos pontos; string para CharacterString Value (BACnet tipo 40). */
  value: number | string | null;
  unit: string | null;
  /** Estado da leitura (câmeras CFTV): waiting_event/unsupported/error/estimated. */
  state?: string;
  /** Valor sentinela do firmware (câmeras CFTV) — dado não confiável. */
  unreliable?: boolean;
}

/**
 * Payload do evento bacnet:telemetry.
 */
interface BacnetTelemetryEvent {
  timestamp: string;
  deviceId: string;
  points: TelemetryPoint[];
}

/**
 * Chave de lookup: `{objectType}:{objectInstance}`
 * Permite matcher pontos da telemetria com pontos do dispositivo
 * independente do tag name (que pode diferir entre config estática e MPROG).
 */
export type TelemetryKey = string;

export interface TelemetryEntry {
  value: number | string | null;
  unit: string | null;
  timestamp: string;
  /**
   * Estado da leitura (câmeras CFTV): 'waiting_event' | 'unsupported' |
   * 'error' | 'estimated' — ausente = leitura real do hardware.
   */
  state?: string;
  /** Valor sentinela do firmware (ex.: 0 fixo da Intelbras) — dado não confiável. */
  unreliable?: boolean;
}

export type TelemetryMap = Map<TelemetryKey, TelemetryEntry>;

/**
 * Gera a chave de lookup para um ponto BACnet.
 */
export function telemetryKey(objectType: number | string, objectInstance: number): TelemetryKey {
  return `${objectType}:${objectInstance}`;
}

/**
 * Gera a chave de lookup ISOLADA por dispositivo: `{deviceId}:{objectType}:{objectInstance}`.
 * Usada por pontos virtuais (bancada), cujo `objectType:instance` pode colidir
 * com o de controladoras reais — o `deviceId` garante que cada ponto virtual só
 * receba a própria telemetria.
 */
export function deviceTelemetryKey(
  deviceId: string,
  objectType: number | string,
  objectInstance: number,
): TelemetryKey {
  return `${deviceId}:${objectType}:${objectInstance}`;
}

/**
 * Gera a chave de lookup ISOLADA por dispositivo para protocolos SEM
 * objectType/instance (ex.: SNMP/CFTV): `{deviceId}:tag:{tag}`. Diferente do
 * índice global `byTag`, não colide entre dispositivos que usam os mesmos
 * nomes de tag (toda câmera tem STATUS/UPTIME/...).
 */
export function deviceTagKey(deviceId: string, tag: string): TelemetryKey {
  return `${deviceId}:tag:${tag}`;
}

interface UseBacnetTelemetryOptions {
  /** Filtra eventos de telemetria para um deviceId específico (do config estático do gateway). */
  deviceIdFilter?: string;
  /** Desabilita a conexão (útil quando o componente não está visível). */
  enabled?: boolean;
  /**
   * Timeout em ms após o qual `initialLoad` é forçado para false mesmo sem telemetria.
   * Evita que o skeleton fique infinito se o gateway estiver offline. Padrão: 10000ms.
   */
  initialLoadTimeoutMs?: number;
}

interface UseBacnetTelemetryResult {
  /** Mapa de TelemetryKey → última leitura recebida */
  telemetry: TelemetryMap;
  /**
   * Mapa de `tag` → última leitura. Usado por protocolos sem objectType/instance
   * (ex.: Modbus, cuja telemetria casa por tag). Combine com `deviceIdFilter`
   * para garantir unicidade do tag dentro do dispositivo.
   */
  byTag: TelemetryMap;
  /**
   * Mapa de `{deviceId}:{objectType}:{objectInstance}` → última leitura. Usado
   * por pontos virtuais (bancada), que precisam de isolamento por dispositivo
   * para não casar com controladoras reais de mesmo objectType:instance.
   */
  byDevice: TelemetryMap;
  /**
   * true enquanto aguarda a PRIMEIRA telemetria (loading inicial).
   * Forçado para false após `initialLoadTimeoutMs` mesmo sem dados.
   */
  initialLoad: boolean;
  /** true se conectado ao backend */
  connected: boolean;
  /** Timestamp da última atualização */
  lastUpdate: string | null;
}

const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === 'true';

/**
 * useBacnetTelemetry
 *
 * Conecta ao namespace Socket.IO /telemetry do backend (porta 4000)
 * e mantém um mapa atualizado com os últimos valores recebidos.
 *
 * Os pontos são indexados por `objectType:objectInstance` — desta forma
 * o componente consegue correlacionar os valores mesmo quando o tag
 * name da config estática do gateway difere do nome MPROG configurado.
 *
 * @example
 * const { telemetry, connected } = useBacnetTelemetry({ enabled: true });
 * const entry = telemetry.get(telemetryKey(3, 0)); // BV instância 0
 */
export function useBacnetTelemetry({
  deviceIdFilter,
  enabled = true,
  initialLoadTimeoutMs = 10_000,
}: UseBacnetTelemetryOptions = {}): UseBacnetTelemetryResult {
  const [telemetry, setTelemetry] = useState<TelemetryMap>(new Map());
  const [byTag, setByTag] = useState<TelemetryMap>(new Map());
  const [byDevice, setByDevice] = useState<TelemetryMap>(new Map());
  const [connected, setConnected] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSession = useAuthStore((s) => s.session !== null);
  const { selectedTenantId } = useTenantFilter();

  useEffect(() => {
    // Modo demonstração: sem backend de telemetria, não abre socket.
    if (!enabled || USE_MOCK) {
      setInitialLoad(false);
      return;
    }

    // Sem sessão não há como autenticar o handshake (cookie HttpOnly) — o
    // backend recusaria. Aguarda a hidratação (o efeito reroda quando chega).
    if (!hasSession) {
      setInitialLoad(false);
      return;
    }

    // Timeout de segurança: se o gateway não responder, desbloqueamos a UI
    timeoutRef.current = setTimeout(() => {
      setInitialLoad(false);
    }, initialLoadTimeoutMs);

    // Socket COMPARTILHADO do namespace /telemetry (ver lib/telemetry-socket):
    // um único socket por página, sem conectar/derrubar em re-render/StrictMode.
    const socket = acquireTelemetrySocket();

    socketRef.current = socket;

    // Estado inicial: o socket compartilhado pode já estar conectado.
    setConnected(socket.connected);

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    const onConnectError = () => {
      setConnected(false);
      // Se não conseguiu conectar, não faz sentido manter o skeleton
      setInitialLoad(false);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);

    const onTelemetry = (event: BacnetTelemetryEvent) => {
      if (deviceIdFilter && event.deviceId !== deviceIdFilter) return;

      setTelemetry((prev) => {
        const next = new Map(prev);
        for (const pt of event.points) {
          if (pt.objectType === undefined || pt.objectInstance === undefined) continue;
          const key = telemetryKey(pt.objectType, pt.objectInstance);
          next.set(key, {
            value: pt.value,
            unit: pt.unit,
            timestamp: event.timestamp,
            ...(pt.state ? { state: pt.state } : {}),
            ...(pt.unreliable ? { unreliable: true } : {}),
          });
        }
        return next;
      });

      // Índice isolado por dispositivo — para pontos virtuais (bancada), cujo
      // objectType:instance pode colidir com controladoras reais.
      setByDevice((prev) => {
        const next = new Map(prev);
        for (const pt of event.points) {
          const entry = {
            value: pt.value,
            unit: pt.unit,
            timestamp: event.timestamp,
            ...(pt.state ? { state: pt.state } : {}),
            ...(pt.unreliable ? { unreliable: true } : {}),
          };
          // Pontos com objectType/instance (BACnet, virtuais)
          if (pt.objectType !== undefined && pt.objectInstance !== undefined) {
            next.set(deviceTelemetryKey(event.deviceId, pt.objectType, pt.objectInstance), entry);
          }
          // Índice por device+tag — protocolos sem objectType (SNMP, Modbus)
          if (pt.tag) {
            next.set(deviceTagKey(event.deviceId, pt.tag), entry);
          }
        }
        return next;
      });

      // Índice por tag — para protocolos sem objectType/instance (Modbus).
      setByTag((prev) => {
        const next = new Map(prev);
        for (const pt of event.points) {
          if (!pt.tag) continue;
          next.set(pt.tag, {
            value: pt.value,
            unit: pt.unit,
            timestamp: event.timestamp,
            ...(pt.state ? { state: pt.state } : {}),
            ...(pt.unreliable ? { unreliable: true } : {}),
          });
        }
        return next;
      });

      // Primeira telemetria recebida — encerra o loading inicial
      setInitialLoad(false);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setLastUpdate(event.timestamp);
    };
    socket.on('bacnet:telemetry', onTelemetry);

    return () => {
      // Remove SÓ os listeners deste hook — o socket é compartilhado; quem
      // decide desconectar é o release (refcount + linger) do módulo.
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('bacnet:telemetry', onTelemetry);
      releaseTelemetrySocket();
      socketRef.current = null;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [enabled, deviceIdFilter, initialLoadTimeoutMs, hasSession]);

  // Escopo de tenant (papéis globais): reemite no socket compartilhado sem
  // reconectar — trocar o filtro não pode derrubar o socket dos demais hooks.
  useEffect(() => {
    if (!enabled || USE_MOCK || !hasSession) return;
    setTelemetryScope(selectedTenantId ?? null);
  }, [enabled, hasSession, selectedTenantId]);

  return { telemetry, byTag, byDevice, connected, initialLoad, lastUpdate };
}
