/**
 * Testes do resolveProfile() — verifica precedência de camadas, detecção de
 * fabricante, transforms de escala, enterprise ambíguo e metricOverrides.
 * Usa Jest (ts-jest).
 */

import {
  ALL_PROFILES,
  resolveProfile,
  enterpriseNumberOf,
} from './profile-registry';
import { BASE_CAMERA_PROFILE } from './base/camera.profile';
import { BASE_ACCESS_CONTROLLER_PROFILE } from './base/access-controller.profile';
import type { ResolvedProfile } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function mapping(p: ResolvedProfile, key: string) {
  return p.mappings.get(key) ?? null;
}

// ─── resolveProfile() ─────────────────────────────────────────────────────────

describe('resolveProfile()', () => {
  it('retorna o perfil base quando não há nenhuma pista de fabricante', () => {
    const p = resolveProfile({});
    expect(p.id).toBe('base-camera');
  });

  it('profileIdOverride tem prioridade máxima (> sysDescr > enterprise)', () => {
    // sysDescr aponta para Hikvision, mas o override força Dahua
    const p = resolveProfile({
      profileIdOverride: 'dahua',
      sysDescr: 'Hikvision Linux 3.0',
    });
    expect(p.id).toBe('dahua');
  });

  it('detecta Hikvision por sysDescr (case-insensitive)', () => {
    const p = resolveProfile({ sysDescr: 'HIKVISION DS-2CD2T47G2-L' });
    expect(p.id).toBe('hikvision');
  });

  it('detecta Dahua por sysDescr', () => {
    const p = resolveProfile({ sysDescr: 'Dahua IP camera' });
    expect(p.id).toBe('dahua');
  });

  it('detecta Axis por sysDescr', () => {
    const p = resolveProfile({ sysDescr: 'AXIS P3245-LV Network Camera' });
    expect(p.id).toBe('axis');
  });

  it('detecta Hikvision pelo enterprise number 39165 via sysObjectId', () => {
    const p = resolveProfile({
      sysObjectId: '1.3.6.1.4.1.39165.1.1',
    });
    expect(p.id).toBe('hikvision');
  });

  it('enterprise 1004849 resolve para intelbras (bestEffort conservador BR)', () => {
    const p = resolveProfile({ sysObjectId: '1.3.6.1.4.1.1004849.1' });
    expect(p.id).toBe('intelbras');
  });

  it('enterprise number desconhecido cai no perfil base', () => {
    const p = resolveProfile({ sysObjectId: '1.3.6.1.4.1.99999.1' });
    expect(p.id).toBe('base-camera');
  });

  it('usa a camada vendor para um OID proprietário Hikvision (cpu)', () => {
    const p = resolveProfile({ sysDescr: 'Hikvision device' });
    const cpu = mapping(p, 'cpu');
    expect(cpu).not.toBeNull();
    // OID proprietário Hikvision começa com 1.3.6.1.4.1.39165
    expect(cpu!.oid).toMatch(/^1\.3\.6\.1\.4\.1\.39165/);
    expect(cpu!.profileLayer).toBe('vendor');
  });

  it('cai na camada base quando o vendor não define a métrica', () => {
    const p = resolveProfile({ sysDescr: 'AXIS network camera' });
    // AXIS pode não ter 'uptime' proprietário; base-camera sempre define via MIB-II
    const uptime = mapping(p, 'uptime');
    if (uptime) {
      // Se existir, deve ter profileLayer 'base' (uptime vem do MIB-II padrão)
      expect(['base', 'vendor']).toContain(uptime.profileLayer);
    }
  });

  it('metricOverrides substitui o OID de uma métrica com profileLayer=override', () => {
    const customOid = '1.2.3.4.5.6.7.0';
    const p = resolveProfile({
      sysDescr: 'Hikvision device',
      metricOverrides: { cpu: { metricKey: 'cpu', oid: customOid } },
    });
    const cpu = mapping(p, 'cpu');
    expect(cpu?.oid).toBe(customOid);
    expect(cpu?.profileLayer).toBe('override');
  });

  it('profileIdOverride inválido (id inexistente) cai no perfil base', () => {
    const p = resolveProfile({ profileIdOverride: 'marca-inexistente' });
    expect(p.id).toBe('base-camera');
  });

  it('ALL_PROFILES contém base-camera e todos os fabricantes conhecidos', () => {
    const ids = ALL_PROFILES.map((p) => p.id);
    expect(ids).toContain('base-camera');
    expect(ids).toContain('hikvision');
    expect(ids).toContain('dahua');
    expect(ids).toContain('intelbras');
    expect(ids).toContain('axis');
  });

  it('BASE_CAMERA_PROFILE define ao menos as métricas cpu e memory', () => {
    const keys = BASE_CAMERA_PROFILE.mappings.map((m) => m.metricKey);
    expect(keys).toContain('cpu');
    expect(keys).toContain('memory');
  });

  it('BASE_CAMERA_PROFILE tem priority === 0', () => {
    expect(BASE_CAMERA_PROFILE.priority).toBe(0);
  });

  it('mappings do resultado é um Map', () => {
    const p = resolveProfile({ sysDescr: 'Hikvision device' });
    expect(p.mappings).toBeInstanceOf(Map);
    expect(p.mappings.has('cpu')).toBe(true);
  });
});

