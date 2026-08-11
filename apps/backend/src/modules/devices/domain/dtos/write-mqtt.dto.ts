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
   * Template do payload. Placeholders suportados:
   *   `{{value}}`  — valor JSON conforme valueType (obrigatório)
   *   `{{id}}`     — id numérico de RPC gerado por requisição (Shelly/padrão RPC)
   *   `{{ts}}`     — epoch UNIX em segundos (inteiro) no momento do envio
   *   `{{sh}}`     — assinatura proprietária de 24 bits (Aeris); requer
   *                  configuração de `signatureAlgorithm`/`signatureSecret` no
   *                  device — veja a documentação do firmware Aeris para o
   *                  algoritmo exato. Enquanto não configurado, o comando chega
   *                  ao broker mas o firmware DESCARTA mensagens com sh inválido.
   */
  payloadTemplate: string;
  /**
   * Opcional — tópico completo onde a confirmação chega (ex.: resposta RPC do
   * Shelly). Quando ausente, o comando é "enviado sem confirmação".
   *
   * Para equipamentos Aeris: use o tópico de eco de valor (ex.:
   * `008065/config/split/0/sp_val1`). A confirmação é casada pelo valor numérico
   * (`parsed.value ≈ valor comandado`) em vez do campo `id` RPC — configure
   * `matchByValue: true` para ativar esse modo.
   */
  responseTopic?: string | null;
  /**
   * Quando `true`, o gateway confirma o comando casando o campo `value` do JSON
   * da resposta com o valor comandado (tolerância de 0,1%), em vez de casar
   * pelo campo `id` RPC. Usar com equipamentos que ecoam o novo estado num
   * tópico separado (ex.: Aeris sp_val1).
   */
  matchByValue?: boolean;
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
