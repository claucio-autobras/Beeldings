/**
 * Specs do SnmpMetricService — serviço canônico de métricas SNMP.
 *
 * Cobre:
 *   - Persistência de bindings auto-resolvidos (confidence='exact').
 *   - Não sobrescrever binding manual com auto-resolve.
 *   - Persistência de binding com confidence correto (manual/exact).
 *   - Herança de bindings entre devices do mesmo sysObjectID.
 *   - Herança respeita firmware family (incompatível → não herda).
 *   - Geração de propostas metric-first no shape frontend correto.
 *   - canonicalMetrics do gateway tem prioridade nas propostas.
 *   - Métricas sem OID (reachability) nunca são persistidas como binding.
 *   - normalizeMetricKey mapeia aliases legados corretamente.
 */

import {
  SnmpMetricService,
  normalizeMetricKey,
  CANONICAL_METRICS_PRIORITY,
  METRICS_WITHOUT_OID,
  extractFirmwareFamily,
  areFirmwareFamiliesCompatible,
} from './snmp-metric.service.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePrismaWithStore() {
  const store = new Map<string, Record<string, unknown>>();
  return {
    deviceMetricBinding: {
      findUnique: async ({
        where,
      }: {
        where: { deviceId_metricKey: { deviceId: string; metricKey: string } };
      }) =>
        store.get(
          `${where.deviceId_metricKey.deviceId}:${where.deviceId_metricKey.metricKey}`,
        ) ?? null,
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        const all = [...store.values()] as Array<Record<string, unknown>>;
        if (where.deviceId && typeof where.deviceId === 'string') {
          return all.filter((r) => r.deviceId === where.deviceId);
        }
        if (where.deviceId && typeof where.deviceId === 'object') {
          const notId = (where.deviceId as { not?: string }).not;
          return all.filter(
            (r) =>
              r.tenantId === where.tenantId &&
              r.sysObjectId === where.sysObjectId &&
              r.deviceId !== notId &&
              (where.broken === false ? r.broken === false : true),
          );
        }
        return all;
      },
      upsert: async ({
        where,
        create,
        update,
      }: {
        where: { deviceId_metricKey: { deviceId: string; metricKey: string } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const key = `${where.deviceId_metricKey.deviceId}:${where.deviceId_metricKey.metricKey}`;
        const existing = store.get(key);
        if (existing) {
          const updated = { ...existing, ...update };
          store.set(key, updated);
          return updated;
        }
        store.set(key, create);
        return create;
      },
    },
    _store: store,
  };
}

// ─── normalizeMetricKey ───────────────────────────────────────────────────────

describe('normalizeMetricKey', () => {
  it('mapeia aliases legados para chaves canônicas', () => {
    expect(normalizeMetricKey('cpu')).toBe('cpu_usage');
    expect(normalizeMetricKey('temperature')).toBe('cpu_temperature');
    expect(normalizeMetricKey('memory')).toBe('memory_used_percent');
    expect(normalizeMetricKey('ram_total')).toBe('ram_total');
    expect(normalizeMetricKey('storage')).toBe('storage_used_percent');
    expect(normalizeMetricKey('if_in_octets')).toBe('net_in_rate');
    expect(normalizeMetricKey('if_out_octets')).toBe('net_out_rate');
    expect(normalizeMetricKey('packet_loss')).toBe('net_discard_rate');
    expect(normalizeMetricKey('if_oper_status')).toBe('interface_status');
  });

  it('preserva chaves já canônicas', () => {
    expect(normalizeMetricKey('cpu_usage')).toBe('cpu_usage');
    expect(normalizeMetricKey('uptime')).toBe('uptime');
    expect(normalizeMetricKey('reachability')).toBe('reachability');
    expect(normalizeMetricKey('custom_oid')).toBe('custom_oid');
  });
});

// ─── METRICS_WITHOUT_OID ─────────────────────────────────────────────────────

