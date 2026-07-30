import { ConflictException } from '@nestjs/common';
import { DevicesController } from './devices.controller.js';

/**
 * Regressão de segurança: a captura de amostra em modo raiz NÃO pode liberar
 * ACL para um tópico raiz que pertence (ou colide com) um device de outro
 * tenant/gateway — senão vira canal de espionagem de telemetria alheia.
 * O raiz do PRÓPRIO device do chamador (mesmo tenant+gateway) é permitido.
 */
describe('DevicesController.assertRootTopicUsableForSampling', () => {
  type Ctl = {
    assertRootTopicUsableForSampling(root: string, tenantId: string, gatewayId: string): Promise<void>;
  };

  const makeController = (
    devices: Array<{ tenantId: string; gatewayId: string; rootTopic: string }>,
  ): Ctl => {
    const ctl = Object.create(DevicesController.prototype) as Record<string, unknown>;
    ctl.prisma = {
      device: {
        findMany: jest.fn(async () =>
          devices.map((d, i) => ({
            id: `dev-${i}`,
            name: `Device ${i}`,
            tenantId: d.tenantId,
            gatewayId: d.gatewayId,
            config: { topicMode: 'root', rootTopic: d.rootTopic },
          })),
        ),
      },
    };
    return ctl as unknown as Ctl;
  };

  it('nega raiz já reivindicado por device de OUTRO tenant', async () => {
    const ctl = makeController([{ tenantId: 'tenant-b', gatewayId: 'gw-b', rootTopic: '008065' }]);
    await expect(
      ctl.assertRootTopicUsableForSampling('008065', 'tenant-a', 'gw-a'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('nega overlap de prefixo nos dois sentidos com raiz de outro tenant', async () => {
    const ctl = makeController([{ tenantId: 'tenant-b', gatewayId: 'gw-b', rootTopic: '008065/sub' }]);
    await expect(
      ctl.assertRootTopicUsableForSampling('008065', 'tenant-a', 'gw-a'),
    ).rejects.toBeInstanceOf(ConflictException);
    const ctl2 = makeController([{ tenantId: 'tenant-b', gatewayId: 'gw-b', rootTopic: '008065' }]);
    await expect(
      ctl2.assertRootTopicUsableForSampling('008065/sub', 'tenant-a', 'gw-a'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('nega raiz de device do mesmo tenant mas em OUTRO gateway', async () => {
    const ctl = makeController([{ tenantId: 'tenant-a', gatewayId: 'gw-other', rootTopic: '008065' }]);
    await expect(
      ctl.assertRootTopicUsableForSampling('008065', 'tenant-a', 'gw-a'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('permite o raiz do próprio device do chamador (mesmo tenant+gateway)', async () => {
    const ctl = makeController([{ tenantId: 'tenant-a', gatewayId: 'gw-a', rootTopic: '008065' }]);
    await expect(
      ctl.assertRootTopicUsableForSampling('008065', 'tenant-a', 'gw-a'),
    ).resolves.toBeUndefined();
  });

  it('permite raiz novo sem conflito algum', async () => {
    const ctl = makeController([{ tenantId: 'tenant-b', gatewayId: 'gw-b', rootTopic: 'outra-coisa' }]);
    await expect(
      ctl.assertRootTopicUsableForSampling('008065', 'tenant-a', 'gw-a'),
    ).resolves.toBeUndefined();
  });
});
