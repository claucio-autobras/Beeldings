import { repairMojibake } from './mojibake-repair.util';

const FFFD = '\uFFFD';

describe('repairMojibake', () => {
  it('retorna texto sem � inalterado', () => {
    expect(repairMojibake('sem problema')).toBe('sem problema');
    expect(repairMojibake('')).toBe('');
  });

  it('repara palavras do dicionário com � no meio', () => {
    expect(repairMojibake(`Po${FFFD}o de Esgoto - N${FFFD}vel M${FFFD}nimo DI7`)).toBe(
      'Poço de Esgoto - Nível Mínimo DI7',
    );
    expect(repairMojibake(`S${FFFD}ntese de falhas da Bomba 2`)).toBe(
      'Síntese de falhas da Bomba 2',
    );
    expect(repairMojibake(`Extravas${FFFD}o DI19`)).toBe('Extravasão DI19');
  });

  it('repara múltiplos � no mesmo texto e palavras com separadores', () => {
    expect(
      repairMojibake(`Monitoramento Chave manual/autom${FFFD}tico/remoto (BAS) da Bomba 1`),
    ).toBe('Monitoramento Chave manual/automático/remoto (BAS) da Bomba 1');
  });

  it('preserva ALL CAPS', () => {
    expect(repairMojibake(`PRESS${FFFD}O ALTA`)).toBe('PRESSÃO ALTA');
  });

  it('� na 1ª letra segue o contexto de caixa do texto', () => {
    expect(repairMojibake(`${FFFD}gua Gelada`)).toBe('Água Gelada');
    expect(repairMojibake(`po${FFFD}o de ${FFFD}gua`)).toBe('poço de água');
  });

  it('nunca chuta fora do dicionário', () => {
    expect(repairMojibake(`Desconhecid${FFFD}a xyz`)).toBe(`Desconhecid${FFFD}a xyz`);
  });
});
