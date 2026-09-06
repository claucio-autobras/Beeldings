import { ConfigService } from '@nestjs/config';
import { MqttBridgeService, MqttWriteCommand } from './mqtt-bridge.service';
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
  connect: jest.Mock;
  __client: {
    subscribe: jest.Mock;
    unsubscribe: jest.Mock;
    publish: jest.Mock;
    end: jest.Mock;
    __handlers: Record<string, Array<(...args: unknown[]) => void>>;
  };
};

const PREFIX = 'bluebee/tenant-a/gateway/gw-1/sensors/';

describe('MqttBridgeService — escrita MQTT', () => {
  let service: MqttBridgeService;
  let publishedResults: Array<Record<string, unknown>>;

  let publishedTelemetry: Array<Record<string, unknown>>;

  const gatewayMqtt = {
    publish: jest.fn((topic: string, payload: Record<string, unknown>) => {
      if (topic.endsWith('/commands/result')) publishedResults.push(payload);
      if (topic.endsWith('/telemetry')) publishedTelemetry.push(payload);
    }),
  } as unknown as GatewayMqttService;

  const pollingMetrics = { recordBridgeMessage: jest.fn() } as unknown as PollingMetricsService;

  const config = {
    get: (key: string, def?: string) => {
      if (key === 'TENANT_ID') return 'tenant-a';
      if (key === 'GATEWAY_ID') return 'gw-1';
      return def;
    },
  } as unknown as ConfigService;

  const command = (over: Partial<MqttWriteCommand> = {}): MqttWriteCommand => ({
    command_id: 'mqtt-write-1',
    tenant_id: 'tenant-a',
    gateway_id: 'gw-1',
    commandTopic: `${PREFIX}shelly1/rpc`,
    payload: '{"id":42,"src":"resp","method":"Switch.Set","params":{"id":0,"on":true}}',
    responseTopic: `${PREFIX}shelly1/resp/rpc`,
    matchId: 42,
    matchValue: null,
    confirm: null,
    ...over,
  });

  /** Simula uma mensagem chegando na conexão dedicada do bridge. */
  const deliver = (topic: string, payload: string) => {
    for (const cb of mqttMock.__client.__handlers['message'] ?? []) {
      cb(topic, Buffer.from(payload));
    }
  };

  beforeEach(() => {
    jest.useFakeTimers();
    publishedResults = [];
    publishedTelemetry = [];
    jest.clearAllMocks();
    for (const key of Object.keys(mqttMock.__client.__handlers)) {
      delete mqttMock.__client.__handlers[key];
    }
    service = new MqttBridgeService(gatewayMqtt, config, pollingMetrics);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('confirma o comando quando a resposta RPC chega com o id casado', () => {
    service.handleWriteCommand(command());

    // Assina o tópico de resposta e publica o comando
    expect(mqttMock.__client.subscribe).toHaveBeenCalledWith(
      `${PREFIX}shelly1/resp/rpc`,
      { qos: 0 },
      expect.any(Function),
    );
    expect(mqttMock.__client.publish).toHaveBeenCalledWith(
      `${PREFIX}shelly1/rpc`,
      expect.stringContaining('Switch.Set'),
      { qos: 1 },
      expect.any(Function),
    );

    deliver(`${PREFIX}shelly1/resp/rpc`, JSON.stringify({ id: 42, result: { was_on: false } }));

    expect(publishedResults).toHaveLength(1);
    expect(publishedResults[0]).toMatchObject({
      command_id: 'mqtt-write-1',
      success: true,
      confirmed: true,
    });
  });

  it('ignora respostas com id diferente; no timeout reporta "enviado, sem confirmação" (success + confirmed=false)', () => {
    service.handleWriteCommand(command());

    deliver(`${PREFIX}shelly1/resp/rpc`, JSON.stringify({ id: 999, result: {} }));
    expect(publishedResults).toHaveLength(0);

    jest.advanceTimersByTime(10_000);
    expect(publishedResults).toHaveLength(1);
    // Timeout de confirmação ≠ falha dura: o comando foi publicado (o relé
    // tipicamente atuou) — só a resposta RPC não casou. Nada de erro falso.
    expect(publishedResults[0]).toMatchObject({
      command_id: 'mqtt-write-1',
      success: true,
      confirmed: false,
    });
    expect(publishedResults[0].error).toBeUndefined();
  });

  it('reporta falha quando a resposta RPC traz error', () => {
    service.handleWriteCommand(command());

    deliver(
      `${PREFIX}shelly1/resp/rpc`,
      JSON.stringify({ id: 42, error: { code: -103, message: 'Invalid argument' } }),
    );

    expect(publishedResults[0]).toMatchObject({
      command_id: 'mqtt-write-1',
      success: false,
      confirmed: false,
      error: 'Invalid argument',
    });
  });

  it('sem responseTopic → sucesso "enviado" (confirmed=false)', () => {
    service.handleWriteCommand(command({ responseTopic: null, matchId: null }));

    expect(mqttMock.__client.subscribe).not.toHaveBeenCalled();
    expect(publishedResults[0]).toMatchObject({
      command_id: 'mqtt-write-1',
      success: true,
      confirmed: false,
    });
  });

  it('rejeita tópico de comando fora do namespace de sensores', () => {
    service.handleWriteCommand(command({ commandTopic: 'bluebee/OUTRO/gateway/gw-1/sensors/x/rpc' }));

    expect(mqttMock.__client.publish).not.toHaveBeenCalled();
    expect(publishedResults[0]).toMatchObject({ command_id: 'mqtt-write-1', success: false });
    expect(String(publishedResults[0].error)).toContain('fora do escopo permitido');
  });

  it('desassina o tópico de resposta assinado só para a escrita, após concluir', () => {
    service.handleWriteCommand(command());
    deliver(`${PREFIX}shelly1/resp/rpc`, JSON.stringify({ id: 42, result: {} }));

    expect(mqttMock.__client.unsubscribe).toHaveBeenCalledWith(`${PREFIX}shelly1/resp/rpc`);
  });

  const CONFIRM = { deviceId: 'dev-1', tag: 'rele_estado', value: 1, unit: null };

  it('publica telemetria confirmada pós-escrita quando a resposta RPC valida o comando', () => {
    service.handleWriteCommand(command({ confirm: CONFIRM }));
    deliver(`${PREFIX}shelly1/resp/rpc`, JSON.stringify({ id: 42, result: { was_on: false } }));

    expect(publishedTelemetry).toHaveLength(1);
    expect(publishedTelemetry[0]).toMatchObject({
      deviceId: 'dev-1',
      points: [{ tag: 'rele_estado', value: 1, unit: null }],
    });
    expect(typeof publishedTelemetry[0].timestamp).toBe('string');
  });

  it('confirma por READBACK: eco do novo estado no sourceTopic confirma a escrita mesmo sem resposta RPC', () => {
    const statusTopic = `${PREFIX}shelly1/status/switch:0`;
    (service as unknown as { applyConfig: (d: unknown[]) => void }).applyConfig([
      {
        deviceId: 'dev-1',
        name: 'Shelly',
        protocol: 'mqtt',
        bridge: [
          { tag: 'rele_estado', sourceTopic: statusTopic, jsonPath: 'output', valueType: 'boolean', unit: null },
        ],
      },
    ]);

    service.handleWriteCommand(command({ confirm: CONFIRM }));

    // O Shelly atua e publica o NOVO estado no tópico de status — a resposta
    // RPC nunca chega (tópico/id errado). A escrita deve confirmar na hora.
    deliver(statusTopic, JSON.stringify({ output: true }));

    expect(publishedResults).toHaveLength(1);
    expect(publishedResults[0]).toMatchObject({
      command_id: 'mqtt-write-1',
      success: true,
      confirmed: true,
    });
    // Sem duplicidade: o bridge já republicou o novo estado como telemetria.
    expect(publishedTelemetry).toHaveLength(1);

    // O timeout posterior não gera 2º resultado.
    jest.advanceTimersByTime(10_000);
    expect(publishedResults).toHaveLength(1);
  });

  it('readback com valor ANTIGO não confirma (só o valor comandado conta)', () => {
    const statusTopic = `${PREFIX}shelly1/status/switch:0`;
    (service as unknown as { applyConfig: (d: unknown[]) => void }).applyConfig([
      {
        deviceId: 'dev-1',
        name: 'Shelly',
        protocol: 'mqtt',
        bridge: [
          { tag: 'rele_estado', sourceTopic: statusTopic, jsonPath: 'output', valueType: 'boolean', unit: null },
        ],
      },
    ]);

    service.handleWriteCommand(command({ confirm: CONFIRM }));
    // Estado antigo (0) ≠ comandado (1) → sessão segue aguardando.
    deliver(statusTopic, JSON.stringify({ output: false }));
    expect(publishedResults).toHaveLength(0);
  });

  it('NÃO publica telemetria confirmada em falha, timeout ou sem confirm', () => {
    // Falha RPC
    service.handleWriteCommand(command({ confirm: CONFIRM }));
    deliver(`${PREFIX}shelly1/resp/rpc`, JSON.stringify({ id: 42, error: { code: -1, message: 'x' } }));
    expect(publishedTelemetry).toHaveLength(0);

    // Timeout
    service.handleWriteCommand(command({ command_id: 'mqtt-write-2', confirm: CONFIRM }));
    jest.advanceTimersByTime(10_000);
    expect(publishedTelemetry).toHaveLength(0);

    // Sucesso confirmado, mas comando antigo sem confirm
    service.handleWriteCommand(command({ command_id: 'mqtt-write-3', confirm: null }));
    deliver(`${PREFIX}shelly1/resp/rpc`, JSON.stringify({ id: 42, result: {} }));
    expect(publishedTelemetry).toHaveLength(0);
  });

  it('sem duplicidade: pula a publicação confirmada se o bridge já republicou o novo estado', () => {
    // Configura um binding de bridge para o mesmo device/tag (status espontâneo do Shelly)
    const statusTopic = `${PREFIX}shelly1/status/switch:0`;
    (service as unknown as { applyConfig: (d: unknown[]) => void }).applyConfig([
      {
        deviceId: 'dev-1',
        name: 'Shelly',
        protocol: 'mqtt',
        bridge: [
          { tag: 'rele_estado', sourceTopic: statusTopic, jsonPath: 'output', valueType: 'boolean', unit: null },
        ],
      },
    ]);

    service.handleWriteCommand(command({ confirm: CONFIRM }));

    // O Shelly publica o novo estado ANTES da resposta RPC → bridge republica
    deliver(statusTopic, JSON.stringify({ output: true }));
    expect(publishedTelemetry).toHaveLength(1);

    // A confirmação RPC chega — NÃO deve gerar 2ª publicação
    deliver(`${PREFIX}shelly1/resp/rpc`, JSON.stringify({ id: 42, result: {} }));
    expect(publishedResults[0]).toMatchObject({ success: true, confirmed: true });
    expect(publishedTelemetry).toHaveLength(1);
  });

  it('valor stale do bridge NÃO suprime a telemetria confirmada (só o valor comandado conta)', () => {
    const statusTopic = `${PREFIX}shelly1/status/switch:0`;
    (service as unknown as { applyConfig: (d: unknown[]) => void }).applyConfig([
      {
        deviceId: 'dev-1',
        name: 'Shelly',
        protocol: 'mqtt',
        bridge: [
          { tag: 'rele_estado', sourceTopic: statusTopic, jsonPath: 'output', valueType: 'boolean', unit: null },
        ],
      },
    ]);

    // Comando liga (value=1); o Shelly ainda publica o estado ANTIGO (false → 0)
    service.handleWriteCommand(command({ confirm: CONFIRM }));
    deliver(statusTopic, JSON.stringify({ output: false }));
    expect(publishedTelemetry).toHaveLength(1); // republicação do bridge (valor antigo)

    // A confirmação RPC chega — a telemetria confirmada DEVE ser publicada
    deliver(`${PREFIX}shelly1/resp/rpc`, JSON.stringify({ id: 42, result: {} }));
    expect(publishedTelemetry).toHaveLength(2);
    expect(publishedTelemetry[1]).toMatchObject({
      deviceId: 'dev-1',
      points: [{ tag: 'rele_estado', value: 1, unit: null }],
    });
  });
});
