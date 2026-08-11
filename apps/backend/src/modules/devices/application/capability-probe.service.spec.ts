/**
 * Testes unitários do CapabilityProbeService.
 *
 * Cobre as principais regras de classificação de estado e detecção de perfil.
 * Usa Jest (ts-jest) — sem Vitest.
 */

import {
  detectProfileFromSnmpProbe,
  resolveProfileLabel,
} from './capability-probe.service';

// ─── detectProfileFromSnmpProbe() ─────────────────────────────────────────────

describe('detectProfileFromSnmpProbe()', () => {
  it('retorna perfil genérico quando não há nenhuma pista', () => {
    const p = detectProfileFromSnmpProbe(null, null, null);
    expect(p.id).toBe('generic');
  });

  it('detecta Hikvision por sysDescr (case-insensitive)', () => {
    const p = detectProfileFromSnmpProbe('HIKVISION DS-2CD', null, null);
    expect(p.id).toBe('hikvision');
  });

  it('detecta Dahua por sysDescr', () => {
    const p = detectProfileFromSnmpProbe('Dahua NVR8-16P', null, null);
    expect(p.id).toBe('dahua');
  });

  it('detecta Intelbras por sysDescr', () => {
    const p = detectProfileFromSnmpProbe('intelbras VIP 3230 SD IR', null, null);
    expect(p.id).toBe('intelbras');
  });

  it('detecta Axis por sysDescr', () => {
    const p = detectProfileFromSnmpProbe('AXIS M3106-L Mk II', null, null);
    expect(p.id).toBe('axis');
  });

  it('detecta Hikvision pelo enterprise number 39165 no sysObjectId', () => {
    const p = detectProfileFromSnmpProbe(null, '1.3.6.1.4.1.39165.1.1', null);
    expect(p.id).toBe('hikvision');
  });

  it('enterprise 1004849 → intelbras (conservador no mercado BR)', () => {
    const p = detectProfileFromSnmpProbe(null, '1.3.6.1.4.1.1004849.1', null);
    expect(p.id).toBe('intelbras');
  });

  it('enterprise desconhecido → perfil genérico', () => {
    const p = detectProfileFromSnmpProbe(null, '1.3.6.1.4.1.99999.1', null);
    expect(p.id).toBe('generic');
  });

  it('fabricante manual (hint) tem prioridade sobre sysDescr', () => {
    // sysDescr aponta Dahua mas o hint diz Hikvision → Hikvision vence
    const p = detectProfileFromSnmpProbe('Dahua device', null, 'Hikvision');
    expect(p.id).toBe('hikvision');
  });
});

// ─── resolveProfileLabel() ────────────────────────────────────────────────────

describe('resolveProfileLabel()', () => {
  it('retorna o label correto para id hikvision', () => {
    expect(resolveProfileLabel('hikvision')).toBe('Hikvision');
  });

  it('retorna o label do perfil genérico para id null', () => {
    const label = resolveProfileLabel(null);
    expect(label).toContain('Genérico');
  });

  it('retorna o label do perfil genérico para id desconhecido', () => {
    const label = resolveProfileLabel('marca-nao-cadastrada');
    expect(label).toContain('Genérico');
  });
});

// ─── Regras de estado ─────────────────────────────────────────────────────────

/**
 * A lógica de classificação de estado está em probeSnmp() — testamos aqui via
 * função auxiliar local para não precisar de PrismaService/MQTT em teste.
 */

type MockCapabilityState =
  | 'SUPPORTED'
  | 'UNSUPPORTED'
  | 'TEMPORARY_ERROR'
  | 'NO_PERMISSION';

function classifyOidState(
  reachable: boolean,
  cause: 'community' | 'no_response' | null,
  oidResponded: boolean,
): MockCapabilityState {
  if (!reachable) {
    return cause === 'community' ? 'NO_PERMISSION' : 'TEMPORARY_ERROR';
  }
  return oidResponded ? 'SUPPORTED' : 'UNSUPPORTED';
}

describe('classifyOidState() — regras de classificação de estado', () => {
  it('reachable=false + cause=community → NO_PERMISSION', () => {
    expect(classifyOidState(false, 'community', false)).toBe('NO_PERMISSION');
  });

  it('reachable=false + cause=no_response → TEMPORARY_ERROR', () => {
    expect(classifyOidState(false, 'no_response', false)).toBe('TEMPORARY_ERROR');
  });

  it('reachable=true + OID respondeu → SUPPORTED', () => {
    expect(classifyOidState(true, null, true)).toBe('SUPPORTED');
  });

  it('reachable=true + OID não respondeu → UNSUPPORTED (câmera viva, métrica ausente)', () => {
    // noSuchObject prova câmera viva → UNSUPPORTED (não TEMPORARY_ERROR).
    // Idem para ONVIF sem canal SNMP: incapacidade estrutural, não falha transitória.
    expect(classifyOidState(true, null, false)).toBe('UNSUPPORTED');
  });
});
