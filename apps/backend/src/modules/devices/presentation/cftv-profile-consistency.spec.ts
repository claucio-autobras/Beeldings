/**
 * Testes de consistência entre GET /cftv/profiles e PATCH /:id (profileId).
 *
 * Dois casos críticos:
 *
 * 1. profileId='generic': GET /cftv/profiles lista 'generic' como opção, mas o
 *    PATCH anterior rejeitava com 400. A correcção trata 'generic' como null
 *    (reset para auto-detecção) — o dropdown da UI pode oferecer a opção sem
 *    causar erro.
 *
 * 2. profileOverrides com string OID: o payload real do backend envia
 *    Record<string,string> (métrica → OID string). O gateway normaliza antes
 *    de passar ao resolveProfile — testado em snmp-driver-normalize.spec.ts.
 *    Aqui verificamos que o backend armazena e devolve overrides como string.
 */

import { BadRequestException } from '@nestjs/common';
import { CftvController } from './cftv.controller.js';
import {
  CAMERA_OID_PROFILES,
  GENERIC_PROFILE,
} from '../../devices/application/camera-oid-profiles.js';
import { UserRole } from '../../auth/domain/interfaces/auth.interface.js';
import type { AuthenticatedUser } from '../../auth/domain/interfaces/auth.interface.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ADMIN_USER: AuthenticatedUser = {
  id: 'user-1',
  supabaseId: '',
  email: 'admin@test.com',
  name: 'Admin',
  role: UserRole.ADMIN,
  tenantId: 'tenant-1',
};

