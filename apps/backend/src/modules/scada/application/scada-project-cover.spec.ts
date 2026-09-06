import 'reflect-metadata';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import { ScadaService } from './scada.service.js';
import { ScadaAssetService } from './scada-asset.service.js';

const PROJECT = {
  id: 'project-a',
  name: 'Edifício Aurora',
  siteId: 'site-a',
  tenantId: 'tenant-a',
  coverImageUrl: '/scada-assets/tenant-a/old.jpg',
};

function makeService(project: Record<string, unknown> | null = PROJECT) {
  const prisma = {
    project: {
      findFirst: jest.fn().mockResolvedValue(project),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...PROJECT, ...data }),
      ),
    },
  };
  const assets = {
    saveDataUrl: jest.fn().mockResolvedValue({ url: '/scada-assets/tenant-a/new.jpg' }),
  };
  return { service: new ScadaService(prisma as never, assets as never), prisma, assets };
}

describe('ScadaService — capa do projeto SCADA', () => {
  it('salva a imagem no tenant do projeto e persiste somente a URL', async () => {
    const { service, prisma, assets } = makeService();

    await service.enableProject('project-a', 'tenant-a', 'data:image/jpeg;base64,ZmFrZQ==');

    expect(assets.saveDataUrl).toHaveBeenCalledWith('tenant-a', 'data:image/jpeg;base64,ZmFrZQ==');
    expect(prisma.project.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'project-a' },
      data: { scadaEnabled: true, coverImageUrl: '/scada-assets/tenant-a/new.jpg' },
    }));
  });

  it('reativa sem imagem sem apagar uma capa já cadastrada', async () => {
    const { service, prisma, assets } = makeService();

    await service.enableProject('project-a', 'tenant-a');

    expect(assets.saveDataUrl).not.toHaveBeenCalled();
    expect(prisma.project.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { scadaEnabled: true },
    }));
  });

  it('não habilita o projeto quando o upload falha', async () => {
    const { service, prisma, assets } = makeService();
    assets.saveDataUrl.mockRejectedValue(new BadRequestException('Tipo de imagem não suportado'));

    await expect(
      service.enableProject('project-a', 'tenant-a', 'data:image/bmp;base64,ZmFrZQ=='),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it('rejeita um data URL inválido antes de habilitar o projeto', async () => {
    const { prisma } = makeService();
    const storage = { save: jest.fn() };
    const service = new ScadaService(
      prisma as never,
      new ScadaAssetService(storage as never),
    );

    await expect(
      service.enableProject('project-a', 'tenant-a', 'imagem-sem-data-url'),
    ).rejects.toThrow(BadRequestException);
    expect(storage.save).not.toHaveBeenCalled();
    expect(prisma.project.update).not.toHaveBeenCalled();
  });

  it('não permite associar a capa a um projeto de outro tenant', async () => {
    const { service, prisma, assets } = makeService(null);

    await expect(
      service.enableProject('project-a', 'tenant-b', 'data:image/jpeg;base64,ZmFrZQ=='),
    ).rejects.toThrow(NotFoundException);
    expect(prisma.project.findFirst).toHaveBeenCalledWith({
      where: { id: 'project-a', tenantId: 'tenant-b' },
      select: { id: true, tenantId: true },
    });
    expect(assets.saveDataUrl).not.toHaveBeenCalled();
  });

  it('troca a capa sem alterar a habilitação do projeto', async () => {
    const { service, prisma, assets } = makeService();

    await service.updateProjectCover('project-a', 'tenant-a', 'data:image/png;base64,ZmFrZQ==');

    expect(assets.saveDataUrl).toHaveBeenCalledWith('tenant-a', 'data:image/png;base64,ZmFrZQ==');
    expect(prisma.project.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'project-a' },
      data: { coverImageUrl: '/scada-assets/tenant-a/new.jpg' },
    }));
  });

  it('remove a capa sem apagar telas ou outras configurações', async () => {
    const { service, prisma, assets } = makeService();

    await service.updateProjectCover('project-a', 'tenant-a', null);

    expect(assets.saveDataUrl).not.toHaveBeenCalled();
    expect(prisma.project.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'project-a' },
      data: { coverImageUrl: null },
    }));
  });

  it('não altera o projeto quando a nova capa é inválida', async () => {
    const { service, prisma, assets } = makeService();
    assets.saveDataUrl.mockRejectedValue(new BadRequestException('Tipo de imagem não suportado'));

    await expect(
      service.updateProjectCover('project-a', 'tenant-a', 'data:image/bmp;base64,ZmFrZQ=='),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.project.update).not.toHaveBeenCalled();
  });
});