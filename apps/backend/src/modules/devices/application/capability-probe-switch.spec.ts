/**
 * Testes de regressão: probeSwitchDevice() — orçamento de tempo compartilhado.
 *
 * Verifica dois requisitos críticos:
 *
 *   (a) Ambas as pernas respondem: capacidades são persistidas com os estados
 *       corretos (SUPPORTED para scalars e tabelas com portas detectadas).
 *
 *   (b) Perna de discovery lenta (timeout): resultado parcial é persistido sem
 *       travar a requisição HTTP — scalars ficam com o estado real, métricas de
 *       tabela recebem TEMPORARY_ERROR, e o probe retorna dentro do budget.
 *
 * Usa jest.useFakeTimers() no caso (b) para controlar o relógio sem esperar 40s.
 */

import {
  CapabilityProbeService,
  SWITCH_PROBE_BUDGET_MS,
} from './capability-probe.service';

// ─── Fakes de dependências ────────────────────────────────────────────────────

const SWITCH_DEVICE_ID = 'sw-1';
const TENANT_ID = 'ten-1';
const GATEWAY_ID = 'gw-1';

/** Resultado de diagnóstico scalar com device acessível. */
const DIAG_REACHABLE = {
  success: true as const,
  command_id: 'cmd-1',
  reachable: true,
  cause: null,
  sysDescr: 'Cisco Catalyst 2960',
  sysObjectId: null,
  oidResults: {
    '1.3.6.1.2.1.1.3.0':          { responded: true,  value: 123456 },
    '1.3.6.1.2.1.25.3.3.1.2.1':   { responded: true,  value: 42    },
  },
  walk: [],
  durationMs: 800,
};

/** Resultado de discovery com duas portas. */
const DISCOVER_OK = {
  success: true as const,
  sysDescr: null,
  ports: [
    { ifIndex: 1, ifDescr: 'GigabitEthernet0/1', ifAlias: null, ifType: 6, ifHighSpeed: 1000, ifOperStatus: 1 },
    { ifIndex: 2, ifDescr: 'GigabitEthernet0/2', ifAlias: null, ifType: 6, ifHighSpeed: 1000, ifOperStatus: 2 },
  ],
};

/** Device retornado pelo Prisma (SWITCH). */
function makeSwitchDevice(overrides: Record<string, unknown> = {}) {
  return {
    id: SWITCH_DEVICE_ID,
    tenantId: TENANT_ID,
    gatewayId: GATEWAY_ID,
    protocol: 'snmp',
    monitoredDeviceType: 'SWITCH',
    ip: '10.0.1.1',
    port: 161,
    config: { community: 'public', snmpVersion: '2c' },
    points: [],
    ...overrides,
  };
}

// ─── Helpers de construção de mocks ──────────────────────────────────────────

type AnyMock = Record<string, unknown>;

