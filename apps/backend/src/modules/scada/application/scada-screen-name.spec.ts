import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';

import { ScadaService } from './scada.service.js';

/**
 * Unicidade de nome das telas SCADA (case-insensitive, trimmed) por escopo:
 * - criar com nome já usado no mesmo projeto → 409;
 * - renomear para nome de outra tela do mesmo escopo → 409;
 * - renomear para o próprio nome atual → permitido;
 * - mesmo nome em projetos diferentes → permitido.
 */

const SCREEN = {
  id: 'scr-1',
  name: 'Iluminação',
  tenantId: 'tenant-a',
  siteId: 'site-1',
  projectId: 'proj-1',
  settings: {},
  widgets: [],
};

function makeService(siblings: Array<{ name: string }>) {
  const prisma = {
    scadaScreen: {
      findMany: jest.fn().mockResolvedValue(siblings),
      findFirst: jest.fn().mockResolvedValue(SCREEN),
      findUnique: jest.fn().mockResolvedValue(SCREEN),
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ id: 'scr-new', ...data }),
      ),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...SCREEN, ...data }),
      ),
    },
    project: {
      findFirst: jest.fn().mockResolvedValue({ id: 'proj-1', siteId: 'site-1' }),
    },
    site: {
      findFirst: jest.fn().mockResolvedValue({ id: 'site-1' }),
    },
  };
  const service = new ScadaService(prisma as never);
  return { service, prisma };
}

describe('ScadaService — unicidade de nome das telas', () => {
  it('rejeita criação com nome duplicado no mesmo projeto (case/trim-insensitive)', async () => {
    const { service } = makeService([{ name: 'ILUMINAÇÃO ' }]);
    await expect(
      service.create({ name: 'iluminação', tenantId: 'tenant-a', projectId: 'proj-1' } as never),
    ).rejects.toThrow(ConflictException);
  });

  it('permite criar quando não há tela com o mesmo nome no escopo', async () => {
    const { service, prisma } = makeService([{ name: 'Chillers' }]);
    await service.create({ name: 'Iluminação', tenantId: 'tenant-a', projectId: 'proj-1' } as never);
    expect(prisma.scadaScreen.create).toHaveBeenCalled();
  });

  it('mesmo nome em projetos diferentes é permitido (query filtra pelo projeto)', async () => {
    const { service, prisma } = makeService([]);
    await service.create({ name: 'Iluminação', tenantId: 'tenant-a', projectId: 'proj-2' } as never);
    expect(prisma.scadaScreen.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ projectId: 'proj-2', tenantId: 'tenant-a' }) }),
    );
    expect(prisma.scadaScreen.create).toHaveBeenCalled();
  });

  it('rejeita rename para nome já usado por OUTRA tela do escopo', async () => {
    const { service, prisma } = makeService([{ name: 'Subestação' }]);
    await expect(
      service.update('scr-1', 'tenant-a', { name: '  subestação ' } as never),
    ).rejects.toThrow(ConflictException);
    // exclui a própria tela da checagem
    expect(prisma.scadaScreen.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { not: 'scr-1' } }) }),
    );
  });

  it('renomear para o próprio nome atual continua permitido', async () => {
    // findMany exclui a própria tela; sem irmãs com o mesmo nome → passa.
    const { service, prisma } = makeService([{ name: 'Outra Tela' }]);
    await service.update('scr-1', 'tenant-a', { name: 'ILUMINAÇÃO' } as never);
    expect(prisma.scadaScreen.update).toHaveBeenCalled();
  });

  it('sem projeto valida no escopo do site (projectId null)', async () => {
    const { service } = makeService([{ name: 'Painel Geral' }]);
    await expect(
      service.create({ name: 'painel geral', tenantId: 'tenant-a', siteId: 'site-1' } as never),
    ).rejects.toThrow(ConflictException);
  });
});
