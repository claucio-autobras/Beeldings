import 'reflect-metadata';
import { BadRequestException, ConflictException } from '@nestjs/common';

import { DevicesController } from './devices.controller.js';
import { UserRole, type AuthenticatedUser } from '../../auth/domain/interfaces/auth.interface.js';

/**
 * Edição técnica de pontos Modbus (PATCH /devices/:id/points/:pointId):
 * - registrador/tipo/dado/escala/offset/limites são persistidos no binding do
 *   MESMO registro (id preservado — trends/alarmes/favoritos continuam válidos);
 * - qualquer mudança técnica republica a config retida ao gateway;
 * - rename puro (objectName) NÃO republica;
 * - validações equivalentes às do cadastro (registrador inteiro e único,
 *   escala não nula, tipos válidos);
 * - edição técnica Modbus é rejeitada em devices de outros protocolos.
 */

function makeUser(role: UserRole = UserRole.ADMIN, tenantId = 'tenant-a'): AuthenticatedUser {
  return { id: 'u1', email: 'u@x.com', name: 'User', role, tenantId } as AuthenticatedUser;
}

const modbusDevice = {
  id: 'dev-1',
  tenantId: 'tenant-a',
  gatewayId: 'gw-1',
  protocol: 'modbus',
  config: { unitId: 1 },
};

const basePoint = {
  id: 'point-1',
  deviceId: 'dev-1',
  tag: 'temp_saida',
  objectName: 'Temperatura de Saída',
  objectType: 'modbus',
  instance: 40001,
  unit: '°C',
  binding: {
    register: 40001,
    registerType: 'holding',
    dataType: 'float32',
    endianness: 'big',
    scale: 1,
    offset: 0,
  },
};

interface Mocks {
  update: jest.Mock;
  findFirst: jest.Mock;
  publishForDevice: jest.Mock;
}

function makeController(
  device: Record<string, unknown> | null = modbusDevice,
  point: Record<string, unknown> | null = basePoint,
): { controller: DevicesController; mocks: Mocks } {
  const update = jest.fn().mockImplementation(({ data }) => ({ ...point, ...data }));
  const findFirst = jest.fn().mockResolvedValue(null);
  const prisma = {
    device: { findUnique: jest.fn().mockResolvedValue(device) },
    devicePoint: {
      findUnique: jest.fn().mockResolvedValue(point),
      findFirst,
      update,
    },
  };
  const publishForDevice = jest.fn().mockResolvedValue(undefined);
  const controller = new DevicesController(
    {} as never, // bacnetDiscovery
    {} as never, // bacnetNetworkDiscovery
    {} as never, // bacnetWrite
    {} as never, // mqttWrite
    {} as never, // modbusWrite
    prisma as never,
    { publishForDevice } as never, // configPublisher
    {} as never, // modbusConnection
    {} as never, // mqttSample
    {} as never, // emqxProvisioning
    {} as never, // deviceStatus
    {} as never, // deviceHeartbeat
    {} as never, // defaultTrends
  );
  return { controller, mocks: { update, findFirst, publishForDevice } };
}

const admin = makeUser();

