import {
  isConditionMet,
  nextStateOnCondition,
  nextStateOnAck,
  type EvalRule,
  type EngineState,
} from './alarm-evaluator.js';

const analog = (over: Partial<EvalRule>): EvalRule => ({ type: 'VALUE_RANGE', hysteresis: 0, ...over });

describe('isConditionMet — STATE_CHANGE (digital)', () => {
  it('dispara quando o estado bate com activationState=true', () => {
    const rule: EvalRule = { type: 'STATE_CHANGE', activationState: true };
    expect(isConditionMet(rule, 1, false)).toBe(true);
    expect(isConditionMet(rule, 0, false)).toBe(false);
  });

  it('dispara quando o estado bate com activationState=false', () => {
    const rule: EvalRule = { type: 'STATE_CHANGE', activationState: false };
    expect(isConditionMet(rule, 0, false)).toBe(true);
    expect(isConditionMet(rule, 1, false)).toBe(false);
  });

  it('trata activationState ausente como true', () => {
    const rule: EvalRule = { type: 'STATE_CHANGE' };
    expect(isConditionMet(rule, 1, false)).toBe(true);
  });
});

describe('isConditionMet — VALUE_RANGE sem histerese', () => {
  it('GT', () => {
    const rule = analog({ condition: 'GT', limitValue: 50 });
    expect(isConditionMet(rule, 51, false)).toBe(true);
    expect(isConditionMet(rule, 50, false)).toBe(false);
    expect(isConditionMet(rule, 49, false)).toBe(false);
  });

  it('GTE / LT / LTE', () => {
    expect(isConditionMet(analog({ condition: 'GTE', limitValue: 50 }), 50, false)).toBe(true);
    expect(isConditionMet(analog({ condition: 'LT', limitValue: 10 }), 9, false)).toBe(true);
    expect(isConditionMet(analog({ condition: 'LT', limitValue: 10 }), 10, false)).toBe(false);
    expect(isConditionMet(analog({ condition: 'LTE', limitValue: 10 }), 10, false)).toBe(true);
  });

  it('BETWEEN dispara DENTRO da faixa', () => {
    const rule = analog({ condition: 'BETWEEN', limitLow: 20, limitHigh: 30 });
    expect(isConditionMet(rule, 25, false)).toBe(true);
    expect(isConditionMet(rule, 20, false)).toBe(true);
    expect(isConditionMet(rule, 31, false)).toBe(false);
    expect(isConditionMet(rule, 19, false)).toBe(false);
  });

  it('OUTSIDE dispara FORA da faixa', () => {
    const rule = analog({ condition: 'OUTSIDE', limitLow: 20, limitHigh: 30 });
    expect(isConditionMet(rule, 25, false)).toBe(false);
    expect(isConditionMet(rule, 19, false)).toBe(true);
    expect(isConditionMet(rule, 31, false)).toBe(true);
  });
});

describe('isConditionMet — histerese (banda morta)', () => {
  it('GT: não normaliza dentro da banda morta', () => {
    // limite >50, histerese 2 → normaliza só abaixo de 48.
    const rule = analog({ condition: 'GT', limitValue: 50, hysteresis: 2 });
    expect(isConditionMet(rule, 51, false)).toBe(true); // dispara
    expect(isConditionMet(rule, 49, true)).toBe(true); // ativo: ainda dentro da banda morta
    expect(isConditionMet(rule, 48, true)).toBe(false); // ativo: recuou além → normaliza
    expect(isConditionMet(rule, 49, false)).toBe(false); // inativo: não dispara em 49
  });

  it('LT: banda morta superior', () => {
    // limite <10, histerese 2 → normaliza só acima de 12.
    const rule = analog({ condition: 'LT', limitValue: 10, hysteresis: 2 });
    expect(isConditionMet(rule, 9, false)).toBe(true);
    expect(isConditionMet(rule, 11, true)).toBe(true); // ativo dentro da banda
    expect(isConditionMet(rule, 12, true)).toBe(false); // normaliza
  });

  it('OUTSIDE: histerese estreita a banda normal antes de normalizar', () => {
    const rule = analog({ condition: 'OUTSIDE', limitLow: 20, limitHigh: 30, hysteresis: 2 });
    expect(isConditionMet(rule, 18, false)).toBe(true); // dispara abaixo de 20
    expect(isConditionMet(rule, 21, true)).toBe(true); // ativo: ainda < 22 (low+h)
    expect(isConditionMet(rule, 23, true)).toBe(false); // normaliza dentro de [22, 28]
  });
});

