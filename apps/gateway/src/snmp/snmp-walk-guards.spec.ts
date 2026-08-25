/**
 * Specs dos guards do walk SNMP e da normalização ASN.1 na fronteira de
 * entrada (SNMP Fase 1 — bugs de coleta confirmados em campo no iDFlex V2).
 *
 * Cobre:
 *   - normalizeSnmpVarbind: TimeTicks ÷100 → s; Counter32/64 marcados como
 *     'counter' (taxa é do coletor); OCTET STRING numérico → float; INTEGER
 *     enumerado preservado.
 *   - compareOids: ordenação NUMÉRICA componente a componente.
 *   - WalkEntryCollector: guard de prefixo de subárvore, guard de OID não
 *     crescente (agente em loop) e varbinds de erro como fim normal.
 *   - nextMaxRepetitions: degradação em tooBig (metade, mínimo 1, null no fim).
 *   - isTooBigError: detecção por error-status 1 (RFC 1905) e por mensagem.
 */

import {
  compareOids,
  isTooBigError,
  nextMaxRepetitions,
  normalizeSnmpVarbind,
  oidIsUnderRoot,
  WalkEntryCollector,
} from './snmp-walk.util';

// Códigos ASN.1 (net-snmp ObjectType)
const T_INT = 2;
const T_STR = 4;
const T_COUNTER32 = 65;
const T_TIMETICKS = 67;
const T_COUNTER64 = 70;
const T_NO_SUCH_OBJECT = 128;
const T_NO_SUCH_INSTANCE = 129;
const T_END_OF_MIB_VIEW = 130;

describe('normalizeSnmpVarbind()', () => {
  it('TimeTicks: converte centésimos de segundo em segundos (kind duration)', () => {
    expect(normalizeSnmpVarbind(T_TIMETICKS, 360000)).toEqual({
      numeric: 3600,
      kind: 'duration',
    });
    expect(normalizeSnmpVarbind(T_TIMETICKS, 0)).toEqual({ numeric: 0, kind: 'duration' });
  });

  it('Counter32/Counter64: preserva o acumulador bruto e marca como counter', () => {
    expect(normalizeSnmpVarbind(T_COUNTER32, 123456)).toEqual({
      numeric: 123456,
      kind: 'counter',
    });
    expect(normalizeSnmpVarbind(T_COUNTER64, 9876543210)).toEqual({
      numeric: 9876543210,
      kind: 'counter',
    });
  });

  it('OCTET STRING numérico: converte para float (via parseSnmpNumber)', () => {
    expect(normalizeSnmpVarbind(T_STR, Buffer.from('23.436'))).toEqual({ numeric: 23.436 });
    // Formato vendor "45 PERCENT" também passa pelo parser central.
    expect(normalizeSnmpVarbind(T_STR, Buffer.from('45 PERCENT'))).toEqual({ numeric: 45 });
  });

  it('INTEGER enumerado: valor preservado sem conversão', () => {
    expect(normalizeSnmpVarbind(T_INT, 2)).toEqual({ numeric: 2 });
  });

  it('valor não numérico: numeric null, sem kind', () => {
    expect(normalizeSnmpVarbind(T_STR, Buffer.from('timed'))).toEqual({ numeric: null });
  });
});

describe('compareOids()', () => {
  it('ordena numericamente por componente (…2.10 > …2.9, nunca lexicográfico)', () => {
    expect(compareOids('1.3.6.1.2.1.2.2.1.2.10', '1.3.6.1.2.1.2.2.1.2.9')).toBeGreaterThan(0);
    expect(compareOids('1.3.6.1.2.1.2.2.1.2.9', '1.3.6.1.2.1.2.2.1.2.10')).toBeLessThan(0);
  });

  it('OIDs iguais → 0; prefixo é menor que descendente', () => {
    expect(compareOids('1.3.6.1', '1.3.6.1')).toBe(0);
    expect(compareOids('1.3.6.1', '1.3.6.1.2')).toBeLessThan(0);
    expect(compareOids('1.3.6.1.2', '1.3.6.1')).toBeGreaterThan(0);
  });
});

describe('oidIsUnderRoot()', () => {
  it('aceita a própria raiz e descendentes; rejeita irmãos com prefixo textual', () => {
    expect(oidIsUnderRoot('1.3.6.1.2.1.1', '1.3.6.1.2.1.1')).toBe(true);
    expect(oidIsUnderRoot('1.3.6.1.2.1.1.3.0', '1.3.6.1.2.1.1')).toBe(true);
    expect(oidIsUnderRoot('1.3.6.1.2.1.11.1.0', '1.3.6.1.2.1.1')).toBe(false);
    expect(oidIsUnderRoot('1.3.6.1.2.1.2.2.1.10.1', '1.3.6.1.2.1.1')).toBe(false);
  });
});

