import 'reflect-metadata';
import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { SimulatorService } from './simulator.service.js';
import { UserRole, type AuthenticatedUser } from '../../auth/domain/interfaces/auth.interface.js';

/**
 * Autorização da Bancada de Testes (pontos virtuais) — espelha o padrão do
 * spec de autorização dos writes de dispositivos (BACnet/MQTT/Modbus):
 * - CLIENTE pode COMANDAR (setPointValue) pontos virtuais do próprio tenant;
 * - CLIENTE bloqueado em tenant alheio;
 * - CLIENTE bloqueado nas operações estruturais (ensure/addPoints/deletePoint);
 * - VISUALIZADOR bloqueado em tudo (inclusive comando).
 */

function makeUser(role: UserRole, tenantId = 'tenant-a'): AuthenticatedUser {
  return { id: 'u1', email: 'u@x.com', name: 'User', role, tenantId } as AuthenticatedUser;
}

const PROJECT = { id: 'proj-1', tenantId: 'tenant-a', siteId: null };

const POINT = {
  id: 'pt-1',
  deviceId: 'dev-1',
  tag: 'bomba',
  objectName: 'bomba',
  objectType: 'BV',
  instance: 0,
  unit: '',
  binding: { kind: 'digital', currentValue: false },
  createdAt: new Date(),
};

const DEVICE = {
  id: 'dev-1',
  name: 'Bancada de Testes',
  protocol: 'virtual',
  tenantId: 'tenant-a',
  siteId: null,
  gatewayId: null,
  status: 'online',
  config: { virtual: true, projectId: 'proj-1' },
  createdAt: new Date(),
  points: [POINT],
};

function makeService(overrides: { project?: typeof PROJECT | null; device?: typeof DEVICE | null } = {}) {
  const prisma = {
    project: {
      findUnique: jest.fn().mockResolvedValue(overrides.project === undefined ? PROJECT : overrides.project),
    },
    device: {
      findUnique: jest.fn().mockResolvedValue(overrides.device === undefined ? DEVICE : overrides.device),
      findUniqueOrThrow: jest.fn().mockResolvedValue(DEVICE),
      findMany: jest.fn().mockResolvedValue([DEVICE]),
      create: jest.fn(),
    },
    devicePoint: {
      update: jest.fn().mockResolvedValue(POINT),
      create: jest.fn(),
      delete: jest.fn(),
    },
  };
  const telemetry = { emitTelemetry: jest.fn() };
  const service = new SimulatorService(prisma as never, telemetry as never);
  return { service, prisma, telemetry };
}

describe('Bancada — comando de valor (setPointValue)', () => {
  it('CLIENTE do tenant do projeto consegue setar valor', async () => {
    const { service, prisma, telemetry } = makeService();
    const view = await service.setPointValue('dev-1', 'pt-1', true, makeUser(UserRole.CLIENTE, 'tenant-a'));
    expect(view.id).toBe('dev-1');
    expect(prisma.devicePoint.update).toHaveBeenCalledTimes(1);
    expect(telemetry.emitTelemetry).toHaveBeenCalledTimes(1);
  });

  it.each([UserRole.ADMIN, UserRole.CCO, UserRole.SUPERVISOR])(
    'perfil global %s segue comandando',
    async (role) => {
      const { service, prisma } = makeService();
      await service.setPointValue('dev-1', 'pt-1', true, makeUser(role, 'other'));
      expect(prisma.devicePoint.update).toHaveBeenCalledTimes(1);
    },
  );

  it('CLIENTE de outro tenant é bloqueado (403 "Sem acesso a este projeto")', async () => {
    const { service, prisma } = makeService();
    await expect(
      service.setPointValue('dev-1', 'pt-1', true, makeUser(UserRole.CLIENTE, 'tenant-b')),
    ).rejects.toThrow(ForbiddenException);
    expect(prisma.devicePoint.update).not.toHaveBeenCalled();
  });

  it('VISUALIZADOR do próprio tenant é bloqueado no comando', async () => {
    const { service, prisma } = makeService();
    await expect(
      service.setPointValue('dev-1', 'pt-1', true, makeUser(UserRole.VISUALIZADOR, 'tenant-a')),
    ).rejects.toThrow(/comandar pontos da bancada/);
    expect(prisma.devicePoint.update).not.toHaveBeenCalled();
  });

  it('ponto inexistente → 404', async () => {
    const { service } = makeService();
    await expect(
      service.setPointValue('dev-1', 'pt-x', true, makeUser(UserRole.CLIENTE, 'tenant-a')),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('Bancada — gestão estrutural segue exigindo perfil global', () => {
  it('CLIENTE bloqueado no ensureDevice', async () => {
    const { service } = makeService();
    await expect(service.ensureDevice('proj-1', makeUser(UserRole.CLIENTE, 'tenant-a'))).rejects.toThrow(
      /gerir a bancada/,
    );
  });

  it('CLIENTE bloqueado no addPoints', async () => {
    const { service, prisma } = makeService();
    await expect(
      service.addPoints(
        'dev-1',
        [{ tag: 'novo', kind: 'digital' }],
        makeUser(UserRole.CLIENTE, 'tenant-a'),
      ),
    ).rejects.toThrow(/gerir a bancada/);
    expect(prisma.devicePoint.create).not.toHaveBeenCalled();
  });

  it('CLIENTE bloqueado no deletePoint', async () => {
    const { service, prisma } = makeService();
    await expect(
      service.deletePoint('dev-1', 'pt-1', makeUser(UserRole.CLIENTE, 'tenant-a')),
    ).rejects.toThrow(/gerir a bancada/);
    expect(prisma.devicePoint.delete).not.toHaveBeenCalled();
  });

  it('VISUALIZADOR bloqueado no addPoints', async () => {
    const { service } = makeService();
    await expect(
      service.addPoints('dev-1', [{ tag: 'novo', kind: 'digital' }], makeUser(UserRole.VISUALIZADOR, 'tenant-a')),
    ).rejects.toThrow(ForbiddenException);
  });

  it('perfil global segue gerindo (deletePoint)', async () => {
    const { service, prisma } = makeService();
    await service.deletePoint('dev-1', 'pt-1', makeUser(UserRole.ADMIN, 'x'));
    expect(prisma.devicePoint.delete).toHaveBeenCalledTimes(1);
  });
});
