/**
 * Utilitários para rotulagem de interfaces em métricas SNMP.
 *
 * Extraídos de SnmpHealthMetrics para serem testáveis de forma isolada:
 * não dependem de React nem de DOM.
 */

import type { SnmpInfoEntry } from '../services/cftv.service';

/**
 * Prefixo OID do ifDescr (IF-MIB): 1.3.6.1.2.1.2.2.1.2.<índice>.
 * As últimas instâncias numéricas identificam a interface (1 = eth0, 2 = lo…).
 */
export const IF_DESCR_OID_PREFIX = '1.3.6.1.2.1.2.2.1.2.';

/**
 * Constrói um mapa de índice de interface → nome a partir de entradas snmpInfo.
 * Entradas ifDescr são excluídas da exibição solta e viram rótulo das métricas.
 */
export function buildIfNameIndex(snmpInfo: SnmpInfoEntry[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const e of snmpInfo) {
    if (e.oid.startsWith(IF_DESCR_OID_PREFIX)) {
      const idx = Number(e.oid.slice(IF_DESCR_OID_PREFIX.length));
      if (Number.isFinite(idx) && idx > 0) map.set(idx, e.value);
    }
  }
  return map;
}

/**
 * Retorna o sufixo " — <nome da interface>" para métricas de rede quando o
 * OID do ponto tem um índice de instância mapeado a uma interface conhecida.
 * Retorna string vazia para pontos não-rede ou quando a interface é desconhecida.
 */
export function getIfLabelSuffix(
  oid: string | null,
  category: string,
  ifNameByIndex: Map<number, string>,
): string {
  if (!oid || category !== 'network' || ifNameByIndex.size === 0) return '';
  const lastDot = oid.lastIndexOf('.');
  if (lastDot === -1) return '';
  const idx = Number(oid.slice(lastDot + 1));
  if (!Number.isFinite(idx) || idx <= 0) return '';
  const name = ifNameByIndex.get(idx);
  return name ? ` — ${name}` : '';
}
