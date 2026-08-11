import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './guards/roles.guard.js';
import { resolveBodyTenantScope, resolveTenantScope } from './tenant-scope.util.js';
import { UserRole } from '../domain/interfaces/auth.interface.js';
import type { AuthenticatedUser } from '../domain/interfaces/auth.interface.js';
import { DashboardController } from '../../dashboard/dashboard.controller.js';
import { DevicesController } from '../../devices/presentation/devices.controller.js';
import { CftvController } from '../../devices/presentation/cftv.controller.js';
import { CommsHealthController } from '../../health/comms-health.controller.js';
import { KnowledgeController } from '../../knowledge/knowledge.controller.js';

/**
 * Varredura multi-tenant (achado F1/F8): garante que
 * 1) CLIENTE/VISUALIZADOR recebem 403 nos endpoints globais principais
 *    (via RolesGuard + @Roles refletidos direto das classes reais);
 * 2) o escopo de tenant NUNCA deixa um papel de cliente cair no escopo
 *    "todos os clientes" (nem via query, nem via tenantId nulo).
 */

function makeUser(role: UserRole, tenantId: string | null = 'tenant-a'): AuthenticatedUser {
  return { id: 'u1', email: 'u@x.com', role, tenantId } as unknown as AuthenticatedUser;
}