/** Câmera fake com config de perfil */
function fakeCameraWithConfig(configOverrides: Record<string, unknown> = {}) {
  return {
    id: 'cam-1',
    name: 'Cam',
    protocol: 'snmp',
    ip: '10.0.0.1',
    port: 161,
    status: 'offline',
    tenantId: 'tenant-1',
    siteId: null,
    gatewayId: 'gw-1',
    monitoredDeviceType: 'CAMERA',
    config: {
      snmpVersion: '2c',
      community: 'public',
      pollingIntervalMs: 30000,
      profileId: null,
      profileSource: 'generic',
      ...configOverrides,
    },
    points: [],
    site: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** Constrói CftvController com mocks mínimos para o fluxo de PATCH. */
function buildControllerForPatch(
  currentConfig: Record<string, unknown> = {},
  updatedConfig?: Record<string, unknown>,
) {
  const camera = fakeCameraWithConfig(currentConfig);
  const updatedCamera = fakeCameraWithConfig(updatedConfig ?? currentConfig);

  const prismaMock = {
    device: {
      // findCameraOrThrow → findFirst
      findFirst: jest.fn().mockResolvedValue(camera),
      // retorno pós-update
      findUniqueOrThrow: jest.fn().mockResolvedValue(updatedCamera),
      update: jest.fn().mockResolvedValue(updatedCamera),
    },
    // site.findFirst só chamado quando body.siteId presente — não usado aqui
    site: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };

  const configPublisher = { publishForDevice: jest.fn().mockResolvedValue(undefined) };
  const deviceStatus = {
    getStatus: jest.fn().mockReturnValue('offline'),
    resolveLastSeen: jest.fn().mockResolvedValue(null),
  };

  const controller = new CftvController(
    prismaMock as never,
    configPublisher as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    deviceStatus as never,
    {} as never,
    /* switchPortSync  */ {} as never,
    /* nvrTableSync    */ {} as never,
  );

  return { controller, prismaMock, configPublisher };
}

// ─── Testes ──────────────────────────────────────────────────────────────────

describe('GET /cftv/profiles + PATCH profileId — consistência', () => {
  describe('catálogo de perfis (GET /cftv/profiles)', () => {
    it('CAMERA_OID_PROFILES inclui o perfil generic', () => {
      const ids = CAMERA_OID_PROFILES.map((p) => p.id);
      expect(ids).toContain(GENERIC_PROFILE.id); // 'generic'
    });

    it('CAMERA_OID_PROFILES inclui os perfis de fabricante conhecidos', () => {
      const ids = CAMERA_OID_PROFILES.map((p) => p.id);
      expect(ids).toContain('hikvision');
      expect(ids).toContain('dahua');
      expect(ids).toContain('intelbras');
      expect(ids).toContain('axis');
    });
  });

  describe("PATCH com profileId='generic'", () => {
    it("aceita profileId='generic' sem lançar BadRequestException", async () => {
      const { controller, prismaMock } = buildControllerForPatch(
        {},
        { profileId: null, profileSource: 'generic' },
      );

      // Não deve lançar
      await expect(
        controller.updateCamera(ADMIN_USER, 'cam-1', { profileId: 'generic' }),
      ).resolves.not.toThrow();
    });

    it("trata profileId='generic' como reset para null (profileSource='generic')", async () => {
      const { controller, prismaMock } = buildControllerForPatch(
        { profileId: 'hikvision', profileSource: 'manual' },
        { profileId: null, profileSource: 'generic' },
      );

      await controller.updateCamera(ADMIN_USER, 'cam-1', { profileId: 'generic' });

      const updateCall = prismaMock.device.update.mock.calls[0][0] as {
        data: { config: Record<string, unknown> };
      };
      // profileId deve ser null (não 'generic') — volta para auto-detecção
      expect(updateCall.data.config).toMatchObject({
        profileId: null,
        profileSource: 'generic',
      });
    });

    it('null explícito também funciona como reset', async () => {
      const { controller, prismaMock } = buildControllerForPatch(
        { profileId: 'dahua', profileSource: 'manual' },
        { profileId: null, profileSource: 'generic' },
      );

      await controller.updateCamera(ADMIN_USER, 'cam-1', { profileId: null });

      const updateCall = prismaMock.device.update.mock.calls[0][0] as {
        data: { config: Record<string, unknown> };
      };
      expect(updateCall.data.config).toMatchObject({
        profileId: null,
        profileSource: 'generic',
      });
    });
  });

  describe('PATCH com profileId de fabricante (hikvision, dahua, etc.)', () => {
    it.each(['hikvision', 'dahua', 'intelbras', 'axis'])(
      "aceita profileId='%s' e guarda como manual",
      async (profileId) => {
        const { controller, prismaMock } = buildControllerForPatch(
          {},
          { profileId, profileSource: 'manual' },
        );

        await controller.updateCamera(ADMIN_USER, 'cam-1', { profileId });

        const updateCall = prismaMock.device.update.mock.calls[0][0] as {
          data: { config: Record<string, unknown> };
        };
        expect(updateCall.data.config).toMatchObject({
          profileId,
          profileSource: 'manual',
        });
      },
    );
  });

  describe('PATCH com profileId inválido', () => {
    it('rejeita profileId desconhecido com BadRequestException', async () => {
      const { controller } = buildControllerForPatch();

      await expect(
        controller.updateCamera(ADMIN_USER, 'cam-1', { profileId: 'samsung-inexistente' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('profileOverrides — contrato string (payload real do backend)', () => {
    it('aceita e persiste overrides como Record<string, string>', async () => {
      const overrides = { cpu: '1.3.6.1.4.1.39165.1.7.0', memory: '1.3.6.1.4.1.39165.1.11.0' };
      const { controller, prismaMock } = buildControllerForPatch(
        {},
        { profileOverrides: overrides },
      );

      await controller.updateCamera(ADMIN_USER, 'cam-1', { profileOverrides: overrides });

      const updateCall = prismaMock.device.update.mock.calls[0][0] as {
        data: { config: Record<string, unknown> };
      };
      expect(updateCall.data.config).toMatchObject({ profileOverrides: overrides });
    });

    it('null limpa os overrides existentes', async () => {
      const { controller, prismaMock } = buildControllerForPatch({
        profileOverrides: { cpu: '1.2.3.4' },
      });

      await controller.updateCamera(ADMIN_USER, 'cam-1', { profileOverrides: null });

      const updateCall = prismaMock.device.update.mock.calls[0][0] as {
        data: { config: Record<string, unknown> };
      };
      // null/undefined no config (chave removida) → sem profileOverrides
      expect(updateCall.data.config).not.toHaveProperty('profileOverrides');
    });
  });
});
