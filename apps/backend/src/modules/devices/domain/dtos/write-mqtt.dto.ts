/**
 * Comando de escrita para um ponto MQTT-nativo (ex.: relé Shelly Gen4).
 * O frontend NÃO envia tópico/payload — o backend resolve o binding de escrita
 * do ponto no banco (fonte de verdade), evitando publicação arbitrária.
 */
export class WriteMqttDto {
  tenantId!: string;
  /** Device MQTT comandado (valida tenant + gateway). */
  deviceId!: string;
  /** Ponto comandado — precisa ter binding.write configurado. */
  pointId!: string;
  /** Valor a escrever (número; para boolean, 0/1). */
  value!: number | boolean;
  /**
   * Opcional — rótulo legível do ponto comandado. Usado só pela trilha de
   * auditoria/dashboard; não é enviado ao gateway.
   */
  pointLabel?: string;
}

/** Binding de escrita persistido em DevicePoint.binding.write. */
export interface MqttWriteBinding {
  /** Tópico completo de comando — precisa estar sob .../sensors/ do gateway. */
  commandTopic: string;
  /**
   * Template do payload. Placeholders: `{{value}}` (valor JSON conforme
   * valueType) e `{{id}}` (id numérico de RPC, usado para casar a resposta).
   */
  payloadTemplate: string;
  /**
   * Opcional — tópico completo onde a confirmação chega (ex.: resposta RPC do
   * Shelly). Quando ausente, o comando é "enviado sem confirmação".
   */
  responseTopic?: string | null;
}

export interface MqttWriteSuccess {
  success: true;
  command_id: string;
  /** true quando o gateway confirmou via tópico de resposta; false = apenas enviado. */
  confirmed: boolean;
}

export interface MqttWriteError {
  success: false;
  error: string;
}

export type MqttWriteResult = MqttWriteSuccess | MqttWriteError;
