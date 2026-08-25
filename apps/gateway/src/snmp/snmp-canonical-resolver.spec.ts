/**
 * Testes do resolver canônico de métricas SNMP (diagnóstico).
 *
 * Cobre:
 *   1.  Reachability derivada: selectedOid=null, confidence=exact, unit='%', value 0/100.
 *   1b. Reachable=false → reachability=0, outros null.
 *   2.  Uptime via GET sysUpTime (TimeTicks → s) — selectedOid=SYS_UPTIME_OID.
 *   3.  CPU via GET enterprise (Hikvision) — confidence=exact, selectedOid=OID.
 *   3b. CPU via Dahua.
 *   4.  CPU via hrProcessorLoad walk — confidence=inferred, memberOids, detail.
 *   5.  CPU via hrProcessorLoad GET escalar — confidence=inferred, memberOids.
 *   6.  Memória % via GET enterprise — confidence=exact.
 *   6b. Memória % Dahua.
 *   7.  Memória % via hrStorageTable — confidence=inferred, dependencyOids.
 *   8.  Memória total via Hikvision GET.
 *   8b. Memória total via UCD kB→MB.
 *   9.  Memória total via hrStorageTable.
 *  10.  Storage % via Hikvision GET.
 *  11.  Storage % via hrStorageTable — volumes individuais em detail, avg em value.
 *  12.  Net in/out — isCounter=true, counterType=counter32, selectedOid.
 *  13.  Net error rate — soma in+out, isCounter=true, memberOids.
 *  14.  Net discard rate — soma in+out.
 *  15.  Interface status.
 *  16.  OID desconhecido não altera métricas canônicas.
 *  17.  hrStorageType com leading dot normalizado.
 *  17b. hrStorageType simbólico ("hrStorageRam") normalizado.
 *  18.  classifyHrStorageTable — fallback descr.
 *  18b. Swap/virtual → isPhysicalRam=false; física → isPhysicalRam=true.
 *  19.  collapseHrProcessorLoad — 4 cores.
 *  19b. collapseHrProcessorLoad — sem entradas.
 *  20.  Physical RAM preferida sobre virtual/swap.
 *  21.  storage_used_percent preserva volumes individuais com labels.
 *  22.  net_in_rate isCounter metadata presente.
 *  23.  Temperatura UCD milli-°C → °C.
 *  24.  resolveMemoryFromHrStorage — seleciona maior physical RAM.
 *  25.  resolveStorageFromHrStorage — dependencyOids corretos.
 */

import {
  resolveCanonicalMetrics,
  collapseHrProcessorLoad,
  classifyHrStorageTable,
  resolveMemoryFromHrStorage,
  resolveStorageFromHrStorage,
  selectPrimaryRamEntry,
  type OidReadResult,
  type DiagWalkSection,
} from './snmp-canonical-resolver';

import {
  SYS_UPTIME_OID,
  HIK_CPU_OID,
  HIK_MEM_USED_OID,
  HIK_MEM_TOTAL_OID,
  HIK_STORAGE_OID,
  DAHUA_CPU_OID,
  DAHUA_MEM_OID,
  UCD_MEM_TOTAL_OID,
  UCD_TEMP_OID,
  HR_PROCESSOR_LOAD_PREFIX,
  HR_PROCESSOR_LOAD_1,
  HR_STORAGE_TYPE_PREFIX,
  HR_STORAGE_DESCR_PREFIX,
  HR_STORAGE_ALLOC_PREFIX,
  HR_STORAGE_SIZE_PREFIX,
  HR_STORAGE_USED_PREFIX,
  STORAGE_TYPE_RAM,
  STORAGE_TYPE_VIRTUAL_MEMORY,
  STORAGE_TYPE_FIXED_DISK,
  IF_IN_OCTETS_PREFIX,
  IF_OUT_OCTETS_PREFIX,
  IF_IN_ERRORS_PREFIX,
  IF_OUT_ERRORS_PREFIX,
  IF_IN_DISCARDS_PREFIX,
  IF_OUT_DISCARDS_PREFIX,
  IF_OPER_STATUS_PREFIX,
} from './snmp-canonical-catalog';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOidResult(oid: string, value: number | null): OidReadResult {
  return { oid, responded: value !== null, value, raw: value !== null ? String(value) : null };
}

function makeOidResults(pairs: Array<[string, number | null]>): Record<string, OidReadResult> {
  return Object.fromEntries(pairs.map(([oid, v]) => [oid, makeOidResult(oid, v)]));
}

function makeWalkEntry(oid: string, numeric: number | null, value?: string) {
  return {
    oid,
    type: 'Integer',
    value: value ?? (numeric !== null ? String(numeric) : ''),
    numeric,
    index: (() => {
      const last = oid.slice(oid.lastIndexOf('.') + 1);
      const n = Number(last);
      return n !== 0 && Number.isFinite(n) ? n : null;
    })(),
  };
}

