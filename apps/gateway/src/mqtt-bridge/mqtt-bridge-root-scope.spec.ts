import { ConfigService } from '@nestjs/config';
import { MqttBridgeService } from './mqtt-bridge.service';
import type { GatewayMqttService } from '../mqtt/gateway-mqtt.service';
import type { PollingMetricsService } from '../observability/polling-metrics.service';

jest.mock('mqtt', () => {
  const handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
  const client = {
    on: jest.fn((event: string, cb: (...args: unknown[]) => void) => {
      (handlers[event] ??= []).push(cb);
      return client;
    }),
    subscribe: jest.fn(),
    unsubscribe: jest.fn(),
    publish: jest.fn(
      (_t: string, _p: string, _o: unknown, cb?: (err?: Error) => void) => cb?.(),
    ),
    end: jest.fn(),
    __handlers: handlers,
  };
  return { connect: jest.fn(() => client), __client: client };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const mqttMock = require('mqtt') as {
  __client: { subscribe: jest.Mock; __handlers: Record<string, Array<(...args: unknown[]) => void>> };
};

const config = {
  get: (key: string, def?: string) => {
    if (key === 'TENANT_ID') return 'tenant-a';
    if (key === 'GATEWAY_ID') return 'gw-1';
    return def;
  },
} as unknown as ConfigService;

const gatewayMqtt = { publish: jest.fn() } as unknown as GatewayMqttService;
const pollingMetrics = { recordBridgeMessage: jest.fn() } as unknown as PollingMetricsService;

/**
 * Regressão: a regra de escopo do raiz no gateway deve ser IDÊNTICA à do
 * backend — só o namespace interno exato ('bluebee' ou 'bluebee/…') é
 * proibido. Um raiz como 'bluebeex' (quase-prefixo) é válido no cadastro e
 * PRECISA ser bridge-elegível aqui, senão o device é criado mas nunca flui.
 */
describe('MqttBridgeService — escopo do tópico raiz próprio', () => {
  let service: MqttBridgeService;

  const configFor = (rootTopic: string) => ({
    topic: 'bluebee/tenant-a/gateway/gw-1/config',
    message: {
      devices: [
        {
          protocol: 'mqtt',
          deviceId: 'dev-1',
          rootTopic,
          heartbeat: { topic: `${rootTopic}/status`, timeoutSeconds: 60 },
          bridge: [
            { sourceTopic: `${rootTopic}/update/sensor/NTC1`, tag: 'NTC1', jsonPath: '', valueType: 'number' },
          ],
        },
      ],
    } as unknown as Record<string, unknown>,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(mqttMock.__client.__handlers)) {
      delete mqttMock.__client.__handlers[key];
    }
    service = new MqttBridgeService(gatewayMqtt, config, pollingMetrics);
  });

  it('aceita raiz quase-prefixo (bluebeex) — assina bindings e heartbeat', () => {
    service.handleConfigMessage(configFor('bluebeex'));
    const subscribed = mqttMock.__client.subscribe.mock.calls.map((c) => c[0] as string);
    expect(subscribed).toContain('bluebeex/update/sensor/NTC1');
    expect(subscribed).toContain('bluebeex/status');
  });

  it('aceita raiz fora do namespace interno (008065)', () => {
    service.handleConfigMessage(configFor('008065'));
    const subscribed = mqttMock.__client.subscribe.mock.calls.map((c) => c[0] as string);
    expect(subscribed).toContain('008065/update/sensor/NTC1');
    expect(subscribed).toContain('008065/status');
  });

  it('rejeita raiz dentro do namespace interno (bluebee/evil) — nada assinado fora do prefixo de sensores', () => {
    service.handleConfigMessage(configFor('bluebee/evil'));
    const subscribed = mqttMock.__client.subscribe.mock.calls.map((c) => c[0] as string);
    expect(subscribed).not.toContain('bluebee/evil/update/sensor/NTC1');
    expect(subscribed).not.toContain('bluebee/evil/status');
  });
});
