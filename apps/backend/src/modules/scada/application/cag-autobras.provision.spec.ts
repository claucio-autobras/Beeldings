import { BadRequestException } from '@nestjs/common';
import {
  buildCagWidgets,
  CAG_CANVAS,
  provisionCagAutobras,
  validateCagBindings,
  type CagProvisionTarget,
} from './cag-autobras.provision.js';

function target(): CagProvisionTarget {
  return {
    tenant: { id: 'tenant-autobras', name: 'Autobras DEV', slug: 'autobras' },
    site: { id: 'site-nis', name: 'NIS', tenantId: 'tenant-autobras' },
    project: {
      id: 'project-nis',
      name: 'NIS Beeldings',
      tenantId: 'tenant-autobras',
      siteId: 'site-nis',
      gatewayId: null,
      scadaEnabled: true,
    },
  };
}

function keysDeep(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysDeep);
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [key, ...keysDeep(child)]);
}

describe('CAG Autobras provisioner', () => {
  it('builds a complete 1920x1080 visual composition without bindings', () => {
    const widgets = buildCagWidgets(target());
    expect(CAG_CANVAS).toEqual({ width: 1920, height: 1080 });
    expect(widgets.length).toBeGreaterThanOrEqual(25);
    expect(widgets.some((widget) => widget.type === 'chiller')).toBe(true);
    expect(widgets.some((widget) => widget.type === 'pump')).toBe(true);
    expect(widgets.some((widget) => widget.type === 'pipe')).toBe(true);
    expect(widgets.some((widget) => widget.type === 'equipment-card')).toBe(true);
    expect(widgets.some((widget) => String(widget.text).includes('SEM TELEMETRIA VINCULADA'))).toBe(true);
    expect(() => validateCagBindings(widgets, target())).not.toThrow();
    expect(keysDeep(widgets)).not.toEqual(expect.arrayContaining([
      'deviceId',
      'deviceIds',
      'tag',
      'tagStatus',
      'bindingDeviceId',
      'bindingTag',
      'flowDeviceId',
      'flowTag',
      'statusDeviceId',
      'statusTag',
    ]));
  });

  it('rejects an accidental point or device reference', () => {
    expect(() => validateCagBindings([{ id: 'bad', deviceId: 'other' }])).toThrow(BadRequestException);
    expect(() => validateCagBindings([{ id: 'bad', rows: [{ tag: 'POINT_INVENTADO' }] }])).toThrow(BadRequestException);
  });

  it('resolves only the existing hierarchy and never queries devices or points', async () => {
    const resolved = target();
    const fakePrisma = {
      tenant: { findFirst: jest.fn().mockResolvedValue(resolved.tenant) },
      site: { findFirst: jest.fn().mockResolvedValue(resolved.site) },
      project: { findFirst: jest.fn().mockResolvedValue(resolved.project) },
      scadaScreen: {
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockResolvedValue({ id: 'screen-cag' }),
      },
    };

    const result = await provisionCagAutobras(fakePrisma as never);

    expect(result.created).toBe(true);
    expect(fakePrisma.tenant.findFirst).toHaveBeenCalledTimes(1);
    expect(fakePrisma.site.findFirst).toHaveBeenCalledTimes(1);
    expect(fakePrisma.project.findFirst).toHaveBeenCalledTimes(1);
    expect(fakePrisma.scadaScreen.create).toHaveBeenCalledTimes(1);
    expect((fakePrisma as any).device).toBeUndefined();
  });

  it('reconciles a second execution instead of creating a duplicate screen', async () => {
    const resolved = target();
    const state: { screens: Array<Record<string, any>> } = { screens: [] };
    const fakePrisma = {
      tenant: { findFirst: jest.fn().mockResolvedValue(resolved.tenant) },
      site: { findFirst: jest.fn().mockResolvedValue(resolved.site) },
      project: { findFirst: jest.fn().mockResolvedValue(resolved.project) },
      scadaScreen: {
        findMany: jest.fn().mockImplementation(async () => state.screens),
        create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, any> }) => {
          const screen = { id: 'screen-cag', ...data };
          state.screens.push(screen);
          return { id: screen.id };
        }),
        update: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const first = await provisionCagAutobras(fakePrisma as never);
    const second = await provisionCagAutobras(fakePrisma as never);

    expect(first).toMatchObject({ id: 'screen-cag', created: true });
    expect(second).toMatchObject({ id: 'screen-cag', created: false });
    expect(state.screens).toHaveLength(1);
    expect(fakePrisma.scadaScreen.create).toHaveBeenCalledTimes(1);
    expect(fakePrisma.scadaScreen.update).toHaveBeenCalledTimes(1);
  });

  it('deletes duplicate screens only inside the exact target scope', async () => {
    const resolved = target();
    const fakePrisma = {
      tenant: { findFirst: jest.fn().mockResolvedValue(resolved.tenant) },
      site: { findFirst: jest.fn().mockResolvedValue(resolved.site) },
      project: { findFirst: jest.fn().mockResolvedValue(resolved.project) },
      scadaScreen: {
        findMany: jest.fn().mockResolvedValue([{ id: 'canonical' }, { id: 'duplicate' }]),
        update: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    await provisionCagAutobras(fakePrisma as never);

    expect(fakePrisma.scadaScreen.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['duplicate'] } } });
  });
});