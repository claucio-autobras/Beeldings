/**
 * Comando de escrita para um ponto Modbus (holding register ou coil).
 * O frontend NÃO envia endereço/tipo — o backend resolve o binding do ponto e
 * a config de conexão do device no banco (fonte de verdade), evitando escrita
 * arbitrária em registradores fora do cadastro.
 */
export class WriteModbusDto {
  /** Device Modbus comandado (valida tenant + gateway). */
  deviceId!: string;
  /** Ponto comandado — precisa ser registerType holding ou coil. */
  pointId!: string;
  /** Valor em unidade de engenharia (o gateway reverte scale/offset). */
  value!: number | boolean;
  /**
   * Opcional — rótulo legível do ponto comandado. Usado só pela trilha de
   * auditoria/dashboard; não é enviado ao gateway.
   */
  pointLabel?: string;
}

export interface ModbusWriteSuccess {
  success: true;
  command_id: string;
}

export interface ModbusWriteError {
  success: false;
  error: string;
}

export type ModbusWriteResult = ModbusWriteSuccess | ModbusWriteError;
