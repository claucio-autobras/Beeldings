/**
 * Regression: endereço e contato técnico pertencem ao Site, não ao Projeto.
 *
 *  - SitesService.create deve persistir location/responsibleName (trim, '' → null).
 *  - ProjectsService.create/update NÃO devem mais aceitar address/technicalContact
 *    (as colunas do Project são legado e não podem ser mutadas pela API).
 */

import { BadRequestException } from '@nestjs/common';
import { SitesService } from './sites.service.js';
import { ProjectsService } from '../../projects/application/projects.service.js';
import { ProjectsController } from '../../projects/presentation/projects.controller.js';

type AnyRecord = Record<string, any>;

// ─── SitesService.create ─────────────────────────────────────────────────────

function makeSitesPrisma() {
  const created: AnyRecord[] = [];
  return {
    _created: created,
    tenant: { findUnique: async () => ({ id: 't1', name: 'Tenant' }) },
    site: {
      create: async ({ data }: AnyRecord) => {
        created.push(data);
        return { id: 's1', ...data };
      },
    },
  } as AnyRecord;
}

describe('SitesService.create — endereço e contato do site', () => {
  it('persiste location e responsibleName com trim', async () => {
    const prisma = makeSitesPrisma();
    const service = new SitesService(prisma as never, {} as never);

    const site = await service.create({
      name: '  Unidade Morumbi ',
      tenantId: 't1',
      location: '  Rua das Flores, 100 ',
      responsibleName: ' João Silva ',
    });

    expect(prisma._created[0]).toMatchObject({
      name: 'Unidade Morumbi',
      location: 'Rua das Flores, 100',
      responsibleName: 'João Silva',
    });
    expect(site.location).toBe('Rua das Flores, 100');
  });

  it('campos ausentes ou vazios viram null', async () => {
    const prisma = makeSitesPrisma();
    const service = new SitesService(prisma as never, {} as never);

    await service.create({ name: 'Site X', tenantId: 't1', location: '', responsibleName: undefined });

    expect(prisma._created[0].location).toBeNull();
    expect(prisma._created[0].responsibleName).toBeNull();
  });
});

// ─── ProjectsService — projeto não aceita mais endereço/contato ──────────────

function makeProjectsPrisma() {
  const createdProjects: AnyRecord[] = [];
  const updates: AnyRecord[] = [];
  return {
    _createdProjects: createdProjects,
    _updates: updates,
    site: { findFirst: async () => ({ id: 'site-1', name: 'Site 1', tenantId: 't1' }) },
    gateway: {
      create: async ({ data }: AnyRecord) => ({ ...data }),
      findFirst: async () => null,
    },
    project: {
      findFirst: async ({ where }: AnyRecord) =>
        where?.id ? { id: where.id, name: 'Projeto', siteId: 'site-1', tenantId: 't1' } : null,
      count: async () => 0,
      create: async ({ data }: AnyRecord) => {
        createdProjects.push(data);
        return { id: 'p1', ...data };
      },
      update: async ({ data }: AnyRecord) => {
        updates.push(data);
        return { id: 'p1', name: data.name ?? 'Projeto' };
      },
    },
  } as AnyRecord;
}

const fakeEmqx: AnyRecord = { provisionGateway: async () => {} };
const fakeDeviceStatus: AnyRecord = { getStatus: () => 'offline', getLastSeen: () => null };

const adminUser: AnyRecord = { id: 'u1', role: 'ADMIN', tenantId: 't1' };

function makeController(service: ProjectsService): ProjectsController {
  return new ProjectsController(service, { get: () => undefined } as never);
}

describe('API de projetos — address/technicalContact são rejeitados com 400', () => {
  it('POST /projects com address/technicalContact lança BadRequest e nada é criado', async () => {
    const prisma = makeProjectsPrisma();
    const service = new ProjectsService(prisma as never, fakeEmqx as never, fakeDeviceStatus as never);
    const controller = makeController(service);

    await expect(
      controller.create(
        {
          name: 'BMS Principal',
          siteId: 'site-1',
          tenantId: 't1',
          address: 'Rua Antiga, 1',
          technicalContact: 'Fulano',
        } as never,
        adminUser as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma._createdProjects).toHaveLength(0);
  });

  it('PATCH /projects/:id com campos legados lança BadRequest e nada é gravado', async () => {
    const prisma = makeProjectsPrisma();
    const service = new ProjectsService(prisma as never, fakeEmqx as never, fakeDeviceStatus as never);
    const controller = makeController(service);

    await expect(
      controller.update('p1', { name: 'Novo Nome', address: 'Rua Nova, 2' } as never, adminUser as never),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma._updates).toHaveLength(0);
  });

  it('PATCH /projects/:id só com nome continua funcionando e grava apenas o nome', async () => {
    const prisma = makeProjectsPrisma();
    const service = new ProjectsService(prisma as never, fakeEmqx as never, fakeDeviceStatus as never);
    const controller = makeController(service);

    await controller.update('p1', { name: 'Novo Nome' } as never, adminUser as never);

    expect(prisma._updates[0]).toEqual({ name: 'Novo Nome' });
  });
});
