import {
  gatewayDetailsHref,
  MAX_VISIBLE_GATEWAYS,
  prioritizeGateways,
  type GatewayDisplayRow,
} from './gatewaysHealthTable.logic';

function gateway(
  id: string,
  status: string = 'online',
  health: GatewayDisplayRow['health'] = null,
): GatewayDisplayRow {
  return { id, status, createdAt: id, health };
}

describe('gateways health table display', () => {
  it('gera o link da tela de detalhes para o gateway selecionado', () => {
    expect(gatewayDetailsHref('gw escritório/04')).toBe(
      '/admin/gateways?gatewayId=gw%20escrit%C3%B3rio%2F04',
    );
  });

  it('shows at most five gateways and puts offline gateways first', () => {
    const rows = [
      gateway('online-1'),
      gateway('online-2'),
      gateway('offline-1', 'offline'),
      gateway('unstable-1', 'online', {
        mqtt: { connected: false },
        storeAndForward: { pending: 0 },
      }),
      gateway('online-3'),
      gateway('offline-2', 'offline'),
      gateway('online-4'),
    ];

    expect(prioritizeGateways(rows).map((row) => row.id)).toEqual([
      'offline-1',
      'offline-2',
      'unstable-1',
      'online-1',
      'online-2',
    ]);
    expect(prioritizeGateways(rows)).toHaveLength(MAX_VISIBLE_GATEWAYS);
  });

  it('keeps the first five when every gateway is online and stable', () => {
    const rows = Array.from({ length: 7 }, (_, index) => gateway(`gateway-${index + 1}`));

    expect(prioritizeGateways(rows).map((row) => row.id)).toEqual([
      'gateway-1',
      'gateway-2',
      'gateway-3',
      'gateway-4',
      'gateway-5',
    ]);
  });
});