function makeService(opts: {
  diagnoseMock: jest.Mock;
  discoverMock: jest.Mock;
  prismaOverrides?: Partial<AnyMock>;
}) {
  const prisma: AnyMock = {
    device: {
      findFirst: jest.fn().mockResolvedValue(makeSwitchDevice()),
    } as unknown as AnyMock,
    deviceCapabilityMap: {
      upsert: jest.fn().mockResolvedValue({}),
    } as unknown as AnyMock,
    devicePoint: {
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    } as unknown as AnyMock,
    ...opts.prismaOverrides,
  };

  const snmpDiagnose = { diagnose: opts.diagnoseMock } as unknown;
  const switchPortSync = { discoverPorts: opts.discoverMock } as unknown;
  const configPublisher = {} as unknown;
  const deviceStatus = { getStatus: jest.fn().mockReturnValue('online') } as unknown;

  const nvrTableSync = {} as unknown;
  return new CapabilityProbeService(
    prisma as never,
    snmpDiagnose as never,
    configPublisher as never,
    deviceStatus as never,
    switchPortSync as never,
    nvrTableSync as never,
  );
}

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('probeSwitchDevice() — orçamento de tempo compartilhado', () => {
  // ── (a) Ambas as pernas respondem ───────────────────────────────────────────

  describe('(a) ambas as pernas respondem', () => {
    let service: CapabilityProbeService;
    let upsertMock: jest.Mock;

    beforeEach(() => {
      upsertMock = jest.fn().mockResolvedValue({});
      service = makeService({
        diagnoseMock: jest.fn().mockResolvedValue(DIAG_REACHABLE),
        discoverMock: jest.fn().mockResolvedValue(DISCOVER_OK),
        prismaOverrides: {
          deviceCapabilityMap: { upsert: upsertMock } as unknown as AnyMock,
        },
      });
    });

    it('retorna success:true e reachable:true', async () => {
      const result = await service.probeDevice(SWITCH_DEVICE_ID);
      expect(result.success).toBe(true);
      expect(result.reachable).toBe(true);
    });

    it('scalar uptime → SUPPORTED com probeValue', async () => {
      const result = await service.probeDevice(SWITCH_DEVICE_ID);
      const uptime = result.capabilities.find((c) => c.metricKey === 'uptime');
      expect(uptime?.state).toBe('SUPPORTED');
      expect(uptime?.probeValue).toBe(123456);
    });

    it('scalar cpu → SUPPORTED com probeValue', async () => {
      const result = await service.probeDevice(SWITCH_DEVICE_ID);
      const cpu = result.capabilities.find((c) => c.metricKey === 'cpu');
      expect(cpu?.state).toBe('SUPPORTED');
      expect(cpu?.probeValue).toBe(42);
    });

    it('métricas de tabela → SUPPORTED (2 portas detectadas)', async () => {
      const result = await service.probeDevice(SWITCH_DEVICE_ID);
      const tableMetrics = ['if_oper_status', 'if_in_octets', 'if_out_octets'];
      for (const metric of tableMetrics) {
        const cap = result.capabilities.find((c) => c.metricKey === metric);
        expect(cap?.state).toBe('SUPPORTED');
        expect(cap?.probeValue).toBe(2); // 2 portas
      }
    });

    it('persiste capacidades no banco (upsert por métrica)', async () => {
      await service.probeDevice(SWITCH_DEVICE_ID);
      // 2 scalars + 3 table = 5 métricas
      expect(upsertMock).toHaveBeenCalledTimes(5);
    });

    it('ambas as pernas disparam em paralelo (as duas são chamadas)', async () => {
      const diagMock = jest.fn().mockResolvedValue(DIAG_REACHABLE);
      const discoverMock = jest.fn().mockResolvedValue(DISCOVER_OK);
      const svc = makeService({ diagnoseMock: diagMock, discoverMock });

      await svc.probeDevice(SWITCH_DEVICE_ID);

      expect(diagMock).toHaveBeenCalledTimes(1);
      expect(discoverMock).toHaveBeenCalledTimes(1);
    });
  });

  // ── (b) Perna de discovery lenta (timeout dentro do budget) ────────────────

  describe('(b) perna de discovery excede o budget', () => {
    let service: CapabilityProbeService;
    let upsertMock: jest.Mock;

    beforeEach(() => {
      jest.useFakeTimers();
      upsertMock = jest.fn().mockResolvedValue({});
      service = makeService({
        diagnoseMock: jest.fn().mockResolvedValue(DIAG_REACHABLE),
        // Discovery nunca resolve — simula gateway lento ou perdido
        discoverMock: jest.fn().mockReturnValue(new Promise<never>(() => {})),
        prismaOverrides: {
          deviceCapabilityMap: { upsert: upsertMock } as unknown as AnyMock,
        },
      });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('responde dentro do budget sem pendurar a requisição', async () => {
      const probePromise = service.probeDevice(SWITCH_DEVICE_ID);

      // Avança o relógio além do budget para disparar o timer compartilhado
      await jest.advanceTimersByTimeAsync(SWITCH_PROBE_BUDGET_MS + 500);

      // Promise deve ter resolvido — nenhum hang
      const result = await probePromise;
      expect(result).toBeDefined();
    });

    it('scalars têm estado correto (diagnostic respondeu normalmente)', async () => {
      const probePromise = service.probeDevice(SWITCH_DEVICE_ID);
      await jest.advanceTimersByTimeAsync(SWITCH_PROBE_BUDGET_MS + 500);
      const result = await probePromise;

      const uptime = result.capabilities.find((c) => c.metricKey === 'uptime');
      const cpu   = result.capabilities.find((c) => c.metricKey === 'cpu');
      expect(uptime?.state).toBe('SUPPORTED');
      expect(cpu?.state).toBe('SUPPORTED');
    });

    it('métricas de tabela → TEMPORARY_ERROR (discovery expirou)', async () => {
      const probePromise = service.probeDevice(SWITCH_DEVICE_ID);
      await jest.advanceTimersByTimeAsync(SWITCH_PROBE_BUDGET_MS + 500);
      const result = await probePromise;

      const tableMetrics = ['if_oper_status', 'if_in_octets', 'if_out_octets'];
      for (const metric of tableMetrics) {
        const cap = result.capabilities.find((c) => c.metricKey === metric);
        expect(cap?.state).toBe('TEMPORARY_ERROR');
      }
    });

    it('resultados parciais são persistidos mesmo com discovery expirado', async () => {
      const probePromise = service.probeDevice(SWITCH_DEVICE_ID);
      await jest.advanceTimersByTimeAsync(SWITCH_PROBE_BUDGET_MS + 500);
      await probePromise;

      // Todas as 5 métricas devem ser persistidas (scalars corretos + tabelas TEMPORARY_ERROR)
      expect(upsertMock).toHaveBeenCalledTimes(5);
    });

    it('success:true mesmo com resultado parcial (reachable reflete o scalar)', async () => {
      const probePromise = service.probeDevice(SWITCH_DEVICE_ID);
      await jest.advanceTimersByTimeAsync(SWITCH_PROBE_BUDGET_MS + 500);
      const result = await probePromise;

      expect(result.success).toBe(true);
      expect(result.reachable).toBe(true);
    });
  });

  // ── (c) Scalar leg também expira ────────────────────────────────────────────

  describe('(c) ambas as pernas expiram (gateway completamente mudo)', () => {
    let service: CapabilityProbeService;
    let upsertMock: jest.Mock;

    beforeEach(() => {
      jest.useFakeTimers();
      upsertMock = jest.fn().mockResolvedValue({});
      service = makeService({
        diagnoseMock: jest.fn().mockReturnValue(new Promise<never>(() => {})),
        discoverMock: jest.fn().mockReturnValue(new Promise<never>(() => {})),
        prismaOverrides: {
          deviceCapabilityMap: { upsert: upsertMock } as unknown as AnyMock,
        },
      });
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('resolve dentro do budget com todas as métricas TEMPORARY_ERROR', async () => {
      const probePromise = service.probeDevice(SWITCH_DEVICE_ID);
      await jest.advanceTimersByTimeAsync(SWITCH_PROBE_BUDGET_MS + 500);
      const result = await probePromise;

      expect(result.success).toBe(true);
      expect(result.reachable).toBe(false);

      for (const cap of result.capabilities) {
        expect(cap.state).toBe('TEMPORARY_ERROR');
      }
    });

    it('persiste TEMPORARY_ERROR para todas as métricas', async () => {
      const probePromise = service.probeDevice(SWITCH_DEVICE_ID);
      await jest.advanceTimersByTimeAsync(SWITCH_PROBE_BUDGET_MS + 500);
      await probePromise;

      expect(upsertMock).toHaveBeenCalledTimes(5);
    });
  });
});
