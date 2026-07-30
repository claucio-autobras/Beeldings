import { PollingMetricsService } from './polling-metrics.service';

describe('PollingMetricsService', () => {
  let service: PollingMetricsService;

  beforeEach(() => {
    service = new PollingMetricsService();
  });

  it('remove métricas de devices que saíram da config (fantasmas)', () => {
    service.record({ protocol: 'bacnet', deviceId: 'dev-a', latencyMs: 10, pointsRead: 3, pointsAttempted: 3 });
    service.record({ protocol: 'modbus', deviceId: 'dev-b', latencyMs: 20, pointsRead: 2, pointsAttempted: 2 });

    service.handleConfigMessage({
      topic: 'bluebee/t1/gateway/gw-01/config',
      message: { devices: [{ deviceId: 'dev-a', protocol: 'bacnet' }] } as any,
    });

    const snapshot = service.getSnapshot();
    expect(snapshot.map((m) => m.deviceId)).toEqual(['dev-a']);
  });

  it('ignora mensagens que não são de config', () => {
    service.record({ protocol: 'bacnet', deviceId: 'dev-a', latencyMs: 10, pointsRead: 1, pointsAttempted: 1 });
    service.handleConfigMessage({
      topic: 'bluebee/t1/gateway/gw-01/telemetry',
      message: { devices: [] } as any,
    });
    expect(service.getSnapshot()).toHaveLength(1);
  });

  it('registra entrada zerada para devices MQTT da config', () => {
    service.handleConfigMessage({
      topic: 'bluebee/t1/gateway/gw-01/config',
      message: { devices: [{ deviceId: 'sensor-1', protocol: 'mqtt' }] } as any,
    });

    const [m] = service.getSnapshot();
    expect(m).toMatchObject({
      protocol: 'mqtt',
      deviceId: 'sensor-1',
      messagesReceived: 0,
      totalCycles: 0,
    });
  });

  it('conta mensagens do bridge e marca lastSuccessAt quando há pontos', () => {
    service.recordBridgeMessage('sensor-1', 0, 1);
    let [m] = service.getSnapshot();
    expect(m.messagesReceived).toBe(1);
    expect(m.lastSuccessAt).toBeUndefined();

    service.recordBridgeMessage('sensor-1', 2, 2);
    [m] = service.getSnapshot();
    expect(m.messagesReceived).toBe(2);
    expect(m.lastSuccessAt).toBeDefined();
    expect(m.lastMessageAt).toBeDefined();
  });

  it('mantém lastSuccessAt do polling quando o ciclo seguinte falha', () => {
    service.record({ protocol: 'snmp', deviceId: 'cam-1', latencyMs: 5, pointsRead: 4, pointsAttempted: 4 });
    const [before] = service.getSnapshot();
    const successAt = before.lastSuccessAt;
    expect(successAt).toBeDefined();

    service.record({ protocol: 'snmp', deviceId: 'cam-1', latencyMs: 5, pointsRead: 0, pointsAttempted: 4 });
    const [after] = service.getSnapshot();
    expect(after.lastPointsRead).toBe(0);
    expect(after.lastSuccessAt).toBe(successAt);
  });
});
