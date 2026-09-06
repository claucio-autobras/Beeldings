import { classifySnmpError, parseSnmpNumber } from './snmp-read.util';

/**
 * Regra aprendida em campo (Hikvision real em 10.201.10.23): responder com
 * erro de protocolo (noSuchObject/noSuchName) É uma resposta do agente — a
 * câmera está viva. Só o silêncio (timeout/rede) conta como "não respondeu".
 */
describe('classifySnmpError', () => {
  function namedError(name: string): Error {
    const err = new Error(name);
    err.name = name;
    return err;
  }

  it('classifica RequestFailedError (noSuchName no v1, GenErr…) como agent_error', () => {
    expect(classifySnmpError(namedError('RequestFailedError'))).toBe('agent_error');
  });

  it('classifica RequestTimedOutError como silence', () => {
    expect(classifySnmpError(namedError('RequestTimedOutError'))).toBe('silence');
  });

  it('classifica erros de rede/socket genéricos como silence', () => {
    expect(classifySnmpError(new Error('socket error'))).toBe('silence');
    expect(classifySnmpError(namedError('ProcessingError'))).toBe('silence');
  });

  it('tolera null/undefined/objetos sem name (silence)', () => {
    expect(classifySnmpError(null)).toBe('silence');
    expect(classifySnmpError(undefined)).toBe('silence');
    expect(classifySnmpError({})).toBe('silence');
    expect(classifySnmpError('timeout')).toBe('silence');
  });
});

/**
 * Regra aprendida em campo (Hikvision real): as métricas do enterprise
 * 1.3.6.1.4.1.39165.1.* vêm como OCTET STRING com sufixo de unidade
 * ("45 PERCENT", "256 MB", "0.0 GB") — o parsing precisa extrair o número.
 */
describe('parseSnmpNumber', () => {
  it('passa números e inteiros direto', () => {
    expect(parseSnmpNumber(62)).toBe(62);
    expect(parseSnmpNumber(0)).toBe(0);
    expect(parseSnmpNumber(3.5)).toBe(3.5);
    expect(parseSnmpNumber(BigInt(42))).toBe(42);
  });

  it('extrai o número de strings com sufixo de unidade (Hikvision)', () => {
    expect(parseSnmpNumber('45 PERCENT')).toBe(45);
    expect(parseSnmpNumber('87 PERCENT')).toBe(87);
    expect(parseSnmpNumber('256 MB')).toBe(256);
    expect(parseSnmpNumber('0.0 GB')).toBe(0);
    expect(parseSnmpNumber('0 PERCENT')).toBe(0);
  });

  it('aceita Buffer (OCTET STRING vem como Buffer no net-snmp)', () => {
    expect(parseSnmpNumber(Buffer.from('45 PERCENT'))).toBe(45);
    expect(parseSnmpNumber(Buffer.from('256 MB'))).toBe(256);
    expect(parseSnmpNumber(Buffer.from('62'))).toBe(62);
  });

  it('aceita vírgula decimal e sinal', () => {
    expect(parseSnmpNumber('87,5 %')).toBe(87.5);
    expect(parseSnmpNumber('-3.2 C')).toBe(-3.2);
    expect(parseSnmpNumber('+10')).toBe(10);
  });

  it('retorna null quando não há número', () => {
    expect(parseSnmpNumber(null)).toBeNull();
    expect(parseSnmpNumber(undefined)).toBeNull();
    expect(parseSnmpNumber('')).toBeNull();
    expect(parseSnmpNumber('   ')).toBeNull();
    expect(parseSnmpNumber('N/A')).toBeNull();
    expect(parseSnmpNumber('PERCENT 45')).toBeNull();
    expect(parseSnmpNumber(NaN)).toBeNull();
    expect(parseSnmpNumber(Infinity)).toBeNull();
  });

  it('booleanos viram 0/1', () => {
    expect(parseSnmpNumber(true)).toBe(1);
    expect(parseSnmpNumber(false)).toBe(0);
  });
});
