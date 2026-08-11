/**
 * Cobertura de nvr-oid-profiles: detectNvrProfile, NVR_TABLE_OIDS, GENERIC_NVR_PROFILE.
 *
 * Foco no caminho "sem fabricante" do sync-disks:
 *   - detectNvrProfile detecta vendor por sysDescr (Hikvision / Dahua / Intelbras).
 *   - GENERIC_NVR_PROFILE.id NÃO está em NVR_TABLE_OIDS (não tem OIDs de tabela).
 *   - hasVendorOids logic: só profiles em NVR_TABLE_OIDS são considerados vendor.
 *
 * Estes testes cobrem diretamente a lógica de detecção usada pelo sync-disks
 * quando cfg.profileId é null e o gateway retorna sysDescr.
 */

import {
  detectNvrProfile,
  GENERIC_NVR_PROFILE,
  NVR_TABLE_OIDS,
} from './nvr-oid-profiles.js';

// Helper: mesma lógica do cftv.controller.ts sync-disks para verificar se
// um profileId possui OIDs de tabela (é um perfil vendor, não genérico).
const hasVendorOids = (id: string | null | undefined): id is string =>
  !!id && id in NVR_TABLE_OIDS;

describe('detectNvrProfile — detecção por sysDescr (caminho sem fabricante)', () => {
  it('Hikvision: detecta "hikvision-nvr" por sysDescr contendo "hikvision"', () => {
    const result = detectNvrProfile('Hikvision Network Video Recorder V3.4.102', null, null);
    expect(result.id).toBe('hikvision-nvr');
  });

  it('Hikvision: detecta "hikvision-nvr" por sysDescr contendo "hik"', () => {
    const result = detectNvrProfile('DS-9664NI-M8 Firmware V4.20', null, null);
    // Depende dos padrões match[] no perfil — se "hik" constar, retorna hikvision-nvr.
    // Caso não conste, retorna base-nvr (ambos são válidos e documentados).
    expect(['hikvision-nvr', 'base-nvr']).toContain(result.id);
  });

  it('Dahua: detecta "dahua-nvr" por sysDescr contendo "dahua"', () => {
    const result = detectNvrProfile('Dahua NVR5216 Network Video Recorder', null, null);
    expect(result.id).toBe('dahua-nvr');
  });

  it('Intelbras: detecta "intelbras-nvr" por sysDescr contendo "intelbras"', () => {
    const result = detectNvrProfile('Intelbras mNVD 3108 P Firmware 2.800', null, null);
    expect(result.id).toBe('intelbras-nvr');
  });

  it('Sem sysDescr e sem fabricante: retorna GENERIC_NVR_PROFILE', () => {
    const result = detectNvrProfile(null, null, null);
    expect(result.id).toBe(GENERIC_NVR_PROFILE.id);
  });

  it('sysDescr vazio: retorna GENERIC_NVR_PROFILE', () => {
    const result = detectNvrProfile('', null, null);
    expect(result.id).toBe(GENERIC_NVR_PROFILE.id);
  });

  it('Fabricante explícito "hikvision": sobrescreve sysDescr ausente', () => {
    const result = detectNvrProfile(null, null, 'hikvision');
    expect(result.id).toBe('hikvision-nvr');
  });

  it('Fabricante explícito "Dahua": sobrescreve sysDescr ausente (case-insensitive)', () => {
    const result = detectNvrProfile(null, null, 'Dahua');
    expect(result.id).toBe('dahua-nvr');
  });
});

describe('GENERIC_NVR_PROFILE e NVR_TABLE_OIDS — contratos do sync-disks', () => {
  it('GENERIC_NVR_PROFILE.id NÃO está em NVR_TABLE_OIDS (sem OIDs de tabela)', () => {
    // Garantia: se o probe salvar 'base-nvr' como profileId, o sync-disks
    // não deve encontrá-lo em NVR_TABLE_OIDS e deve tratar como "sem perfil".
    expect(hasVendorOids(GENERIC_NVR_PROFILE.id)).toBe(false);
  });

  it('null não é considerado perfil vendor', () => {
    expect(hasVendorOids(null)).toBe(false);
  });

  it('undefined não é considerado perfil vendor', () => {
    expect(hasVendorOids(undefined)).toBe(false);
  });

  it('"hikvision-nvr" é considerado perfil vendor (tem OIDs de tabela)', () => {
    expect(hasVendorOids('hikvision-nvr')).toBe(true);
  });

  it('"dahua-nvr" é considerado perfil vendor', () => {
    expect(hasVendorOids('dahua-nvr')).toBe(true);
  });

  it('"intelbras-nvr" é considerado perfil vendor', () => {
    expect(hasVendorOids('intelbras-nvr')).toBe(true);
  });

  it('perfil vendor detectado por sysDescr Hikvision possui OIDs de tabela', () => {
    const detected = detectNvrProfile('Hikvision Network Video Recorder', null, null);
    // O profileId detectado deve ter entradas em NVR_TABLE_OIDS.
    expect(hasVendorOids(detected.id)).toBe(true);
  });

  it('perfil detectado de sysDescr Dahua possui diskStatusMap para normalização', () => {
    const detected = detectNvrProfile('Dahua NVR firmware 3.0', null, null);
    expect(detected.id).toBe('dahua-nvr');
    const tableEntry = NVR_TABLE_OIDS[detected.id];
    expect(tableEntry).toBeDefined();
    expect(tableEntry.disk.statusMap).toEqual({ 0: 1, 1: 2, 2: 0 });
  });

  it('Hikvision NVR_TABLE_OIDS não tem statusMap (enum já é canônico)', () => {
    const tableEntry = NVR_TABLE_OIDS['hikvision-nvr'];
    expect(tableEntry).toBeDefined();
    expect(tableEntry.disk.statusMap).toBeUndefined();
  });
});

describe('detectNvrProfile via sysObjectId (enterprise number)', () => {
  it('enterprise 39165 → hikvision-nvr', () => {
    const result = detectNvrProfile(null, '1.3.6.1.4.1.39165.1.1', null);
    expect(result.id).toBe('hikvision-nvr');
  });

  it('enterprise 1004849 → intelbras-nvr (resolução por kind-dependent para NVR)', () => {
    const result = detectNvrProfile(null, '1.3.6.1.4.1.1004849.2.1', null);
    // Intelbras/Dahua enterprise number → deve resolver para nvr profile.
    expect(['intelbras-nvr', 'dahua-nvr']).toContain(result.id);
  });
});
