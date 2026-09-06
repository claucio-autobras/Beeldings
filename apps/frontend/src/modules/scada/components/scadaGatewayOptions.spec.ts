import { resolveScadaGatewayOptions } from './scadaGatewayOptions';
import type { GatewayItem } from '@/modules/gateways/services/gateways.service';
import type { ProjectItem } from '@/modules/projects/services/projects.service';

const gateway = (id: string, tenantId = 'tenant-a'): GatewayItem => ({
  id, tenantId, status: 'online', createdAt: '2026-01-01T00:00:00.000Z',
});

const project = (
  id: string,
  gatewayId: string | null,
  siteId = 'site-a',
  tenantId = 'tenant-a',
): ProjectItem => ({
  id, name: `Projeto ${id}`, siteId, tenantId, createdAt: '2026-01-01T00:00:00.000Z',
  gateway: gatewayId ? { id: gatewayId, status: 'online' } : null,
});

describe('resolveScadaGatewayOptions', () => {
  it('filters the project anchor to the selected site and keeps the gateway recognizable', () => {
    const options = resolveScadaGatewayOptions(
      [gateway('gw-site'), gateway('gw-other')],
      [project('project-site', 'gw-site'), project('project-other', 'gw-other', 'site-b')],
      'site-a',
      new Set(),
    );

    expect(options.find((option) => option.gateway.id === 'gw-site')).toMatchObject({
      projectId: 'project-site', compatible: true, availabilityReason: 'available',
    });
    expect(options.find((option) => option.gateway.id === 'gw-other')).toMatchObject({
      projectId: null, compatible: false, availabilityReason: 'no-site-project',
    });
  });

  it('allows a shared gateway through the project linked to the selected site', () => {
    const options = resolveScadaGatewayOptions(
      [gateway('gw-shared')],
      [project('project-a', 'gw-shared', 'site-a'), project('project-b', 'gw-shared', 'site-b')],
      'site-a',
      new Set(),
    );

    expect(options[0]).toMatchObject({ gateway: { id: 'gw-shared' }, projectId: 'project-a', compatible: true });
  });

  it('does not select a project already visible in SCADA', () => {
    const options = resolveScadaGatewayOptions(
      [gateway('gw-1')],
      [project('project-1', 'gw-1')],
      'site-a',
      new Set(['project-1']),
    );

    expect(options[0]).toMatchObject({
      projectId: null,
      compatible: false,
      availabilityReason: 'already-added',
    });
  });

  it('identifies a gateway whose site projects were all already added to SCADA', () => {
    const options = resolveScadaGatewayOptions(
      [gateway('gw-1')],
      [project('project-1', 'gw-1')],
      'site-a',
      new Set(['project-1']),
    );

    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({
      gateway: { id: 'gw-1' },
      availabilityReason: 'already-added',
      compatible: false,
    });
  });

  it('keeps a gateway available when at least one site project is not yet in SCADA', () => {
    const options = resolveScadaGatewayOptions(
      [gateway('gw-1')],
      [project('project-added', 'gw-1'), project('project-new', 'gw-1')],
      'site-a',
      new Set(['project-added']),
    );

    expect(options[0]).toMatchObject({
      projectId: 'project-new',
      compatible: true,
      availabilityReason: 'available',
    });
  });
});