describe('METRICS_WITHOUT_OID', () => {
  it('inclui reachability, status e ping_loss', () => {
    expect(METRICS_WITHOUT_OID.has('reachability')).toBe(true);
    expect(METRICS_WITHOUT_OID.has('status')).toBe(true);
    expect(METRICS_WITHOUT_OID.has('ping_loss')).toBe(true);
  });
  it('não inclui métricas com OID', () => {
    expect(METRICS_WITHOUT_OID.has('cpu_usage')).toBe(false);
    expect(METRICS_WITHOUT_OID.has('uptime')).toBe(false);
  });
});

// ─── extractFirmwareFamily ────────────────────────────────────────────────────

describe('extractFirmwareFamily', () => {
  it('extrai família coarse de sysDescr', () => {
    const fam = extractFirmwareFamily({ walk: [], sysDescr: 'Control iD fw5.13.9-build' });
    expect(fam).not.toBeNull();
    expect(fam).toContain('5.13');
  });

  it('extrai de ENTITY-MIB entPhysicalFirmwareRev', () => {
    const fam = extractFirmwareFamily({
      walk: [{
        root: '1.3.6.1.2.1.47',
        entries: [
          { oid: '1.3.6.1.2.1.47.1.1.1.1.9.1', value: '5.10.2' },
        ],
      }],
      sysDescr: null,
    });
    expect(fam).toBe('5.10');
  });

  it('retorna null quando sem informação', () => {
    expect(extractFirmwareFamily({ walk: [], sysDescr: null })).toBeNull();
  });
});

// ─── areFirmwareFamiliesCompatible ───────────────────────────────────────────

describe('areFirmwareFamiliesCompatible', () => {
  it('null + anything = compatível', () => {
    expect(areFirmwareFamiliesCompatible(null, '5.13')).toBe(true);
    expect(areFirmwareFamiliesCompatible('5.13', null)).toBe(true);
    expect(areFirmwareFamiliesCompatible(null, null)).toBe(true);
  });
  it('mesma família = compatível', () => {
    expect(areFirmwareFamiliesCompatible('5.13', '5.13')).toBe(true);
  });
  it('famílias diferentes = incompatível', () => {
    expect(areFirmwareFamiliesCompatible('5.13', '5.14')).toBe(false);
    expect(areFirmwareFamiliesCompatible('V4', 'V5')).toBe(false);
  });
});

// ─── persistAutoResolvedBindings ─────────────────────────────────────────────

