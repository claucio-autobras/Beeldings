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

  // Confirmação por eco de valor sem responseTopic explícito: usa o próprio
  // sourceTopic do ponto como tópico de resposta. Sem esse fallback, um binding
  // com matchByValue e responseTopic vazio virava "enviado sem confirmação" —
  // a UI mostrava sucesso otimista mesmo quando o equipamento não mudava.
  const sourceTopic =
    typeof (point.binding as { sourceTopic?: unknown } | null)?.sourceTopic === 'string'
      ? ((point.binding as { sourceTopic?: string }).sourceTopic ?? '').trim()
      : '';
  const effectiveWrite: MqttWriteBinding =
    write.matchByValue === true && !(write.responseTopic ?? '').trim() && sourceTopic
      ? { ...write, responseTopic: sourceTopic }
      : write;

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
    write: effectiveWrite,
    valueType,
    pointTag: point.tag,
    pointUnit: point.unit ?? null,
    isDigital: valueType === 'boolean',
  };
}
