import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { TenantsController } from './tenants.controller.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { ClusterService } from '../cluster/cluster.service.js';
import type { ScadaObjectStorageService } from '../scada/infrastructure/scada-object-storage.service.js';
import type { AuthenticatedUser } from '../auth/domain/interfaces/auth.interface.js';

/**
 * Testes do GET /tenants — garante que a resposta para CLIENTE/VISUALIZADOR
 * inclui os campos de identidade visual (logoUrl/accentColor), usados pela
 * topbar do próprio cliente. Regressão: quando o Prisma Client fica
 * desatualizado (migration de branding não aplicada), esses campos somem e o
 * cliente vê só o nome em texto, sem logo nem cor.
 */
describe('TenantsController.getTenants', () => {
  const TENANT_ID = 'tenant-1';
  const tenantRow = {
    id: TENANT_ID,
    name: 'Novo Cliente',
    slug: 'novo-cliente',
    active: true,
    logoUrl: '/scada-assets/tenant-1/logo.png',
    accentColor: '#1d4ed8',
    createdAt: new Date('2026-06-30T14:07:20.914Z'),
    _count: { sites: 2, devices: 6 },
  };

  const prismaMock = {
    tenant: {
      findMany: jest.fn(async () => [tenantRow]),
      findUnique: jest.fn(async () => tenantRow),
    },
  } as unknown as PrismaService;

  const controller = new TenantsController(
    prismaMock,
    {} as ClusterService,
    {} as ScadaObjectStorageService,
    {} as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('CLIENTE recebe o próprio tenant com logoUrl e accentColor', async () => {
    const user = { id: 'u-cli', role: 'CLIENTE', tenantId: TENANT_ID } as AuthenticatedUser;
    const result = await controller.getTenants(user);

    expect(prismaMock.tenant.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: TENANT_ID } }),
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: TENANT_ID,
      name: 'Novo Cliente',
      logoUrl: '/scada-assets/tenant-1/logo.png',
      accentColor: '#1d4ed8',
    });
  });

  it('VISUALIZADOR recebe o próprio tenant com branding', async () => {
    const user = { id: 'u-viz', role: 'VISUALIZADOR', tenantId: TENANT_ID } as AuthenticatedUser;
    const result = await controller.getTenants(user);
    expect(result[0]).toMatchObject({
      logoUrl: '/scada-assets/tenant-1/logo.png',
      accentColor: '#1d4ed8',
    });
  });

  it('ADMIN recebe todos os tenants com branding', async () => {
    const user = { id: 'u-adm', role: 'ADMIN', tenantId: null } as AuthenticatedUser;
    const result = await controller.getTenants(user);
    expect(prismaMock.tenant.findMany).toHaveBeenCalled();
    expect(result[0]).toMatchObject({
      logoUrl: '/scada-assets/tenant-1/logo.png',
      accentColor: '#1d4ed8',
    });
  });

  it('CLIENTE sem tenantId recebe lista vazia', async () => {
    const user = { id: 'u-cli', role: 'CLIENTE', tenantId: null } as AuthenticatedUser;
    await expect(controller.getTenants(user)).resolves.toEqual([]);
  });
});

/**
 * Testes do PATCH /tenants/:id — edição de nome/slug do cliente pela tela de
 * Ajustes. Garante restrição a ADMIN, normalização/validação de slug, erro
 * amigável em colisão de slug (em vez de estourar a constraint única) e 404
 * para cliente inexistente. Resposta no formato TenantItem.
 */
