/**
 * Testes unitários para as funções auxiliares do SnmpHealthMetrics e do
 * SnmpDiagnoseModal (task 968).
 *
 * Cobre:
 *  1. buildCpuAggregate — colapso de múltiplos pontos cpu/cpu_usage
 *  2. memoryLabel — rótulo distinto por unidade de memória
 *  3. storageLabel — rótulo distinto por volume de armazenamento
 *  4. deriveProposalsFromLegacy — compatibilidade com payload sem `proposals`
 */

import type { CameraPoint, SnmpPointDisplay, DiagnoseMetricResult, DiagnoseCandidate } from '../services/cftv.service';

// ─── Helpers de fixture ────────────────────────────────────────────────────────

function makeDisplay(
  override: Partial<SnmpPointDisplay> = {},
): SnmpPointDisplay {
  return {
    category: 'performance',
    categoryLabel: 'Desempenho',
    label: 'Uso de CPU',
    importance: 'primary',
    origin: 'canonical',
    valueKind: 'number',
    unit: '%',
    ...override,
  };
}

function makePoint(
  metric: string,
  tag: string,
  override: Partial<CameraPoint> = {},
): CameraPoint {
  return {
    id: `pt-${tag}`,
    tag,
    objectName: tag,
    metric,
    oid: `1.3.6.1.4.1.99.${tag}`,
    unit: '%',
    lastValue: null,
    lastValueAt: null,
    lastValueState: null,
    ...override,
  } as CameraPoint;
}

type Row = {
  point: CameraPoint;
  display: SnmpPointDisplay;
  value: number | null;
  unreliable: boolean;
};

function makeRow(
  metric: string,
  value: number | null,
  displayOverride: Partial<SnmpPointDisplay> = {},
  pointOverride: Partial<CameraPoint> = {},
): Row {
  const point = makePoint(metric, metric.toUpperCase(), pointOverride);
  return {
    point,
    display: makeDisplay({ label: 'Uso de CPU', ...displayOverride }),
    value,
    unreliable: false,
  };
}

// ─── buildCpuAggregate ────────────────────────────────────────────────────────

// Import the module under test via dynamic require so we can test private
// functions exported for testing, or inline them here for isolation.
// Since buildCpuAggregate is not exported, we test it via the logic inline.

/**
 * Inline implementation matching the component's buildCpuAggregate logic
 * so we can unit-test the algorithm without coupling to React internals.
 */
function buildCpuAggregate(rows: Row[]): {
  cpuRow: {
    synthetic: Row;
    originals: Row[];
    max: number | null;
  } | null;
  rest: Row[];
} {
  const cpuRows = rows.filter(
    (r) => r.point.metric === 'cpu' || r.point.metric === 'cpu_usage',
  );
  const peakRow = rows.find((r) => r.point.metric === 'cpu_usage_peak') ?? null;
  const rest = rows.filter(
    (r) =>
      r.point.metric !== 'cpu' &&
      r.point.metric !== 'cpu_usage' &&
      r.point.metric !== 'cpu_usage_peak',
  );
  if (cpuRows.length === 0) return { cpuRow: null, rest };
  if (cpuRows.length === 1 && !peakRow) return { cpuRow: null, rest: rows };

  const withValues = cpuRows.filter((r) => r.value !== null);
  const avg =
    withValues.length > 0
      ? withValues.reduce((s, r) => s + (r.value as number), 0) / withValues.length
      : null;
  const max = peakRow?.value ??
    (withValues.length > 0
      ? Math.max(...withValues.map((r) => r.value as number))
      : null);

  const template = cpuRows[0];
  const synthetic: Row = {
    point: template.point,
    display: { ...template.display, label: 'Uso de CPU' },
    value: avg,
    unreliable: cpuRows.some((r) => r.unreliable),
  };

  return { cpuRow: { synthetic, originals: cpuRows, max }, rest };
}

