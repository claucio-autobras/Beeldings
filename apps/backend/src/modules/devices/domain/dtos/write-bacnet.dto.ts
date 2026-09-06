export class WriteBacnetDto {
  tenantId!: string;
  gatewayId!: string;
  /** IP do device — ou do ROTEADOR BACnet quando net/adr presentes */
  ip!: string;
  port!: number;
  /** Rede BACnet remota (device MS/TP atrás de roteador) — omitido para BACnet/IP direto */
  net?: number | null;
  /** MAC do device na rede remota (ex: [12] em MS/TP) */
  adr?: number[] | null;
  objectType!: number;
  objectInstance!: number;
  /** Valor a escrever. `null` = liberar o override (relinquish) na prioridade informada. */
  value!: number | boolean | null;
  /** Opcional — prioridade BACnet (1–16). Padrão: 8 */
  priority?: number;
  /**
   * Opcional — rótulo legível do ponto comandado (ex.: "Bomba 01"). Usado só
   * pela trilha de auditoria/dashboard para exibir um nome amigável; não é
   * enviado ao gateway.
   */
  pointLabel?: string;
  /**
   * Opcional — id do Device comandado. Usado só pela trilha de auditoria
   * (entityId) para o dashboard resolver o site do comando; não vai ao gateway.
   */
  deviceId?: string;
}

export interface BacnetWriteSuccess {
  success: true;
  command_id: string;
}

export interface BacnetWriteError {
  success: false;
  error: string;
}

export type BacnetWriteResult = BacnetWriteSuccess | BacnetWriteError;
