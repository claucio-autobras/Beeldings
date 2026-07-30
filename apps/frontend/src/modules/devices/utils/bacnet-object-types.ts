/**
 * Helpers de tipo de objeto BACnet — compartilhados pela tabela/cards de pontos
 * (BACnetDeviceDetail) e pelo controle de "Forçar valor".
 *
 * Centraliza o mapa de tipo → número BACnet e as classificações (digital,
 * multi-state, comandável) para evitar divergência entre desktop e mobile.
 */

/** Mapa de tipo (string) → número do objeto BACnet. */
export const OBJECT_TYPE_NUM: Record<string, number> = {
  AI: 0, AO: 1, AV: 2, BI: 3, BO: 4, BV: 5, MSI: 13, MSO: 14,
};

/** Converte o tipo (string ou já numérico) para o número BACnet usado na escrita. */
export function objectTypeToNum(t: string | number): number {
  if (typeof t === 'number') return t;
  return OBJECT_TYPE_NUM[t] ?? 0;
}

/** Digitais (binários) — exibidos e comandados como ATIVO/INATIVO (1/0). */
export function isDigital(objectType: string | number): boolean {
  const t = String(objectType);
  return ['BI', 'BO', 'BV', '3', '4', '5'].includes(t);
}

/** Multi-state (MSI/MSO) — valor é o número do estado. */
export function isMultiState(objectType: string | number): boolean {
  const t = String(objectType);
  return ['MSI', 'MSO', '13', '14'].includes(t);
}

/**
 * Tipos comandáveis (saídas/valores): AO, AV, BO, BV, MSO.
 * Entradas (AI/BI/MSI) são somente leitura e NÃO aceitam escrita por protocolo.
 */
const COMMANDABLE_TYPES = new Set(['AO', 'AV', 'BO', 'BV', 'MSO', '1', '2', '4', '5', '14']);

/** true se o ponto é de um tipo BACnet que aceita escrita (comandável). */
export function isCommandable(objectType: string | number): boolean {
  return COMMANDABLE_TYPES.has(String(objectType));
}
