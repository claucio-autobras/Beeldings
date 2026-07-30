import type { Device, DevicePoint } from '@prisma/client';
import type { MqttWriteBinding } from '../domain/dtos/write-mqtt.dto.js';
import type { MqttWriteRequest } from './mqtt-write.service.js';

/**
 * Resolução compartilhada de escrita MQTT (controller manual E runner de
 * automações): valida que o ponto é comandável (binding.write com tópico de
 * comando e template de payload) e que o device tem gateway, lendo tudo do
 * banco — nunca do chamador. Lança `Error` com mensagem legível quando o
 * cadastro está incompleto ou o ponto é somente-leitura.
 *
 * Retorna o request pronto para o `MqttWriteService`, faltando só o `value`,
 * que o chamador define conforme o `valueType` resolvido.
 */
export interface ResolvedMqttWriteTarget extends Omit<MqttWriteRequest, 'value'> {
  /** true quando o ponto é boolean (digital) — usado no reverse de automações. */
  isDigital: boolean;
}

export function resolveMqttWriteTarget(
  device: Device,
  point: DevicePoint,
): ResolvedMqttWriteTarget {
  if (device.protocol !== 'mqtt') {
    throw new Error(`Dispositivo "${device.name}" não é MQTT`);
  }
  if (!device.gatewayId) {
    throw new Error(`Dispositivo "${device.name}" não tem gateway associado`);
  }

  const binding = (point.binding ?? {}) as {
    valueType?: 'number' | 'boolean';
    write?: MqttWriteBinding | null;
  };
  const write = binding.write;
  if (!write?.commandTopic?.trim() || !write?.payloadTemplate?.trim()) {
    throw new Error('Ponto não é comandável (sem binding de escrita)');
  }

  const valueType = binding.valueType === 'boolean' ? 'boolean' : 'number';

  // Escopo permitido para comando/resposta: modo raiz usa `{rootTopic}/`,
  // senão o namespace de sensores do gateway (comportamento atual).
  const cfg = (device.config ?? {}) as { topicMode?: string; rootTopic?: string };
  const topicScope =
    cfg.topicMode === 'root' && cfg.rootTopic?.trim()
      ? `${cfg.rootTopic.trim()}/`
      : `bluebee/${device.tenantId}/gateway/${device.gatewayId}/sensors/`;

  return {
    topicScope,
    tenantId: device.tenantId,
    gatewayId: device.gatewayId,
    deviceId: device.id,
    write,
    valueType,
    pointTag: point.tag,
    pointUnit: point.unit ?? null,
    isDigital: valueType === 'boolean',
  };
}
