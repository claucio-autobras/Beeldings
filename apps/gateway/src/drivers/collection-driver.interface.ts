/**
 * Interfaces comuns do sistema de drivers de coleta.
 *
 * Um driver é o adaptador responsável por coletar telemetria de um tipo de
 * dispositivo monitorado (câmera, switch, NVR…) usando um protocolo específico
 * (SNMP, ONVIF, ping, HTTP). Cada instância de driver é criada por device e
 * mantém estado entre ciclos (conexões, identification cache, event values…).
 *
 * Interface mínima para o motor de orquestração (fase 2+). Em fase 1 os
 * drivers são instanciados diretamente pelos PollingServices protocolo a
 * protocolo — o DriverRegistry existe mas não é usado pelos serviços ainda.
 */

import type { ResolvedProfile } from '../profiles/types';

export type { ResolvedProfile };

/** Ponto de telemetria publicado por um driver. */
export interface DriverTelemetryPoint {
  tag: string;
  value: number | null;
  unit: string | null;
  /** Estado qualitativo quando o valor não é leitura direta do hardware. */
  state?: 'estimated' | 'unsupported' | 'waiting_event' | 'error';
  /** true quando o valor casou com sentinela de bug de firmware. */
  unreliable?: boolean;
  /** Fonte/camada vencedora (diagnóstico): 'mib2' | 'vendor' | 'http' | 'ping' | 'oid'. */
  source?: string;
}

/** Resultado de um ciclo de coleta. */
export interface CollectOutput {
  /** true quando o dispositivo respondeu (SNMP/ONVIF/ping). */
  reachable: boolean;
  /** Pontos de telemetria prontos para publicação. */
  points: DriverTelemetryPoint[];
}

/**
 * Interface do driver de coleta.
 *
 * Um driver:
 * - É stateful (mantém conexão + identification cache entre ciclos).
 * - É criado por device (um driver por device ativo).
 * - É descartado quando o device é removido da config (dispose()).
 * - Nunca publica diretamente no broker — retorna pontos ao chamador.
 */
export interface CollectionDriver {
  /**
   * ID do protocolo que este driver implementa ('snmp', 'onvif', etc.).
   * Usado pelo DriverRegistry como chave de lookup.
   */
  readonly protocol: string;

  /**
   * Executa um ciclo de coleta completo.
   * Deve retornar mesmo em caso de falha (nunca rejeita); falhas de
   * transporte resultam em `reachable: false` com todos os pontos null.
   */
  collect(): Promise<CollectOutput>;

  /**
   * Libera recursos do driver (conexões, timers, listeners).
   * Chamado pelo serviço quando o device é removido da config.
   */
  dispose(): void;
}
