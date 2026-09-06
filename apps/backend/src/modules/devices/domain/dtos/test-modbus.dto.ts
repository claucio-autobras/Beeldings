/** Modo de conexão Modbus: TCP (rede) ou RTU (serial RS485). */
export type ModbusConnectionType = 'tcp' | 'rtu';

/** Parâmetros da porta serial RS485 (modo RTU). */
export interface ModbusSerialConfig {
  /** Caminho da porta: COM3 (Windows) ou /dev/ttyUSB0 (Linux). */
  path: string;
  baudRate: number;
  parity: 'none' | 'even' | 'odd';
  dataBits: 7 | 8;
  stopBits: 1 | 2;
}

export class TestModbusConnectionDto {
  tenantId!: string;
  gatewayId!: string;
  /** Ausente = 'tcp' (retrocompatibilidade). */
  connectionType?: ModbusConnectionType;
  ip?: string;
  port?: number;
  unitId!: number;
  /** Obrigatório no modo 'rtu'. */
  serial?: ModbusSerialConfig;
}

export interface ModbusConnectionSuccess {
  success: true;
  command_id: string;
}

export interface ModbusConnectionError {
  success: false;
  error: string;
}

export type ModbusConnectionResult = ModbusConnectionSuccess | ModbusConnectionError;

/** Baud rates aceitos no cadastro RTU. */
export const MODBUS_BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200] as const;

/**
 * Valida e normaliza os parâmetros seriais de um cadastro/teste RTU.
 * Lança Error com mensagem amigável quando inválido.
 */
export function normalizeModbusSerial(raw: unknown): ModbusSerialConfig {
  const s = (raw ?? {}) as Partial<Record<keyof ModbusSerialConfig, unknown>>;
  const path = String(s.path ?? '').trim();
  if (!path) {
    throw new Error('Informe a porta serial (ex.: COM3 ou /dev/ttyUSB0)');
  }
  if (!/^(COM\d+|\/dev\/[\w.\-/]+)$/i.test(path)) {
    throw new Error(`Porta serial inválida: "${path}" — use o formato COM3 (Windows) ou /dev/ttyUSB0 (Linux)`);
  }
  const baudRate = Number(s.baudRate ?? 9600);
  if (!MODBUS_BAUD_RATES.includes(baudRate as (typeof MODBUS_BAUD_RATES)[number])) {
    throw new Error(`Baud rate inválido: ${s.baudRate} — use um de ${MODBUS_BAUD_RATES.join(', ')}`);
  }
  const parity = String(s.parity ?? 'none');
  if (!['none', 'even', 'odd'].includes(parity)) {
    throw new Error(`Paridade inválida: ${s.parity} — use none, even ou odd`);
  }
  const dataBits = Number(s.dataBits ?? 8);
  if (dataBits !== 8 && dataBits !== 7) {
    throw new Error(`Data bits inválido: ${s.dataBits} — use 8 ou 7`);
  }
  const stopBits = Number(s.stopBits ?? 1);
  if (stopBits !== 1 && stopBits !== 2) {
    throw new Error(`Stop bits inválido: ${s.stopBits} — use 1 ou 2`);
  }
  return {
    path,
    baudRate,
    parity: parity as ModbusSerialConfig['parity'],
    dataBits: dataBits as 7 | 8,
    stopBits: stopBits as 1 | 2,
  };
}
