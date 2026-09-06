import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { BadRequestException, ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { of, lastValueFrom } from 'rxjs';

import { DevicesController } from './devices.controller.js';
import { RolesGuard } from '../../auth/presentation/guards/roles.guard.js';
import { ROLES_KEY } from '../../auth/presentation/decorators/roles.decorator.js';
import { UserRole, type AuthenticatedUser } from '../../auth/domain/interfaces/auth.interface.js';
import { AuditInterceptor } from '../../audit/audit.interceptor.js';

/**
 * Autorização dos comandos de escrita (BACnet, MQTT, Modbus):
 * - CLIENTE tem permissão nos três endpoints (junto de ADMIN/CCO/SUPERVISOR);
 * - VISUALIZADOR continua bloqueado pelo RolesGuard;
 * - CLIENTE só comanda dispositivos do próprio tenant;
 * - a trilha de auditoria grava FAILURE quando o write responde success:false.
 */

const WRITE_HANDLERS = ['writeBacnet', 'writeMqtt', 'writeModbus'] as const;

function rolesOf(handler: (typeof WRITE_HANDLERS)[number]): UserRole[] {
  return Reflect.getMetadata(ROLES_KEY, DevicesController.prototype[handler]) as UserRole[];
}

function makeUser(role: UserRole, tenantId = 'tenant-a'): AuthenticatedUser {
  return { id: 'u1', email: 'u@x.com', name: 'User', role, tenantId } as AuthenticatedUser;
}

function guardContext(roles: UserRole[], user: AuthenticatedUser | undefined): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('Comandos de escrita — papéis permitidos (@Roles)', () => {
  it.each(WRITE_HANDLERS)('%s permite CLIENTE e não permite VISUALIZADOR', (handler) => {
    const roles = rolesOf(handler);
    expect(roles).toEqual(
      expect.arrayContaining([UserRole.ADMIN, UserRole.CCO, UserRole.SUPERVISOR, UserRole.CLIENTE]),
    );
    expect(roles).not.toContain(UserRole.VISUALIZADOR);
  });
});

describe('RolesGuard nos writes', () => {
  const commandRoles = [UserRole.ADMIN, UserRole.CCO, UserRole.SUPERVISOR, UserRole.CLIENTE];

  function runGuard(user: AuthenticatedUser): boolean {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(commandRoles),
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    return guard.canActivate(guardContext(commandRoles, user));
  }

  it('permite CLIENTE', () => {
    expect(runGuard(makeUser(UserRole.CLIENTE))).toBe(true);
  });

  it('bloqueia VISUALIZADOR com "Acesso negado"', () => {
    expect(() => runGuard(makeUser(UserRole.VISUALIZADOR))).toThrow(ForbiddenException);
    expect(() => runGuard(makeUser(UserRole.VISUALIZADOR))).toThrow(/Acesso negado/);
  });
});

describe('Escopo de tenant para CLIENTE', () => {
  const bacnetWrite = { writeBacnet: jest.fn().mockResolvedValue({ success: true, command_id: 'c1' }) };
  const mqttWrite = { writeMqtt: jest.fn().mockResolvedValue({ success: true, command_id: 'c2' }) };
  const modbusWrite = { writeModbus: jest.fn().mockResolvedValue({ success: true, command_id: 'c3' }) };

  function makeController(device: Record<string, unknown> | null) {
    const prisma = { device: { findUnique: jest.fn().mockResolvedValue(device) } };
    return new DevicesController(
      {} as never, // bacnetDiscovery
      {} as never, // bacnetNetworkDiscovery
      bacnetWrite as never,
      mqttWrite as never,
      modbusWrite as never,
      prisma as never,
      {} as never, // configPublisher
      {} as never, // modbusConnection
      {} as never, // mqttSample
      {} as never, // emqxProvisioning
      {} as never, // deviceStatus
      {} as never, // deviceHeartbeat
      {} as never, // defaultTrends
    );
  }

  const cliente = makeUser(UserRole.CLIENTE, 'tenant-a');

  const bacnetBody = {
    tenantId: 'tenant-a',
    gatewayId: 'gw-1',
    ip: '10.0.0.5',
    port: 47808,
    objectType: 4,
    objectInstance: 1,
    value: 1,
  };

  const mqttPoint = {
    id: 'p1',
    tag: 'relay',
    unit: null,
    binding: {
      valueType: 'boolean',
      write: { commandTopic: 'cmd/t', payloadTemplate: '{"on":{{value}}}' },
    },
  };

  const mqttDevice = (tenantId: string) => ({
    id: 'dev-1',
    tenantId,
    gatewayId: 'gw-1',
    protocol: 'mqtt',
    config: {},
    points: [mqttPoint],
  });

  const modbusDevice = (tenantId: string) => ({
    id: 'dev-2',
    tenantId,
    gatewayId: 'gw-1',
    protocol: 'modbus',
    config: { host: '10.0.0.9', port: 502, unitId: 1 },
    points: [
      {
        id: 'p2',
        tag: 'coil1',
        config: { register: 10, registerType: 'coil' },
      },
    ],
  });

  beforeEach(() => {
    bacnetWrite.writeBacnet.mockClear();
    mqttWrite.writeMqtt.mockClear();
    modbusWrite.writeModbus.mockClear();
  });

  it('BACnet: CLIENTE comanda o próprio tenant', async () => {
    const controller = makeController(null);
    const res = await controller.writeBacnet(cliente, bacnetBody as never);
    expect(res).toEqual({ success: true, command_id: 'c1' });
    expect(bacnetWrite.writeBacnet).toHaveBeenCalledTimes(1);
  });

  it('BACnet: CLIENTE bloqueado em tenant alheio (inclusive relinquish value:null)', async () => {
    const controller = makeController(null);
    await expect(
      controller.writeBacnet(cliente, { ...bacnetBody, tenantId: 'tenant-b', value: null } as never),
    ).rejects.toThrow(BadRequestException);
    expect(bacnetWrite.writeBacnet).not.toHaveBeenCalled();
  });

  it('BACnet: relinquish (value:null) do próprio tenant funciona para CLIENTE', async () => {
    const controller = makeController(null);
    const res = await controller.writeBacnet(cliente, { ...bacnetBody, value: null, priority: 8 } as never);
    expect(res.success).toBe(true);
    expect(bacnetWrite.writeBacnet).toHaveBeenCalledWith(
      expect.objectContaining({ value: null, priority: 8 }),
    );
  });

  it('MQTT: CLIENTE comanda o próprio tenant', async () => {
    const controller = makeController(mqttDevice('tenant-a'));
    const res = await controller.writeMqtt(cliente, { deviceId: 'dev-1', pointId: 'p1', value: true } as never);
    expect(res).toEqual({ success: true, command_id: 'c2' });
  });

  it('MQTT: CLIENTE bloqueado em tenant alheio', async () => {
    const controller = makeController(mqttDevice('tenant-b'));
    await expect(
      controller.writeMqtt(cliente, { deviceId: 'dev-1', pointId: 'p1', value: true } as never),
    ).rejects.toThrow('Sem permissão para comandar este dispositivo');
    expect(mqttWrite.writeMqtt).not.toHaveBeenCalled();
  });

  it('Modbus: CLIENTE comanda o próprio tenant', async () => {
    const controller = makeController(modbusDevice('tenant-a'));
    const res = await controller.writeModbus(cliente, { deviceId: 'dev-2', pointId: 'p2', value: 1 } as never);
    expect(res).toEqual({ success: true, command_id: 'c3' });
  });

  it('Modbus: CLIENTE bloqueado em tenant alheio', async () => {
    const controller = makeController(modbusDevice('tenant-b'));
    await expect(
      controller.writeModbus(cliente, { deviceId: 'dev-2', pointId: 'p2', value: 1 } as never),
    ).rejects.toThrow('Sem permissão para comandar este dispositivo');
    expect(modbusWrite.writeModbus).not.toHaveBeenCalled();
  });
});

describe('Auditoria de comandos de CLIENTE', () => {
  function runIntercept(response: Record<string, unknown>) {
    const record = jest.fn().mockResolvedValue(undefined);
    const interceptor = new AuditInterceptor(
      { record } as never,
      {} as never,
    );
    const req = {
      method: 'POST',
      route: { path: '/devices/bacnet/write' },
      params: {},
      body: { tenantId: 'tenant-a', pointLabel: 'Bomba 1', value: 1 },
      headers: {},
      user: makeUser(UserRole.CLIENTE),
      ip: '127.0.0.1',
    };
    const context = {
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => req }),
    } as unknown as ExecutionContext;
    return lastValueFrom(
      interceptor.intercept(context, { handle: () => of(response) }),
    ).then(async () => {
      // write() é fire-and-forget — dá um tick p/ o record ser chamado.
      await new Promise((r) => setImmediate(r));
      return record;
    });
  }

  it('grava SUCCESS para comando bem-sucedido de CLIENTE', async () => {
    const record = await runIntercept({ success: true, command_id: 'c1' });
    expect(record).toHaveBeenCalledTimes(1);
    const entry = record.mock.calls[0][0];
    expect(entry.action).toBe('COMMAND');
    expect(entry.result).toBe('SUCCESS');
    expect(entry.actor.role).toBe(UserRole.CLIENTE);
  });

  it('grava FAILURE quando o write responde 200 com success:false', async () => {
    const record = await runIntercept({ success: false, error: 'timeout' });
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0].result).toBe('FAILURE');
  });
});