describe('SnmpMetricService.persistAutoResolvedBindings', () => {
  it('não persiste métricas sem OID (reachability/status)', async () => {
    const prisma = makePrismaWithStore();
    const svc = new SnmpMetricService(prisma as never);
    const count = await svc.persistAutoResolvedBindings({
      tenantId: 't1', deviceId: 'd1', sysObjectId: null,
      resolved: [
        { metricKey: 'reachability', oid: '', scale: 1, unit: '' },
        { metricKey: 'status', oid: '', scale: 1, unit: '' },
        { metricKey: 'uptime', oid: '1.3.6.1.2.1.1.3.0', scale: 0.01, unit: 's' },
      ],
    });
    expect(count).toBe(1); // só uptime
    expect(prisma._store.size).toBe(1);
  });

  it('normaliza aliases legados antes de persistir', async () => {
    const prisma = makePrismaWithStore();
    const svc = new SnmpMetricService(prisma as never);
    await svc.persistAutoResolvedBindings({
      tenantId: 't1', deviceId: 'd1', sysObjectId: null,
      resolved: [{ metricKey: 'cpu', oid: '1.3.6.1.2.1.25.3.3.1.2.1', scale: 1, unit: '%' }],
    });
    const stored = [...prisma._store.values()][0];
    expect(stored.metricKey).toBe('cpu_usage');
  });

  it('não sobrescreve bindings manuais', async () => {
    const prisma = makePrismaWithStore();
    // Pré-popula com binding manual
    prisma._store.set('d1:cpu_usage', {
      deviceId: 'd1', metricKey: 'cpu_usage',
      oid: '1.2.3.4.0', confidenceLabel: 'manual', broken: false,
    });
    const svc = new SnmpMetricService(prisma as never);
    const count = await svc.persistAutoResolvedBindings({
      tenantId: 't1', deviceId: 'd1', sysObjectId: null,
      resolved: [{ metricKey: 'cpu', oid: '1.3.6.1.2.1.25.3.3.1.2.1', scale: 1, unit: '%' }],
    });
    expect(count).toBe(0);
    // OID manual preservado
    expect(prisma._store.get('d1:cpu_usage')?.oid).toBe('1.2.3.4.0');
  });

  it('preserva binding legado vindo de ponto ao apenas diagnosticar', async () => {
    const prisma = makePrismaWithStore();
    // Cadastros pré-metric-first já carregam um OID de coleta no ponto. A
    // migração os classifica como exact, mas esse valor não é uma autorização
    // para a descoberta trocar a coleta sem o operador clicar em Aplicar.
    prisma._store.set('d1:cpu_usage', {
      deviceId: 'd1',
      metricKey: 'cpu_usage',
      oid: '1.3.6.1.4.1.49617.1.1.4.0',
      confidenceLabel: 'exact',
      source: 'point',
      broken: false,
    });
    const svc = new SnmpMetricService(prisma as never);

    const count = await svc.persistAutoResolvedBindings({
      tenantId: 't1',
      deviceId: 'd1',
      sysObjectId: '1.3.6.1.4.1.49617',
      resolved: [{
        metricKey: 'cpu_usage',
        oid: '1.3.6.1.2.1.25.3.3.1.2.1',
        scale: 1,
        unit: '%',
      }],
    });

    expect(count).toBe(0);
    expect(prisma._store.get('d1:cpu_usage')).toMatchObject({
      oid: '1.3.6.1.4.1.49617.1.1.4.0',
      confidenceLabel: 'exact',
      source: 'point',
    });
  });

  it('usa confidenceLabel=exact', async () => {
    const prisma = makePrismaWithStore();
    const svc = new SnmpMetricService(prisma as never);
    await svc.persistAutoResolvedBindings({
      tenantId: 't1', deviceId: 'd1', sysObjectId: null,
      resolved: [{ metricKey: 'uptime', oid: '1.3.6.1.2.1.1.3.0', scale: 0.01, unit: 's' }],
    });
    const stored = prisma._store.get('d1:uptime');
    expect(stored?.confidenceLabel).toBe('exact');
    expect(stored?.source).toBe('diagnose');
  });

  it('preserva confidenceLabel=inferred para métricas derivadas por heurística', async () => {
    const prisma = makePrismaWithStore();
    const svc = new SnmpMetricService(prisma as never);
    await svc.persistAutoResolvedBindings({
      tenantId: 't1',
      deviceId: 'd1',
      sysObjectId: null,
      resolved: [{
        metricKey: 'memory_used_percent',
        oid: '1.3.6.1.2.1.25.2.3.1.6.1',
        scale: 1,
        unit: '%',
        confidence: 'inferred',
      }],
    });
    const stored = prisma._store.get('d1:memory_used_percent');
    expect(stored?.confidenceLabel).toBe('inferred');
    expect(stored?.confidence).toBe(0.8);
  });

  it('não substitui uma fonte existente no preenchimento automático do cadastro', async () => {
    const prisma = makePrismaWithStore();
    prisma._store.set('d1:cpu_usage', {
      id: 'binding-1',
      deviceId: 'd1',
      metricKey: 'cpu_usage',
      oid: '1.3.6.1.4.1.manual',
      confidenceLabel: 'exact',
      source: 'diagnose',
      broken: false,
    });
    const svc = new SnmpMetricService(prisma as never);

    const count = await svc.persistAutoResolvedBindings({
      tenantId: 't1',
      deviceId: 'd1',
      sysObjectId: null,
      onlyIfMissing: true,
      resolved: [{
        metricKey: 'cpu_usage',
        oid: '1.3.6.1.2.1.25.3.3.1.2.1',
        scale: 1,
        unit: '%',
      }],
    });

    expect(count).toBe(0);
    expect(prisma._store.get('d1:cpu_usage')?.oid).toBe('1.3.6.1.4.1.manual');
  });
});

