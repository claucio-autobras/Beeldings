// ─── Relatório de alarmes: reativações (CFTV) ────────────────────────────────
// Cobre o cenário do relatório: ocorrência que reativou DENTRO do período
// filtrado (ativação original FORA do período) deve aparecer no relatório com
// estado Ativo e info de reativação, ordenada pela atividade mais recente.

import { ReportsService } from './reports.service.js';
import { alarmPeriodWhere, lastActivityAt, sortBySeverityThenActivity } from '../alarms/alarm-activity.util.js';

interface FakeEvent {
  id: string;
  kind: string;
  state: string;
  valueAtTrigger: number | null;
  activatedAt: Date;
  normalizedAt: Date | null;
  lastReactivatedAt: Date | null;
  reactivationCount: number;
  acknowledgedAt: Date | null;
  acknowledgedBy: string | null;
  ackNote: string | null;
  alarmRule: {
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
    message: string;
    point: { tag: string; objectName: string | null; unit: string | null; device: { name: string } };
  };
}

function makeEvent(partial: Partial<FakeEvent> & { id: string }): FakeEvent {
  return {
    kind: 'ALARM',
    state: 'ACTIVE',
    valueAtTrigger: 1,
    activatedAt: new Date('2026-07-01T10:00:00Z'),
    normalizedAt: null,
    lastReactivatedAt: null,
    reactivationCount: 0,
    acknowledgedAt: null,
    acknowledgedBy: null,
    ackNote: null,
    alarmRule: {
      severity: 'MEDIUM',
      message: 'Detecção de movimento',
      point: { tag: 'cam-01-motion', objectName: 'Movimento', unit: null, device: { name: 'Câmera 01' } },
    },
    ...partial,
  };
}

