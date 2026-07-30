import { MqttWriteService, type MqttWriteRequest } from './mqtt-write.service.js';
import type { MqttService } from '../../mqtt/mqtt.service.js';

/**
 * Testes do MqttWriteService — render de payload, pending-before-publish,
 * sucesso/falha/timeout e concorrência (command_id único por escrita).
 */
describe('MqttWriteService', () => {
  let service: MqttWriteService;
  let messageHandler: (topic: string, payload: Buffer) => void;
  let published: Array<{ topic: string; payload: Record<string, unknown>; qos: number }>;
  let publishImpl: () => Promise<void>;

  const mqttMock = {
    subscribe: jest.fn(),
    onMessage: jest.fn((cb: (topic: string, payload: Buffer) => void) => {
      messageHandler = cb;
    }),
    publish: jest.fn((topic: string, payload: Record<string, unknown>, qos: number) => {
      published.push({ topic, payload, qos });
      return publishImpl();
    }),
  } as unknown as MqttService;

  const baseRequest = (): MqttWriteRequest => ({
    tenantId: 'tenant-a',
    gatewayId: 'gw-1',
    deviceId: 'dev-1',
    valueType: 'boolean',
    value: true,
    pointTag: 'rele_estado',
    pointUnit: null,
    topicScope: 'bluebee/tenant-a/gateway/gw-1/sensors/',
    write: {
      commandTopic: 'bluebee/tenant-a/gateway/gw-1/sensors/shelly1/rpc',
      payloadTemplate:
        '{"id":{{id}},"src":"bluebee/tenant-a/gateway/gw-1/sensors/shelly1/resp","method":"Switch.Set","params":{"id":0,"on":{{value}}}}',
      responseTopic: 'bluebee/tenant-a/gateway/gw-1/sensors/shelly1/resp/rpc',
    },
  });

  /** Responde no tópico de resultados com o payload dado, casando o último command_id publicado. */
  const respond = (extra: Record<string, unknown>, index = 0) => {
    const commandId = (published[index].payload as { command_id: string }).command_id;
    messageHandler(
      'bluebee/tenant-a/gateway/gw-1/commands/result',
      Buffer.from(JSON.stringify({ command_id: commandId, ...extra })),
    );
  };

  beforeEach(() => {
    jest.useFakeTimers();
    published = [];
    publishImpl = () => Promise.resolve();
    (mqttMock.subscribe as jest.Mock).mockClear();
    service = new MqttWriteService(mqttMock);
    service.onModuleInit();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('renderPayload', () => {
    it('substitui {{value}} e {{id}} (boolean → true/false)', () => {
      const { payload, rpcId } = service.renderPayload(
        '{"id":{{id}},"on":{{value}}}',
        true,
        'boolean',
      );
      expect(rpcId).not.toBeNull();
      expect(payload).toBe(`{"id":${rpcId},"on":true}`);
      expect(() => JSON.parse(payload)).not.toThrow();
    });

    it('boolean aceita 1/0 e number rende número', () => {
      expect(service.renderPayload('{{value}}', 1, 'boolean').payload).toBe('true');
      expect(service.renderPayload('{{value}}', 0, 'boolean').payload).toBe('false');
      expect(service.renderPayload('{{value}}', 21.5, 'number').payload).toBe('21.5');
    });

    it('sem {{id}} no template → rpcId null', () => {
      const { rpcId } = service.renderPayload('{"on":{{value}}}', false, 'boolean');
      expect(rpcId).toBeNull();
    });
  });

  it('resolve sucesso confirmado quando o gateway responde success+confirmed', async () => {
    const promise = service.writeMqtt(baseRequest());
    await Promise.resolve(); // deixa o publish rodar

    expect(published).toHaveLength(1);
    const env = published[0].payload as Record<string, unknown>;
    expect(published[0].topic).toBe('bluebee/tenant-a/gateway/gw-1/commands');
    expect(env.protocol).toBe('mqtt');
    expect(env.action).toBe('write');
    const params = env.params as Record<string, unknown>;
    expect(params.commandTopic).toBe('bluebee/tenant-a/gateway/gw-1/sensors/shelly1/rpc');
    expect(params.responseTopic).toBe('bluebee/tenant-a/gateway/gw-1/sensors/shelly1/resp/rpc');
    expect(typeof params.matchId).toBe('number');
    expect(String(params.payload)).toContain('"on":true');

    respond({ success: true, confirmed: true });
    const result = await promise;
    expect(result).toMatchObject({ success: true, confirmed: true });
  });

  it('resolve falha quando o gateway reporta erro', async () => {
    const promise = service.writeMqtt(baseRequest());
    await Promise.resolve();
    respond({ success: false, error: 'Dispositivo recusou o comando' });
    const result = await promise;
    expect(result).toEqual({ success: false, error: 'Dispositivo recusou o comando' });
  });

  it('expira em 20s sem resposta do gateway', async () => {
    const promise = service.writeMqtt(baseRequest());
    await Promise.resolve();
    jest.advanceTimersByTime(20_000);
    const result = await promise;
    expect(result.success).toBe(false);
    expect((result as { error: string }).error).toContain('Timeout');
  });

  it('escritas concorrentes casam cada resposta pelo próprio command_id', async () => {
    const p1 = service.writeMqtt(baseRequest());
    const p2 = service.writeMqtt({ ...baseRequest(), value: false });
    await Promise.resolve();

    expect(published).toHaveLength(2);
    const id1 = (published[0].payload as { command_id: string }).command_id;
    const id2 = (published[1].payload as { command_id: string }).command_id;
    expect(id1).not.toBe(id2);

    // Responde na ordem inversa
    respond({ success: false, error: 'falhou' }, 1);
    respond({ success: true, confirmed: true }, 0);

    expect(await p2).toEqual({ success: false, error: 'falhou' });
    expect(await p1).toMatchObject({ success: true, confirmed: true });
  });

  it('rejeita tópico de comando fora do namespace de sensores do gateway', async () => {
    const req = baseRequest();
    req.write.commandTopic = 'bluebee/OUTRO/gateway/gw-1/sensors/shelly1/rpc';
    const result = await service.writeMqtt(req);
    expect(result.success).toBe(false);
    expect((result as { error: string }).error).toContain('fora do escopo');
    expect(published).toHaveLength(0);
  });

  it('falha imediata quando o publish no broker rejeita', async () => {
    publishImpl = () => Promise.reject(new Error('broker off'));
    const result = await service.writeMqtt(baseRequest());
    expect(result).toEqual({
      success: false,
      error: 'Falha ao publicar o comando no broker MQTT',
    });
  });

  it('ignora resultados de command_id desconhecido sem quebrar', () => {
    expect(() =>
      messageHandler(
        'bluebee/tenant-a/gateway/gw-1/commands/result',
        Buffer.from(JSON.stringify({ command_id: 'outro', success: true })),
      ),
    ).not.toThrow();
  });
});