describe('WalkEntryCollector — guards contra agentes defeituosos', () => {
  const ROOT = '1.3.6.1.2.1.1';

  it('coleta entradas normais preservando tipo, valor, numeric e kind', () => {
    const c = new WalkEntryCollector(ROOT, 100);
    const action = c.feed([
      { oid: '1.3.6.1.2.1.1.3.0', type: T_TIMETICKS, value: 360000 },
      { oid: '1.3.6.1.2.1.1.5.0', type: T_STR, value: Buffer.from('camera-01') },
    ]);
    expect(action).toBe('continue');
    expect(c.entries).toHaveLength(2);
    expect(c.entries[0]).toMatchObject({
      oid: '1.3.6.1.2.1.1.3.0',
      numeric: 3600,
      kind: 'duration',
    });
    expect(c.entries[1]).toMatchObject({ oid: '1.3.6.1.2.1.1.5.0', value: 'camera-01' });
    expect(c.truncated).toBe(false);
  });

  it('guard (a): OID fora do prefixo da raiz → para (fim normal, com motivo)', () => {
    const c = new WalkEntryCollector(ROOT, 100);
    const action = c.feed([
      { oid: '1.3.6.1.2.1.1.3.0', type: T_TIMETICKS, value: 100 },
      // Agente defeituoso vazou para a subárvore vizinha.
      { oid: '1.3.6.1.2.1.2.1.0', type: T_INT, value: 3 },
    ]);
    expect(action).toBe('stop');
    expect(c.entries).toHaveLength(1);
    expect(c.discarded.out_of_subtree).toBe(1);
  });

  it('guard (b): OID não estritamente crescente (loop) → aborta com motivo', () => {
    const c = new WalkEntryCollector(ROOT, 100);
    c.feed([{ oid: '1.3.6.1.2.1.1.5.0', type: T_STR, value: Buffer.from('x') }]);
    const action = c.feed([
      // Repetiu o mesmo OID — agente em loop.
      { oid: '1.3.6.1.2.1.1.5.0', type: T_STR, value: Buffer.from('x') },
    ]);
    expect(action).toBe('stop');
    expect(c.entries).toHaveLength(1);
    expect(c.discarded.non_increasing_oid).toBe(1);
    expect(c.truncated).toBe(true);
  });

  it('guard (b): OID que RETROCEDE também aborta (comparação numérica)', () => {
    const c = new WalkEntryCollector(ROOT, 100);
    c.feed([{ oid: '1.3.6.1.2.1.1.9.0', type: T_INT, value: 1 }]);
    const action = c.feed([{ oid: '1.3.6.1.2.1.1.5.0', type: T_INT, value: 1 }]);
    expect(action).toBe('stop');
    expect(c.discarded.non_increasing_oid).toBe(1);
  });

  it('varbinds de erro (endOfMibView/noSuchObject/noSuchInstance) = fim normal', () => {
    for (const type of [T_END_OF_MIB_VIEW, T_NO_SUCH_OBJECT, T_NO_SUCH_INSTANCE]) {
      const c = new WalkEntryCollector(ROOT, 100);
      c.feed([{ oid: '1.3.6.1.2.1.1.1.0', type: T_STR, value: Buffer.from('ok') }]);
      const action = c.feed([{ oid: '1.3.6.1.2.1.1.2.0', type, value: null }]);
      expect(action).toBe('stop');
      expect(c.entries).toHaveLength(1);
      expect(c.truncated).toBe(false);
      expect(Object.values(c.discarded).reduce((a, b) => a + b, 0)).toBe(1);
    }
  });

  it('limite de entradas → truncated (fim normal)', () => {
    const c = new WalkEntryCollector(ROOT, 1);
    const action = c.feed([
      { oid: '1.3.6.1.2.1.1.1.0', type: T_INT, value: 1 },
      { oid: '1.3.6.1.2.1.1.2.0', type: T_INT, value: 2 },
    ]);
    expect(action).toBe('stop');
    expect(c.entries).toHaveLength(1);
    expect(c.truncated).toBe(true);
  });
});

describe('nextMaxRepetitions() — degradação em tooBig', () => {
  it('reduz pela metade até 1 e devolve null quando não há mais degradação', () => {
    expect(nextMaxRepetitions(20)).toBe(10);
    expect(nextMaxRepetitions(10)).toBe(5);
    expect(nextMaxRepetitions(5)).toBe(2);
    expect(nextMaxRepetitions(2)).toBe(1);
    expect(nextMaxRepetitions(1)).toBeNull();
    expect(nextMaxRepetitions(0)).toBeNull();
  });
});

describe('isTooBigError()', () => {
  it('detecta por error-status 1 (RFC 1905) e por mensagem', () => {
    expect(isTooBigError(Object.assign(new Error('Request failed'), { status: 1 }))).toBe(true);
    expect(isTooBigError(new Error('tooBig response from agent'))).toBe(true);
    expect(isTooBigError(Object.assign(new Error('noAccess'), { status: 6 }))).toBe(false);
    expect(isTooBigError(new Error('timeout'))).toBe(false);
    expect(isTooBigError(null)).toBe(false);
  });
});
