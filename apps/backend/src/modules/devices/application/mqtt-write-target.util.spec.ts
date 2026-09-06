import { resolveMqttWriteTarget } from './mqtt-write-target.util.js';
import type { Device, DevicePoint } from '@prisma/client';

/**
 * Regressão do caso real Aeris: binding com `matchByValue: true` porém
 * `responseTopic` vazio virava escrita "sem confirmação" — o gateway publicava
 * e reportava sucesso sem o equipamento responder, e a UI mantinha o valor
 * otimista mesmo quando o comando não surtia efeito. O fallback usa o
 * sourceTopic do ponto (eco de valor do equipamento) como tópico de resposta.
 */
describe('resolveMqttWriteTarget', () => {
  const device = {
    id: 'dev-1',
    name: 'Aeris',
    protocol: 'mqtt',
    gatewayId: 'gw-1',
    tenantId: 'tenant-1',
    config: { topicMode: 'root', rootTopic: '008065' },
  } as unknown as Device;

  const basePoint = (binding: Record<string, unknown>): DevicePoint =>
    ({
      id: 'pt-1',
      tag: 'STATUS_SPLIT',
      unit: null,
      binding,
    }) as unknown as DevicePoint;

  it('usa o sourceTopic como responseTopic quando matchByValue está ativo sem responseTopic', () => {
    const target = resolveMqttWriteTarget(
      device,
      basePoint({
        valueType: 'boolean',
        sourceTopic: '008065/update/sensor/POWER1',
        write: {
          commandTopic: '008065/set/split/0/force1',
          payloadTemplate: '{{value}}',
          responseTopic: null,
          matchByValue: true,
        },
      }),
    );
    expect(target.write.responseTopic).toBe('008065/update/sensor/POWER1');
    expect(target.write.matchByValue).toBe(true);
    expect(target.topicScope).toBe('008065/');
  });

  it('preserva o responseTopic explícito quando configurado', () => {
    const target = resolveMqttWriteTarget(
      device,
      basePoint({
        valueType: 'number',
        sourceTopic: '008065/update/sensor/SP1',
        write: {
          commandTopic: '008065/set/split/0/sp1',
          payloadTemplate: '{{value}}',
          responseTopic: '008065/config/split/0/sp_val1',
          matchByValue: true,
        },
      }),
    );
    expect(target.write.responseTopic).toBe('008065/config/split/0/sp_val1');
  });

  it('sem matchByValue não inventa responseTopic (fluxo "enviado" segue válido)', () => {
    const target = resolveMqttWriteTarget(
      device,
      basePoint({
        valueType: 'boolean',
        sourceTopic: '008065/update/sensor/POWER1',
        write: {
          commandTopic: '008065/set/split/0/force1',
          payloadTemplate: '{{value}}',
          responseTopic: null,
        },
      }),
    );
    expect(target.write.responseTopic ?? null).toBeNull();
  });
});
