import { NotFoundException } from '@nestjs/common';
import { DashboardController } from '../dashboard/dashboard.controller.js';
import { DevicesController } from '../devices/presentation/devices.controller.js';
import { DeviceConfigPublisherService } from '../devices/application/device-config-publisher.service.js';
import { AiService } from '../ai/ai.service.js';
import { SimulatorService } from '../scada/application/simulator.service.js';
import { UserRole } from '../auth/domain/interfaces/auth.interface.js';
import type { AuthenticatedUser } from '../auth/domain/interfaces/auth.interface.js';

/**
 * Regressão: a Bancada de Testes (Device protocol='virtual') NUNCA pode voltar a
 * contar/aparecer como equipamento real.
 *
 * Estes testes exercitam o CÓDIGO REAL de cada superfície (dashboard, lista de
 * devices, publicação de config p/ gateway, IA) através de um Prisma falso que
 * aplica de verdade o `where` recebido. Assim, se alguém esquecer o filtro
 * `EXCLUDE_VIRTUAL_DEVICES` em qualquer query, o virtual vaza e o teste falha.
 *
 * O dispositivo virtual do fixture é DELIBERADAMENTE montado para casar com todos
 * os predicados NÃO-protocolo das queries (mesmo tenant e mesmo gatewayId do real).
 * Ou seja: a ÚNICA coisa que o mantém fora das telas de equipamento é o filtro de
 * protocolo — é exatamente esse filtro que os testes travam.
 */

type AnyRecord = Record<string, any>;

/** Avalia uma condição de campo do `where` do Prisma (subset usado no código). */
function matchValue(actual: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
    const c = cond as AnyRecord;
    if ('not' in c) return actual !== c.not;
    if ('in' in c) return Array.isArray(c.in) && c.in.includes(actual);
    if ('notIn' in c) return Array.isArray(c.notIn) && !c.notIn.includes(actual);
    throw new Error(`Condição de where não suportada no fake: ${JSON.stringify(cond)}`);
  }
  return actual === cond;
}

/** Aplica o `where` inteiro (AND de igualdades/condições simples). */
function matchWhere(record: AnyRecord, where?: AnyRecord): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => matchValue(record[key], cond));
}

function sortBy(list: AnyRecord[], orderBy?: AnyRecord): AnyRecord[] {
  if (!orderBy) return list;
  const [field, dir] = Object.entries(orderBy)[0] ?? [];
  if (!field) return list;
  const mult = dir === 'desc' ? -1 : 1;
  return [...list].sort((a, b) => {
    const av = a[field];
    const bv = b[field];
    if (av instanceof Date && bv instanceof Date) return (av.getTime() - bv.getTime()) * mult;
    return String(av).localeCompare(String(bv)) * mult;
  });
}

/** Prisma falso em memória: só o suficiente para as superfícies deste teste. */
function makeFakePrisma(devices: AnyRecord[], projects: AnyRecord[] = []) {
  const clone = (d: AnyRecord) => ({ ...d, points: [...(d.points ?? [])] });
  return {
    device: {
      async findMany({ where, orderBy }: AnyRecord = {}) {
        const matched = devices.filter((d) => matchWhere(d, where));
        return sortBy(matched, orderBy).map(clone);
      },
      async findFirst({ where }: AnyRecord = {}) {
        const found = devices.find((d) => matchWhere(d, where));
        return found ? clone(found) : null;
      },
      async findUnique({ where }: AnyRecord = {}) {
        const found = devices.find((d) => d.id === where.id);
        return found ? clone(found) : null;
      },
      async findUniqueOrThrow({ where }: AnyRecord = {}) {
        const found = devices.find((d) => d.id === where.id);
        if (!found) throw new Error(`Device ${where.id} não encontrado`);
        return clone(found);
      },
      async groupBy({ by, where }: AnyRecord = {}) {
        const matched = devices.filter((d) => matchWhere(d, where));
        const seen = new Map<string, AnyRecord>();
        for (const d of matched) {
          const key = by.map((f: string) => String(d[f])).join('|');
          if (!seen.has(key)) {
            const row: AnyRecord = {};
            for (const f of by) row[f] = d[f];
            seen.set(key, row);
          }
        }
        return [...seen.values()];
      },
    },
    project: {
      async findUnique({ where }: AnyRecord = {}) {
        return projects.find((p) => p.id === where.id) ?? null;
      },
    },
    // Modelos não relacionados ao filtro: retornam vazio/zero.
    tenant: {
      async count() {
        return 1;
      },
      async findMany() {
        return [{ id: 't1', name: 'Autobras' }];
      },
    },
    gateway: {
      async findMany() {
        return [];
      },
    },
    alarmEvent: {
      async count() {
        return 0;
      },
      async groupBy() {
        return [];
      },
      async findMany() {
        return [];
      },
    },
    automation: {
      async count() {
        return 0;
      },
    },
  } as AnyRecord;
}

/** Status ao vivo falso — irrelevante para a contagem/listagem de virtuais. */
const fakeDeviceStatus = {
  getStatus: () => 'offline' as const,
  getLastSeen: () => null,
  resolveLastSeen: async () => null,
  resolveLastSeenMany: async (ids: string[]) =>
    new Map(ids.map((id) => [id, null])),
} as AnyRecord;

const adminUser: AuthenticatedUser = {
  id: 'u1',
  email: 'admin@autobras.com.br',
  role: UserRole.ADMIN,
  tenantId: 't1',
} as AuthenticatedUser;

