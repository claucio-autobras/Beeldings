/**
 * Specs das métricas-contador de tabela IF-MIB (SNMP Fase 1 — Bug 4):
 * error/discard passam por computeRate (taxa) e publicam pkt/s — nunca
 * acumulador bruto nem unidade de bytes.
 */

import { counterTableUnit, isCounterTableMetric } from './snmp.driver';
import { BASE_SWITCH_PROFILE } from '../profiles/base/switch.profile';

describe('COUNTER_TABLE_METRICS (Bug 4 — error/discard sem taxa)', () => {
  it('inclui octets E as quatro métricas de erro/descartes', () => {
    for (const metric of [
      'if_in_octets',
      'if_out_octets',
      'if_in_errors',
      'if_out_errors',
      'if_in_discards',
      'if_out_discards',
    ]) {
      expect(isCounterTableMetric(metric)).toBe(true);
    }
  });

  it('métricas que não são contador de tabela ficam fora (sem taxa indevida)', () => {
    expect(isCounterTableMetric('if_oper_status')).toBe(false);
    expect(isCounterTableMetric('disk_used')).toBe(false);
    expect(isCounterTableMetric('packet_loss')).toBe(false);
  });

  it('unidade publicada: octets → B/s; errors/discards → pkt/s', () => {
    expect(counterTableUnit('if_in_octets')).toBe('B/s');
    expect(counterTableUnit('if_out_octets')).toBe('B/s');
    expect(counterTableUnit('if_in_errors')).toBe('pkt/s');
    expect(counterTableUnit('if_out_errors')).toBe('pkt/s');
    expect(counterTableUnit('if_in_discards')).toBe('pkt/s');
    expect(counterTableUnit('if_out_discards')).toBe('pkt/s');
    expect(counterTableUnit('if_oper_status')).toBeNull();
  });
});

describe('BASE_SWITCH_PROFILE — prefixos de tabela IF-MIB', () => {
  it('declara tableOidPrefix para as quatro colunas de erro/descartes', () => {
    const prefixByMetric = new Map(
      BASE_SWITCH_PROFILE.mappings.map((m) => [m.metricKey, m.tableOidPrefix]),
    );
    expect(prefixByMetric.get('if_in_discards')).toBe('1.3.6.1.2.1.2.2.1.13');
    expect(prefixByMetric.get('if_in_errors')).toBe('1.3.6.1.2.1.2.2.1.14');
    expect(prefixByMetric.get('if_out_discards')).toBe('1.3.6.1.2.1.2.2.1.19');
    expect(prefixByMetric.get('if_out_errors')).toBe('1.3.6.1.2.1.2.2.1.20');
  });
});
