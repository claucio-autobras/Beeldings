// Fechamento de período semanal/mensal em America/Sao_Paulo: as fronteiras
// devem ser meia-noite de SP (03:00 UTC) independentemente do fuso do servidor.

import {
  currentPartialPeriod,
  lastClosedPeriod,
  resolvePresetPeriod,
  spMidnightUtc,
} from './insight-period.util.js';

describe('insight-period.util', () => {
  it('spMidnightUtc devolve 03:00 UTC (SP = UTC-3, sem horário de verão)', () => {
    expect(spMidnightUtc(2026, 8, 10).toISOString()).toBe('2026-08-10T03:00:00.000Z');
  });

  describe('lastClosedPeriod WEEKLY', () => {
    it('numa sexta-feira, fecha a semana anterior (segunda a domingo)', () => {
      // 14/08/2026 é sexta-feira em SP.
      const now = new Date('2026-08-14T15:00:00.000Z');
      const p = lastClosedPeriod('WEEKLY', now);
      expect(p.from.toISOString()).toBe('2026-08-03T03:00:00.000Z'); // seg 03/08 SP
      expect(p.to.toISOString()).toBe('2026-08-10T03:00:00.000Z'); // seg 10/08 SP (exclusivo)
      expect(p.label).toBe('Semana de 03/08/2026 a 09/08/2026');
    });

    it('na virada de segunda-feira em SP, a semana recém-fechada vira o período', () => {
      // Segunda 10/08/2026 00:30 SP = 03:30 UTC.
      const now = new Date('2026-08-10T03:30:00.000Z');
      const p = lastClosedPeriod('WEEKLY', now);
      expect(p.from.toISOString()).toBe('2026-08-03T03:00:00.000Z');
      expect(p.to.toISOString()).toBe('2026-08-10T03:00:00.000Z');
    });

    it('domingo 23h SP ainda pertence à semana em curso (fecha a anterior)', () => {
      // Domingo 09/08/2026 23:00 SP = 10/08 02:00 UTC.
      const now = new Date('2026-08-10T02:00:00.000Z');
      const p = lastClosedPeriod('WEEKLY', now);
      expect(p.from.toISOString()).toBe('2026-07-27T03:00:00.000Z');
      expect(p.to.toISOString()).toBe('2026-08-03T03:00:00.000Z');
    });
  });

  describe('lastClosedPeriod MONTHLY', () => {
    it('em agosto, fecha julho', () => {
      const now = new Date('2026-08-14T15:00:00.000Z');
      const p = lastClosedPeriod('MONTHLY', now);
      expect(p.from.toISOString()).toBe('2026-07-01T03:00:00.000Z');
      expect(p.to.toISOString()).toBe('2026-08-01T03:00:00.000Z');
      expect(p.label).toBe('Julho de 2026');
    });

    it('em janeiro, fecha dezembro do ano anterior', () => {
      const now = new Date('2026-01-15T12:00:00.000Z');
      const p = lastClosedPeriod('MONTHLY', now);
      expect(p.from.toISOString()).toBe('2025-12-01T03:00:00.000Z');
      expect(p.to.toISOString()).toBe('2026-01-01T03:00:00.000Z');
      expect(p.label).toBe('Dezembro de 2025');
    });

    it('dia 1º de madrugada em SP já fecha o mês anterior', () => {
      // 01/08/2026 00:10 SP = 03:10 UTC.
      const now = new Date('2026-08-01T03:10:00.000Z');
      const p = lastClosedPeriod('MONTHLY', now);
      expect(p.from.toISOString()).toBe('2026-07-01T03:00:00.000Z');
      expect(p.to.toISOString()).toBe('2026-08-01T03:00:00.000Z');
    });
  });

  describe('currentPartialPeriod', () => {
    it('semana corrente vai da segunda em SP até agora', () => {
      const now = new Date('2026-08-14T15:00:00.000Z');
      const p = currentPartialPeriod('WEEKLY', now);
      expect(p.from.toISOString()).toBe('2026-08-10T03:00:00.000Z');
      expect(p.to.toISOString()).toBe(now.toISOString());
      expect(p.label).toContain('parcial');
    });

    it('mês corrente vai do dia 1º em SP até agora', () => {
      const now = new Date('2026-08-14T15:00:00.000Z');
      const p = currentPartialPeriod('MONTHLY', now);
      expect(p.from.toISOString()).toBe('2026-08-01T03:00:00.000Z');
      expect(p.to.toISOString()).toBe(now.toISOString());
    });
  });

  it('resolvePresetPeriod mapeia preset → período + frequência', () => {
    const now = new Date('2026-08-14T15:00:00.000Z');
    expect(resolvePresetPeriod('last_week', now).frequency).toBe('WEEKLY');
    expect(resolvePresetPeriod('last_month', now).frequency).toBe('MONTHLY');
    expect(resolvePresetPeriod('current_week', now).period.to.toISOString()).toBe(now.toISOString());
    expect(resolvePresetPeriod('current_month', now).frequency).toBe('MONTHLY');
  });
});