describe('nextStateOnCondition — máquina de estados', () => {
  it('INACTIVE → ACTIVE quando a condição é satisfeita', () => {
    expect(nextStateOnCondition('INACTIVE', true)).toBe('ACTIVE');
    expect(nextStateOnCondition('INACTIVE', false)).toBe('INACTIVE');
  });

  it('ACTIVE → NORMALIZED_UNACK quando a condição cessa', () => {
    expect(nextStateOnCondition('ACTIVE', true)).toBe('ACTIVE');
    expect(nextStateOnCondition('ACTIVE', false)).toBe('NORMALIZED_UNACK');
  });

  it('ACTIVE_ACK → NORMALIZED_ACK quando a condição cessa (ramo reconhecido)', () => {
    expect(nextStateOnCondition('ACTIVE_ACK', true)).toBe('ACTIVE_ACK');
    expect(nextStateOnCondition('ACTIVE_ACK', false)).toBe('NORMALIZED_ACK');
  });

  it('NORMALIZED_* são terminais (não reabrem a mesma ocorrência)', () => {
    const terminals: EngineState[] = ['NORMALIZED_UNACK', 'NORMALIZED_ACK'];
    for (const s of terminals) {
      expect(nextStateOnCondition(s, true)).toBe(s);
      expect(nextStateOnCondition(s, false)).toBe(s);
    }
  });
});

describe('nextStateOnAck — reconhecimento do operador', () => {
  it('NORMALIZED_UNACK → NORMALIZED_ACK', () => {
    expect(nextStateOnAck('NORMALIZED_UNACK')).toBe('NORMALIZED_ACK');
  });

  it('ACTIVE permanece ACTIVE (alarme ativo não é reconhecível)', () => {
    expect(nextStateOnAck('ACTIVE')).toBe('ACTIVE');
  });

  it('estados não-reconhecíveis permanecem', () => {
    expect(nextStateOnAck('INACTIVE')).toBe('INACTIVE');
    expect(nextStateOnAck('ACTIVE_ACK')).toBe('ACTIVE_ACK');
    expect(nextStateOnAck('NORMALIZED_ACK')).toBe('NORMALIZED_ACK');
  });
});

describe('máquina de estados — ciclo completo', () => {
  it('ACTIVE → NORMALIZED_UNACK → NORMALIZED_ACK', () => {
    let s: EngineState = 'INACTIVE';
    s = nextStateOnCondition(s, true);
    expect(s).toBe('ACTIVE');
    s = nextStateOnCondition(s, false);
    expect(s).toBe('NORMALIZED_UNACK');
    s = nextStateOnAck(s);
    expect(s).toBe('NORMALIZED_ACK');
  });

  it('ACK enquanto ativo é ignorado; só reconhece após normalizar', () => {
    let s: EngineState = 'INACTIVE';
    s = nextStateOnCondition(s, true);
    expect(s).toBe('ACTIVE');
    s = nextStateOnAck(s);
    expect(s).toBe('ACTIVE'); // ativo não é reconhecível
    s = nextStateOnCondition(s, false);
    expect(s).toBe('NORMALIZED_UNACK');
    s = nextStateOnAck(s);
    expect(s).toBe('NORMALIZED_ACK');
  });
});
