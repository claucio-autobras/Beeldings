/**
 * Filtro de portas descobertas via IF-MIB (Bug 3 — loopback monitorado).
 *
 * Regras (RFC 1573):
 *   - ifType 24 (softwareLoopback) NUNCA é porta monitorável — some da lista
 *     (era a origem do "PACOTES PERDIDOS — LO");
 *   - ifOperStatus 2 (down) continua VISÍVEL na lista, mas é omitida da
 *     criação automática de pontos (recomendação) — o operador ainda a vê e
 *     pode agir, mas nada é monitorado por suposição.
 *
 * Campos ausentes (agente que não expõe ifType/ifOperStatus) não escondem a
 * porta — falha explícita > filtro silencioso.
 */
import {
  IF_OPER_STATUS_DOWN,
  SOFTWARE_LOOPBACK_IF_TYPE,
} from './snmp-oid-semantics.js';

export interface DiscoveredPortLike {
  ifIndex: number;
  ifType?: number | null;
  ifOperStatus?: number | null;
}

export function isLoopbackPort(port: DiscoveredPortLike): boolean {
  return port.ifType === SOFTWARE_LOOPBACK_IF_TYPE;
}

export function isDownPort(port: DiscoveredPortLike): boolean {
  return port.ifOperStatus === IF_OPER_STATUS_DOWN;
}

export interface PartitionedPorts<T> {
  /** Portas exibidas ao operador (sem loopback). */
  visible: T[];
  /** Portas elegíveis à criação automática de pontos (sem loopback nem down). */
  creatable: T[];
}

export function partitionDiscoveredPorts<T extends DiscoveredPortLike>(
  ports: T[],
): PartitionedPorts<T> {
  const visible = ports.filter((p) => !isLoopbackPort(p));
  const creatable = visible.filter((p) => !isDownPort(p));
  return { visible, creatable };
}
