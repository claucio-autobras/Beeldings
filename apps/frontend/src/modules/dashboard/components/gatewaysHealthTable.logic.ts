export interface GatewayDisplayRow {
  id: string;
  status: string;
  createdAt: string;
  health?: {
    mqtt: { connected: boolean; reconnectCount?: number };
    storeAndForward: { pending: number };
  } | null;
}

export const MAX_VISIBLE_GATEWAYS = 5;

export function gatewayDetailsHref(gatewayId: string): string {
  return `/admin/gateways?gatewayId=${encodeURIComponent(gatewayId)}`;
}

/**
 * Mantém a ordem original quando os gateways têm a mesma prioridade.
 * Offline vem primeiro; em seguida gateways instáveis; por fim os demais.
 */
export function prioritizeGateways<T extends GatewayDisplayRow>(gateways: T[]): T[] {
  const priority = (gateway: GatewayDisplayRow): number => {
    if (gateway.status !== 'online') return 2;
    if (
      gateway.health &&
      (!gateway.health.mqtt.connected ||
        gateway.health.storeAndForward.pending > 0 ||
        (gateway.health.mqtt.reconnectCount ?? 0) > 0)
    ) {
      return 1;
    }
    return 0;
  };

  return gateways
    .map((gateway, index) => ({ gateway, index }))
    .sort((a, b) => priority(b.gateway) - priority(a.gateway) || a.index - b.index)
    .slice(0, MAX_VISIBLE_GATEWAYS)
    .map(({ gateway }) => gateway);
}