/**
 * Recuperação de cadastros antigos de controladoras SCA (task "ler dados logo
 * após salvar"): bindings com o OID genérico ENGESSADO do seed do cadastro
 * antigo — e nunca tocados pelo diagnóstico/edição manual — são re-resolvidos
 * para `oid: null` no publish, devolvendo a resolução de OID à cadeia de
 * perfis base→fabricante do gateway. OIDs aplicados deliberadamente pelo
 * operador/diagnóstico ficam intactos.
 */
import { isLegacySeededAcBinding } from './device-config-publisher.service.js';

describe('isLegacySeededAcBinding', () => {
  it('reconhece o seed engessado do cadastro antigo (metric + OID genérico, sem `unsupported`)', () => {
    expect(
      isLegacySeededAcBinding({ metric: 'cpu', oid: '1.3.6.1.2.1.25.3.3.1.2.1', scale: 1 }),
    ).toBe(true);
    expect(
      isLegacySeededAcBinding({ metric: 'memory', oid: '1.3.6.1.4.1.2021.4.6.0', scale: 1 }),
    ).toBe(true);
    expect(
      isLegacySeededAcBinding({
        metric: 'temperature',
        oid: '1.3.6.1.4.1.2021.13.16.2.1.3.1',
        scale: 0.001,
      }),
    ).toBe(true);
    expect(
      isLegacySeededAcBinding({ metric: 'packet_loss', oid: '1.3.6.1.2.1.2.2.1.13.1', scale: 1 }),
    ).toBe(true);
  });

  it('binding tocado pelo diagnóstico/manual (chave `unsupported` presente) NUNCA é re-resolvido', () => {
    // Diagnóstico e edição manual sempre gravam `unsupported` no binding —
    // mesmo que o OID escolhido coincida com o genérico, foi deliberado.
    expect(
      isLegacySeededAcBinding({
        metric: 'cpu',
        oid: '1.3.6.1.2.1.25.3.3.1.2.1',
        scale: 1,
        unsupported: false,
      }),
    ).toBe(false);
    expect(
      isLegacySeededAcBinding({
        metric: 'memory',
        oid: '1.3.6.1.4.1.2021.4.6.0',
        scale: 1,
        unsupported: true,
      }),
    ).toBe(false);
  });

  it('OID diferente do seed genérico (proprietário/custom) fica intacto', () => {
    expect(
      isLegacySeededAcBinding({ metric: 'cpu', oid: '1.3.6.1.4.1.49617.1.1.4.0', scale: 1 }),
    ).toBe(false);
    expect(isLegacySeededAcBinding({ metric: 'custom', oid: '1.3.6.1.2.1.25.3.3.1.2.1' })).toBe(
      false,
    );
  });

  it('binding sem OID, sem metric ou nulo → false (nada a recuperar)', () => {
    expect(isLegacySeededAcBinding({ metric: 'cpu', oid: null })).toBe(false);
    expect(isLegacySeededAcBinding({ oid: '1.3.6.1.2.1.25.3.3.1.2.1' })).toBe(false);
    expect(isLegacySeededAcBinding(null)).toBe(false);
    expect(isLegacySeededAcBinding(undefined)).toBe(false);
  });
});