function makeWalkSection(root: string, entries: ReturnType<typeof makeWalkEntry>[]): DiagWalkSection {
  return {
    root,
    label: root,
    entries,
    truncated: false,
    found: entries.length,
    discarded: {},
    error: null,
    durationMs: 100,
  };
}

const EMPTY_WALK: DiagWalkSection[] = [];
const EMPTY_OIDS: Record<string, OidReadResult> = {};

// ─── Testes ───────────────────────────────────────────────────────────────────

describe('resolveCanonicalMetrics', () => {

  it('rebaixa temperatura impossível para sem leitura', () => {
    const metrics = resolveCanonicalMetrics(true, makeOidResults([[UCD_TEMP_OID, 85_827_000]]), EMPTY_WALK);
    expect(metrics['cpu_temperature'].value).toBeNull();
  });

  // ── 1. Reachability ─────────────────────────────────────────────────────────

  it('1. reachable=true → reachability=100, selectedOid=null, unit=%', () => {
    const metrics = resolveCanonicalMetrics(true, EMPTY_OIDS, EMPTY_WALK);
    const r = metrics['reachability'];
    expect(r.value).toBe(100);
    expect(r.selectedOid).toBeNull();
    expect(r.confidence).toBe('exact');
    expect(r.unit).toBe('%');
    expect(r.source).toContain('sysUpTime');
  });

  it('1b. reachable=false → reachability=0, uptime=null', () => {
    const metrics = resolveCanonicalMetrics(false, EMPTY_OIDS, EMPTY_WALK);
    expect(metrics['reachability'].value).toBe(0);
    expect(metrics['reachability'].unit).toBe('%');
    expect(metrics['uptime'].value).toBeNull();
  });

  // ── 2. Uptime ────────────────────────────────────────────────────────────────

  it('2. sysUpTime GET (TimeTicks ÷100 → s) — selectedOid=SYS_UPTIME_OID, confidence=exact', () => {
    // 100000 ticks = 1000 s
    const oidResults = makeOidResults([[SYS_UPTIME_OID, 100_000]]);
    const metrics = resolveCanonicalMetrics(true, oidResults, EMPTY_WALK);
    const r = metrics['uptime'];
    expect(r.value).toBeCloseTo(1000);
    expect(r.selectedOid).toBe(SYS_UPTIME_OID);
    expect(r.confidence).toBe('exact');
    expect(r.source).toContain('sysUpTime');
  });

  // ── 3. CPU enterprise ────────────────────────────────────────────────────────

  it('3. cpu_usage — Hikvision enterprise GET → confidence=exact, selectedOid=HIK_CPU_OID', () => {
    const oidResults = makeOidResults([
      [HIK_CPU_OID, 72],
      [HR_PROCESSOR_LOAD_1, 50],
    ]);
    const metrics = resolveCanonicalMetrics(true, oidResults, EMPTY_WALK);
    const r = metrics['cpu_usage'];
    expect(r.value).toBe(72);
    expect(r.selectedOid).toBe(HIK_CPU_OID);
    expect(r.confidence).toBe('exact');
    expect(r.source).toContain('Hikvision');
  });

  it('3b. cpu_usage — Dahua enterprise GET', () => {
    const oidResults = makeOidResults([[DAHUA_CPU_OID, 45]]);
    const metrics = resolveCanonicalMetrics(true, oidResults, EMPTY_WALK);
    expect(metrics['cpu_usage'].value).toBe(45);
    expect(metrics['cpu_usage'].selectedOid).toBe(DAHUA_CPU_OID);
    expect(metrics['cpu_usage'].source).toContain('Dahua');
  });

  // ── 4. CPU via hrProcessorLoad walk ──────────────────────────────────────────

  it('4. cpu_usage — hrProcessorLoad walk: avg de múltiplos cores, confidence=inferred', () => {
    const walk = [
      makeWalkSection(HR_PROCESSOR_LOAD_PREFIX, [
        makeWalkEntry(`${HR_PROCESSOR_LOAD_PREFIX}.1`, 40),
        makeWalkEntry(`${HR_PROCESSOR_LOAD_PREFIX}.2`, 60),
        makeWalkEntry(`${HR_PROCESSOR_LOAD_PREFIX}.3`, 80),
      ]),
    ];
    const metrics = resolveCanonicalMetrics(true, EMPTY_OIDS, walk);
    const r = metrics['cpu_usage'];
    expect(r.value).toBeCloseTo(60); // avg(40,60,80)
    expect(r.confidence).toBe('inferred');
    expect(r.selectedOid).toBeNull();
    expect(r.maxValue).toBe(80);
    expect(r.memberOids).toContain(`${HR_PROCESSOR_LOAD_PREFIX}.1`);
    expect(r.memberOids).toHaveLength(3);
    expect(r.detail).toHaveLength(3);
    expect(r.dependencyOids).toHaveLength(3);
  });

  // ── 5. CPU via hrProcessorLoad GET escalar ────────────────────────────────────

  it('5. cpu_usage — hrProcessorLoad GET índice .1 (sem walk)', () => {
    const oidResults = makeOidResults([[HR_PROCESSOR_LOAD_1, 55]]);
    const metrics = resolveCanonicalMetrics(true, oidResults, EMPTY_WALK);
    const r = metrics['cpu_usage'];
    expect(r.value).toBeCloseTo(55);
    expect(r.confidence).toBe('inferred');
    expect(r.memberOids).toContain(HR_PROCESSOR_LOAD_1);
    expect(r.source).toContain('hrProcessorLoad');
  });

  // ── 6. Memória % enterprise ────────────────────────────────────────────────

  it('6. memory_used_percent — Hikvision enterprise GET — confidence=exact', () => {
    const oidResults = makeOidResults([[HIK_MEM_USED_OID, 68]]);
    const metrics = resolveCanonicalMetrics(true, oidResults, EMPTY_WALK);
    const r = metrics['memory_used_percent'];
    expect(r.value).toBe(68);
    expect(r.selectedOid).toBe(HIK_MEM_USED_OID);
    expect(r.confidence).toBe('exact');
    expect(r.source).toContain('Hikvision');
  });

  it('6b. memory_used_percent — Dahua enterprise GET', () => {
    const oidResults = makeOidResults([[DAHUA_MEM_OID, 55]]);
    const metrics = resolveCanonicalMetrics(true, oidResults, EMPTY_WALK);
    expect(metrics['memory_used_percent'].value).toBe(55);
    expect(metrics['memory_used_percent'].source).toContain('Dahua');
  });

  // ── 7. Memória % via hrStorageTable ───────────────────────────────────────

  it('7. memory_used_percent — hrStorageTable RAM (used/size * 100), confidence=inferred, dependencyOids', () => {
    // index=1: type=RAM, allocationUnits=1024, size=1024, used=512 (50%)
    const walk = [
      makeWalkSection(HR_STORAGE_TYPE_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_TYPE_PREFIX}.1`, null, STORAGE_TYPE_RAM),
      ]),
      makeWalkSection(HR_STORAGE_ALLOC_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_ALLOC_PREFIX}.1`, 1024),
      ]),
      makeWalkSection(HR_STORAGE_SIZE_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_SIZE_PREFIX}.1`, 1024),
      ]),
      makeWalkSection(HR_STORAGE_USED_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_USED_PREFIX}.1`, 512),
      ]),
    ];
    const metrics = resolveCanonicalMetrics(true, EMPTY_OIDS, walk);
    const r = metrics['memory_used_percent'];
    expect(r.value).toBeCloseTo(50);
    expect(r.confidence).toBe('inferred');
    expect(r.selectedOid).toBeNull();
    expect(r.dependencyOids).toContain(`${HR_STORAGE_SIZE_PREFIX}.1`);
    expect(r.dependencyOids).toContain(`${HR_STORAGE_USED_PREFIX}.1`);
    expect(r.source).toContain('hrStorageTable');
  });

  // ── 8. Memória total enterprise ────────────────────────────────────────────

  it('8. ram_total — Hikvision enterprise GET (MB), confidence=exact', () => {
    const oidResults = makeOidResults([[HIK_MEM_TOTAL_OID, 512]]);
    const metrics = resolveCanonicalMetrics(true, oidResults, EMPTY_WALK);
    const r = metrics['ram_total'];
    expect(r.value).toBe(512 * 1024 * 1024);
    expect(r.selectedOid).toBe(HIK_MEM_TOTAL_OID);
    expect(r.confidence).toBe('exact');
  });

  it('8b. ram_total — UCD kB → bytes', () => {
    const oidResults = makeOidResults([[UCD_MEM_TOTAL_OID, 524288]]); // 512 MB em kB
    const metrics = resolveCanonicalMetrics(true, oidResults, EMPTY_WALK);
    expect(metrics['ram_total'].value).toBeCloseTo(524288 * 1024);
    expect(metrics['ram_total'].selectedOid).toBe(UCD_MEM_TOTAL_OID);
  });

  // ── 9. Memória total via hrStorageTable ────────────────────────────────────

  it('9. ram_total — hrStorageTable (size * allocationUnits in bytes)', () => {
    // size=512, allocationUnits=2097152 (2MB) → total = 512*2MB = 1024MB
    const walk = [
      makeWalkSection(HR_STORAGE_TYPE_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_TYPE_PREFIX}.1`, null, STORAGE_TYPE_RAM),
      ]),
      makeWalkSection(HR_STORAGE_ALLOC_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_ALLOC_PREFIX}.1`, 2097152),
      ]),
      makeWalkSection(HR_STORAGE_SIZE_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_SIZE_PREFIX}.1`, 512),
      ]),
      makeWalkSection(HR_STORAGE_USED_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_USED_PREFIX}.1`, 256),
      ]),
    ];
    const metrics = resolveCanonicalMetrics(true, EMPTY_OIDS, walk);
    expect(metrics['ram_total'].value).toBeCloseTo(512 * 2097152);
    expect(metrics['ram_total'].confidence).toBe('inferred');
  });

  // ── 10. Storage % enterprise ───────────────────────────────────────────────

  it('10. storage_used_percent — Hikvision enterprise GET, confidence=exact', () => {
    const oidResults = makeOidResults([[HIK_STORAGE_OID, 85]]);
    const metrics = resolveCanonicalMetrics(true, oidResults, EMPTY_WALK);
    expect(metrics['storage_used_percent'].value).toBe(85);
    expect(metrics['storage_used_percent'].confidence).toBe('exact');
    expect(metrics['storage_used_percent'].selectedOid).toBe(HIK_STORAGE_OID);
  });

  // ── 11. Storage % via hrStorageTable (volumes individuais) ─────────────────

  it('11. storage_used_percent — hrStorageTable preserva volumes com labels individuais', () => {
    // index=1: volume, descr='HDD-A', size=1000, used=700 (70%)
    // index=2: volume, descr='SSD-B', size=2000, used=1000 (50%)
    // avg = 60%; volumes preservados individualmente
    const walk = [
      makeWalkSection(HR_STORAGE_TYPE_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_TYPE_PREFIX}.1`, null, STORAGE_TYPE_FIXED_DISK),
        makeWalkEntry(`${HR_STORAGE_TYPE_PREFIX}.2`, null, STORAGE_TYPE_FIXED_DISK),
      ]),
      makeWalkSection(HR_STORAGE_DESCR_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_DESCR_PREFIX}.1`, null, 'HDD-A'),
        makeWalkEntry(`${HR_STORAGE_DESCR_PREFIX}.2`, null, 'SSD-B'),
      ]),
      makeWalkSection(HR_STORAGE_ALLOC_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_ALLOC_PREFIX}.1`, 512),
        makeWalkEntry(`${HR_STORAGE_ALLOC_PREFIX}.2`, 512),
      ]),
      makeWalkSection(HR_STORAGE_SIZE_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_SIZE_PREFIX}.1`, 1000),
        makeWalkEntry(`${HR_STORAGE_SIZE_PREFIX}.2`, 2000),
      ]),
      makeWalkSection(HR_STORAGE_USED_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_USED_PREFIX}.1`, 700),
        makeWalkEntry(`${HR_STORAGE_USED_PREFIX}.2`, 1000),
      ]),
    ];
    const metrics = resolveCanonicalMetrics(true, EMPTY_OIDS, walk);
    const r = metrics['storage_used_percent'];
    expect(r.value).toBeCloseTo(60);
    expect(r.confidence).toBe('inferred');
    const detail = r.detail as any[];
    expect(detail).toHaveLength(2);
    expect(detail[0].usedPercent).toBeCloseTo(70);
    expect(detail[0].descr).toBe('HDD-A');
    expect(detail[1].usedPercent).toBeCloseTo(50);
    expect(detail[1].descr).toBe('SSD-B');
    // dependencyOids deve incluir colunas de ambos os volumes
    expect(r.dependencyOids?.length).toBeGreaterThanOrEqual(6);
  });

  // ── 12. Net in/out rate — Counter32 semantics ─────────────────────────────

  it('12a. net_in_rate — ifInOctets index .1, isCounter=true, counterType=counter32', () => {
    const oidResults = makeOidResults([[`${IF_IN_OCTETS_PREFIX}.1`, 5_000_000]]);
    const metrics = resolveCanonicalMetrics(true, oidResults, EMPTY_WALK);
    const r = metrics['net_in_rate'];
    expect(r.value).toBe(5_000_000);
    expect(r.isCounter).toBe(true);
    expect(r.counterType).toBe('counter32');
    expect(r.selectedOid).toBe(`${IF_IN_OCTETS_PREFIX}.1`);
    expect(r.confidence).toBe('exact');
    expect(r.rawUnit).toBe('octets');
  });

  it('12b. net_out_rate — ifOutOctets index .1, isCounter=true', () => {
    const oidResults = makeOidResults([[`${IF_OUT_OCTETS_PREFIX}.1`, 1_000_000]]);
    const metrics = resolveCanonicalMetrics(true, oidResults, EMPTY_WALK);
    const r = metrics['net_out_rate'];
    expect(r.value).toBe(1_000_000);
    expect(r.isCounter).toBe(true);
    expect(r.counterType).toBe('counter32');
  });

  it('12c. fallback por walk fixa somente a primeira interface vencedora', () => {
    const walk = [
      makeWalkSection(IF_IN_OCTETS_PREFIX, [
        makeWalkEntry(`${IF_IN_OCTETS_PREFIX}.2`, 2_000),
        makeWalkEntry(`${IF_IN_OCTETS_PREFIX}.3`, 3_000),
      ]),
    ];
    const metrics = resolveCanonicalMetrics(true, EMPTY_OIDS, walk);
    const r = metrics['net_in_rate'];
    expect(r.value).toBe(2_000);
    expect(r.selectedOid).toBe(`${IF_IN_OCTETS_PREFIX}.2`);
    expect(r.memberOids ?? []).toEqual([]);
    expect(r.confidence).toBe('exact');
  });

  // ── 13. Net error rate — soma in+out, Counter32 ───────────────────────────

  it('13. net_error_rate — soma ifInErrors.1 + ifOutErrors.1, isCounter=true, memberOids', () => {
    const oidResults = makeOidResults([
      [`${IF_IN_ERRORS_PREFIX}.1`, 10],
      [`${IF_OUT_ERRORS_PREFIX}.1`, 5],
    ]);
    const metrics = resolveCanonicalMetrics(true, oidResults, EMPTY_WALK);
    const r = metrics['net_error_rate'];
    expect(r.value).toBe(15);
    expect(r.isCounter).toBe(true);
    expect(r.counterType).toBe('counter32');
    expect(r.memberOids).toContain(`${IF_IN_ERRORS_PREFIX}.1`);
    expect(r.memberOids).toContain(`${IF_OUT_ERRORS_PREFIX}.1`);
    expect(r.confidence).toBe('inferred');
    expect(r.source).toContain('ifInErrors');
  });

  it('13b. net_error_rate — só in errors disponível (out=null)', () => {
    const oidResults = makeOidResults([[`${IF_IN_ERRORS_PREFIX}.1`, 10]]);
    const metrics = resolveCanonicalMetrics(true, oidResults, EMPTY_WALK);
    expect(metrics['net_error_rate'].value).toBe(10);
    expect(metrics['net_error_rate'].isCounter).toBe(true);
  });

  it('13c. fallback walk sem índice .1 persiste contadores in+out de todos os índices', () => {
    const walk = [
      makeWalkSection(IF_IN_ERRORS_PREFIX, [
        makeWalkEntry(`${IF_IN_ERRORS_PREFIX}.2`, 10),
        makeWalkEntry(`${IF_IN_ERRORS_PREFIX}.3`, 20),
      ]),
      makeWalkSection(IF_OUT_ERRORS_PREFIX, [
        makeWalkEntry(`${IF_OUT_ERRORS_PREFIX}.2`, 3),
        makeWalkEntry(`${IF_OUT_ERRORS_PREFIX}.3`, 4),
      ]),
    ];
    const r = resolveCanonicalMetrics(true, EMPTY_OIDS, walk)['net_error_rate'];
    expect(r.value).toBe(37);
    expect(r.memberOids).toEqual([
      `${IF_IN_ERRORS_PREFIX}.2`,
      `${IF_IN_ERRORS_PREFIX}.3`,
      `${IF_OUT_ERRORS_PREFIX}.2`,
      `${IF_OUT_ERRORS_PREFIX}.3`,
    ]);
    expect(r.source).toContain('ifInErrors+ifOutErrors');
  });

  // ── 14. Net discard rate ──────────────────────────────────────────────────

  it('14. net_discard_rate — soma ifInDiscards.1 + ifOutDiscards.1, isCounter=true', () => {
    const oidResults = makeOidResults([
      [`${IF_IN_DISCARDS_PREFIX}.1`, 3],
      [`${IF_OUT_DISCARDS_PREFIX}.1`, 7],
    ]);
    const metrics = resolveCanonicalMetrics(true, oidResults, EMPTY_WALK);
    const r = metrics['net_discard_rate'];
    expect(r.value).toBe(10);
    expect(r.isCounter).toBe(true);
    expect(r.counterType).toBe('counter32');
    expect(r.memberOids).toHaveLength(2);
  });

  // ── 15. Interface status ────────────────────────────────────────────────────

  it('15a. interface_status — ifOperStatus.1 = 1 (up)', () => {
    const oidResults = makeOidResults([[`${IF_OPER_STATUS_PREFIX}.1`, 1]]);
    const metrics = resolveCanonicalMetrics(true, oidResults, EMPTY_WALK);
    expect(metrics['interface_status'].value).toBe(1);
    expect(metrics['interface_status'].selectedOid).toBe(`${IF_OPER_STATUS_PREFIX}.1`);
  });

  it('15b. interface_status — ifOperStatus.1 = 2 (down) — valor bruto preservado', () => {
    const oidResults = makeOidResults([[`${IF_OPER_STATUS_PREFIX}.1`, 2]]);
    const metrics = resolveCanonicalMetrics(true, oidResults, EMPTY_WALK);
    expect(metrics['interface_status'].value).toBe(2);
  });

  // ── 16. OID desconhecido — não afeta métricas canônicas ───────────────────

  it('16. OID desconhecido não altera nenhuma métrica canônica', () => {
    const oidResults = makeOidResults([
      ['1.3.6.1.4.1.99999.1.1.0', 42], // OID arbitrário
    ]);
    const metrics = resolveCanonicalMetrics(true, oidResults, EMPTY_WALK);
    expect(metrics['cpu_usage'].value).toBeNull();
    expect(metrics['memory_used_percent'].value).toBeNull();
  });

  // ── 17. hrStorageType com leading dot ────────────────────────────────────

  it('17. hrStorageType com leading dot normalizado (.1.3.6.1.2.1.25.2.1.2)', () => {
    const walk = [
      makeWalkSection(HR_STORAGE_TYPE_PREFIX, [
        // Leading dot — como alguns agentes retornam
        makeWalkEntry(`${HR_STORAGE_TYPE_PREFIX}.1`, null, `.${STORAGE_TYPE_RAM}`),
      ]),
      makeWalkSection(HR_STORAGE_SIZE_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_SIZE_PREFIX}.1`, 2048),
      ]),
      makeWalkSection(HR_STORAGE_USED_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_USED_PREFIX}.1`, 1024),
      ]),
    ];
    const entries = classifyHrStorageTable(walk, {});
    expect(entries[0].kind).toBe('ram');
    expect(entries[0].typeOid).toBe(STORAGE_TYPE_RAM); // sem leading dot
  });

  it('17b. hrStorageType simbólico "hrStorageRam" normalizado para OID numérico', () => {
    const walk = [
      makeWalkSection(HR_STORAGE_TYPE_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_TYPE_PREFIX}.1`, null, 'hrStorageRam'),
        makeWalkEntry(`${HR_STORAGE_TYPE_PREFIX}.2`, null, 'hrStorageVirtualMemory'),
        makeWalkEntry(`${HR_STORAGE_TYPE_PREFIX}.3`, null, 'hrStorageFixedDisk'),
      ]),
      makeWalkSection(HR_STORAGE_SIZE_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_SIZE_PREFIX}.1`, 4096),
        makeWalkEntry(`${HR_STORAGE_SIZE_PREFIX}.2`, 2048),
        makeWalkEntry(`${HR_STORAGE_SIZE_PREFIX}.3`, 8192),
      ]),
    ];
    const entries = classifyHrStorageTable(walk, {});
    expect(entries[0].kind).toBe('ram');
    expect(entries[0].isPhysicalRam).toBe(true);
    expect(entries[0].typeOid).toBe(STORAGE_TYPE_RAM);
    expect(entries[1].kind).toBe('ram');
    expect(entries[1].isPhysicalRam).toBe(false);
    expect(entries[1].typeOid).toBe(STORAGE_TYPE_VIRTUAL_MEMORY);
    expect(entries[2].kind).toBe('volume');
  });

  // ── 18. hrStorageTable — fallback por descr ────────────────────────────────

  it('18. classifyHrStorageTable — fallback descr: "Physical memory" → ram, "Hard Disk" → volume', () => {
    const walk = [
      makeWalkSection(HR_STORAGE_DESCR_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_DESCR_PREFIX}.1`, null, 'Physical memory'),
        makeWalkEntry(`${HR_STORAGE_DESCR_PREFIX}.2`, null, 'Hard Disk'),
      ]),
      makeWalkSection(HR_STORAGE_SIZE_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_SIZE_PREFIX}.1`, 2048),
        makeWalkEntry(`${HR_STORAGE_SIZE_PREFIX}.2`, 4096),
      ]),
    ];
    const entries = classifyHrStorageTable(walk, {});
    expect(entries[0].kind).toBe('ram');
    expect(entries[1].kind).toBe('volume');
  });

  it('18b. fallback descr "Virtual memory" → kind=ram, isPhysicalRam=false', () => {
    const walk = [
      makeWalkSection(HR_STORAGE_DESCR_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_DESCR_PREFIX}.1`, null, 'Virtual memory'),
      ]),
      makeWalkSection(HR_STORAGE_SIZE_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_SIZE_PREFIX}.1`, 1024),
      ]),
    ];
    const entries = classifyHrStorageTable(walk, {});
    expect(entries[0].kind).toBe('ram');
    expect(entries[0].isPhysicalRam).toBe(false);
  });

  // ── 19. collapseHrProcessorLoad ───────────────────────────────────────────

  it('19. collapseHrProcessorLoad — 4 cores, avg=50, max=80', () => {
    const walk = [
      makeWalkSection(HR_PROCESSOR_LOAD_PREFIX, [
        makeWalkEntry(`${HR_PROCESSOR_LOAD_PREFIX}.1`, 20),
        makeWalkEntry(`${HR_PROCESSOR_LOAD_PREFIX}.2`, 40),
        makeWalkEntry(`${HR_PROCESSOR_LOAD_PREFIX}.3`, 60),
        makeWalkEntry(`${HR_PROCESSOR_LOAD_PREFIX}.4`, 80),
      ]),
    ];
    const result = collapseHrProcessorLoad(walk, {});
    expect(result.avg).toBeCloseTo(50);
    expect(result.max).toBe(80);
    expect(result.memberOids).toHaveLength(4);
    expect(result.detail).toHaveLength(4);
  });

  it('19b. collapseHrProcessorLoad — sem entradas → avg=null', () => {
    const result = collapseHrProcessorLoad(EMPTY_WALK, {});
    expect(result.avg).toBeNull();
    expect(result.max).toBeNull();
    expect(result.memberOids).toHaveLength(0);
  });

  // ── 20. Physical RAM preferida sobre virtual/swap ─────────────────────────

  it('20. selectPrimaryRamEntry — prefere RAM física sobre virtual/swap', () => {
    const entries = [
      {
        index: 1, typeOid: STORAGE_TYPE_VIRTUAL_MEMORY, descr: 'Virtual memory',
        allocationUnits: 1024, size: 8192, used: 4096, kind: 'ram' as const,
        isPhysicalRam: false,
      },
      {
        index: 2, typeOid: STORAGE_TYPE_RAM, descr: 'Physical memory',
        allocationUnits: 1024, size: 4096, used: 2048, kind: 'ram' as const,
        isPhysicalRam: true,
      },
    ];
    // Virtual is larger but physical should be preferred
    const primary = selectPrimaryRamEntry(entries);
    expect(primary?.index).toBe(2);
    expect(primary?.isPhysicalRam).toBe(true);
  });

  it('20b. selectPrimaryRamEntry — sem física → usa virtual (maior)', () => {
    const entries = [
      {
        index: 1, typeOid: STORAGE_TYPE_VIRTUAL_MEMORY, descr: 'Swap',
        allocationUnits: 1024, size: 2048, used: 1024, kind: 'ram' as const,
        isPhysicalRam: false,
      },
      {
        index: 2, typeOid: STORAGE_TYPE_VIRTUAL_MEMORY, descr: 'Virtual',
        allocationUnits: 1024, size: 4096, used: 2048, kind: 'ram' as const,
        isPhysicalRam: false,
      },
    ];
    const primary = selectPrimaryRamEntry(entries);
    expect(primary?.index).toBe(2); // maior virtual
  });

  it('20c. memory_used_percent — physical RAM selecionada mesmo sendo menor que virtual', () => {
    const walk = [
      makeWalkSection(HR_STORAGE_TYPE_PREFIX, [
        // Virtual memory entry (maior) — não deve ser escolhida
        makeWalkEntry(`${HR_STORAGE_TYPE_PREFIX}.1`, null, STORAGE_TYPE_VIRTUAL_MEMORY),
        // Physical RAM (menor) — deve ser escolhida
        makeWalkEntry(`${HR_STORAGE_TYPE_PREFIX}.2`, null, STORAGE_TYPE_RAM),
      ]),
      makeWalkSection(HR_STORAGE_ALLOC_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_ALLOC_PREFIX}.1`, 1024),
        makeWalkEntry(`${HR_STORAGE_ALLOC_PREFIX}.2`, 1024),
      ]),
      makeWalkSection(HR_STORAGE_SIZE_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_SIZE_PREFIX}.1`, 8192), // virtual: maior
        makeWalkEntry(`${HR_STORAGE_SIZE_PREFIX}.2`, 2048), // physical: menor
      ]),
      makeWalkSection(HR_STORAGE_USED_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_USED_PREFIX}.1`, 4096), // virtual: 50%
        makeWalkEntry(`${HR_STORAGE_USED_PREFIX}.2`, 512),  // physical: 25%
      ]),
    ];
    const metrics = resolveCanonicalMetrics(true, EMPTY_OIDS, walk);
    // Deve usar physical (index=2): 512/2048 = 25%
    expect(metrics['memory_used_percent'].value).toBeCloseTo(25);
  });

  // ── 21. storage_used_percent preserva volumes individuais ─────────────────

  it('21. storage_used_percent — detail contém todos os volumes individualmente', () => {
    const walk = [
      makeWalkSection(HR_STORAGE_TYPE_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_TYPE_PREFIX}.3`, null, STORAGE_TYPE_FIXED_DISK),
        makeWalkEntry(`${HR_STORAGE_TYPE_PREFIX}.4`, null, STORAGE_TYPE_FIXED_DISK),
        makeWalkEntry(`${HR_STORAGE_TYPE_PREFIX}.5`, null, STORAGE_TYPE_FIXED_DISK),
      ]),
      makeWalkSection(HR_STORAGE_DESCR_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_DESCR_PREFIX}.3`, null, '/'),
        makeWalkEntry(`${HR_STORAGE_DESCR_PREFIX}.4`, null, '/boot'),
        makeWalkEntry(`${HR_STORAGE_DESCR_PREFIX}.5`, null, '/data'),
      ]),
      makeWalkSection(HR_STORAGE_ALLOC_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_ALLOC_PREFIX}.3`, 4096),
        makeWalkEntry(`${HR_STORAGE_ALLOC_PREFIX}.4`, 4096),
        makeWalkEntry(`${HR_STORAGE_ALLOC_PREFIX}.5`, 4096),
      ]),
      makeWalkSection(HR_STORAGE_SIZE_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_SIZE_PREFIX}.3`, 10000),
        makeWalkEntry(`${HR_STORAGE_SIZE_PREFIX}.4`, 2000),
        makeWalkEntry(`${HR_STORAGE_SIZE_PREFIX}.5`, 50000),
      ]),
      makeWalkSection(HR_STORAGE_USED_PREFIX, [
        makeWalkEntry(`${HR_STORAGE_USED_PREFIX}.3`, 8000),   // 80%
        makeWalkEntry(`${HR_STORAGE_USED_PREFIX}.4`, 1000),   // 50%
        makeWalkEntry(`${HR_STORAGE_USED_PREFIX}.5`, 25000),  // 50%
      ]),
    ];
    const metrics = resolveCanonicalMetrics(true, EMPTY_OIDS, walk);
    const detail = metrics['storage_used_percent'].detail as any[];
    expect(detail).toHaveLength(3);
    const root = detail.find((d: any) => d.descr === '/');
    expect(root?.usedPercent).toBeCloseTo(80);
    const boot = detail.find((d: any) => d.descr === '/boot');
    expect(boot?.usedPercent).toBeCloseTo(50);
  });

  // ── 22. isCounter metadata ────────────────────────────────────────────────

  it('22. net_in_rate catalog entry: isCounter=true, rawUnit=octets', () => {
    // Verifica que o catalog transmite corretamente isCounter/rawUnit para o resultado
    const oidResults = makeOidResults([[`${IF_IN_OCTETS_PREFIX}.1`, 999]]);
    const metrics = resolveCanonicalMetrics(true, oidResults, EMPTY_WALK);
    expect(metrics['net_in_rate'].isCounter).toBe(true);
    expect(metrics['net_in_rate'].rawUnit).toBe('octets');
    expect(metrics['net_out_rate'].isCounter).toBe(true);
    expect(metrics['net_error_rate'].isCounter).toBe(true);
    expect(metrics['net_discard_rate'].isCounter).toBe(true);
  });

  // ── 23. Temperatura ────────────────────────────────────────────────────────

  it('23. temperatura — UCD milli-°C → °C (÷1000)', () => {
    const oidResults = makeOidResults([[UCD_TEMP_OID, 45_000]]); // 45°C
    const metrics = resolveCanonicalMetrics(true, oidResults, EMPTY_WALK);
    expect(metrics['cpu_temperature'].value).toBeCloseTo(45);
    expect(metrics['cpu_temperature'].source).toContain('UCD');
  });

  // ── 24. resolveMemoryFromHrStorage — physical > virtual ───────────────────

  it('24. resolveMemoryFromHrStorage — seleciona entrada física maior (não virtual)', () => {
    const entries = [
      { index: 1, typeOid: STORAGE_TYPE_RAM,            descr: 'RAM',     allocationUnits: 1024, size: 2048, used: 1024, kind: 'ram' as const, isPhysicalRam: true  },
      { index: 2, typeOid: STORAGE_TYPE_VIRTUAL_MEMORY, descr: 'Virtual', allocationUnits: 1024, size: 4096, used: 2048, kind: 'ram' as const, isPhysicalRam: false },
    ];
    const result = resolveMemoryFromHrStorage(entries);
    // Deve usar index=1 (físico), mesmo index=2 sendo maior
    expect(result.usedPercent).toBeCloseTo(50); // 1024/2048
    expect(result.sourceIndex).toBe(1);
    expect(result.dependencyOids).toContain(`${HR_STORAGE_SIZE_PREFIX}.1`);
    expect(result.dependencyOids).toContain(`${HR_STORAGE_USED_PREFIX}.1`);
  });

  // ── 25. resolveStorageFromHrStorage — dependencyOids ─────────────────────

  it('25. resolveStorageFromHrStorage — dependencyOids contém colunas de todos os volumes', () => {
    const entries = [
      { index: 3, typeOid: STORAGE_TYPE_FIXED_DISK, descr: 'HDD', allocationUnits: 4096, size: 1000, used: 500, kind: 'volume' as const },
      { index: 5, typeOid: STORAGE_TYPE_FIXED_DISK, descr: 'SSD', allocationUnits: 4096, size: 2000, used: 1000, kind: 'volume' as const },
    ];
    const result = resolveStorageFromHrStorage(entries);
    expect(result.volumes).toHaveLength(2);
    expect(result.dependencyOids).toContain(`${HR_STORAGE_SIZE_PREFIX}.3`);
    expect(result.dependencyOids).toContain(`${HR_STORAGE_USED_PREFIX}.3`);
    expect(result.dependencyOids).toContain(`${HR_STORAGE_SIZE_PREFIX}.5`);
    expect(result.dependencyOids).toContain(`${HR_STORAGE_USED_PREFIX}.5`);
  });

});
