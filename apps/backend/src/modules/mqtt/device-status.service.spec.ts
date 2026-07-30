import { DeviceStatusService } from './device-status.service.js';

/**
 * Detecção de gateway offline via LWT + heartbeat.
 *
 * O sinal EXPLÍCITO de liveness (markGatewayStatus) precisa se sobrepor à
 * simples recência de telemetria: um LWT `offline` marca offline mesmo que
 * telemetria antiga ainda esteja "recente"; um heartbeat `online` marca online;
 * e a recuperação (telemetria/heartbeat DEPOIS do offline) volta para online.
 */
describe('DeviceStatusService — liveness explícito de gateway', () => {
  const GW = 'gw-01';
  let service: DeviceStatusService;

  beforeEach(() => {
    service = new DeviceStatusService();
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-07T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('heartbeat marca o gateway como online', () => {
    service.markGatewayStatus(GW, 'online');
    expect(service.getStatus(GW)).toBe('online');
    // heartbeat também conta como "visto agora"
    expect(service.getLastSeen(GW)).toBe('2026-07-07T12:00:00.000Z');
  });

  it('LWT offline marca offline mesmo com telemetria ainda recente', () => {
    // telemetria recente diria "online" pelo caminho antigo
    service.markSeen(GW);
    expect(service.getStatus(GW)).toBe('online');

    // porém o LWT (queda ativa) tem prioridade
    jest.advanceTimersByTime(1_000);
    service.markGatewayStatus(GW, 'offline');
    expect(service.getStatus(GW)).toBe('offline');
  });

  it('online explícito expira após a janela de heartbeat (heartbeat perdido)', () => {
    service.markGatewayStatus(GW, 'online');
    expect(service.getStatus(GW)).toBe('online');

    // sem novo heartbeat além da janela (45s) → offline
    jest.advanceTimersByTime(46_000);
    expect(service.getStatus(GW)).toBe('offline');
  });

  it('recupera para online quando o heartbeat volta após um offline', () => {
    service.markGatewayStatus(GW, 'offline');
    expect(service.getStatus(GW)).toBe('offline');

    jest.advanceTimersByTime(5_000);
    service.markGatewayStatus(GW, 'online');
    expect(service.getStatus(GW)).toBe('online');
  });

  it('recupera para online quando telemetria chega DEPOIS do offline (antes do heartbeat)', () => {
    service.markGatewayStatus(GW, 'offline');
    expect(service.getStatus(GW)).toBe('offline');

    // gateway voltou e já publica telemetria antes do próximo heartbeat
    jest.advanceTimersByTime(2_000);
    service.markSeen(GW);
    expect(service.getStatus(GW)).toBe('online');
  });

  it('telemetria ANTERIOR ao offline não reativa (offline continua válido)', () => {
    service.markSeen(GW);
    jest.advanceTimersByTime(1_000);
    service.markGatewayStatus(GW, 'offline');
    // nenhuma prova de vida nova após o offline
    expect(service.getStatus(GW)).toBe('offline');
  });

  it('dispositivos sem sinal explícito continuam derivando status da telemetria', () => {
    const DEV = 'device-1';
    expect(service.getStatus(DEV)).toBe('offline');
    service.markSeen(DEV);
    expect(service.getStatus(DEV)).toBe('online');
    jest.advanceTimersByTime(46_000);
    expect(service.getStatus(DEV)).toBe('offline');
  });
});

/**
 * Fallback DURÁVEL do "visto por último" (resolveLastSeen*).
 *
 * Pós-boot o mapa em memória está vazio; o valor exibido deve vir do banco
 * (última transição em status_events e/ou último lastValueAt de ponto) e
 * NUNCA de datas de cadastro. Sem nenhum dado real → null.
 */
describe('DeviceStatusService — fallback durável do visto por último', () => {
  const T_EVENT = new Date('2026-07-07T10:00:00.000Z');
  const T_POINT = new Date('2026-07-07T11:30:00.000Z');

  function makePrisma(overrides?: {
    events?: { entityId: string; _max: { at: Date | null } }[];
    points?: { deviceId: string; _max: { lastValueAt: Date | null } }[];
  }) {
    return {
      statusEvent: {
        groupBy: jest.fn().mockResolvedValue(overrides?.events ?? []),
      },
      devicePoint: {
        groupBy: jest.fn().mockResolvedValue(overrides?.points ?? []),
      },
    };
  }

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-07-07T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('memória vazia → usa a última transição do status_events', async () => {
    const prisma = makePrisma({ events: [{ entityId: 'dev-1', _max: { at: T_EVENT } }] });
    const service = new DeviceStatusService(prisma as never);
    expect(await service.resolveLastSeen('dev-1')).toBe(T_EVENT.toISOString());
  });

  it('usa o mais recente entre status_events e lastValueAt dos pontos', async () => {
    const prisma = makePrisma({
      events: [{ entityId: 'dev-1', _max: { at: T_EVENT } }],
      points: [{ deviceId: 'dev-1', _max: { lastValueAt: T_POINT } }],
    });
    const service = new DeviceStatusService(prisma as never);
    expect(await service.resolveLastSeen('dev-1')).toBe(T_POINT.toISOString());
  });

  it('sem nenhum dado real retorna null (nunca data de cadastro)', async () => {
    const prisma = makePrisma();
    const service = new DeviceStatusService(prisma as never);
    expect(await service.resolveLastSeen('dev-sem-dados')).toBeNull();
  });

  it('memória tem prioridade sobre o banco (não consulta o durável)', async () => {
    const prisma = makePrisma({ events: [{ entityId: 'dev-1', _max: { at: T_EVENT } }] });
    const service = new DeviceStatusService(prisma as never);
    service.markSeen('dev-1');
    expect(await service.resolveLastSeen('dev-1')).toBe('2026-07-07T12:00:00.000Z');
    expect(prisma.statusEvent.groupBy).not.toHaveBeenCalled();
  });

  it('cacheia o resultado durável — segunda chamada não vai ao banco', async () => {
    const prisma = makePrisma({ events: [{ entityId: 'dev-1', _max: { at: T_EVENT } }] });
    const service = new DeviceStatusService(prisma as never);
    await service.resolveLastSeen('dev-1');
    await service.resolveLastSeen('dev-1');
    expect(prisma.statusEvent.groupBy).toHaveBeenCalledTimes(1);
  });

  it('lote: resolve vários devices com 2 queries e devolve null p/ quem não tem dado', async () => {
    const prisma = makePrisma({
      events: [{ entityId: 'dev-1', _max: { at: T_EVENT } }],
      points: [{ deviceId: 'dev-2', _max: { lastValueAt: T_POINT } }],
    });
    const service = new DeviceStatusService(prisma as never);
    const map = await service.resolveLastSeenMany(['dev-1', 'dev-2', 'dev-3']);
    expect(map.get('dev-1')).toBe(T_EVENT.toISOString());
    expect(map.get('dev-2')).toBe(T_POINT.toISOString());
    expect(map.get('dev-3')).toBeNull();
    expect(prisma.statusEvent.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.devicePoint.groupBy).toHaveBeenCalledTimes(1);
  });

  it('sem Prisma (testes/legado) retorna null sem quebrar', async () => {
    const service = new DeviceStatusService();
    expect(await service.resolveLastSeen('dev-1')).toBeNull();
  });
});