const now = new Date('2026-01-01T00:00:00.000Z');

/** 1 equipamento REAL (BACnet) e 1 dispositivo VIRTUAL (Bancada de Testes). */
function makeDevices() {
  const realDevice: AnyRecord = {
    id: 'dev-real',
    name: 'Chiller 01',
    protocol: 'bacnet',
    ip: '10.0.0.10',
    port: 47808,
    status: 'offline',
    tenantId: 't1',
    siteId: 's1',
    gatewayId: 'gw1',
    config: {},
    site: null,
    createdAt: now,
    updatedAt: now,
    points: [
      {
        id: 'pt-real',
        tag: 'temp',
        objectName: 'Temperatura',
        objectType: 'AV',
        instance: 1,
        unit: '°C',
        binding: {},
        createdAt: now,
      },
    ],
  };
  const virtualDevice: AnyRecord = {
    id: 'dev-virtual',
    name: 'Bancada de Testes',
    protocol: 'virtual',
    ip: '',
    port: 0,
    status: 'online',
    tenantId: 't1',
    siteId: 's1',
    // Mesmo gatewayId do real DE PROPÓSITO: só o filtro de protocolo o exclui.
    gatewayId: 'gw1',
    config: { virtual: true, projectId: 'p1' },
    site: null,
    createdAt: now,
    updatedAt: now,
    points: [
      {
        id: 'pt-virtual',
        tag: 'sim',
        objectName: 'Ponto Simulado',
        objectType: 'AV',
        instance: 1,
        unit: '',
        binding: { kind: 'analog', currentValue: 42 },
        createdAt: now,
      },
    ],
  };
  return { realDevice, virtualDevice };
}

describe('Bancada de Testes (virtual) nunca conta como equipamento', () => {
  it('dashboard admin-stats e client-stats NÃO contam o dispositivo virtual', async () => {
    const { realDevice, virtualDevice } = makeDevices();
    const prisma = makeFakePrisma([realDevice, virtualDevice]);
    const controller = new DashboardController(prisma, fakeDeviceStatus);

    const admin = await controller.getAdminStats();
    expect(admin.totalDevices).toBe(1);

    const client = await controller.getClientStats(adminUser, 't1');
    expect(client.deviceCount).toBe(1);
  });

  it('GET /devices NÃO lista o dispositivo virtual', async () => {
    const { realDevice, virtualDevice } = makeDevices();
    const prisma = makeFakePrisma([realDevice, virtualDevice]);
    const controller = new DevicesController(
      {} as never, // bacnetDiscovery
      {} as never, // bacnetNetworkDiscovery
      {} as never, // bacnetWrite
      {} as never, // mqttWrite
      {} as never, // modbusWrite
      prisma as never,
      {} as never, // configPublisher
      {} as never, // modbusConnection
      {} as never, // mqttSample
      {} as never, // emqxProvisioning
      fakeDeviceStatus as never,
      {} as never, // deviceHeartbeat
      {} as never, // defaultTrends
    );

    const list = await controller.getDevices(adminUser, undefined);
    expect(list).toHaveLength(1);
    expect(list.map((d) => d.id)).toEqual(['dev-real']);
    expect(list.some((d) => d.protocol === 'virtual')).toBe(false);
  });

  it('publicação de config para o gateway NÃO inclui o dispositivo virtual', async () => {
    const { realDevice, virtualDevice } = makeDevices();
    const prisma = makeFakePrisma([realDevice, virtualDevice]);
    const published: AnyRecord[] = [];
    const fakeMqtt = {
      publish: async (_topic: string, payload: AnyRecord) => {
        published.push(payload);
      },
    } as AnyRecord;
    const publisher = new DeviceConfigPublisherService(prisma, fakeMqtt);

    await publisher.publishForGateway('t1', 'gw1');

    expect(published).toHaveLength(1);
    const ids = published[0].devices.map((d: AnyRecord) => d.deviceId);
    expect(ids).toEqual(['dev-real']);
    expect(ids).not.toContain('dev-virtual');
  });

  it('a IA rejeita um deviceId virtual e aceita um device real', async () => {
    const { realDevice, virtualDevice } = makeDevices();
    const prisma = makeFakePrisma([realDevice, virtualDevice]);
    const fakeKnowledge = { search: async () => [] } as AnyRecord;
    const ai = new AiService(prisma, fakeKnowledge, { record: jest.fn() } as never);

    await expect(ai.suggestForDevice('t1', 'dev-virtual')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    // Device real passa pela verificação (sem playbooks retorna cedo, sem chamar IA).
    const result = await ai.suggestForDevice('t1', 'dev-real');
    expect(result.deviceId).toBe('dev-real');
  });

  it('a Bancada dentro do SCADA (simulator) CONTINUA enxergando o virtual', async () => {
    const { realDevice, virtualDevice } = makeDevices();
    const prisma = makeFakePrisma(
      [realDevice, virtualDevice],
      [{ id: 'p1', tenantId: 't1', siteId: 's1' }],
    );
    const fakeTelemetry = { emitTelemetry: () => undefined } as AnyRecord;
    const simulator = new SimulatorService(prisma, fakeTelemetry);

    const devices = await simulator.listDevices('p1', adminUser);
    expect(devices).toHaveLength(1);
    expect(devices[0].id).toBe('dev-virtual');
    expect(devices[0].protocol).toBe('virtual');
  });
});
