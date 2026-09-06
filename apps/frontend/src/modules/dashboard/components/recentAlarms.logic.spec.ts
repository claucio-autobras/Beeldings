import {
  recentAlarmActivityAt,
  recentAlarmSeverityLabel,
} from './recentAlarms.logic';

describe('recentAlarmActivityAt', () => {
  it('mostra a reativação recente em vez da ativação original antiga', () => {
    expect(recentAlarmActivityAt({
      activatedAt: '2026-08-20T10:00:00.000Z',
      lastReactivatedAt: '2026-08-31T14:00:00.000Z',
    })).toBe('2026-08-31T14:00:00.000Z');
  });

  it('usa a ativação quando a ocorrência nunca foi reativada', () => {
    expect(recentAlarmActivityAt({
      activatedAt: '2026-08-31T13:00:00.000Z',
      lastReactivatedAt: null,
    })).toBe('2026-08-31T13:00:00.000Z');
  });

  it('exibe a severidade real no chip do alarme recente', () => {
    expect(recentAlarmSeverityLabel('HIGH')).toBe('Alta');
    expect(recentAlarmSeverityLabel('MEDIUM')).toBe('Média');
    expect(recentAlarmSeverityLabel('LOW')).toBe('Baixa');
  });
});