/** Divide uma linha CSV respeitando aspas (campos com vírgula, ex.: datas). */
function splitCsv(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Filtro do Prisma reproduzido em memória (só os operadores usados aqui). */
function matchesPeriod(e: FakeEvent, where: any): boolean {
  const conds: any[] = where.AND ?? [];
  return conds.every((c) => {
    if (c.activatedAt?.lte) return e.activatedAt <= c.activatedAt.lte;
    if (c.OR) {
      return c.OR.some((o: any) => {
        const [field, cmp] = Object.entries<any>(o)[0];
        const v = (e as any)[field] as Date | null;
        return v != null && v >= cmp.gte;
      });
    }
    return true;
  });
}

function buildService(events: FakeEvent[]): ReportsService {
  const prisma = {
    tenant: { findMany: jest.fn().mockResolvedValue([]) },
    user: { findMany: jest.fn().mockResolvedValue([]) },
    alarmEvent: {
      findMany: jest.fn(async ({ where }: any) => {
        const period = where.AND ? { AND: where.AND } : {};
        return events.filter((e) => matchesPeriod(e, period));
      }),
    },
  };
  return new ReportsService(prisma as any, {} as any);
}

describe('alarmPeriodWhere / lastActivityAt', () => {
  it('inclui reativação e normalização no corte inferior do período', () => {
    const where = alarmPeriodWhere(new Date('2026-07-16T00:00:00Z'), new Date('2026-07-16T23:59:59Z'));
    expect(where.AND).toHaveLength(2);
    const or = (where.AND as any[])[1].OR;
    expect(or).toEqual([
      { activatedAt: { gte: new Date('2026-07-16T00:00:00Z') } },
      { normalizedAt: { gte: new Date('2026-07-16T00:00:00Z') } },
      { lastReactivatedAt: { gte: new Date('2026-07-16T00:00:00Z') } },
    ]);
  });

  it('sem período devolve objeto vazio', () => {
    expect(alarmPeriodWhere(undefined, undefined)).toEqual({});
  });

  it('lastActivityAt usa o máximo entre ativação/normalização/reativação', () => {
    expect(
      lastActivityAt({
        activatedAt: new Date('2026-07-01T10:00:00Z'),
        normalizedAt: new Date('2026-07-02T10:00:00Z'),
        lastReactivatedAt: new Date('2026-07-16T11:13:39Z'),
      }),
    ).toBe(new Date('2026-07-16T11:13:39Z').getTime());
  });

  it('ordena por severidade e depois pela atividade mais recente', () => {
    const a = { activatedAt: new Date('2026-07-16T09:00:00Z'), normalizedAt: null, lastReactivatedAt: null, sev: 'MEDIUM' };
    const b = { activatedAt: new Date('2026-07-01T10:00:00Z'), normalizedAt: null, lastReactivatedAt: new Date('2026-07-16T11:00:00Z'), sev: 'MEDIUM' };
    const c = { activatedAt: new Date('2026-06-01T10:00:00Z'), normalizedAt: null, lastReactivatedAt: null, sev: 'HIGH' };
    const sorted = sortBySeverityThenActivity([a, b, c], (e) => e.sev);
    expect(sorted).toEqual([c, b, a]);
  });
});

describe('ReportsService.generateAlarmsReport (CSV)', () => {
  it('ocorrência reativada dentro do período (ativação fora) aparece como Ativo com info de reativação', async () => {
    const reactivated = makeEvent({
      id: 'e1',
      state: 'ACTIVE',
      activatedAt: new Date('2026-07-01T10:00:00Z'), // fora do período
      reactivationCount: 10,
      lastReactivatedAt: new Date('2026-07-16T14:13:39Z'), // dentro do período
    });
    const oldClosed = makeEvent({
      id: 'e2',
      state: 'NORMALIZED_UNACK',
      activatedAt: new Date('2026-06-01T10:00:00Z'),
      normalizedAt: new Date('2026-06-01T11:00:00Z'), // tudo fora do período
    });
    const todayFresh = makeEvent({
      id: 'e3',
      activatedAt: new Date('2026-07-16T09:00:00Z'), // dentro, mas atividade mais antiga que a reativação
    });
    const service = buildService([reactivated, oldClosed, todayFresh]);

    const file = await service.generateAlarmsReport({
      status: 'all',
      format: 'CSV',
      from: new Date('2026-07-16T00:00:00Z'),
      to: new Date('2026-07-16T23:59:59Z'),
    });

    const lines = (file.body as string).split('\n');
    // Cabeçalho com as novas colunas.
    expect(lines[0]).toContain('Reativações');
    expect(lines[0]).toContain('Última reativação');
    // e2 ficou fora (nenhuma atividade no período); e1 e e3 dentro.
    expect(lines).toHaveLength(3);
    const header = splitCsv(lines[0]);
    const row1 = splitCsv(lines[1]);
    const row2 = splitCsv(lines[2]);
    // e1 (reativou às 14h13) vem antes de e3 (ativou às 9h) — atividade mais recente primeiro.
    expect(row1[header.indexOf('Estado')]).toBe('Ativo');
    expect(row1[header.indexOf('Reativações')]).toBe('10');
    expect(row1[header.indexOf('Última reativação')]).toContain('16/07/2026'); // formatada (America/Sao_Paulo)
    // e3 (sem reativações) vem depois, com colunas de reativação vazias.
    expect(row2[header.indexOf('Reativações')]).toBe('');
    expect(row2[header.indexOf('Ativado em')]).toContain('16/07/2026');
  });

  it('sem reativações as colunas ficam vazias', async () => {
    const service = buildService([makeEvent({ id: 'e1' })]);
    const file = await service.generateAlarmsReport({ status: 'all', format: 'CSV' });
    const lines = (file.body as string).split('\n');
    const cols = splitCsv(lines[1]);
    const header = splitCsv(lines[0]);
    expect(cols[header.indexOf('Reativações')]).toBe('');
    expect(cols[header.indexOf('Última reativação')]).toBe('');
  });
});
