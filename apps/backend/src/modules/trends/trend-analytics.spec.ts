import { PrismaClient } from '@prisma/client';
import {
  rollupRetentionDays,
  partitionNameFor,
  partitionMonthStart,
} from './trend-retention.service.js';
import { valueAt } from './equipment-analytics.service.js';
import { DefaultTrendsService } from './default-trends.service.js';

// ─── Helpers puros de retenção por partição ──────────────────────────────────

describe('rollupRetentionDays', () => {
  it('aplica pisos mínimos (2 anos horário, 5 anos diário)', () => {
    expect(rollupRetentionDays(30)).toEqual({ hourly: 730, daily: 1825 });
    expect(rollupRetentionDays(365)).toEqual({ hourly: 730, daily: 1825 });
  });

  it('escala com retenções brutas longas (2x horário, 4x diário)', () => {
    expect(rollupRetentionDays(1000)).toEqual({ hourly: 2000, daily: 4000 });
  });
});

describe('partitionNameFor / partitionMonthStart', () => {
  it('gera nome mensal UTC com zero à esquerda', () => {
    expect(partitionNameFor(new Date(Date.UTC(2026, 0, 15)))).toBe('trend_records_y2026m01');
    expect(partitionNameFor(new Date(Date.UTC(2026, 11, 31, 23, 59)))).toBe('trend_records_y2026m12');
  });

  it('faz round-trip nome → início do mês', () => {
    const d = new Date(Date.UTC(2026, 6, 1));
    expect(partitionMonthStart(partitionNameFor(d))?.getTime()).toBe(d.getTime());
  });

  it('rejeita nomes fora do padrão', () => {
    expect(partitionMonthStart('trend_records')).toBeNull();
    expect(partitionMonthStart('trend_records_default')).toBeNull();
    expect(partitionMonthStart('trend_records_y2026m1')).toBeNull();
  });
});

// ─── Anotação de contexto operacional (last-value-before) ────────────────────

describe('valueAt', () => {
  const samples = [
    { t: 100, value: 0 },
    { t: 200, value: 1 },
    { t: 300, value: 0 },
  ];

  it('retorna null antes da primeira amostra', () => {
    expect(valueAt(samples, 50)).toBeNull();
  });

  it('retorna o último valor vigente (<= t)', () => {
    expect(valueAt(samples, 100)).toBe(0);
    expect(valueAt(samples, 150)).toBe(0);
    expect(valueAt(samples, 200)).toBe(1);
    expect(valueAt(samples, 299)).toBe(1);
    expect(valueAt(samples, 300)).toBe(0);
    expect(valueAt(samples, 9999)).toBe(0);
  });

  it('lida com lista vazia', () => {
    expect(valueAt([], 100)).toBeNull();
  });
});

// ─── Classificação de trends padrão ──────────────────────────────────────────

describe('DefaultTrendsService.classify', () => {
  const svc = new DefaultTrendsService(
    null as never, // prisma não usado por classify
    null as never, // recorder não usado por classify
  );
  const base = { id: 'p1', tag: 't', objectName: 'n', unit: null, binding: null };

  it('BACnet analógicos → analog; digitais → digital; demais → null', () => {
    for (const t of ['AI', 'AV', 'AO']) expect(svc.classify({ ...base, objectType: t })).toBe('analog');
    for (const t of ['BI', 'BV', 'BO']) expect(svc.classify({ ...base, objectType: t })).toBe('digital');
    for (const t of ['MSI', 'MSO', 'CharacterString', '']) expect(svc.classify({ ...base, objectType: t })).toBeNull();
  });

  it('Modbus: coil/discrete → digital; registradores → analog', () => {
    expect(svc.classify({ ...base, objectType: 'modbus', binding: { registerType: 'coil' } })).toBe('digital');
    expect(svc.classify({ ...base, objectType: 'modbus', binding: { registerType: 'discrete' } })).toBe('digital');
    expect(svc.classify({ ...base, objectType: 'modbus', binding: { registerType: 'holding' } })).toBe('analog');
    expect(svc.classify({ ...base, objectType: 'modbus', binding: null })).toBe('analog');
  });

  it('MQTT: boolean → digital; number/string → analog', () => {
    expect(svc.classify({ ...base, objectType: 'mqtt', binding: { valueType: 'boolean' } })).toBe('digital');
    expect(svc.classify({ ...base, objectType: 'mqtt', binding: { valueType: 'number' } })).toBe('analog');
  });
});

// ─── Consistência dos rollups com os dados brutos (integração, leitura) ─────
// Compara os rollups horários/diários já materializados com a agregação
// recalculada dos trend_records cobertos pelo cursor. Se o job incremental
// avançar durante a leitura, tenta de novo (poucas vezes) para snapshot estável.

const RUN_DB = !!process.env.DATABASE_URL;
(RUN_DB ? describe : describe.skip)('rollups × dados brutos (integração)', () => {
  const prisma = new PrismaClient();
  afterAll(async () => prisma.$disconnect());

  async function snapshot() {
    const state = await prisma.trendRollupState.findUnique({ where: { id: 1 } });
    return state?.lastRecordId ?? 0n;
  }

  it('rollup horário bate com min/max/sum/count dos brutos GOOD', async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const cursor = await snapshot();
      if (cursor === 0n) return; // sem dados agregados ainda — nada a validar

      const raw = await prisma.$queryRaw<
        { trend_id: string; bucket: Date; min: number; max: number; sum: number; count: number }[]
      >`
        SELECT "trend_id", date_trunc('hour', "timestamp") AS bucket,
               min("value") AS min, max("value") AS max, sum("value") AS sum, count(*)::int AS count
        FROM "trend_records"
        WHERE id <= ${cursor} AND "quality" = 'GOOD'
        GROUP BY 1, 2`;

      const rolled = await prisma.$queryRaw<
        { trend_id: string; bucket: Date; min: number; max: number; sum: number; count: number }[]
      >`SELECT "trend_id", "bucket", "min", "max", "sum", "count" FROM "trend_rollups_hourly"`;

      if ((await snapshot()) !== cursor) continue; // job avançou no meio — refaz

      const key = (r: { trend_id: string; bucket: Date }) => `${r.trend_id}|${r.bucket.toISOString()}`;
      const rolledMap = new Map(rolled.map((r) => [key(r), r]));

      expect(rolled.length).toBe(raw.length);
      for (const r of raw) {
        const m = rolledMap.get(key(r));
        expect(m).toBeDefined();
        expect(m!.count).toBe(r.count);
        expect(m!.min).toBeCloseTo(r.min, 6);
        expect(m!.max).toBeCloseTo(r.max, 6);
        expect(m!.sum).toBeCloseTo(r.sum, 4);
      }
      return;
    }
    throw new Error('Cursor do rollup avançou em todas as tentativas — snapshot instável');
  }, 30_000);

  it('partições do mês corrente e futuras existem', async () => {
    const rows = await prisma.$queryRaw<{ relname: string }[]>`
      SELECT c.relname FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid
      JOIN pg_class p ON p.oid = i.inhparent
      WHERE p.relname = 'trend_records'`;
    const names = rows.map((r) => r.relname);
    const now = new Date();
    for (let k = 0; k <= 2; k++) {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + k, 1));
      expect(names).toContain(partitionNameFor(d));
    }
  }, 30_000);
});
