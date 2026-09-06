import type { ExecutionContext, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { JwtAuthGuard } from '../../auth/presentation/guards/jwt-auth.guard.js';
import { UserRole, type AuthenticatedUser } from '../../auth/domain/interfaces/auth.interface.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { ScadaObjectStorageService } from '../infrastructure/scada-object-storage.service.js';
import { SimulatorService } from '../application/simulator.service.js';
import { ScadaModule } from './scada.module.js';

const ADMIN_USER: AuthenticatedUser = {
  id: 'admin-a',
  supabaseId: 'admin-a',
  email: 'admin@example.com',
  name: 'Admin',
  role: UserRole.ADMIN,
  tenantId: null,
};

describe('PATCH /scada/projects/:projectId (HTTP)', () => {
  let app: INestApplication;
  let currentUser: AuthenticatedUser = ADMIN_USER;
  let project: {
    id: string;
    name: string;
    siteId: string;
    tenantId: string;
    coverImageUrl: string | null;
  };
  const save = jest.fn();

  beforeAll(async () => {
    project = {
      id: 'project-a',
      name: 'Edifício Aurora',
      siteId: 'site-a',
      tenantId: 'tenant-a',
      coverImageUrl: '/scada-assets/tenant-a/old.jpg',
    };

    const prisma = {
      project: {
        findFirst: jest.fn(async ({ where }: { where: { id: string; tenantId?: string } }) =>
          where.id === project.id && (!where.tenantId || where.tenantId === project.tenantId)
            ? { id: project.id, tenantId: project.tenantId }
            : null,
        ),
        update: jest.fn(async ({ data }: { data: { coverImageUrl: string | null } }) => {
          project = { ...project, ...data };
          return project;
        }),
      },
    };

    const moduleRef = await Test.createTestingModule({
      imports: [ScadaModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(ScadaObjectStorageService)
      .useValue({ save })
      .overrideProvider(SimulatorService)
      .useValue({})
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          context.switchToHttp().getRequest<{ user: AuthenticatedUser }>().user = currentUser;
          return true;
        },
      })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    save.mockReset();
    currentUser = ADMIN_USER;
  });

  it('registra o controller real e troca a capa pelo pipeline autenticado', async () => {
    const response = await request(app.getHttpServer())
      .patch('/scada/projects/project-a')
      .send({ coverImageDataUrl: 'data:image/png;base64,ZmFrZQ==' })
      .expect(200);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      expect.stringMatching(/^tenant-a\/[0-9a-f-]+\.png$/),
      Buffer.from('fake'),
      'image/png',
    );
    expect(response.body).toMatchObject({
      id: 'project-a',
      coverImageUrl: expect.stringMatching(/^\/scada-assets\/tenant-a\/[0-9a-f-]+\.png$/),
    });
  });

  it('remove a capa com null pela mesma rota registrada', async () => {
    const response = await request(app.getHttpServer())
      .patch('/scada/projects/project-a')
      .send({ coverImageDataUrl: null })
      .expect(200);

    expect(save).not.toHaveBeenCalled();
    expect(response.body).toMatchObject({
      id: 'project-a',
      coverImageUrl: null,
    });
  });

  it('mantém a capa anterior quando o payload é inválido', async () => {
    project = {
      ...project,
      coverImageUrl: '/scada-assets/tenant-a/current.jpg',
    };

    const response = await request(app.getHttpServer())
      .patch('/scada/projects/project-a')
      .send({})
      .expect(400);

    expect(response.body.message).toMatch(/coverImageDataUrl/i);
    expect(project.coverImageUrl).toBe('/scada-assets/tenant-a/current.jpg');
    expect(save).not.toHaveBeenCalled();
  });

  it('nega papel sem permissão e preserva a capa anterior', async () => {
    project = {
      ...project,
      coverImageUrl: '/scada-assets/tenant-a/current.jpg',
    };
    currentUser = {
      ...ADMIN_USER,
      role: UserRole.CLIENTE,
      tenantId: 'tenant-a',
    };

    const response = await request(app.getHttpServer())
      .patch('/scada/projects/project-a')
      .send({ coverImageDataUrl: null })
      .expect(403);

    expect(response.body.message).toMatch(/sem permissão/i);
    expect(project.coverImageUrl).toBe('/scada-assets/tenant-a/current.jpg');
    expect(save).not.toHaveBeenCalled();
  });
});