import {
  resolveScadaNavLabel,
  SCADA_FALLBACK_LABEL,
} from './sidebar-navigation';

const oneSite = [{ name: 'Torre Norte' }];
const manySites = [{ name: 'Torre Norte' }, { name: 'Torre Sul' }];

describe('resolveScadaNavLabel', () => {
  it.each(['ADMIN', 'CCO', 'SUPERVISOR'] as const)(
    'uses Sites for the %s profile without depending on site data',
    (role) => {
      expect(resolveScadaNavLabel(role, manySites, 'Cliente')).toBe('Sites');
    },
  );

  it.each(['CLIENTE', 'VISUALIZADOR'] as const)(
    'uses the only site for the %s profile',
    (role) => {
      expect(resolveScadaNavLabel(role, oneSite, 'Cliente')).toBe('Torre Norte');
    },
  );

  it.each(['CLIENTE', 'VISUALIZADOR'] as const)(
    'uses the scoped client name when the %s profile has multiple sites',
    (role) => {
      expect(resolveScadaNavLabel(role, manySites, 'Cliente Demo')).toBe('Cliente Demo');
    },
  );

  it('keeps a stable fallback while loading, on errors, or without sites', () => {
    expect(resolveScadaNavLabel('CLIENTE', undefined, 'Cliente Demo')).toBe(SCADA_FALLBACK_LABEL);
    expect(resolveScadaNavLabel('CLIENTE', [], 'Cliente Demo')).toBe(SCADA_FALLBACK_LABEL);
    expect(resolveScadaNavLabel('CLIENTE', manySites, null)).toBe(SCADA_FALLBACK_LABEL);
  });

  it('does not turn a blank site or client name into a blank navigation label', () => {
    expect(resolveScadaNavLabel('CLIENTE', [{ name: '  ' }], 'Cliente Demo')).toBe(SCADA_FALLBACK_LABEL);
    expect(resolveScadaNavLabel('CLIENTE', manySites, '  ')).toBe(SCADA_FALLBACK_LABEL);
  });
});