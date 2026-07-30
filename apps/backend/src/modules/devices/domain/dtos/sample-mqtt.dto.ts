export class SampleMqttTopicDto {
  tenantId!: string;
  gatewayId!: string;
  topic!: string;
  /**
   * Tópico raiz próprio do equipamento (modo sem prefixo) — quando presente, a
   * validação de escopo usa `{rootTopic}/` em vez do prefixo de sensores.
   */
  rootTopic?: string;
}

/** Uma amostra de payload capturada no tópico. */
export interface MqttSample {
  topic: string;
  payload: string;
  receivedAt: string;
}

export interface MqttSampleSuccess {
  success: true;
  command_id: string;
  samples: MqttSample[];
}

export interface MqttSampleError {
  success: false;
  error: string;
}

export type MqttSampleResult = MqttSampleSuccess | MqttSampleError;
