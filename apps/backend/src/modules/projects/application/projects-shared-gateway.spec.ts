/**
 * Regression: device counts in the projects list must be scoped to the
 * project's own site, not the full gateway count — a gateway can be shared
 * across multiple sites.
 *
 * Scenario exercised:
 *   - Gateway GW-1 is shared by Project A (site-A) and Project B (site-B).
 *   - Site-A has 2 real devices + 1 virtual device on GW-1.
 *   - Site-B has 3 real devices on GW-1.
 *
 * Expected:
 *   - Project A device count = 2  (virtual excluded, site-B devices excluded)
 *   - Project B device count = 3  (site-A devices excluded)
 *
 * Also verifies delete behaviour on a shared gateway:
 *   - Deleting Project A (shared) only removes the project record; devices are
 *     untouched so Project B's devices survive.
 */

import { ProjectsService } from './projects.service.js';

type AnyRecord = Record<string, any>;

// ─── Minimal Prisma fake ─────────────────────────────────────────────────────

function matchValue(actual: unknown, cond: unknown): boolean {
  if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
    const c = cond as AnyRecord;
    if ('not' in c) return actual !== c.not;
    if ('in' in c) return Array.isArray(c.in) && c.in.includes(actual);
    if ('notIn' in c) return Array.isArray(c.notIn) && !c.notIn.includes(actual);
  }
  return actual === cond;
}

function matchWhere(record: AnyRecord, where?: AnyRecord): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    // Nested filter e.g. { device: { gatewayId } }
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date) &&
        !('not' in cond) && !('in' in cond) && !('notIn' in cond)) {
      return matchWhere(record[key] ?? {}, cond as AnyRecord);
    }
    return matchValue(record[key], cond);
  });
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const GW_ID = 'gw-shared';
const SITE_A = 'site-a';
const SITE_B = 'site-b';
const TENANT = 't1';

const devices: AnyRecord[] = [
  { id: 'd-a1', protocol: 'bacnet',  gatewayId: GW_ID, siteId: SITE_A, tenantId: TENANT },
  { id: 'd-a2', protocol: 'modbus',  gatewayId: GW_ID, siteId: SITE_A, tenantId: TENANT },
  { id: 'd-av', protocol: 'virtual', gatewayId: GW_ID, siteId: SITE_A, tenantId: TENANT },
  { id: 'd-b1', protocol: 'bacnet',  gatewayId: GW_ID, siteId: SITE_B, tenantId: TENANT },
  { id: 'd-b2', protocol: 'bacnet',  gatewayId: GW_ID, siteId: SITE_B, tenantId: TENANT },
  { id: 'd-b3', protocol: 'modbus',  gatewayId: GW_ID, siteId: SITE_B, tenantId: TENANT },
];

const projectA: AnyRecord = {
  id: 'proj-a', name: 'Projeto A', siteId: SITE_A, tenantId: TENANT, gatewayId: GW_ID,
  address: null, technicalContact: null, scadaEnabled: false,
  createdAt: new Date(), updatedAt: new Date(),
  gateway: { id: GW_ID, status: 'offline', lastSeen: null },
};
const projectB: AnyRecord = {
  id: 'proj-b', name: 'Projeto B', siteId: SITE_B, tenantId: TENANT, gatewayId: GW_ID,
  address: null, technicalContact: null, scadaEnabled: false,
  createdAt: new Date(), updatedAt: new Date(),
  gateway: { id: GW_ID, status: 'offline', lastSeen: null },
};

function makeFakePrisma(currentDevices = devices, currentProjects = [projectA, projectB]) {
  const deletedProjectIds: string[] = [];
  const deletedDeviceIds: string[] = [];

  const prisma: AnyRecord = {
    _deletedProjectIds: deletedProjectIds,
    _deletedDeviceIds: deletedDeviceIds,

    project: {
      async findMany({ where, include, orderBy }: AnyRecord = {}) {
        const matched = currentProjects
          .filter((p) => !deletedProjectIds.includes(p.id))
          .filter((p) => matchWhere(p, where));
        if (orderBy?.name) matched.sort((a, b) => a.name.localeCompare(b.name));
        // Return with embedded gateway if include.gateway is present
        return matched.map((p) => ({ ...p }));
      },
      async findFirst({ where }: AnyRecord = {}) {
        return currentProjects.find((p) => !deletedProjectIds.includes(p.id) && matchWhere(p, where)) ?? null;
      },
      async count({ where }: AnyRecord = {}) {
        return currentProjects.filter((p) => !deletedProjectIds.includes(p.id) && matchWhere(p, where)).length;
      },
      async delete({ where }: AnyRecord = {}) {
        deletedProjectIds.push(where.id);
        return { id: where.id };
      },
    },

    device: {
      async groupBy({ by, where, _count: countSpec }: AnyRecord = {}) {
        const alive = currentDevices.filter((d) => !deletedDeviceIds.includes(d.id));
        const matched = alive.filter((d) => matchWhere(d, where));
        // Group by specified fields
        const groups = new Map<string, AnyRecord>();
        for (const d of matched) {
          const key = (by as string[]).map((f) => String(d[f])).join('|');
          if (!groups.has(key)) {
            const row: AnyRecord = { _count: { id: 0 } };
            for (const f of by as string[]) row[f] = d[f];
            groups.set(key, row);
          }
          groups.get(key)!._count.id++;
        }
        return [...groups.values()];
      },
      async deleteMany({ where }: AnyRecord = {}) {
        const toDelete = currentDevices.filter((d) => matchWhere(d, where));
        for (const d of toDelete) deletedDeviceIds.push(d.id);
        return { count: toDelete.length };
      },
    },

    devicePoint: {
      async deleteMany() { return { count: 0 }; },
    },

    gateway: {
      async delete() { return {}; },
    },

    async $transaction(ops: Array<Promise<unknown>>) {
      return Promise.all(ops);
    },
  };
  return prisma;
}

