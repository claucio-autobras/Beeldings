import { EmqxReprovisionService } from './emqx-reprovision.service.js';

/**
 * Re-provisionamento em massa das credenciais/ACLs do EMQX a partir do banco.
 *
 * O serviço é o caminho de RECUPERAÇÃO após perda de estado do broker (Mnesia):
 * precisa percorrer gateways (usuário + ACL + usuário de sensores) e devices
 * MQTT em modo raiz (usuário dedicado + ACL + ACL de roots no gateway) de forma
 * idempotente, contabilizar falhas sem abortar o lote e nunca agir quando a
 * checagem de boot for inconclusiva.
 */
describe('EmqxReprovisionService', () => {
  const GW1 = { id: 'gw-1', tenantId: 't1', mqttPass: 'p1', sensorMqttUser: 'gw-1-sensors', sensorMqttPass: 'sp1' };
  const GW2 = { id: 'gw-2', tenantId: 't2', mqttPass: 'p2', sensorMqttUser: null, sensorMqttPass: null };

  const ROOT_DEV = {
    id: 'dev-1',
    tenantId: 't1',
    gatewayId: 'gw-1',
    config: { topicMode: 'root', rootTopic: '008065', deviceMqttUser: 'dev-dev-1', deviceMqttPass: 'dp1' },
    points: [{ binding: { write: { commandTopic: '008065/set/power' } } }],
  };
  const PREFIX_DEV = {
    id: 'dev-2',
    tenantId: 't1',
    gatewayId: 'gw-1',
    config: { topicMode: 'prefix' },
    points: [],
  };

  function makeDeps(overrides?: {
    gateways?: unknown[];
    devices?: unknown[];
    configured?: boolean;
  }) {
    const prisma = {
      gateway: { findMany: jest.fn().mockResolvedValue(overrides?.gateways ?? [GW1, GW2]) },
      device: { findMany: jest.fn().mockResolvedValue(overrides?.devices ?? [ROOT_DEV, PREFIX_DEV]) },
    };
    const emqx = {
      isConfigured: jest.fn().mockReturnValue(overrides?.configured ?? true),
      mqttUserExists: jest.fn().mockResolvedValue(true),
      provisionGateway: jest.fn().mockResolvedValue(undefined),
      provisionSensorUser: jest.fn().mockResolvedValue(undefined),
      provisionRootDeviceUser: jest.fn().mockResolvedValue(undefined),
      syncRootDeviceAcl: jest.fn().mockResolvedValue(undefined),
      applyGatewayRootAcl: jest.fn().mockResolvedValue(undefined),
    };
    const cluster = { onLeadership: jest.fn() };
    const service = new EmqxReprovisionService(prisma as never, emqx as never, cluster as never);
    return { service, prisma, emqx, cluster };
  }

  it('re-provisiona gateways, usuários de sensores, devices raiz e ACLs de root', async () => {
    const { service, emqx } = makeDeps();
    const report = await service.reprovisionAll('manual');

    expect(emqx.provisionGateway).toHaveBeenCalledWith('gw-1', 'p1', 't1');
    expect(emqx.provisionGateway).toHaveBeenCalledWith('gw-2', 'p2', 't2');
    // usuário de sensores só para quem tem credencial emitida
    expect(emqx.provisionSensorUser).toHaveBeenCalledTimes(1);
    expect(emqx.provisionSensorUser).toHaveBeenCalledWith('gw-1', 't1', 'sp1');
    // device raiz com senha persistida → usuário dedicado + ACL
    expect(emqx.provisionRootDeviceUser).toHaveBeenCalledWith(
      'dev-1', 'dp1', '008065', ['008065/set/power'],
    );
    // ACL de roots reaplicada no usuário do gateway
    expect(emqx.applyGatewayRootAcl).toHaveBeenCalledWith('gw-1', 't1', ['008065']);
    // device em modo prefixo NÃO gera credencial dedicada
    expect(emqx.provisionRootDeviceUser).toHaveBeenCalledTimes(1);

    expect(report.gateways).toEqual({ total: 2, ok: 2, failed: 0 });
    expect(report.sensorUsers).toEqual({ total: 1, ok: 1, failed: 0 });
    expect(report.rootDevices).toEqual({ total: 1, ok: 1, failed: 0 });
    expect(report.gatewayRootAcls).toEqual({ total: 1, ok: 1, failed: 0 });
    expect(report.errors).toEqual([]);
  });

  it('é idempotente: rodar duas vezes produz as mesmas chamadas de upsert', async () => {
    const { service, emqx } = makeDeps();
    const r1 = await service.reprovisionAll('manual');
    const r2 = await service.reprovisionAll('manual');
    expect(r1.gateways).toEqual(r2.gateways);
    expect(r1.rootDevices).toEqual(r2.rootDevices);
    // 2 execuções × 2 gateways
    expect(emqx.provisionGateway).toHaveBeenCalledTimes(4);
    expect(r2.errors).toEqual([]);
  });

  it('falha em um item não aborta o lote e vai para o relatório', async () => {
    const { service, emqx } = makeDeps();
    emqx.provisionGateway.mockRejectedValueOnce(new Error('HTTP 500'));
    const report = await service.reprovisionAll('manual');

    expect(report.gateways).toEqual({ total: 2, ok: 1, failed: 1 });
    expect(report.errors.some((e) => e.includes('gw-1'))).toBe(true);
    // os demais itens seguiram normalmente
    expect(report.rootDevices.ok).toBe(1);
  });

  it('device raiz SEM senha persistida: reaplica a ACL mas reporta como pendência', async () => {
    const dev = { ...ROOT_DEV, config: { topicMode: 'root', rootTopic: '008065' } };
    const { service, emqx } = makeDeps({ devices: [dev] });
    const report = await service.reprovisionAll('manual');

    expect(emqx.provisionRootDeviceUser).not.toHaveBeenCalled();
    expect(emqx.syncRootDeviceAcl).toHaveBeenCalledWith('dev-1', '008065', ['008065/set/power']);
    expect(report.rootDevices).toEqual({ total: 1, ok: 0, failed: 1 });
    expect(report.errors[0]).toContain('sem senha persistida');
  });

  it('sem EMQX configurado, não toca no broker e reporta configured=false', async () => {
    const { service, emqx, prisma } = makeDeps({ configured: false });
    const report = await service.reprovisionAll('manual');
    expect(report.configured).toBe(false);
    expect(prisma.gateway.findMany).not.toHaveBeenCalled();
    expect(emqx.provisionGateway).not.toHaveBeenCalled();
  });

  it('chamadas concorrentes compartilham a MESMA execução', async () => {
    const { service, emqx } = makeDeps();
    const [a, b] = await Promise.all([
      service.reprovisionAll('manual'),
      service.reprovisionAll('manual'),
    ]);
    expect(a).toBe(b);
    expect(emqx.provisionGateway).toHaveBeenCalledTimes(2); // 1 execução × 2 gateways
  });

  describe('verificação leve no boot', () => {
    it('usuário de gateway AUSENTE (404) dispara o re-provisionamento completo', async () => {
      const { service, emqx } = makeDeps();
      emqx.mqttUserExists.mockResolvedValue(false);
      await service.bootCheck();
      expect(emqx.provisionGateway).toHaveBeenCalledTimes(2);
      expect(service.getLastReport()?.trigger).toBe('boot');
    });

    it('checagem inconclusiva (API fora do ar) NÃO dispara re-provisionamento', async () => {
      const { service, emqx } = makeDeps();
      emqx.mqttUserExists.mockResolvedValue(null);
      await service.bootCheck();
      expect(emqx.provisionGateway).not.toHaveBeenCalled();
      expect(service.getLastReport()).toBeNull();
    });

    it('todos os usuários presentes → nada a fazer', async () => {
      const { service, emqx } = makeDeps();
      await service.bootCheck();
      expect(emqx.provisionGateway).not.toHaveBeenCalled();
    });
  });
});
