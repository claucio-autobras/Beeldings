import type { OfflineOriginEntry } from '../services/dashboard.service';

/**
 * Roteamento de clique da barra/tooltip de "Quedas (offline)" do card
 * "Alarmes e quedas no período" (dashboard Admin): cada queda pertence a um
 * cliente + dispositivo/gateway já classificado pela tela dona daquela
 * categoria (Dispositivos, CFTV ou SCA). Resolve a URL de destino já
 * filtrada pelo cliente, para o Admin não precisar reselecionar manualmente
 * (as próprias telas de destino aplicam ?tenantId=/?tenantName= no filtro
 * global ao montar — ver devices.page.tsx e cftv-sca.page.tsx).
 *
 * Separado em módulo puro (mesma convenção de criticalAssetClick.ts) para
 * ficar testável sem montar o componente do gráfico.
 */

/** URL de destino para uma origem de queda específica, filtrada pelo cliente dono. */
export function resolveOfflineDropHref(entry: OfflineOriginEntry): string {
  const params = new URLSearchParams({ tenantId: entry.tenantId, tenantName: entry.tenantName });
  if (entry.category === 'cftv') return `/cftv-sca?tab=cftv&${params.toString()}`;
  if (entry.category === 'sca') return `/cftv-sca?tab=sca&${params.toString()}`;
  // 'devices': BMS/IoT com categoria clara ganha deep-link até o equipamento;
  // gateway sem device próprio só filtra pelo cliente (destino ainda sensato).
  if (entry.entityType !== 'gateway') params.set('deviceId', entry.entityId);
  return `/devices?${params.toString()}`;
}

/**
 * Destino da origem "principal" (maior contagem) de um bucket — usado quando
 * o clique é na barra em si, sem escolher um item específico do tooltip.
 * `entries` deve já vir ordenado por contagem desc (contrato do backend).
 */
export function resolveTopOfflineDropHref(entries: OfflineOriginEntry[]): string | null {
  if (entries.length === 0) return null;
  return resolveOfflineDropHref(entries[0]);
}
