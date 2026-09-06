import { EmqxMonitorService } from './emqx-monitor.service.js';
import type { EmqxBrokerSnapshot } from './emqx-monitor.service.js';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ClusterService } from '../cluster/cluster.service.js';

/**
 * Lógica de alerta do monitor do EMQX: histerese (2 coletas anormais para
 * disparar, 10 saudáveis para rearmar), cooldown anti-spam e alerta de broker
 * inacessível. Usa `evaluate()` diretamente com snapshots sintéticos.
 */
describe('EmqxMonitorService — alertas', () => {
  let service: EmqxMonitorService;
  let created: Array<Record<string, unknown>>;
  let published: string[];

  const config = {
    get: (key: string, def?: string) => (key === 'EMQX_API_URL' ? 'http://emqx.test' : def ?? ''),
  } as unknown as ConfigService;

  const flush = () => new Promise((r) => setImmediate(r));

  beforeEach(() => {
    created = [];
    published = [];
    const prisma = {
      alarmEvent: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return { id: 'ev-1', state: 'ACTIVE', activatedAt: new Date(), ...data };
        }),
      },
    } as unknown as PrismaService;
    const cluster = {
      onLeadership: jest.fn(),
      publish: jest.fn(async (_ch: string, payload: string) => {
        published.push(payload);
      }),
    } as unknown as ClusterService;
    service = new EmqxMonitorService(config, prisma, cluster);
  });

  const snap = (over: Partial<EmqxBrokerSnapshot>): EmqxBrokerSnapshot => ({
    configured: true,
    available: true,
    checkedAt: new Date().toISOString(),
    connections: 10,
    liveConnections: 10,
    topics: 5,
    subscriptions: 5,
    messageInRate: 1,
    messageOutRate: 1,
    droppedTotal: 0,
    droppedNoSubscribersTotal: 0,
    queueFullDroppedTotal: 0,
    droppedDelta: null,
    health: 'healthy',
    error: null,
    ...over,
  });

  it('não alerta com broker saudável', async () => {
    let t = 0;
    for (let i = 0; i < 5; i++) {
      const out = service.evaluate(snap({ droppedTotal: 0 }), (t += 30_000));
      expect(out.health).toBe('healthy');
    }
    await flush();
    expect(created).toHaveLength(0);
  });

  it('alerta só após 2 coletas anormais consecutivas (histerese)', async () => {
    let t = 0;
    service.evaluate(snap({ droppedTotal: 0 }), (t += 30_000)); // baseline
    const one = service.evaluate(snap({ droppedTotal: 5 }), (t += 30_000)); // 1ª anormal
    expect(one.health).toBe('abnormal');
    await flush();
    expect(created).toHaveLength(0); // ainda não

    service.evaluate(snap({ droppedTotal: 12 }), (t += 30_000)); // 2ª anormal → alerta
    await flush();
    expect(created).toHaveLength(1);
    expect(created[0].tenantId).toBe('__system__');
    expect(created[0].kind).toBe('AUTOMATION_NOTICE');
    expect(published).toHaveLength(1);
  });

  it('não repete o alerta enquanto continuar anormal (anti-spam)', async () => {
    let t = 0;
    service.evaluate(snap({ droppedTotal: 0 }), (t += 30_000));
    for (let i = 1; i <= 6; i++) {
      service.evaluate(snap({ droppedTotal: i * 10 }), (t += 30_000));
    }
    await flush();
    expect(created).toHaveLength(1);
  });

  it('descartes por fila cheia também disparam alerta', async () => {
    let t = 0;
    service.evaluate(snap({ queueFullDroppedTotal: 0 }), (t += 30_000));
    service.evaluate(snap({ queueFullDroppedTotal: 3 }), (t += 30_000));
    service.evaluate(snap({ queueFullDroppedTotal: 7 }), (t += 30_000));
    await flush();
    expect(created).toHaveLength(1);
    expect(String(created[0].message)).toContain('fila cheia');
  });

  it('rearma após 10 coletas saudáveis, mas respeita o cooldown de 30 min', async () => {
    let t = 0;
    // Primeiro alerta
    service.evaluate(snap({ droppedTotal: 0 }), (t += 30_000));
    service.evaluate(snap({ droppedTotal: 5 }), (t += 30_000));
    service.evaluate(snap({ droppedTotal: 10 }), (t += 30_000));
    await flush();
    expect(created).toHaveLength(1);

    // 10 coletas saudáveis rearmam
    for (let i = 0; i < 10; i++) {
      service.evaluate(snap({ droppedTotal: 10 }), (t += 30_000));
    }
    // Nova anormalidade DENTRO do cooldown → não alerta de novo
    service.evaluate(snap({ droppedTotal: 15 }), (t += 30_000));
    service.evaluate(snap({ droppedTotal: 20 }), (t += 30_000));
    await flush();
    expect(created).toHaveLength(1);

    // Passado o cooldown (30 min), o mesmo padrão volta a alertar
    t += 31 * 60_000;
    for (let i = 0; i < 10; i++) {
      service.evaluate(snap({ droppedTotal: 20 }), (t += 30_000));
    }
    service.evaluate(snap({ droppedTotal: 30 }), (t += 30_000));
    service.evaluate(snap({ droppedTotal: 40 }), (t += 30_000));
    await flush();
    expect(created).toHaveLength(2);
  });

  it('broker inacessível por 3 coletas gera alerta próprio', async () => {
    let t = 0;
    const down = snap({ available: false, error: 'ECONNREFUSED' });
    service.evaluate(down, (t += 30_000));
    service.evaluate(down, (t += 30_000));
    await flush();
    expect(created).toHaveLength(0);
    const out = service.evaluate(down, (t += 30_000));
    await flush();
    expect(out.health).toBe('unknown');
    expect(created).toHaveLength(1);
    expect(String(created[0].sourceName)).toContain('inacessível');
  });
});
