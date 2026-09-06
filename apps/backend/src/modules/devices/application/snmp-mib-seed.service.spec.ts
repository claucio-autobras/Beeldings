/**
 * Specs do SnmpMibSeedService — bundle offline de MIBs padrão.
 *
 * Cobre:
 *   - Seed idempotente (não re-insere labels já presentes).
 *   - resolveOidName: match exato, prefixo mais longo, "Unknown OID" p/ desconhecidos.
 *   - Bundle contém todas as 6 MIBs declaradas com pelo menos 5 entradas cada.
 *   - OIDs críticos de SNMPv2-MIB, IF-MIB, HOST-RESOURCES-MIB, UCD-SNMP-MIB,
 *     ENTITY-MIB e CONTROLID-MIB estão presentes.
 */

import {
  SnmpMibSeedService,
  OFFLINE_MIB_BUNDLE,
  OFFLINE_MIB_LABELS,
} from './snmp-mib-seed.service.js';

// ─── Mock do PrismaService ────────────────────────────────────────────────────

function makePrisma(existingLabels: string[] = []) {
  const created: unknown[] = [];
  return {
    snmpMib: {
      findMany: async () => existingLabels.map((label) => ({ label })),
      create: async (args: unknown) => { created.push(args); return {}; },
    },
    _created: created,
  };
}

// ─── Bundle coverage ──────────────────────────────────────────────────────────

