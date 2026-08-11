/**
 * Teste de regressão: câmeras criadas via createCamera (SNMP) devem ter
 * monitoredDeviceType='CAMERA' para serem retornadas por queries com
 * ONLY_CFTV_DEVICES.
 *
 * Contexto: a migração 20260805145540 adiciona a coluna monitored_device_type e
 * o filtro ONLY_CFTV_DEVICES passa a usar { monitoredDeviceType: 'CAMERA' } como
 * critério canônico. Câmeras criadas sem esse campo desaparecem da listagem após
 * o create.
 */

import { BadRequestException } from '@nestjs/common';
import { CftvController } from './cftv.controller.js';
import { ONLY_CFTV_DEVICES } from '../../prisma/device-filters.js';
import { UserRole } from '../../auth/domain/interfaces/auth.interface.js';
import type { AuthenticatedUser } from '../../auth/domain/interfaces/auth.interface.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Gera um device fake com os campos mínimos para simular o retorno do Prisma. */
function fakeCamera(overrides: Record<string, unknown> = {}) {
  return {
    id: 'cam-1',
    name: 'Câmera Teste',
    protocol: 'snmp',
    ip: '192.168.1.10',
    port: 161,
    status: 'offline',
    tenantId: 'tenant-1',
    siteId: null,
    gatewayId: 'gw-1',
    monitoredDeviceType: null,
    config: {},
    points: [],
    site: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Simula um PrismaService mínimo que captura o argumento de device.create. */
function buildPrismaMock() {
  const calls: unknown[] = [];
  const mock = {
    device: {
      create: jest.fn(async (args: unknown) => {
        calls.push(args);
        const data = (args as { data: Record<string, unknown> }).data;
        return fakeCamera({
          ...data,
          points: ((data.points as { create?: unknown[] })?.create ?? []).map(
            (p, i) => ({ ...(p as object), id: `pt-${i}` }),
          ),
        });
      }),
      findUnique: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({}),
    },
    _calls: calls,
  };
  return mock;
}

/** Usuário admin mínimo compatível com AuthenticatedUser. */
const ADMIN_USER: AuthenticatedUser = {
  id: 'user-1',
  supabaseId: '',
  email: 'admin@test.com',
  name: 'Admin',
  role: UserRole.ADMIN,
  tenantId: 'tenant-1',
};

// ─── Testes ──────────────────────────────────────────────────────────────────

describe('CftvController — monitoredDeviceType em criação de câmera', () => {
  /** Instancia o controller com stubs mínimos para os caminhos de create. */
  function buildController(prismaMock: ReturnType<typeof buildPrismaMock>) {
    const configPublisher = { publishForDevice: jest.fn().mockResolvedValue(undefined) };
    const deviceStatus = {
      getStatus: jest.fn().mockReturnValue('offline'),
      resolveLastSeenMany: jest.fn().mockResolvedValue(new Map()),
    };

    return new CftvController(
      prismaMock as never,
      configPublisher as never,
      /* snmpScan        */ {} as never,
      /* onvifProbe      */ {} as never,
      /* onvifScan       */ {} as never,
      /* snmpHealthTest  */ {} as never,
      /* snmpDiagnose    */ {} as never,
      /* capabilityProbe */ {} as never,
      deviceStatus as never,
      /* liveView        */ {} as never,
      /* switchPortSync  */ {} as never,
      /* nvrTableSync    */ {} as never,
    );
  }

  describe('createCamera (SNMP)', () => {
    it('passa monitoredDeviceType="CAMERA" para prisma.device.create', async () => {
      const prismaMock = buildPrismaMock();
      const controller = buildController(prismaMock);

      await controller.createCamera(ADMIN_USER, {
        name: 'Cam SNMP',
        ip: '10.0.0.1',
        port: 161,
        gatewayId: 'gw-1',
        tenantId: 'tenant-1',
        monitoringProtocol: 'snmp',
        snmpVersion: '2c',
        community: 'public',
      });

      expect(prismaMock.device.create).toHaveBeenCalledTimes(1);
      const createArg = prismaMock.device.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      expect(createArg.data.monitoredDeviceType).toBe('CAMERA');
    });

    it('câmera criada satisfaz o filtro ONLY_CFTV_DEVICES', async () => {
      const prismaMock = buildPrismaMock();
      const controller = buildController(prismaMock);

      await controller.createCamera(ADMIN_USER, {
        name: 'Cam SNMP',
        ip: '10.0.0.1',
        port: 161,
        gatewayId: 'gw-1',
        tenantId: 'tenant-1',
        monitoringProtocol: 'snmp',
      });

      const createArg = prismaMock.device.create.mock.calls[0][0] as {
        data: Record<string, unknown>;
      };
      // O objeto criado deve satisfazer ONLY_CFTV_DEVICES
      // { monitoredDeviceType: 'CAMERA' }
      const filter = ONLY_CFTV_DEVICES as { monitoredDeviceType: string };
      expect(createArg.data.monitoredDeviceType).toBe(filter.monitoredDeviceType);
    });

    it('rejeita se nome estiver ausente', async () => {
      const prismaMock = buildPrismaMock();
      const controller = buildController(prismaMock);

      await expect(
        controller.createCamera(ADMIN_USER, {
          ip: '10.0.0.1',
          gatewayId: 'gw-1',
          tenantId: 'tenant-1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejeita se ip estiver ausente', async () => {
      const prismaMock = buildPrismaMock();
      const controller = buildController(prismaMock);

      await expect(
        controller.createCamera(ADMIN_USER, {
          name: 'Cam',
          gatewayId: 'gw-1',
          tenantId: 'tenant-1',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