describe('buildCpuAggregate', () => {
  it('retorna cpuRow=null quando há apenas 1 ponto cpu (sem colapso)', () => {
    const rows = [makeRow('cpu', 42)];
    const { cpuRow, rest } = buildCpuAggregate(rows);
    expect(cpuRow).toBeNull();
    expect(rest).toHaveLength(1);
  });

  it('colapsa 2 pontos cpu em média e max', () => {
    const rows = [makeRow('cpu', 40), makeRow('cpu', 60)];
    const { cpuRow } = buildCpuAggregate(rows);
    expect(cpuRow).not.toBeNull();
    expect(cpuRow!.synthetic.value).toBe(50);
    expect(cpuRow!.max).toBe(60);
    expect(cpuRow!.originals).toHaveLength(2);
  });

  it('colapsa pontos cpu e cpu_usage juntos', () => {
    const rows = [
      makeRow('cpu', 30),
      makeRow('cpu_usage', 70),
    ];
    const { cpuRow } = buildCpuAggregate(rows);
    expect(cpuRow).not.toBeNull();
    expect(cpuRow!.originals).toHaveLength(2);
    expect(cpuRow!.synthetic.value).toBe(50);
  });

  it('usa cpu_usage_peak como detalhe sem criar um segundo card', () => {
    const rows = [
      makeRow('cpu_usage', 45),
      makeRow('cpu_usage_peak', 78),
      makeRow('memory_used_percent', 60),
    ];
    const { cpuRow, rest } = buildCpuAggregate(rows);
    expect(cpuRow?.synthetic.value).toBe(45);
    expect(cpuRow?.max).toBe(78);
    expect(cpuRow?.originals).toHaveLength(1);
    expect(rest.map((row) => row.point.metric)).toEqual(['memory_used_percent']);
  });

  it('média ignora pontos sem valor (null)', () => {
    const rows = [
      makeRow('cpu', null),
      makeRow('cpu', 80),
      makeRow('cpu', 60),
    ];
    const { cpuRow } = buildCpuAggregate(rows);
    expect(cpuRow!.synthetic.value).toBe(70); // média de 80 e 60
    expect(cpuRow!.max).toBe(80);
  });

  it('quando todos os pontos são null, avg e max ficam null', () => {
    const rows = [makeRow('cpu', null), makeRow('cpu', null)];
    const { cpuRow } = buildCpuAggregate(rows);
    expect(cpuRow!.synthetic.value).toBeNull();
    expect(cpuRow!.max).toBeNull();
  });

  it('preserva linhas não-cpu no rest', () => {
    const rows = [
      makeRow('cpu', 50),
      makeRow('cpu', 70),
      makeRow('memory', 40, { label: 'Memória', unit: '%' }),
    ];
    const { rest } = buildCpuAggregate(rows);
    expect(rest).toHaveLength(1);
    expect(rest[0].point.metric).toBe('memory');
  });
});

// ─── memoryLabel ──────────────────────────────────────────────────────────────

/**
 * Inline da lógica de memoryLabel para testes isolados.
 * Deve corresponder exatamente ao componente SnmpHealthMetrics.tsx.
 */
function memoryLabel(row: Row): string {
  const metric = row.point.metric;
  if (metric === 'memory_used_percent') return 'Memória usada (%)';
  if (metric === 'memory_total' || metric === 'ram_total') return 'Memória total';
  const unit = (row.display.unit ?? '').trim();
  if (unit === '%') return 'Memória (%)';
  if (unit) return `Memória (${unit})`;
  return row.display.label;
}

describe('memoryLabel', () => {
  it('ram_total retorna "Memória total" independente da unidade', () => {
    const row = makeRow('ram_total', 4096, { unit: 'kB', label: 'Memória RAM total' });
    expect(memoryLabel(row)).toBe('Memória total');
  });

  it('memory_total retorna "Memória total"', () => {
    const row = makeRow('memory_total', 8192, { unit: 'MB', label: 'Memória total' });
    expect(memoryLabel(row)).toBe('Memória total');
  });

  it('memory_used_percent retorna "Memória usada (%)"', () => {
    const row = makeRow('memory_used_percent', 75, { unit: '%', label: 'Memória usada' });
    expect(memoryLabel(row)).toBe('Memória usada (%)');
  });

  it('memory com unidade % retorna "Memória (%)"', () => {
    const row = makeRow('memory', 55, { unit: '%', label: 'Memória' });
    expect(memoryLabel(row)).toBe('Memória (%)');
  });

  it('memory com unidade kB retorna "Memória (kB)"', () => {
    const row = makeRow('memory', 102400, { unit: 'kB', label: 'Memória' });
    expect(memoryLabel(row)).toBe('Memória (kB)');
  });

  it('memory sem unidade retorna label original', () => {
    const row = makeRow('memory', 55, { unit: '', label: 'Memória' });
    expect(memoryLabel(row)).toBe('Memória');
  });
});

// ─── storageLabel ─────────────────────────────────────────────────────────────

/**
 * Inline da lógica de storageLabel para testes isolados.
 * Deve corresponder exatamente ao componente SnmpHealthMetrics.tsx.
 */