describe('TenantsController.updateTenant', () => {
  const TENANT_ID = 'tenant-1';
  const admin = { id: 'u-admin', role: 'ADMIN' } as AuthenticatedUser;

  const tenantRow = {
    id: TENANT_ID,
    name: 'Cliente Antigo',
    slug: 'cliente-antigo',
    active: true,
    logoUrl: null,
    accentColor: null,
    createdAt: new Date('2026-06-30T14:07:20.914Z'),
  };

  const findUnique = jest.fn();
  const update = jest.fn();

  const prismaMock = {
    tenant: { findUnique, update },
  } as unknown as PrismaService;

  const controller = new TenantsController(
    prismaMock,
    {} as ClusterService,
    {} as ScadaObjectStorageService,
    {} as never,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    findUnique.mockImplementation(async ({ where }: { where: { id?: string; slug?: string } }) => {
      if (where.id === TENANT_ID) return tenantRow;
      return null; // busca por slug: sem colisão por padrão
    });
    update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...tenantRow,
      ...data,
      _count: { sites: 2, devices: 6 },
    }));
  });

  it('atualiza nome e slug e responde no formato TenantItem', async () => {
    const result = await controller.updateTenant(admin, TENANT_ID, {
      name: '  Novo Nome  ',
      slug: 'Novo Slug!',
    });

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TENANT_ID },
        data: { name: 'Novo Nome', slug: 'novo-slug' },
      }),
    );
    expect(result).toMatchObject({
      id: TENANT_ID,
      name: 'Novo Nome',
      slug: 'novo-slug',
      active: true,
      siteCount: 2,
      deviceCount: 6,
      createdAt: '2026-06-30T14:07:20.914Z',
    });
  });

  it('recusa quem não é ADMIN', async () => {
    const cco = { id: 'u-cco', role: 'CCO' } as AuthenticatedUser;
    await expect(
      controller.updateTenant(cco, TENANT_ID, { name: 'X' }),
    ).rejects.toThrow(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('retorna 404 se o cliente não existe', async () => {
    findUnique.mockResolvedValueOnce(null);
    await expect(
      controller.updateTenant(admin, 'inexistente', { name: 'X' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('recusa slug que vira vazio após normalização', async () => {
    await expect(
      controller.updateTenant(admin, TENANT_ID, { slug: '  --- ' }),
    ).rejects.toThrow(BadRequestException);
    expect(update).not.toHaveBeenCalled();
  });

  it('recusa nome vazio', async () => {
    await expect(
      controller.updateTenant(admin, TENANT_ID, { name: '   ' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('recusa corpo sem name nem slug', async () => {
    await expect(controller.updateTenant(admin, TENANT_ID, {})).rejects.toThrow(
      BadRequestException,
    );
  });

  it('recusa slug já usado por outro cliente com erro amigável', async () => {
    findUnique.mockImplementation(async ({ where }: { where: { id?: string; slug?: string } }) => {
      if (where.id === TENANT_ID) return tenantRow;
      if (where.slug === 'ocupado') return { id: 'tenant-2', slug: 'ocupado' };
      return null;
    });
    await expect(
      controller.updateTenant(admin, TENANT_ID, { slug: 'ocupado' }),
    ).rejects.toThrow('Já existe um cliente com este slug');
    expect(update).not.toHaveBeenCalled();
  });

  it('permite salvar mantendo o próprio slug (sem falso positivo de colisão)', async () => {
    const result = await controller.updateTenant(admin, TENANT_ID, {
      name: 'Renomeado',
      slug: 'cliente-antigo',
    });
    expect(result).toMatchObject({ name: 'Renomeado', slug: 'cliente-antigo' });
    // Não deve consultar colisão quando o slug não mudou.
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it('converte P2002 (corrida na constraint única) em erro amigável', async () => {
    update.mockImplementationOnce(async () => {
      const err = new Error('Unique constraint failed') as Error & { code: string };
      err.code = 'P2002';
      throw err;
    });
    await expect(
      controller.updateTenant(admin, TENANT_ID, { slug: 'corrida' }),
    ).rejects.toThrow('Já existe um cliente com este slug');
  });
});

/**
 * Testes da exclusão de cliente (DELETE /tenants/:id) — garante que a
 * transação remove TODOS os vínculos diretos com o tenant (incluindo telas
 * SCADA e grupos de alarme, causa do erro P2003 em produção) e que falhas de
 * FK viram erro amigável (409) em vez de "Internal server error".
 */
describe('TenantsController.deleteTenant', () => {
  const TENANT_ID = 'tenant-1';

  const admin = { id: 'u-admin', role: 'ADMIN' } as AuthenticatedUser;

  interface Op {
    model: string;
    action: string;
    args: unknown;
  }

  let ops: Op[];
  let transactionImpl: (list: unknown[]) => Promise<unknown>;

  const model = (name: string) => ({
    deleteMany: jest.fn((args: unknown) => ({ model: name, action: 'deleteMany', args })),
    updateMany: jest.fn((args: unknown) => ({ model: name, action: 'updateMany', args })),
    delete: jest.fn((args: unknown) => ({ model: name, action: 'delete', args })),
    findUnique: jest.fn(async () => ({ id: TENANT_ID, name: 'Cliente', slug: 'cliente' })),
  });

  const prismaMock = {
    tenant: model('tenant'),
    devicePoint: model('devicePoint'),
    scadaScreen: model('scadaScreen'),
    alarmGroup: model('alarmGroup'),
    device: model('device'),
    gateway: model('gateway'),
    project: model('project'),
    site: model('site'),
    user: model('user'),
    $transaction: jest.fn((list: Op[]) => {
      ops = list;
      return transactionImpl(list);
    }),
  } as unknown as PrismaService;

  const clusterMock = {} as ClusterService;

  const scadaStorageMock = {
    deletePrefix: jest.fn(async () => 0),
  } as unknown as ScadaObjectStorageService;

  const assetServiceMock = {
    saveDataUrl: jest.fn(async () => ({ url: '/scada-assets/t/x.png' })),
  } as unknown as import('../scada/application/scada-asset.service.js').ScadaAssetService;

  let controller: TenantsController;

  beforeEach(() => {
    ops = [];
    transactionImpl = async () => [];
    jest.clearAllMocks();
    (scadaStorageMock.deletePrefix as jest.Mock).mockResolvedValue(0);
    controller = new TenantsController(prismaMock, clusterMock, scadaStorageMock, assetServiceMock);
  });

  it('exclui telas SCADA e grupos de alarme antes do tenant', async () => {
    await controller.deleteTenant(admin, TENANT_ID);

    const idx = (m: string, a: string) =>
      ops.findIndex((op) => op.model === m && op.action === a);

    // Todos os vínculos diretos com FK real para tenants entram na transação.
    expect(idx('scadaScreen', 'deleteMany')).toBeGreaterThanOrEqual(0);
    expect(idx('alarmGroup', 'deleteMany')).toBeGreaterThanOrEqual(0);
    expect(idx('device', 'deleteMany')).toBeGreaterThanOrEqual(0);
    expect(idx('gateway', 'deleteMany')).toBeGreaterThanOrEqual(0);
    expect(idx('project', 'deleteMany')).toBeGreaterThanOrEqual(0);
    expect(idx('site', 'deleteMany')).toBeGreaterThanOrEqual(0);
    expect(idx('user', 'deleteMany')).toBeGreaterThanOrEqual(0);

    // O tenant é o ÚLTIMO passo da transação.
    const tenantIdx = idx('tenant', 'delete');
    expect(tenantIdx).toBe(ops.length - 1);
    expect(idx('scadaScreen', 'deleteMany')).toBeLessThan(tenantIdx);
    expect(idx('alarmGroup', 'deleteMany')).toBeLessThan(tenantIdx);

    // Filtros corretos por tenant.
    expect(prismaMock.scadaScreen.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID },
    });
    expect(prismaMock.alarmGroup.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID },
    });
    // Usuários globais nunca são excluídos — só CLIENTE/VISUALIZADOR.
    expect(prismaMock.user.deleteMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT_ID, role: { in: ['CLIENTE', 'VISUALIZADOR'] } },
    });
  });

  it('limpa assets SCADA do bucket após excluir o cliente (best-effort)', async () => {
    await controller.deleteTenant(admin, TENANT_ID);
    expect(scadaStorageMock.deletePrefix).toHaveBeenCalledWith(TENANT_ID);
  });

  it('não bloqueia a exclusão se a limpeza do bucket falhar', async () => {
    (scadaStorageMock.deletePrefix as jest.Mock).mockRejectedValueOnce(
      new Error('bucket indisponível'),
    );
    await expect(controller.deleteTenant(admin, TENANT_ID)).resolves.toBeUndefined();
  });

  it('não toca no bucket se a transação de exclusão falhar', async () => {
    transactionImpl = async () => {
      throw new Error('conexão perdida');
    };
    await expect(controller.deleteTenant(admin, TENANT_ID)).rejects.toThrow();
    expect(scadaStorageMock.deletePrefix).not.toHaveBeenCalled();
  });

  it('converte violação de FK (P2003) em erro amigável 409', async () => {
    transactionImpl = async () => {
      const err = new Error('Foreign key constraint violated') as Error & { code: string };
      err.code = 'P2003';
      throw err;
    };

    await expect(controller.deleteTenant(admin, TENANT_ID)).rejects.toThrow(ConflictException);
  });

  it('repassa erros que não são de FK sem mascarar', async () => {
    transactionImpl = async () => {
      throw new Error('conexão perdida');
    };

    await expect(controller.deleteTenant(admin, TENANT_ID)).rejects.toThrow('conexão perdida');
  });

  it('recusa exclusão para quem não é ADMIN', async () => {
    const cco = { id: 'u-cco', role: 'CCO' } as AuthenticatedUser;
    await expect(controller.deleteTenant(cco, TENANT_ID)).rejects.toThrow(BadRequestException);
  });

  it('retorna 404 se o cliente não existe', async () => {
    (prismaMock.tenant.findUnique as jest.Mock).mockResolvedValueOnce(null);
    await expect(controller.deleteTenant(admin, 'inexistente')).rejects.toThrow(NotFoundException);
  });
});