// ─── persistBinding ───────────────────────────────────────────────────────────

describe('SnmpMetricService.persistBinding', () => {
  it('persiste com confidence=manual', async () => {
    const prisma = makePrismaWithStore();
    const svc = new SnmpMetricService(prisma as never);
    await svc.persistBinding({
      tenantId: 't1', deviceId: 'd1', metricKey: 'cpu_usage',
      oid: '1.3.6.1.2.1.25.3.3.1.2.1', scale: 1, unit: '%',
      confidence: 'manual',
    });
    const stored = prisma._store.get('d1:cpu_usage');
    expect(stored?.confidenceLabel).toBe('manual');
    expect(stored?.broken).toBe(false);
  });

  it('persiste com confidence=exact', async () => {
    const prisma = makePrismaWithStore();
    const svc = new SnmpMetricService(prisma as never);
    await svc.persistBinding({
      tenantId: 't1', deviceId: 'd1', metricKey: 'uptime',
      oid: '1.3.6.1.2.1.1.3.0', scale: 0.01, unit: 's',
      confidence: 'exact',
    });
    const stored = prisma._store.get('d1:uptime');
    expect(stored?.confidenceLabel).toBe('exact');
  });

  it('normaliza alias e não persiste métricas sem OID', async () => {
    const prisma = makePrismaWithStore();
    const svc = new SnmpMetricService(prisma as never);
    await svc.persistBinding({
      tenantId: 't1', deviceId: 'd1', metricKey: 'reachability',
      oid: '', scale: 1, unit: '', confidence: 'manual',
    });
    expect(prisma._store.size).toBe(0);
  });
});

describe('SnmpMetricService.getStorageVolumeBindings', () => {
  it('separa cada linha hrStorage e preserva o hrStorageDescr', async () => {
    const prisma = makePrismaWithStore();
    prisma._store.set('d1:storage_used_percent', {
      deviceId: 'd1',
      metricKey: 'storage_used_percent',
      memberOids: [
        '1.3.6.1.2.1.25.2.3.1.4.7',
        '1.3.6.1.2.1.25.2.3.1.5.7',
        '1.3.6.1.2.1.25.2.3.1.6.7',
        '1.3.6.1.2.1.25.2.3.1.4.9',
        '1.3.6.1.2.1.25.2.3.1.5.9',
        '1.3.6.1.2.1.25.2.3.1.6.9',
      ],
      labels: {
        '1.3.6.1.2.1.25.2.3.1.6.7': 'Flash principal',
        '1.3.6.1.2.1.25.2.3.1.6.9': '/tmp',
      },
    });
    const svc = new SnmpMetricService(prisma as never);

    await expect(svc.getStorageVolumeBindings('d1')).resolves.toEqual([
      {
        index: '7',
        label: 'Flash principal',
        oid: '1.3.6.1.2.1.25.2.3.1.6.7',
        memberOids: [
          '1.3.6.1.2.1.25.2.3.1.4.7',
          '1.3.6.1.2.1.25.2.3.1.5.7',
          '1.3.6.1.2.1.25.2.3.1.6.7',
        ],
      },
      {
        index: '9',
        label: '/tmp',
        oid: '1.3.6.1.2.1.25.2.3.1.6.9',
        memberOids: [
          '1.3.6.1.2.1.25.2.3.1.4.9',
          '1.3.6.1.2.1.25.2.3.1.5.9',
          '1.3.6.1.2.1.25.2.3.1.6.9',
        ],
      },
    ]);
  });
});