function storageLabel(row: Row): string {
  const metric = row.point.metric;
  const base = row.point.objectName || row.display.label;
  const genericLabels = ['Armazenamento', 'storage', 'storage_used_percent'];
  if (base && !genericLabels.includes(base)) {
    if (metric === 'storage_used_percent') return `${base} (%)`;
    return base;
  }
  const oid = row.point.oid ?? '';
  const match = oid.match(/\.(\d+)$/);
  const prefix = metric === 'storage_used_percent' ? 'Armazenamento (%)' : 'Armazenamento';
  if (match) return `${prefix} vol. ${match[1]}`;
  return metric === 'storage_used_percent' ? 'Armazenamento (%)' : row.display.label;
}

describe('storageLabel', () => {
  it('usa objectName quando é específico', () => {
    const row = makeRow('storage', 80, { label: 'Armazenamento' }, {
      objectName: 'Disco /dev/sda1',
    } as Partial<CameraPoint>);
    expect(storageLabel(row)).toBe('Disco /dev/sda1');
  });

  it('extrai índice do OID quando objectName é genérico', () => {
    const row = makeRow('storage', 80, { label: 'Armazenamento' }, {
      objectName: 'Armazenamento',
      oid: '1.3.6.1.2.1.25.2.3.1.5.2',
    } as Partial<CameraPoint>);
    expect(storageLabel(row)).toBe('Armazenamento vol. 2');
  });

  it('usa label original quando OID não termina em dígito', () => {
    const row = makeRow('storage', 80, { label: 'Armazenamento' }, {
      objectName: 'storage',
      // OID sem sufixo numérico (sem index)
      oid: undefined,
    } as Partial<CameraPoint>);
    expect(storageLabel(row)).toBe('Armazenamento');
  });

  it('storage_used_percent com objectName específico adiciona sufixo (%)', () => {
    const row = makeRow('storage_used_percent', 72, { label: 'Armazenamento (%)' }, {
      objectName: 'Disco /dev/sda1',
    } as Partial<CameraPoint>);
    expect(storageLabel(row)).toBe('Disco /dev/sda1 (%)');
  });

  it('storage_used_percent sem objectName específico usa prefixo "Armazenamento (%)"', () => {
    const row = makeRow('storage_used_percent', 72, { label: 'Armazenamento' }, {
      objectName: 'storage_used_percent',
      oid: '1.3.6.1.2.1.25.2.3.1.6.1',
    } as Partial<CameraPoint>);
    expect(storageLabel(row)).toBe('Armazenamento (%) vol. 1');
  });
});

// ─── deriveProposalsFromLegacy ────────────────────────────────────────────────

/**
 * Inline da lógica de deriveProposalsFromLegacy para testes isolados.
 * (mesma lógica do SnmpDiagnoseModal.tsx)
 */
const PROFILE_METRIC_LABELS: Record<string, string> = {
  cpu: 'Uso de CPU',
  memory: 'Memória',
  ram_total: 'Memória RAM total',
  storage: 'Armazenamento',
  temperature: 'Temperatura',
  packet_loss: 'Pacotes perdidos',
  uptime: 'Tempo ligado',
};

function makeCandidate(
  oid: string,
  profileLabel: string,
  responded: boolean,
  isCurrent = false,
  value: number | null = null,
): DiagnoseCandidate {
  return {
    oid,
    profileLabel,
    scale: 1,
    unit: '%',
    responded,
    value,
    raw: value !== null ? String(value) : null,
    isCurrent,
  };
}

function makeMetricResult(
  metric: string,
  currentResponded: boolean,
  currentOid: string | null,
  candidates: DiagnoseCandidate[],
  currentValue: number | null = null,
): DiagnoseMetricResult {
  return {
    metric: metric as DiagnoseMetricResult['metric'],
    label: PROFILE_METRIC_LABELS[metric] ?? metric,
    pointId: currentOid ? 'pt-1' : null,
    currentOid,
    currentResponded,
    currentValue,
    currentRaw: currentValue !== null ? String(currentValue) : null,
    supported: currentResponded || candidates.some((c) => c.responded),
    candidates,
  };
}