describe('Edição técnica de ponto Modbus', () => {
  it('edita registrador/tipo/escala no MESMO registro e republica a config', async () => {
    const { controller, mocks } = makeController();

    const updated = await controller.updatePoint(admin, 'dev-1', 'point-1', {
      tag: 'temp_saida',
      objectName: 'Temperatura de Saída',
      register: 40010,
      registerType: 'input',
      dataType: 'int16',
      scale: 0.1,
      offset: -5,
      unit: '°C',
      minExpected: 0,
      maxExpected: 120,
    });

    // Mesmo registro: update no id original (nunca delete+create).
    expect(mocks.update).toHaveBeenCalledTimes(1);
    const call = mocks.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'point-1' });
    expect(updated.id).toBe('point-1');

    // Campos técnicos persistidos no binding, preservando o que não foi editado.
    expect(call.data.binding).toEqual({
      register: 40010,
      registerType: 'input',
      dataType: 'int16',
      endianness: 'big',
      scale: 0.1,
      offset: -5,
      minExpected: 0,
      maxExpected: 120,
    });
    // instance acompanha o registrador (índice único [deviceId, objectType, instance]).
    expect(call.data.instance).toBe(40010);

    // Config retida republicada para o gateway ler o novo registrador.
    expect(mocks.publishForDevice).toHaveBeenCalledWith('dev-1');
  });

  it('rename puro (objectName) não republica a config', async () => {
    const { controller, mocks } = makeController();
    await controller.updatePoint(admin, 'dev-1', 'point-1', { objectName: 'Novo Nome' });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.publishForDevice).not.toHaveBeenCalled();
  });

  it('salvar sem mudança técnica efetiva não republica a config', async () => {
    const { controller, mocks } = makeController();
    // Mesmo payload completo do modal, com os valores atuais do ponto.
    await controller.updatePoint(admin, 'dev-1', 'point-1', {
      objectName: 'Nome novo',
      register: 40001,
      registerType: 'holding',
      dataType: 'float32',
      scale: 1,
      offset: 0,
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(mocks.publishForDevice).not.toHaveBeenCalled();
  });

  it('minExpected/maxExpected null limpam os limites do binding', async () => {
    const point = {
      ...basePoint,
      binding: { ...basePoint.binding, minExpected: 0, maxExpected: 100 },
    };
    const { controller, mocks } = makeController(modbusDevice, point);
    await controller.updatePoint(admin, 'dev-1', 'point-1', {
      minExpected: null,
      maxExpected: null,
    });
    const binding = mocks.update.mock.calls[0][0].data.binding as Record<string, unknown>;
    expect(binding.minExpected).toBeUndefined();
    expect(binding.maxExpected).toBeUndefined();
    expect(mocks.publishForDevice).toHaveBeenCalledWith('dev-1');
  });

  it('rejeita registrador duplicado no mesmo dispositivo (409)', async () => {
    const { controller, mocks } = makeController();
    mocks.findFirst.mockResolvedValueOnce({ id: 'point-2' });
    await expect(
      controller.updatePoint(admin, 'dev-1', 'point-1', { register: 40002 }),
    ).rejects.toThrow(ConflictException);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.publishForDevice).not.toHaveBeenCalled();
  });

  it.each([
    [{ register: 40001.5 }, /inteiro/],
    [{ register: -1 }, /inteiro/],
    [{ scale: 0 }, /escala/i],
    [{ scale: Number.NaN }, /escala/i],
    [{ offset: Number.NaN }, /offset/i],
    [{ registerType: 'banana' }, /registerType/],
    [{ dataType: 'float64' }, /dado/i],
    [{ minExpected: 50, maxExpected: 10 }, /mínimo/],
  ] as Array<[Record<string, unknown>, RegExp]>)(
    'rejeita valores inválidos %j',
    async (body, message) => {
      const { controller, mocks } = makeController();
      await expect(
        controller.updatePoint(admin, 'dev-1', 'point-1', body as never),
      ).rejects.toThrow(BadRequestException);
      await expect(
        controller.updatePoint(admin, 'dev-1', 'point-1', body as never),
      ).rejects.toThrow(message);
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.publishForDevice).not.toHaveBeenCalled();
    },
  );

  it('edição de tag Modbus é aceita e republica a config (polling casa por tag)', async () => {
    const { controller, mocks } = makeController();
    await controller.updatePoint(admin, 'dev-1', 'point-1', { tag: 'temp_entrada' });
    expect(mocks.update.mock.calls[0][0].data.tag).toBe('temp_entrada');
    expect(mocks.publishForDevice).toHaveBeenCalledWith('dev-1');
  });

  it('mudança de unidade republica (a unidade viaja na config de registradores)', async () => {
    const { controller, mocks } = makeController();
    await controller.updatePoint(admin, 'dev-1', 'point-1', { unit: 'bar' });
    expect(mocks.update.mock.calls[0][0].data.unit).toBe('bar');
    expect(mocks.publishForDevice).toHaveBeenCalledWith('dev-1');
  });

  it('rejeita edição técnica Modbus em device de outro protocolo (BACnet)', async () => {
    const bacnetDevice = { ...modbusDevice, protocol: 'bacnet' };
    const { controller, mocks } = makeController(bacnetDevice);
    await expect(
      controller.updatePoint(admin, 'dev-1', 'point-1', { register: 40010 }),
    ).rejects.toThrow(/só se aplica a pontos Modbus/);
    // Tag também continua imutável fora de MQTT/Modbus.
    await expect(
      controller.updatePoint(admin, 'dev-1', 'point-1', { tag: 'nova_tag' }),
    ).rejects.toThrow(BadRequestException);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('CLIENTE de outro tenant não edita o ponto', async () => {
    const { controller, mocks } = makeController();
    await expect(
      controller.updatePoint(makeUser(UserRole.CLIENTE, 'tenant-b'), 'dev-1', 'point-1', {
        register: 40010,
      }),
    ).rejects.toThrow(/Sem permissão/);
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
