import { safeSnmpCandidateLabel } from './snmp-metric-display';

describe('safeSnmpCandidateLabel', () => {
  it('nunca devolve um OID cru para a seleção principal de métricas', () => {
    expect(safeSnmpCandidateLabel('1.3.6.1.2.1.25.3.3.1.2.1')).toBe('Fonte desconhecida');
    expect(safeSnmpCandidateLabel('  1.3.6.1.4.1.49617.1.1.4.0  ')).toBe('Fonte desconhecida');
  });

  it('preserva somente nomes amigáveis de MIB ou perfil', () => {
    expect(safeSnmpCandidateLabel('HOST-RESOURCES hrProcessorLoad')).toBe(
      'HOST-RESOURCES hrProcessorLoad',
    );
  });
});