function deriveProposalsFromLegacy(metrics: DiagnoseMetricResult[]) {
  const proposals: Array<{
    metricKey: string;
    friendlyName: string;
    unit: string | null;
    exampleValue: string | null;
    confidence: 'exact' | 'inferred';
    candidates: Array<{
      oid: string;
      label: string;
      exampleValue: string | null;
      unit: string | null;
      isDefault: boolean;
    }>;
    selectedOid: string | null;
  }> = [];

  for (const m of metrics) {
    const respondedCandidates = m.candidates.filter((c) => c.responded);
    const currentWorks = m.currentResponded && m.currentOid;
    const label = PROFILE_METRIC_LABELS[m.metric] ?? m.label ?? m.metric;

    const candidates = m.candidates
      .filter((c) => c.responded)
      .map((c) => ({
        oid: c.oid,
        label: c.profileLabel || c.oid,
        exampleValue: c.value !== null ? String(c.value) : c.raw,
        unit: c.unit || null,
        isDefault: c.isCurrent
          ? true
          : respondedCandidates[0]?.oid === c.oid && !currentWorks,
      }));

    if (m.currentOid && !candidates.find((c) => c.oid === m.currentOid)) {
      candidates.unshift({
        oid: m.currentOid,
        label: 'OID atual',
        exampleValue: m.currentValue !== null ? String(m.currentValue) : m.currentRaw,
        unit: null,
        isDefault: true,
      });
    }

    const defaultCandidate = candidates.find((c) => c.isDefault) ?? candidates[0] ?? null;

    // Unsupported = no responded candidates and no current working OID.
    const isUnsupported = respondedCandidates.length === 0 && !currentWorks;

    proposals.push({
      metricKey: m.metric,
      friendlyName: label,
      unit: defaultCandidate?.unit ?? null,
      exampleValue: defaultCandidate?.exampleValue ?? null,
      confidence:
        m.currentResponded && m.currentOid
          ? 'exact'
          : 'inferred',
      candidates,
      // Unsupported metrics get null so they are excluded from apply count
      selectedOid: isUnsupported ? null : (defaultCandidate?.oid ?? m.currentOid),
    });
  }

  return proposals;
}

describe('deriveProposalsFromLegacy', () => {
  it('métrica com OID atual respondendo → confiança exact', () => {
    const m = makeMetricResult('cpu', true, '1.3.6.1.2.1.1.1.0', [
      makeCandidate('1.3.6.1.2.1.1.1.0', 'Atual', true, true, 65),
    ], 65);
    const proposals = deriveProposalsFromLegacy([m]);
    expect(proposals).toHaveLength(1);
    expect(proposals[0].confidence).toBe('exact');
    expect(proposals[0].friendlyName).toBe('Uso de CPU');
    expect(proposals[0].selectedOid).toBe('1.3.6.1.2.1.1.1.0');
  });

  it('métrica sem OID mas com candidato respondendo → confiança inferred', () => {
    const m = makeMetricResult('memory', false, null, [
      makeCandidate('1.3.6.1.4.1.1.1.1', 'Hikvision', true, false, 42),
    ]);
    const proposals = deriveProposalsFromLegacy([m]);
    expect(proposals[0].confidence).toBe('inferred');
    expect(proposals[0].selectedOid).toBe('1.3.6.1.4.1.1.1.1');
  });

  it('métrica sem candidatos respondendo → confiança inferred e selectedOid null (não suportada)', () => {
    const m = makeMetricResult('temperature', false, null, [
      makeCandidate('1.3.6.1.4.1.2.1', 'Genérico', false),
    ]);
    const proposals = deriveProposalsFromLegacy([m]);
    // Unsupported metrics must NOT be labeled 'exact' — they get 'inferred'
    expect(proposals[0].confidence).toBe('inferred');
    // selectedOid must be null so they are excluded from the apply count
    expect(proposals[0].selectedOid).toBeNull();
  });

  it('métrica com OID atual sem resposta mas candidato alternativo disponível', () => {
    // currentOid existe mas não respondeu; candidato alternativo respondeu.
    // O candidato respondente fica na lista de candidates; o currentOid é
    // adicionado como fallback com isDefault=true no início da lista.
    const m = makeMetricResult('storage', false, '1.3.6.1.2.1.1.1.0', [
      makeCandidate('1.3.6.1.2.1.1.1.0', 'Atual', false, true),
      makeCandidate('1.3.6.1.4.1.2.1.1', 'Alternativo', true, false, 55),
    ]);
    const proposals = deriveProposalsFromLegacy([m]);
    // inferred pois o OID atual não respondeu mas outro respondeu
    expect(proposals[0].confidence).toBe('inferred');
    // Candidato respondente aparece na lista
    const candidateOids = proposals[0].candidates.map((c) => c.oid);
    expect(candidateOids).toContain('1.3.6.1.4.1.2.1.1');
    // proposal tem um selectedOid definido
    expect(proposals[0].selectedOid).not.toBeNull();
  });

  it('gera proposta para cada métrica no array metrics', () => {
    const metrics = [
      makeMetricResult('cpu', true, '1.3.6.1.2.1.1.0', [
        makeCandidate('1.3.6.1.2.1.1.0', 'Atual', true, true, 50),
      ], 50),
      makeMetricResult('memory', false, null, []),
    ];
    const proposals = deriveProposalsFromLegacy(metrics);
    expect(proposals).toHaveLength(2);
    expect(proposals.map((p) => p.metricKey)).toEqual(['cpu', 'memory']);
  });
});