describe('OFFLINE_MIB_BUNDLE — cobertura de MIBs', () => {
  it('contém todas as 6 MIBs declaradas', () => {
    for (const label of OFFLINE_MIB_LABELS) {
      const entries = OFFLINE_MIB_BUNDLE[label];
      expect(entries).toBeDefined();
      expect(entries.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('SNMPv2-MIB contém sysDescr, sysUpTime, sysName', () => {
    const entries = OFFLINE_MIB_BUNDLE['SNMPv2-MIB'];
    const oids = entries.map((e) => e.oid);
    expect(oids).toContain('1.3.6.1.2.1.1.1.0'); // sysDescr
    expect(oids).toContain('1.3.6.1.2.1.1.3.0'); // sysUpTime
    expect(oids).toContain('1.3.6.1.2.1.1.5.0'); // sysName
    const sysUpTime = entries.find((e) => e.oid === '1.3.6.1.2.1.1.3.0')!;
    expect(sysUpTime.name).toBe('sysUpTime');
  });

  it('IF-MIB contém ifDescr, ifOperStatus, ifInDiscards, ifOutOctets', () => {
    const entries = OFFLINE_MIB_BUNDLE['IF-MIB'];
    const byOid = new Map(entries.map((e) => [e.oid, e]));
    expect(byOid.get('1.3.6.1.2.1.2.2.1.2')?.name).toBe('ifDescr');
    expect(byOid.get('1.3.6.1.2.1.2.2.1.8')?.name).toBe('ifOperStatus');
    expect(byOid.get('1.3.6.1.2.1.2.2.1.13')?.name).toBe('ifInDiscards');
    expect(byOid.get('1.3.6.1.2.1.2.2.1.16')?.name).toBe('ifOutOctets');
  });

  it('HOST-RESOURCES-MIB contém hrMemorySize, hrProcessorLoad', () => {
    const entries = OFFLINE_MIB_BUNDLE['HOST-RESOURCES-MIB'];
    const byOid = new Map(entries.map((e) => [e.oid, e]));
    expect(byOid.get('1.3.6.1.2.1.25.2.2.0')?.name).toBe('hrMemorySize');
    expect(byOid.get('1.3.6.1.2.1.25.3.3.1.2')?.name).toBe('hrProcessorLoad');
  });

  it('UCD-SNMP-MIB contém memAvailReal e lmTempSensorsValue', () => {
    const entries = OFFLINE_MIB_BUNDLE['UCD-SNMP-MIB'];
    const byOid = new Map(entries.map((e) => [e.oid, e]));
    expect(byOid.get('1.3.6.1.4.1.2021.4.6.0')?.name).toBe('memAvailReal');
    expect(byOid.get('1.3.6.1.4.1.2021.13.16.2.1.3')?.name).toBe('lmTempSensorsValue');
  });

  it('ENTITY-MIB contém entPhysicalSerialNum e entPhysicalFirmwareRev', () => {
    const entries = OFFLINE_MIB_BUNDLE['ENTITY-MIB'];
    const byOid = new Map(entries.map((e) => [e.oid, e]));
    expect(byOid.get('1.3.6.1.2.1.47.1.1.1.1.11')?.name).toBe('entPhysicalSerialNum');
    expect(byOid.get('1.3.6.1.2.1.47.1.1.1.1.9')?.name).toBe('entPhysicalFirmwareRev');
  });

  it('CONTROLID-MIB contém cidFirmwareVersion, cidCpuUsage, cidCpuTemperature', () => {
    const entries = OFFLINE_MIB_BUNDLE['CONTROLID-MIB'];
    const byOid = new Map(entries.map((e) => [e.oid, e]));
    expect(byOid.get('1.3.6.1.4.1.49617.1.1.1.0')?.name).toBe('cidFirmwareVersion');
    expect(byOid.get('1.3.6.1.4.1.49617.1.1.4.0')?.name).toBe('cidCpuUsage');
    expect(byOid.get('1.3.6.1.4.1.49617.1.1.5.0')?.name).toBe('cidCpuTemperature');
  });
});

// ─── Seed idempotência ────────────────────────────────────────────────────────

describe('SnmpMibSeedService.seedOfflineMibs', () => {
  it('insere todas as 6 MIBs quando banco está vazio', async () => {
    const prisma = makePrisma([]);
    const svc = new SnmpMibSeedService(prisma as never);
    await svc.seedOfflineMibs();
    expect(prisma._created).toHaveLength(OFFLINE_MIB_LABELS.length);
  });

  it('não re-insere MIBs já presentes', async () => {
    const prisma = makePrisma([...OFFLINE_MIB_LABELS]);
    const svc = new SnmpMibSeedService(prisma as never);
    await svc.seedOfflineMibs();
    expect(prisma._created).toHaveLength(0);
  });

  it('insere apenas as MIBs ausentes', async () => {
    const prisma = makePrisma(['SNMPv2-MIB', 'IF-MIB']);
    const svc = new SnmpMibSeedService(prisma as never);
    await svc.seedOfflineMibs();
    expect(prisma._created).toHaveLength(OFFLINE_MIB_LABELS.length - 2);
    const labels = (prisma._created as Array<{ data: { label: string } }>).map((c) => c.data.label);
    expect(labels).not.toContain('SNMPv2-MIB');
    expect(labels).not.toContain('IF-MIB');
  });
});

// ─── resolveOidName ───────────────────────────────────────────────────────────

describe('SnmpMibSeedService.resolveOidName', () => {
  const svc = new SnmpMibSeedService({} as never);

  it('resolve match exato', () => {
    expect(svc.resolveOidName('1.3.6.1.2.1.1.1.0')).toBe('sysDescr');
    expect(svc.resolveOidName('1.3.6.1.4.1.49617.1.1.4.0')).toBe('cidCpuUsage');
    expect(svc.resolveOidName('1.3.6.1.2.1.25.2.2.0')).toBe('hrMemorySize');
  });

  it('resolve instância de tabela pelo prefixo mais longo', () => {
    // ifDescr.1 → "ifDescr.1"
    const name = svc.resolveOidName('1.3.6.1.2.1.2.2.1.2.1');
    expect(name).toBe('ifDescr.1');
  });

  it('retorna "Unknown OID {oid}" para OIDs desconhecidos (não modo avançado)', () => {
    const oid = '1.3.6.1.4.1.99999.99.1.0';
    expect(svc.resolveOidName(oid)).toBe(`Unknown OID ${oid}`);
    // Nunca retorna só o número cru.
    expect(svc.resolveOidName(oid)).not.toBe(oid);
  });

  it('retorna OID puro no modo avançado', () => {
    const oid = '1.3.6.1.4.1.99999.99.1.0';
    expect(svc.resolveOidName(oid, true)).toBe(oid);
  });
});
