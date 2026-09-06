import type { Device, DevicePoint } from '@prisma/client';
import type { ModbusWriteRequest } from './modbus-write.service.js';

/**
 * Resolução compartilhada de escrita Modbus (controller manual E runner de
 * automações): valida o binding do registrador (só holding/coil aceitam
 * escrita) e a config de conexão (TCP/RTU + serial), lendo tudo do banco —
 * nunca do chamador. Lança `Error` com mensagem legível quando o cadastro
 * está incompleto ou o registrador é somente-leitura.
 *
 * Retorna o request pronto para o `ModbusWriteService`, faltando só o `value`
 * (unidade de engenharia), que o chamador define.
 */
export interface ResolvedModbusWriteTarget extends Omit<ModbusWriteRequest, 'value'> {
  /** true quando o registrador é coil (digital) — usado no reverse de automações. */
  isDigital: boolean;
}

export function resolveModbusWriteTarget(
  device: Device,
  point: DevicePoint,
): ResolvedModbusWriteTarget {
  if (device.protocol !== 'modbus') {
    throw new Error(`Dispositivo "${device.name}" não é Modbus`);
  }
  if (!device.gatewayId) {
    throw new Error(`Dispositivo "${device.name}" não tem gateway associado`);
  }

  const binding = (point.binding ?? {}) as {
    register?: number;
    registerType?: 'holding' | 'input' | 'coil' | 'discrete';
    dataType?: 'int16' | 'uint16' | 'int32' | 'uint32' | 'float32';
    endianness?: 'big' | 'little';
    scale?: number;
    offset?: number;
  };
  const registerType = binding.registerType ?? 'holding';
  if (registerType !== 'holding' && registerType !== 'coil') {
    throw new Error(
      `Registrador ${registerType} é somente leitura (apenas holding e coil aceitam escrita)`,
    );
  }

  const config = (device.config ?? {}) as {
    connectionType?: 'tcp' | 'rtu';
    unitId?: number;
    serial?: {
      path: string;
      baudRate: number;
      parity: 'none' | 'even' | 'odd';
      dataBits: 7 | 8;
      stopBits: 1 | 2;
    };
  };
  const connectionType = config.connectionType === 'rtu' ? 'rtu' : 'tcp';
  if (connectionType === 'rtu' && !config.serial?.path) {
    throw new Error('Dispositivo RTU sem parâmetros de porta serial cadastrados');
  }

  return {
    tenantId: device.tenantId,
    gatewayId: device.gatewayId,
    deviceId: device.id,
    connectionType,
    ip: device.ip ?? '',
    port: device.port ?? 502,
    unitId: config.unitId ?? 1,
    ...(connectionType === 'rtu' && config.serial ? { serial: config.serial } : {}),
    register: binding.register ?? point.instance,
    registerType,
    dataType: binding.dataType ?? 'float32',
    endianness: binding.endianness ?? 'big',
    scale: binding.scale ?? 1,
    offset: binding.offset ?? 0,
    pointTag: point.tag,
    pointUnit: point.unit ?? null,
    isDigital: registerType === 'coil',
  };
}