function makeContext(handler: (...args: never[]) => unknown, cls: object, user: AuthenticatedUser | null): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard nos endpoints globais principais', () => {
  const guard = new RolesGuard(new Reflector());

  const globalEndpoints: Array<[string, (...args: never[]) => unknown, object]> = [
    ['GET /dashboard/admin-stats', DashboardController.prototype.getAdminStats, DashboardController],
    ['GET /health/comms', CommsHealthController.prototype.getComms, CommsHealthController],
    ['GET /knowledge', KnowledgeController.prototype.list, KnowledgeController],
  ];

  it.each(globalEndpoints)('%s: CLIENTE recebe 403', (_name, handler, cls) => {
    const ctx = makeContext(handler, cls, makeUser(UserRole.CLIENTE));
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it.each(globalEndpoints)('%s: VISUALIZADOR recebe 403', (_name, handler, cls) => {
    const ctx = makeContext(handler, cls, makeUser(UserRole.VISUALIZADOR));
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it.each(globalEndpoints)('%s: ADMIN passa', (_name, handler, cls) => {
    const ctx = makeContext(handler, cls, makeUser(UserRole.ADMIN, null));
    expect(guard.canActivate(ctx)).toBe(true);
  });
});

describe('resolveTenantScope', () => {
  it('CLIENTE fica travado no próprio tenant mesmo pedindo outro na query', () => {
    expect(resolveTenantScope(makeUser(UserRole.CLIENTE, 'tenant-a'), 'tenant-b')).toBe('tenant-a');
    expect(resolveTenantScope(makeUser(UserRole.VISUALIZADOR, 'tenant-a'), 'tenant-b')).toBe('tenant-a');
  });

  it('CLIENTE sem tenant associado é NEGADO (nunca cai no escopo global)', () => {
    expect(() => resolveTenantScope(makeUser(UserRole.CLIENTE, null))).toThrow(ForbiddenException);
    expect(() => resolveTenantScope(makeUser(UserRole.VISUALIZADOR, null), 'tenant-b')).toThrow(ForbiddenException);
  });

  it('papéis globais podem ver todos ou filtrar pela query', () => {
    expect(resolveTenantScope(makeUser(UserRole.ADMIN, null))).toBeUndefined();
    expect(resolveTenantScope(makeUser(UserRole.CCO, null), 'tenant-b')).toBe('tenant-b');
    expect(resolveTenantScope(makeUser(UserRole.SUPERVISOR, null), '')).toBeUndefined();
  });
});

describe('resolveBodyTenantScope (cadastros/scans com tenantId no body)', () => {
  it('CLIENTE não pode operar em tenant de terceiro passado no body', () => {
    expect(resolveBodyTenantScope(makeUser(UserRole.CLIENTE, 'tenant-a'), 'tenant-b')).toBe('tenant-a');
  });

  it('CLIENTE sem tenant é negado mesmo com tenantId no body', () => {
    expect(() => resolveBodyTenantScope(makeUser(UserRole.CLIENTE, null), 'tenant-b')).toThrow(ForbiddenException);
  });

  it('papel global usa o tenant do body', () => {
    expect(resolveBodyTenantScope(makeUser(UserRole.ADMIN, null), 'tenant-b')).toBe('tenant-b');
  });
});

describe('GET /dashboard/overview não vaza escopo global para papel de cliente', () => {
  it('CLIENTE sem tenant recebe 403 (nunca cai no agregado global)', async () => {
    // resolveTenantScope nega antes de qualquer consulta — prisma não é tocado.
    const controller = new DashboardController(null as never, null as never, null as never);
    await expect(controller.getOverview(makeUser(UserRole.CLIENTE, null))).rejects.toThrow(ForbiddenException);
  });

  it('VISUALIZADOR sem tenant recebe 403 mesmo pedindo tenantId na query', async () => {
    const controller = new DashboardController(null as never, null as never, null as never);
    await expect(
      controller.getOverview(makeUser(UserRole.VISUALIZADOR, null), '24h', 'tenant-b'),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('Descoberta BACnet não aceita tenant/gateway de terceiro', () => {
  // Gateway de OUTRO tenant: findFirst({id, tenantId}) não encontra → 403.
  const fakePrisma = { gateway: { findFirst: async () => null } };
  const nil = null as never;
  const controller = new DevicesController(
    nil, nil, nil, nil, nil,
    fakePrisma as never,
    nil, nil, nil, nil, nil, nil, nil,
  );

  it('CLIENTE não dispara scan em tenant de terceiro (tenant do body ignorado → 403)', async () => {
    await expect(
      controller.scanBacnet(makeUser(UserRole.CLIENTE, 'tenant-a'), {
        tenantId: 'tenant-b',
        gatewayId: 'gw-1',
      } as never),
    ).rejects.toThrow(ForbiddenException);
  });

  it('discovery com gateway que não pertence ao tenant é negado', async () => {
    await expect(
      controller.discoverBacnet(makeUser(UserRole.ADMIN, null), {
        tenantId: 'tenant-b',
        gatewayId: 'gw-de-outro-tenant',
        ip: '10.0.0.5',
        port: 47808,
      } as never),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('Sync BACnet não permite mutar dispositivo de outro tenant', () => {
  const nil = null as never;
  const device = { id: 'dev-1', tenantId: 'tenant-b' };
  const fakePrisma = { device: { findUnique: async () => device } };
  const controller = new DevicesController(
    nil, nil, nil, nil, nil,
    fakePrisma as never,
    nil, nil, nil, nil, nil, nil, nil,
  );
  const cliente = makeUser(UserRole.CLIENTE, 'tenant-a');

  it('sync incremental em device de terceiro é negado', async () => {
    await expect(
      controller.syncBacnetPoints(cliente, 'dev-1', { newPoints: [] }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('sync/replace em device de terceiro é negado', async () => {
    await expect(
      controller.replaceBacnetPoints(cliente, 'dev-1', { points: [] }),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('CFTV: comandos/scans não aceitam gateway de terceiro', () => {
  // Gateway de OUTRO tenant: findFirst({id, tenantId}) não encontra → 403.
  const fakePrisma = { gateway: { findFirst: async () => null } };
  const nil = null as never;
  const controller = new CftvController(
    fakePrisma as never,
    nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil,
  );
  const cliente = makeUser(UserRole.CLIENTE, 'tenant-a');
  const body = { tenantId: 'tenant-a', gatewayId: 'gw-de-outro-tenant' };

  it('test-snmp com gateway de terceiro é negado', async () => {
    await expect(
      controller.testSnmp(cliente, { ...body, ip: '10.0.0.5' } as never),
    ).rejects.toThrow(ForbiddenException);
  });

  it('scan SNMP com gateway de terceiro é negado', async () => {
    await expect(
      controller.scan(cliente, { ...body, ipStart: '10.0.0.1', ipEnd: '10.0.0.9' } as never),
    ).rejects.toThrow(ForbiddenException);
  });

  it('scan ONVIF com gateway de terceiro é negado', async () => {
    await expect(
      controller.scanOnvif(cliente, body as never),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe('CFTV Switches: gateway de terceiro é rejeitado em create e update', () => {
  // gateway.findFirst retorna null → assertGatewayInTenant lança ForbiddenException.
  const fakeSwitchInTenantA = {
    id: 'sw-1',
    tenantId: 'tenant-a',
    monitoredDeviceType: 'SWITCH',
    config: {},
  };
  const fakePrisma = {
    device: { findFirst: async () => fakeSwitchInTenantA },
    gateway: { findFirst: async () => null },
  };
  const nil = null as never;
  const controller = new CftvController(
    fakePrisma as never,
    nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil,
  );
  // ADMIN global: passa assertCanEdit; também testa caminho de papel não-cliente.
  const admin = makeUser(UserRole.ADMIN, null);
  const crossTenantGwId = 'gw-de-outro-tenant';

  it('createSwitch com gateway de outro tenant é negado', async () => {
    await expect(
      controller.createSwitch(admin, {
        name: 'Switch Teste',
        ip: '192.168.1.1',
        gatewayId: crossTenantGwId,
        tenantId: 'tenant-a',
        snmpVersion: '2c',
        community: 'public',
      } as never),
    ).rejects.toThrow(ForbiddenException);
  });

  it('updateSwitch com gatewayId de outro tenant é negado', async () => {
    await expect(
      controller.updateSwitch(admin, 'sw-1', {
        gatewayId: crossTenantGwId,
      } as never),
    ).rejects.toThrow(ForbiddenException);
  });
});
