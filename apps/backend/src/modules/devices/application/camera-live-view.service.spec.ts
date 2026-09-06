import { jest } from '@jest/globals';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  CameraLiveViewService,
  LIVE_VIEW_TTL_MS,
} from './camera-live-view.service.js';
import { encryptCameraSecret } from './camera-credentials.util.js';

/**
 * Testes do ciclo de sessão de visualização ao vivo com MQTT simulado:
 * start → frames repassados ao socket → timeout de keep-alive → stop.
 */

type MessageHandler = (topic: string, payload: Buffer) => void;

class FakeMqttService {
  subscriptions: string[] = [];
  published: Array<{ topic: string; payload: Record<string, unknown>; qos: number }> = [];
  private handlers: MessageHandler[] = [];
  failPublish = false;

  subscribe(pattern: string): void {
    this.subscriptions.push(pattern);
  }

  publish(topic: string, payload: object, qos = 1): Promise<void> {
    if (this.failPublish) return Promise.reject(new Error('broker offline'));
    this.published.push({ topic, payload: payload as Record<string, unknown>, qos });
    return Promise.resolve();
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  /** Simula uma mensagem vinda do broker (gateway → backend). */
  deliver(topic: string, payload: unknown): void {
    const raw = Buffer.from(JSON.stringify(payload));
    for (const handler of this.handlers) handler(topic, raw);
  }

  commandsOf(action: string) {
    return this.published.filter((p) => (p.payload as { action?: string }).action === action);
  }
}

class FakeTelemetryGateway {
  emitted: Array<{ data: Record<string, unknown>; tenantId: string }> = [];
  emitCameraFrame(data: Record<string, unknown>, tenantId: string): void {
    this.emitted.push({ data, tenantId });
  }
}

const CAMERA = {
  id: 'cam-1',
  protocol: 'onvif',
  tenantId: 'tenant-1',
  gatewayId: 'gw-1',
  ip: '10.0.0.10',
  port: 80,
  config: {
    onvifUsername: 'admin',
    onvifPasswordEnc: '',
    rtspUrl: null,
  },
};

class FakePrisma {
  cameras = new Map<string, Record<string, unknown>>();
  device = {
    findUnique: async ({ where }: { where: { id: string } }) =>
      this.cameras.get(where.id) ?? null,
  };
}

const USER = { id: 'user-1', tenantId: 'tenant-1' };
const GLOBAL_USER = { id: 'admin-1', tenantId: null };

describe('CameraLiveViewService', () => {
  let mqtt: FakeMqttService;
  let gateway: FakeTelemetryGateway;
  let prisma: FakePrisma;
  let service: CameraLiveViewService;

  beforeEach(() => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    jest.useFakeTimers();
    mqtt = new FakeMqttService();
    gateway = new FakeTelemetryGateway();
    prisma = new FakePrisma();
    prisma.cameras.set(CAMERA.id, {
      ...CAMERA,
      config: { ...CAMERA.config, onvifPasswordEnc: encryptCameraSecret('s3cret') },
    });
    service = new CameraLiveViewService(
      prisma as never,
      mqtt as never,
      gateway as never,
    );
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  function frameTopic(sessionId: string): string {
    return `bluebee/tenant-1/gateway/gw-1/live-view/${sessionId}`;
  }

  it('start publica live_start com credenciais decifradas e retorna sessionId', async () => {
    const res = await service.start(USER, CAMERA.id);
    expect(res.sessionId).toBeTruthy();
    expect(res.ttlMs).toBe(LIVE_VIEW_TTL_MS);

    const starts = mqtt.commandsOf('live_start');
    expect(starts).toHaveLength(1);
    expect(starts[0].topic).toBe('bluebee/tenant-1/gateway/gw-1/commands');
    const params = starts[0].payload.params as Record<string, unknown>;
    expect(params.sessionId).toBe(res.sessionId);
    expect(params.ip).toBe(CAMERA.ip);
    expect(params.username).toBe('admin');
    expect(params.password).toBe('s3cret'); // decifrada só no comando MQTT
  });

  it('repassa frames da sessão pelo socket com escopo do tenant do tópico', async () => {
    const { sessionId } = await service.start(USER, CAMERA.id);

    const frame = {
      sessionId,
      deviceId: CAMERA.id,
      type: 'frame',
      seq: 1,
      ts: new Date().toISOString(),
      image: Buffer.from('jpeg').toString('base64'),
    };
    mqtt.deliver(frameTopic(sessionId), frame);

    expect(gateway.emitted).toHaveLength(1);
    expect(gateway.emitted[0].tenantId).toBe('tenant-1');
    expect(gateway.emitted[0].data).toMatchObject({ sessionId, type: 'frame', seq: 1 });
  });

  it('repassa eventos de erro de captura (nunca silêncio)', async () => {
    const { sessionId } = await service.start(USER, CAMERA.id);
    mqtt.deliver(frameTopic(sessionId), {
      sessionId,
      deviceId: CAMERA.id,
      type: 'error',
      errorCode: 'AUTH',
      error: 'credenciais recusadas',
      ts: new Date().toISOString(),
    });
    expect(gateway.emitted).toHaveLength(1);
    expect(gateway.emitted[0].data).toMatchObject({ type: 'error', errorCode: 'AUTH' });
  });

  it('ignora payload cujo sessionId não bate com o tópico', async () => {
    const { sessionId } = await service.start(USER, CAMERA.id);
    mqtt.deliver(frameTopic(sessionId), {
      sessionId: 'outra-sessao',
      deviceId: CAMERA.id,
      type: 'frame',
      ts: new Date().toISOString(),
    });
    expect(gateway.emitted).toHaveLength(0);
  });

  it('sem keep-alive a sessão expira e o backend envia live_stop sozinho', async () => {
    const { sessionId } = await service.start(USER, CAMERA.id);
    expect(mqtt.commandsOf('live_stop')).toHaveLength(0);

    await jest.advanceTimersByTimeAsync(LIVE_VIEW_TTL_MS + 3_000);

    const stops = mqtt.commandsOf('live_stop');
    expect(stops).toHaveLength(1);
    expect((stops[0].payload.params as { sessionId: string }).sessionId).toBe(sessionId);
    // Sessão removida: keep-alive posterior falha com 404.
    await expect(service.keepAlive(USER, sessionId)).rejects.toThrow(NotFoundException);
  });

  it('keep-alive renova a sessão (não expira enquanto renovada) e repassa ao gateway', async () => {
    const { sessionId } = await service.start(USER, CAMERA.id);

    for (let i = 0; i < 4; i++) {
      await jest.advanceTimersByTimeAsync(LIVE_VIEW_TTL_MS - 2_000);
      await service.keepAlive(USER, sessionId);
    }
    expect(mqtt.commandsOf('live_stop')).toHaveLength(0);
    expect(mqtt.commandsOf('live_keepalive').length).toBeGreaterThanOrEqual(4);

    // Parou de renovar → expira.
    await jest.advanceTimersByTimeAsync(LIVE_VIEW_TTL_MS + 3_000);
    expect(mqtt.commandsOf('live_stop')).toHaveLength(1);
  });

  it('stop explícito envia live_stop e remove a sessão', async () => {
    const { sessionId } = await service.start(USER, CAMERA.id);
    await service.stop(USER, sessionId);

    expect(mqtt.commandsOf('live_stop')).toHaveLength(1);
    await expect(service.stop(USER, sessionId)).rejects.toThrow(NotFoundException);
  });

  it('segundo start do MESMO usuário encerra e substitui a sessão anterior', async () => {
    const first = await service.start(USER, CAMERA.id);
    const second = await service.start(USER, CAMERA.id);

    expect(second.sessionId).not.toBe(first.sessionId);
    const stops = mqtt.commandsOf('live_stop');
    expect(stops).toHaveLength(1);
    expect((stops[0].payload.params as { sessionId: string }).sessionId).toBe(
      first.sessionId,
    );
    // A antiga não aceita mais keep-alive; a nova sim.
    await expect(service.keepAlive(USER, first.sessionId)).rejects.toThrow(NotFoundException);
    await expect(service.keepAlive(USER, second.sessionId)).resolves.toMatchObject({
      ttlMs: LIVE_VIEW_TTL_MS,
    });
  });

  it('evento "ended" do gateway limpa a sessão local e é repassado ao socket', async () => {
    const { sessionId } = await service.start(USER, CAMERA.id);
    mqtt.deliver(frameTopic(sessionId), {
      sessionId,
      deviceId: CAMERA.id,
      type: 'ended',
      reason: 'capture_failed',
      ts: new Date().toISOString(),
    });
    expect(gateway.emitted).toHaveLength(1);
    expect(gateway.emitted[0].data).toMatchObject({ type: 'ended' });
    await expect(service.keepAlive(USER, sessionId)).rejects.toThrow(NotFoundException);
  });

  it('rejeita câmera não-ONVIF com erro claro', async () => {
    prisma.cameras.set('cam-snmp', { ...CAMERA, id: 'cam-snmp', protocol: 'snmp' });
    await expect(service.start(USER, 'cam-snmp')).rejects.toThrow(BadRequestException);
  });

  it('rejeita câmera de outro tenant (usuário de cliente)', async () => {
    prisma.cameras.set('cam-x', { ...CAMERA, id: 'cam-x', tenantId: 'tenant-2' });
    await expect(service.start(USER, 'cam-x')).rejects.toThrow(ForbiddenException);
  });

  it('papel global pode iniciar sessão de qualquer tenant', async () => {
    const res = await service.start(GLOBAL_USER, CAMERA.id);
    expect(res.sessionId).toBeTruthy();
  });

  it('câmera inexistente → 404; sem credenciais → erro claro', async () => {
    await expect(service.start(USER, 'nao-existe')).rejects.toThrow(NotFoundException);
    prisma.cameras.set('cam-nocred', {
      ...CAMERA,
      id: 'cam-nocred',
      config: { onvifUsername: 'admin' },
    });
    await expect(service.start(USER, 'cam-nocred')).rejects.toThrow(BadRequestException);
  });

  it('falha de publicação no broker → start falha sem deixar sessão órfã', async () => {
    mqtt.failPublish = true;
    await expect(service.start(USER, CAMERA.id)).rejects.toThrow(BadRequestException);
    mqtt.failPublish = false;
    // Nada expira depois (nenhuma sessão ficou registrada).
    await jest.advanceTimersByTimeAsync(LIVE_VIEW_TTL_MS + 3_000);
    expect(mqtt.commandsOf('live_stop')).toHaveLength(0);
  });

  it('usuário não-dono não renova nem encerra a sessão de outro', async () => {
    const { sessionId } = await service.start(USER, CAMERA.id);
    const other = { id: 'user-2', tenantId: 'tenant-1' };
    await expect(service.keepAlive(other, sessionId)).rejects.toThrow(ForbiddenException);
    await expect(service.stop(other, sessionId)).rejects.toThrow(ForbiddenException);
  });
});