// Minimal DeviceStatusService stub
const fakeDeviceStatus: AnyRecord = {
  getStatus: () => 'offline',
  getLastSeen: () => null,
};

// Minimal EmqxProvisioningService stub
const fakeEmqx: AnyRecord = {
  deprovisionGateway: async () => {},
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('ProjectsService.findAll — shared gateway device counts', () => {
  let service: ProjectsService;
  let prisma: AnyRecord;

  beforeEach(() => {
    prisma = makeFakePrisma();
    service = new ProjectsService(prisma as never, fakeEmqx as never, fakeDeviceStatus as never);
  });

  it('Project A count = 2 (excludes virtual + site-B devices)', async () => {
    const result = await service.findAll(SITE_A, TENANT);
    expect(result).toHaveLength(1);
    const projA = result.find((p: AnyRecord) => p.id === 'proj-a')!;
    expect(projA).toBeDefined();
    expect((projA as AnyRecord).gateway._count.devices).toBe(2);
  });

  it('Project B count = 3 (excludes site-A devices)', async () => {
    const result = await service.findAll(SITE_B, TENANT);
    expect(result).toHaveLength(1);
    const projB = result.find((p: AnyRecord) => p.id === 'proj-b')!;
    expect(projB).toBeDefined();
    expect((projB as AnyRecord).gateway._count.devices).toBe(3);
  });

  it('Without siteId filter — each project shows only its own site count', async () => {
    const result = await service.findAll(undefined, TENANT);
    expect(result).toHaveLength(2);
    const a = result.find((p: AnyRecord) => p.id === 'proj-a')!;
    const b = result.find((p: AnyRecord) => p.id === 'proj-b')!;
    expect((a as AnyRecord).gateway._count.devices).toBe(2);
    expect((b as AnyRecord).gateway._count.devices).toBe(3);
  });

  it('Virtual device (protocol="virtual") is excluded from the count', async () => {
    // Only virtual devices in site-A → count should be 0
    const virtualOnly: AnyRecord[] = [
      { id: 'd-v1', protocol: 'virtual', gatewayId: GW_ID, siteId: SITE_A, tenantId: TENANT },
    ];
    const p2 = makeFakePrisma(virtualOnly, [projectA]);
    const svc = new ProjectsService(p2 as never, fakeEmqx as never, fakeDeviceStatus as never);
    const result = await svc.findAll(SITE_A, TENANT);
    expect((result[0] as AnyRecord).gateway._count.devices).toBe(0);
  });
});

describe('ProjectsService.delete — shared gateway is site-safe', () => {
  it('Deleting one project on a shared gateway does NOT delete devices from other site', async () => {
    const prisma = makeFakePrisma();
    const service = new ProjectsService(prisma as never, fakeEmqx as never, fakeDeviceStatus as never);

    // Delete project A; gateway is shared so only project record should be removed
    await service.delete('proj-a', TENANT);

    expect(prisma._deletedProjectIds).toEqual(['proj-a']);
    // No devices should have been deleted
    expect(prisma._deletedDeviceIds).toHaveLength(0);
  });

  it('After deleting Project A, Project B still shows its full device count', async () => {
    const prisma = makeFakePrisma();
    const service = new ProjectsService(prisma as never, fakeEmqx as never, fakeDeviceStatus as never);

    await service.delete('proj-a', TENANT);

    // Now query project B — devices should still be intact
    const result = await service.findAll(SITE_B, TENANT);
    const projB = result.find((p: AnyRecord) => p.id === 'proj-b')!;
    expect((projB as AnyRecord).gateway._count.devices).toBe(3);
  });
});
