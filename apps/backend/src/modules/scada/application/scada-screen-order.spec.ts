import 'reflect-metadata';

import { ScadaService } from './scada.service.js';

describe('ScadaService — ordenação das telas', () => {
  it('solicita telas por criação descendente e desempata pelo id', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new ScadaService(
      { scadaScreen: { findMany } } as never,
      {} as never,
    );

    await service.findAll({
      tenantId: 'tenant-a',
      siteId: 'site-1',
      projectId: 'project-1',
    });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-a',
        siteId: 'site-1',
        projectId: 'project-1',
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  });

  it('não usa updatedAt para definir a posição após uma alteração', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const findFirst = jest.fn().mockResolvedValue({
      id: 'screen-1',
      name: 'Tela antiga',
      tenantId: 'tenant-a',
      siteId: 'site-1',
      projectId: 'project-1',
      widgets: [],
      settings: {},
    });
    const update = jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
      Promise.resolve({
        id: 'screen-1',
        name: 'Tela nova',
        tenantId: 'tenant-a',
        siteId: 'site-1',
        projectId: 'project-1',
        widgets: [],
        settings: {},
        ...data,
      }),
    );
    const service = new ScadaService(
      { scadaScreen: { findMany, findFirst, update } } as never,
      {} as never,
    );

    await service.update('screen-1', 'tenant-a', { name: 'Tela nova' });
    await service.findAll({ projectId: 'project-1' });

    expect(update).toHaveBeenCalledWith({
      where: { id: 'screen-1' },
      data: { name: 'Tela nova' },
    });

    const query = findMany.mock.calls[findMany.mock.calls.length - 1][0] as {
      orderBy: Array<Record<string, string>>;
    };
    expect(query.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(JSON.stringify(query.orderBy)).not.toContain('updatedAt');
  });

  it('inclui o site no acesso individual da tela', async () => {
    const findFirst = jest.fn().mockResolvedValue({
      id: 'screen-1',
      tenantId: 'tenant-a',
      siteId: 'site-1',
      projectId: 'project-1',
      widgets: [],
      settings: {},
    });
    const service = new ScadaService(
      { scadaScreen: { findFirst } } as never,
      {} as never,
    );

    await service.findOne('screen-1', 'tenant-a', 'site-1');

    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 'screen-1', tenantId: 'tenant-a', siteId: 'site-1' },
    });
  });
});