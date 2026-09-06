import { showNoCommBadge } from './point-no-comm';

describe('showNoCommBadge — selo neutro por ponto quando o equipamento está sem comunicação', () => {
  describe('equipamento SEM comunicação (banner âmbar visível)', () => {
    it('substitui o selo "normal" (verde) pelo selo neutro', () => {
      expect(showNoCommBadge(true, 'normal')).toBe(true);
    });

    it('aceita variações de caixa vindas do backend', () => {
      expect(showNoCommBadge(true, 'Normal')).toBe(true);
      expect(showNoCommBadge(true, 'NORMAL')).toBe(true);
    });

    it('PRESERVA o selo "alarm" (vermelho) — severidade nunca é ocultada', () => {
      expect(showNoCommBadge(true, 'alarm')).toBe(false);
    });

    it('PRESERVA o selo "fault" (âmbar) — severidade nunca é ocultada', () => {
      expect(showNoCommBadge(true, 'fault')).toBe(false);
    });

    it('status desconhecido/ausente não vira selo neutro (mantém o selo original)', () => {
      expect(showNoCommBadge(true, undefined)).toBe(false);
      expect(showNoCommBadge(true, null)).toBe(false);
      expect(showNoCommBadge(true, '')).toBe(false);
      expect(showNoCommBadge(true, 'unknown')).toBe(false);
    });
  });

  describe('equipamento COM comunicação (inclui heartbeat online / carência inicial)', () => {
    it('nunca substitui o selo, qualquer que seja o status do ponto', () => {
      expect(showNoCommBadge(false, 'normal')).toBe(false);
      expect(showNoCommBadge(false, 'alarm')).toBe(false);
      expect(showNoCommBadge(false, 'fault')).toBe(false);
    });
  });
});