describe('SnmpMetricService.syncCpuPeakPoint', () => {
  it('cria um ponto técnico de pico para CPU multi-core', async () => {
    const members = [
      '1.3.6.1.2.1.25.3.3.1.2.1',
      '1.3.6.1.2.1.25.3.3.1.2.2',
    ];
    const prisma = {
      deviceMetricBinding: {
        findUnique: jest.fn().mockResolvedValue({
          oid: members[0],
          memberOids: members,
        }),
      },
      devicePoint: {
        findFirst: jest.fn().mockResolvedValue(null),
        aggregate: jest.fn().mockResolvedValue({ _max: { instance: 4 } }),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    const svc = new SnmpMetricService(prisma as never);

    await svc.syncCpuPeakPoint('d1');

    expect(prisma.devicePoint.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        deviceId: 'd1',
        tag: 'CPU_USAGE_PEAK',
        objectName: 'Pico de CPU',
        instance: 5,
        unit: '%',
        binding: {
          metric: 'cpu_usage_peak',
          oid: members[0],
          scale: 1,
          memberOids: members,
          unsupported: false,
        },
      }),
    });
  });

  it('remove o detalhe antigo quando CPU deixa de ter múltiplos membros', async () => {
    const prisma = {
      deviceMetricBinding: {
        findUnique: jest.fn().mockResolvedValue({
          oid: '1.3.6.1.4.1.999.1.0',
          memberOids: [],
        }),
      },
      devicePoint: {
        findFirst: jest.fn().mockResolvedValue({ id: 'peak-1' }),
        aggregate: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    const svc = new SnmpMetricService(prisma as never);

    await svc.syncCpuPeakPoint('d1');

    expect(prisma.devicePoint.delete).toHaveBeenCalledWith({
      where: { id: 'peak-1' },
    });
    expect(prisma.devicePoint.create).not.toHaveBeenCalled();
  });
});

// ─── inheritBindingsFromSameModel ────────────────────────────────────────────

describe('SnmpMetricService.inheritBindingsFromSameModel', () => {
  it('não herda quando não há donors', async () => {
    const prisma = makePrismaWithStore();
    const svc = new SnmpMetricService(prisma as never);
    const count = await svc.inheritBindingsFromSameModel({
      tenantId: 't1', deviceId: 'd-new', sysObjectId: '1.3.6.1.4.1.99999',
    });
    expect(count).toBe(0);
  });

  it('não herda sobre binding exact existente', async () => {
    // Device destino já tem binding exact para cpu_usage
    const prisma = {
      deviceMetricBinding: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          if ((where.deviceId as Record<string, unknown>)?.not === 'd-new') {
            // Donors
            return [{
              metricKey: 'cpu_usage', oid: '1.2.3.4', confidenceLabel: 'exact',
              broken: false, firmwareFamily: '5.13', updatedAt: new Date(),
              memberOids: [], labels: {},
            }];
          }
          // Existentes do destino
          return [{ metricKey: 'cpu_usage', confidenceLabel: 'exact' }];
        },
        upsert: jest.fn(),
      },
    };
    const svc = new SnmpMetricService(prisma as never);
    await svc.inheritBindingsFromSameModel({
      tenantId: 't1', deviceId: 'd-new', sysObjectId: '1.3.6.1.4.1.99999',
      firmwareFamily: '5.13',
    });
    expect(prisma.deviceMetricBinding.upsert).not.toHaveBeenCalled();
  });

  it('não herda quando firmware family é incompatível', async () => {
    const prisma = {
      deviceMetricBinding: {
        findMany: async ({ where }: { where: Record<string, unknown> }) => {
          if ((where.deviceId as Record<string, unknown>)?.not === 'd-new') {
            return [{
              metricKey: 'uptime', oid: '1.3.6.1.2.1.1.3.0', confidenceLabel: 'exact',
              broken: false, firmwareFamily: '5.14', updatedAt: new Date(),
              memberOids: [], labels: {},
            }];
          }
          return [];
        },
        upsert: jest.fn(),
      },
    };
    const svc = new SnmpMetricService(prisma as never);
    const count = await svc.inheritBindingsFromSameModel({
      tenantId: 't1', deviceId: 'd-new', sysObjectId: '1.3.6.1.4.1.49617',
      firmwareFamily: '5.13', // diferente do donor
    });
    expect(count).toBe(0);
    expect(prisma.deviceMetricBinding.upsert).not.toHaveBeenCalled();
  });
});