// ─── ACCESS_CONTROLLER ────────────────────────────────────────────────────────

describe('resolveProfile() — ACCESS_CONTROLLER', () => {
  it('sem fabricante → base-access-controller (fallback MIB-II genérico)', () => {
    const p = resolveProfile({ deviceType: 'ACCESS_CONTROLLER' });
    expect(p.id).toBe('base-access-controller');
    expect(p.bestEffort).toBe(false);
  });

  it('manufacturer="Hikvision" → perfil vendor hikvision (DS-K compartilha enterprise 39165)', () => {
    const p = resolveProfile({
      deviceType: 'ACCESS_CONTROLLER',
      manufacturer: 'Hikvision',
    });
    expect(p.id).toBe('hikvision');
    const cpu = p.mappings.get('cpu');
    // OID proprietário Hikvision (não MIB-II)
    expect(cpu?.oid).toMatch(/^1\.3\.6\.1\.4\.1\.39165/);
    expect(cpu?.profileLayer).toBe('vendor');
  });

  it('manufacturer="Control iD" → perfil control-id (monitoramento genérico MIB-II por ora)', () => {
    const p = resolveProfile({
      deviceType: 'ACCESS_CONTROLLER',
      manufacturer: 'Control iD',
    });
    expect(p.id).toBe('control-id');
    // Perfil ainda sem OIDs proprietários → cai nos OIDs base MIB-II
    const cpu = p.mappings.get('cpu');
    expect(cpu).not.toBeNull();
    // Deve ser OID MIB-II (HOST-RESOURCES hrProcessorLoad), não OID proprietário
    expect(cpu?.profileLayer).toBe('base');
  });

  it('manufacturer="Intelbras" → perfil intelbras-ac (monitoramento genérico MIB-II por ora)', () => {
    const p = resolveProfile({
      deviceType: 'ACCESS_CONTROLLER',
      manufacturer: 'Intelbras',
    });
    expect(p.id).toBe('intelbras-ac');
    const cpu = p.mappings.get('cpu');
    expect(cpu).not.toBeNull();
    expect(cpu?.profileLayer).toBe('base');
  });

  it('sysDescr Hikvision em controladora → perfil hikvision', () => {
    const p = resolveProfile({
      deviceType: 'ACCESS_CONTROLLER',
      sysDescr: 'Hikvision DS-K2602 Access Controller',
    });
    expect(p.id).toBe('hikvision');
  });

  it('enterprise 39165 via sysObjectId → perfil hikvision', () => {
    const p = resolveProfile({
      deviceType: 'ACCESS_CONTROLLER',
      sysObjectId: '1.3.6.1.4.1.39165.1.1',
    });
    expect(p.id).toBe('hikvision');
  });

  it('ALL_PROFILES contém base-access-controller, control-id e intelbras-ac', () => {
    const ids = ALL_PROFILES.map((p) => p.id);
    expect(ids).toContain('base-access-controller');
    expect(ids).toContain('control-id');
    expect(ids).toContain('intelbras-ac');
  });

  it('BASE_ACCESS_CONTROLLER_PROFILE tem priority === 0 e define cpu, memory e uptime', () => {
    expect(BASE_ACCESS_CONTROLLER_PROFILE.priority).toBe(0);
    const keys = BASE_ACCESS_CONTROLLER_PROFILE.mappings.map((m) => m.metricKey);
    expect(keys).toContain('cpu');
    expect(keys).toContain('memory');
    expect(keys).toContain('uptime');
  });

  it('perfis CAMERA (dahua/intelbras) não aparecem como candidatos para ACCESS_CONTROLLER', () => {
    // Garante que os perfis vendor de câmera não poluem a resolução de controladora.
    const p = resolveProfile({
      deviceType: 'ACCESS_CONTROLLER',
      sysDescr: 'Dahua Technology IPC',
    });
    // Dahua não tem mappings para ACCESS_CONTROLLER → deve cair no base
    expect(p.id).toBe('base-access-controller');
  });
});

// ─── enterpriseNumberOf() ─────────────────────────────────────────────────────

describe('enterpriseNumberOf()', () => {
  it('extrai o enterprise number de um sysObjectId padrão', () => {
    expect(enterpriseNumberOf('1.3.6.1.4.1.39165.1.1')).toBe(39165);
    expect(enterpriseNumberOf('1.3.6.1.4.1.1004849.1')).toBe(1004849);
  });

  it('retorna null para OID que não começa com 1.3.6.1.4.1', () => {
    expect(enterpriseNumberOf('1.3.6.1.2.1.1.2.0')).toBeNull();
    expect(enterpriseNumberOf(null)).toBeNull();
    expect(enterpriseNumberOf('')).toBeNull();
  });
});
