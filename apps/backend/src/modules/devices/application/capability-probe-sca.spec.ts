/**
 * Testes de regressão para o suporte a ACCESS_CONTROLLER no CapabilityProbeService.
 *
 * Cobre:
 *   1. detectAcProfileFromSnmpProbe() — detecção pelo catálogo SCA.
 *   2. resolveAcProfileLabel() — resolução de label pelo catálogo SCA.
 *   3. Prova de não-regressão: câmeras continuam usando o catálogo de câmeras
 *      (detectProfileFromSnmpProbe / resolveProfileLabel inalterados).
 */

import {
  detectProfileFromSnmpProbe,
  detectAcProfileFromSnmpProbe,
  resolveProfileLabel,
  resolveAcProfileLabel,
} from './capability-probe.service';

// ─── detectAcProfileFromSnmpProbe() ──────────────────────────────────────────

describe('detectAcProfileFromSnmpProbe()', () => {
  it('retorna perfil genérico SCA quando não há nenhuma pista', () => {
    const p = detectAcProfileFromSnmpProbe(null, null, null);
    expect(p.id).toBe('generic');
    // O label do perfil genérico SCA é distinto do genérico de câmera
    expect(p.label).toContain('Genérico');
  });

  it('detecta Control iD pelo manufacturer hint', () => {
    const p = detectAcProfileFromSnmpProbe(null, null, 'Control iD');
    expect(p.id).toBe('control-id');
  });

  it('detecta Control iD pelo sysDescr (case-insensitive)', () => {
    const p = detectAcProfileFromSnmpProbe('CONTROLID iDAccess Pro', null, null);
    expect(p.id).toBe('control-id');
  });

  it('detecta Intelbras AC pelo manufacturer hint', () => {
    const p = detectAcProfileFromSnmpProbe(null, null, 'Intelbras');
    expect(p.id).toBe('intelbras-ac');
  });

  it('detecta Intelbras AC pelo sysDescr', () => {
    const p = detectAcProfileFromSnmpProbe('Intelbras iDBox-1060 Face', null, null);
    expect(p.id).toBe('intelbras-ac');
  });

  it('detecta Hikvision AC pelo manufacturer hint → hikvision-ac (não "hikvision" de câmera)', () => {
    const p = detectAcProfileFromSnmpProbe(null, null, 'Hikvision');
    expect(p.id).toBe('hikvision-ac');
    // NÃO deve retornar 'hikvision' (ID do catálogo de câmeras)
    expect(p.id).not.toBe('hikvision');
  });

  it('detecta Hikvision AC pelo sysDescr', () => {
    const p = detectAcProfileFromSnmpProbe('Hikvision DS-K2602 Linux 3.0', null, null);
    expect(p.id).toBe('hikvision-ac');
  });

  it('detecta Hikvision AC pelo enterprise 39165 no sysObjectId → hikvision-ac', () => {
    const p = detectAcProfileFromSnmpProbe(null, '1.3.6.1.4.1.39165.1.1', null);
    expect(p.id).toBe('hikvision-ac');
  });

  it('detecta Control iD pelo enterprise 34475 no sysObjectId', () => {
    const p = detectAcProfileFromSnmpProbe(null, '1.3.6.1.4.1.34475.1', null);
    expect(p.id).toBe('control-id');
  });

  it('enterprise desconhecido → perfil genérico SCA', () => {
    const p = detectAcProfileFromSnmpProbe(null, '1.3.6.1.4.1.99999.1', null);
    expect(p.id).toBe('generic');
  });

  it('manufacturer tem prioridade sobre sysDescr (Hikvision hint + sysDescr Intelbras)', () => {
    const p = detectAcProfileFromSnmpProbe('Intelbras iDFace 300', null, 'Hikvision');
    expect(p.id).toBe('hikvision-ac');
  });

  it('perfil detectado tem campo match não vazio (não é o genérico de fallback)', () => {
    const p = detectAcProfileFromSnmpProbe(null, null, 'Hikvision');
    expect(p.match.length).toBeGreaterThan(0);
  });
});

// ─── resolveAcProfileLabel() ──────────────────────────────────────────────────

describe('resolveAcProfileLabel()', () => {
  it('retorna label correto para id "control-id"', () => {
    const label = resolveAcProfileLabel('control-id');
    expect(label).toContain('Control iD');
  });

  it('retorna label correto para id "intelbras-ac"', () => {
    const label = resolveAcProfileLabel('intelbras-ac');
    expect(label.toLowerCase()).toContain('intelbras');
  });

  it('retorna label correto para id "hikvision-ac"', () => {
    const label = resolveAcProfileLabel('hikvision-ac');
    expect(label.toLowerCase()).toContain('hikvision');
  });

  it('retorna label do perfil genérico para id null', () => {
    const label = resolveAcProfileLabel(null);
    expect(label).toContain('Genérico');
  });

  it('retorna label do perfil genérico para id desconhecido', () => {
    const label = resolveAcProfileLabel('id-nao-cadastrado');
    expect(label).toContain('Genérico');
  });

  it('NÃO retorna label de câmera para id de perfil SCA (catálogos são isolados)', () => {
    // 'hikvision-ac' NÃO existe no catálogo de câmeras — não deve retornar
    // o label de câmera Hikvision.
    const acLabel = resolveAcProfileLabel('hikvision-ac');
    const cameraLabel = resolveProfileLabel('hikvision');
    // Ambos existem mas em catálogos distintos
    expect(acLabel).not.toBe(cameraLabel);
  });
});

// ─── Não-regressão: catálogo de câmeras inalterado ───────────────────────────

describe('detectProfileFromSnmpProbe() — câmeras inalteradas (regressão)', () => {
  it('Hikvision por sysDescr → id "hikvision" (catálogo câmera)', () => {
    const p = detectProfileFromSnmpProbe('HIKVISION DS-2CD2043', null, null);
    expect(p.id).toBe('hikvision');
    // ID de câmera, não de AC
    expect(p.id).not.toBe('hikvision-ac');
  });

  it('Dahua por sysDescr → id "dahua"', () => {
    const p = detectProfileFromSnmpProbe('Dahua Technology NVR', null, null);
    expect(p.id).toBe('dahua');
  });

  it('enterprise 39165 → "hikvision" (catálogo câmera, não "hikvision-ac")', () => {
    const p = detectProfileFromSnmpProbe(null, '1.3.6.1.4.1.39165.1.1', null);
    expect(p.id).toBe('hikvision');
    expect(p.id).not.toBe('hikvision-ac');
  });

  it('sem pistas → perfil genérico de câmera (id "generic")', () => {
    const p = detectProfileFromSnmpProbe(null, null, null);
    expect(p.id).toBe('generic');
  });
});

describe('resolveProfileLabel() — câmeras inalteradas (regressão)', () => {
  it('"hikvision" → label Hikvision', () => {
    expect(resolveProfileLabel('hikvision')).toBe('Hikvision');
  });

  it('null → label genérico', () => {
    expect(resolveProfileLabel(null)).toContain('Genérico');
  });

  it('"hikvision-ac" (ID SCA) → label genérico (não conhecido no catálogo câmera)', () => {
    // O catálogo de câmeras não conhece IDs SCA — deve cair no genérico.
    expect(resolveProfileLabel('hikvision-ac')).toContain('Genérico');
  });
});
