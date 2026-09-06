/**
 * Testes de regressão para normalizeProfileOverrides().
 *
 * Garante que o payload real do backend (Record<string, string>)
 * é convertido correctamente para MetricMapping antes de entrar em
 * resolveProfile — evitando que o override perca o OID ao ser
 * espalhado como objecto.
 */

import { normalizeProfileOverrides } from './snmp.driver';

describe('normalizeProfileOverrides()', () => {
  it('converte string OID → MetricMapping com metricKey e oid', () => {
    const result = normalizeProfileOverrides({
      cpu: '1.3.6.1.4.1.39165.1.7.0',
      memory: '1.3.6.1.4.1.39165.1.11.0',
    });

    expect(result).not.toBeNull();
    expect(result!['cpu']).toEqual({ metricKey: 'cpu', oid: '1.3.6.1.4.1.39165.1.7.0' });
    expect(result!['memory']).toEqual({ metricKey: 'memory', oid: '1.3.6.1.4.1.39165.1.11.0' });
  });

  it('preserva objecto MetricMapping já convertido (forward-compat)', () => {
    const result = normalizeProfileOverrides({
      cpu: { metricKey: 'cpu', oid: '1.2.3.4', scale: 2 },
    });

    expect(result!['cpu'].oid).toBe('1.2.3.4');
    expect(result!['cpu'].scale).toBe(2);
    expect(result!['cpu'].metricKey).toBe('cpu');
  });

  it('retorna null quando overrides é null', () => {
    expect(normalizeProfileOverrides(null)).toBeNull();
  });

  it('retorna null quando overrides é undefined', () => {
    expect(normalizeProfileOverrides(undefined)).toBeNull();
  });

  it('retorna null quando todos os valores são inválidos', () => {
    // null/undefined/array → ignorados; objecto sem chaves válidas → null
    expect(normalizeProfileOverrides({ cpu: null as unknown as string })).toBeNull();
  });

  it('retorna null para objecto vazio', () => {
    expect(normalizeProfileOverrides({})).toBeNull();
  });

  it('o OID resultante é efetivamente aplicado pelo resolveProfile', async () => {
    // Teste de integração parcial: garante que o override chega ao perfil resolvido.
    const { resolveProfile } = await import('../profiles/profile-registry');

    const customOid = '1.9.9.9.9.0';
    const overrides = normalizeProfileOverrides({ cpu: customOid });
    expect(overrides).not.toBeNull();

    const resolved = resolveProfile({
      sysDescr: 'Hikvision DS-2CD2T47G2-L',
      metricOverrides: overrides!,
    });

    const cpu = resolved.mappings.get('cpu');
    expect(cpu?.oid).toBe(customOid);
    expect(cpu?.profileLayer).toBe('override');
  });
});