// ─── buildProposals ───────────────────────────────────────────────────────────

describe('SnmpMetricService.buildProposals', () => {
  const EMPTY_RESULT = {
    reachable: true, sysObjectId: null, oidResults: {}, walk: [],
  };

  it('retorna até 12 propostas', () => {
    const svc = new SnmpMetricService({} as never);
    const proposals = svc.buildProposals({
      tenantId: 't1', deviceId: 'd1', sysObjectId: null,
      diagnoseResult: EMPTY_RESULT,
      catalogCandidates: CANONICAL_METRICS_PRIORITY.slice(0, 8).map((k) => ({
        metricKey: k, oid: `1.3.6.1.2.1.99.${k}`, scale: 1, unit: '', profileLabel: 'test',
      })),
      discovered: [],
    });
    expect(proposals.length).toBeLessThanOrEqual(12);
  });

  it('inclui reachability como proposta sintética sem OID', () => {
    const svc = new SnmpMetricService({} as never);
    const proposals = svc.buildProposals({
      tenantId: 't1', deviceId: 'd1', sysObjectId: null,
      diagnoseResult: EMPTY_RESULT,
      catalogCandidates: [],
      discovered: [],
    });
    const reachability = proposals.find((p) => p.metricKey === 'reachability');
    expect(reachability).toBeDefined();
    expect(reachability?.selectedOid).toBeNull();
    expect(reachability?.confidence).toBe('exact');
  });

  it('shape correto: friendlyName, unit, exampleValue, candidates, selectedOid', () => {
    const svc = new SnmpMetricService({} as never);
    const proposals = svc.buildProposals({
      tenantId: 't1', deviceId: 'd1', sysObjectId: null,
      diagnoseResult: {
        reachable: true, sysObjectId: null,
        oidResults: { '1.3.6.1.2.1.1.3.0': { responded: true, value: 360000, raw: '360000' } },
        walk: [],
      },
      catalogCandidates: [{
        metricKey: 'uptime', oid: '1.3.6.1.2.1.1.3.0', scale: 0.01, unit: 's', profileLabel: 'MIB-II',
      }],
      discovered: [],
    });
    const uptime = proposals.find((p) => p.metricKey === 'uptime');
    expect(uptime).toBeDefined();
    expect(typeof uptime!.friendlyName).toBe('string');
    expect(uptime!.selectedOid).toBe('1.3.6.1.2.1.1.3.0');
    expect(uptime!.confidence).toBe('exact');
    expect(Array.isArray(uptime!.candidates)).toBe(true);
    expect(uptime!.candidates[0].oid).toBe('1.3.6.1.2.1.1.3.0');
    expect(uptime!.candidates[0].isDefault).toBe(false);
  });

  it('canonicalMetrics do gateway tem prioridade', () => {
    const svc = new SnmpMetricService({} as never);
    const gatewayOid = '1.3.6.1.4.1.49617.1.1.4.0';
    const catalogOid = '1.3.6.1.2.1.25.3.3.1.2.1';
    const proposals = svc.buildProposals({
      tenantId: 't1', deviceId: 'd1', sysObjectId: null,
      diagnoseResult: {
        reachable: true, sysObjectId: null,
        oidResults: { [gatewayOid]: { responded: true, value: 45, raw: '45' } },
        walk: [],
        canonicalMetrics: [{
          metricKey: 'cpu_usage', oid: gatewayOid, value: 45,
          unit: '%', scale: 1, verified: true,
        }],
      },
      catalogCandidates: [{
        metricKey: 'cpu', oid: catalogOid, scale: 1, unit: '%', profileLabel: 'HOST-RES',
      }],
      discovered: [],
    });
    const cpu = proposals.find((p) => p.metricKey === 'cpu_usage');
    expect(cpu?.selectedOid).toBe(gatewayOid);
    expect(cpu?.confidence).toBe('exact');
  });

  it('mantém binding sem resposta como quebrado e deixa candidato válido como sugestão', () => {
    const svc = new SnmpMetricService({} as never);
    const oldOid = '1.3.6.1.4.1.49617.1.1.99.0';
    const validOid = '1.3.6.1.4.1.49617.1.1.4.0';
    const proposals = svc.buildProposals({
      tenantId: 't1',
      deviceId: 'd1',
      sysObjectId: '1.3.6.1.4.1.49617',
      diagnoseResult: {
        reachable: true,
        sysObjectId: '1.3.6.1.4.1.49617',
        oidResults: {
          [oldOid]: { responded: false, value: null, raw: null },
          [validOid]: { responded: true, value: 92.19, raw: '92.19' },
        },
        walk: [],
      },
      catalogCandidates: [
        { metricKey: 'temperature', oid: oldOid, scale: 1, unit: '°C', profileLabel: 'iDFLEX' },
        { metricKey: 'temperature', oid: validOid, scale: 1, unit: '°C', profileLabel: 'iDFLEX' },
      ],
      discovered: [],
      currentOidsByMetric: { cpu_temperature: oldOid },
    });
    const temperature = proposals.find((p) => p.metricKey === 'cpu_temperature');
    expect(temperature?.state).toBe('broken');
    expect(temperature?.activeOid).toBe(oldOid);
    expect(temperature?.suggestedOid).toBe(validOid);
    expect(temperature?.candidates.find((c) => c.oid === validOid)?.exampleValue).toBe('92.19');
  });

  it('reconhece binding canônico já monitorado como fonte ativa', () => {
    const svc = new SnmpMetricService({} as never);
    const activeOid = '1.3.6.1.4.1.49617.1.1.7.0';
    const proposals = svc.buildProposals({
      tenantId: 't1',
      deviceId: 'd1',
      sysObjectId: '1.3.6.1.4.1.49617',
      diagnoseResult: {
        reachable: true,
        sysObjectId: '1.3.6.1.4.1.49617',
        oidResults: {
          [activeOid]: { responded: true, value: 42, raw: '42' },
        },
        walk: [],
      },
      catalogCandidates: [
        {
          metricKey: 'temperature',
          oid: activeOid,
          scale: 1,
          unit: '°C',
          profileLabel: 'Temperatura',
        },
      ],
      discovered: [],
      currentOidsByMetric: { cpu_temperature: activeOid },
    });

    const temperature = proposals.find((p) => p.metricKey === 'cpu_temperature');
    expect(temperature?.state).toBe('active');
    expect(temperature?.activeOid).toBe(activeOid);
    expect(temperature?.selectedOid).toBe(activeOid);
    expect(temperature?.candidates.find((c) => c.oid === activeOid)?.isActive).toBe(true);
  });

  it('bindings herdados preenchem lacunas com confidence=inferred', () => {
    const svc = new SnmpMetricService({} as never);
    const proposals = svc.buildProposals({
      tenantId: 't1', deviceId: 'd1', sysObjectId: null,
      diagnoseResult: EMPTY_RESULT,
      catalogCandidates: [],
      discovered: [],
      existingBindings: [
        { metricKey: 'net_in_rate', oid: '1.3.6.1.2.1.2.2.1.10.1', confidenceLabel: 'inferred' },
      ],
    });
    const netIn = proposals.find((p) => p.metricKey === 'net_in_rate');
    expect(netIn).toBeDefined();
    expect(netIn?.confidence).toBe('inferred');
  });
});
