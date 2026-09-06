/**
 * Fallback por OID no readSnmpOids (correção "sem dados" com câmera online).
 *
 * Regra aprendida em campo: em SNMP v1, um único OID inválido no GET em lote
 * faz o agente responder erro para a requisição INTEIRA (RequestFailedError)
 * — sem fallback, todos os pontos viravam null mesmo com a câmera viva.
 * O fallback relê cada OID individualmente (padrão split-on-error do Modbus),
 * preservando a ordem do array de retorno.
 */

type GetCallback = (error: Error | null, varbinds: MockVarBind[]) => void;

interface MockVarBind {
  oid: string;
  value: unknown;
  isError?: boolean;
}

/** Comportamento programável por teste: recebe os OIDs do GET. */
let getBehavior: (oids: string[]) => { error: Error | null; varbinds: MockVarBind[] };

/** Registro dos GETs feitos (para verificar lote → individuais). */
let getCalls: string[][] = [];

jest.mock('net-snmp', () => ({
  Version1: 0,
  Version2c: 1,
  createSession: jest.fn(() => ({
    get: (oids: string[], cb: GetCallback) => {
      getCalls.push([...oids]);
      const { error, varbinds } = getBehavior(oids);
      setImmediate(() => cb(error, varbinds));
    },
    close: jest.fn(),
    on: jest.fn(),
  })),
  isVarbindError: (vb: MockVarBind) => Boolean(vb?.isError),
}));

import { readSnmpOids } from './snmp-read.util';

function namedError(name: string): Error {
  const err = new Error(name);
  err.name = name;
  return err;
}

const TARGET = { ip: '10.0.0.5', port: 161, snmpVersion: '1' as const, community: 'public' };

const OID_CPU = '1.3.6.1.4.1.39165.1.7.0';
const OID_MEM = '1.3.6.1.4.1.39165.1.8.0';
const OID_TEMP_INVALIDO = '1.3.6.1.4.1.39165.1.99.0';

beforeEach(() => {
  getCalls = [];
});

describe('readSnmpOids — fallback por OID (SNMP v1)', () => {
  it('lote com OID inválido → relê individualmente e salva os válidos', async () => {
    getBehavior = (oids) => {
      if (oids.length > 1) {
        // GET em lote: v1 responde erro para a requisição inteira.
        return { error: namedError('RequestFailedError'), varbinds: [] };
      }
      // GETs individuais do fallback.
      const oid = oids[0];
      if (oid === OID_CPU) return { error: null, varbinds: [{ oid, value: '45 PERCENT' }] };
      if (oid === OID_MEM) return { error: null, varbinds: [{ oid, value: '256 MB' }] };
      return { error: namedError('RequestFailedError'), varbinds: [] };
    };

    const values = await readSnmpOids(TARGET, [OID_CPU, OID_TEMP_INVALIDO, OID_MEM]);

    // Ordem preservada; válidos com valor, inválido null (câmera respondeu).
    expect(values).toEqual([45, null, 256]);
    // 1 GET em lote + 3 GETs individuais.
    expect(getCalls[0]).toEqual([OID_CPU, OID_TEMP_INVALIDO, OID_MEM]);
    expect(getCalls.slice(1)).toEqual([[OID_CPU], [OID_TEMP_INVALIDO], [OID_MEM]]);
  }, 10_000);

  it('câmera muda (timeout) → null geral (offline), sem fallback', async () => {
    getBehavior = () => ({ error: namedError('RequestTimedOutError'), varbinds: [] });

    const values = await readSnmpOids(TARGET, [OID_CPU, OID_MEM]);

    expect(values).toBeNull();
    expect(getCalls).toHaveLength(1); // sem tentativas individuais
  });

  it('um único OID com erro de agente → [null] sem fallback (é ele o inválido)', async () => {
    getBehavior = () => ({ error: namedError('RequestFailedError'), varbinds: [] });

    const values = await readSnmpOids(TARGET, [OID_TEMP_INVALIDO]);

    expect(values).toEqual([null]);
    expect(getCalls).toHaveLength(1);
  });

  it('lote sem erro segue o caminho normal (varbind com erro = null pontual)', async () => {
    getBehavior = (oids) => ({
      error: null,
      varbinds: [
        { oid: oids[0], value: '45 PERCENT' },
        { oid: oids[1], value: null, isError: true },
      ],
    });

    const values = await readSnmpOids(TARGET, [OID_CPU, OID_TEMP_INVALIDO]);

    expect(values).toEqual([45, null]);
    expect(getCalls).toHaveLength(1);
  });

  it('timeout num GET individual do fallback → null só naquele OID', async () => {
    getBehavior = (oids) => {
      if (oids.length > 1) {
        return { error: namedError('RequestFailedError'), varbinds: [] };
      }
      const oid = oids[0];
      if (oid === OID_CPU) return { error: null, varbinds: [{ oid, value: 62 }] };
      return { error: namedError('RequestTimedOutError'), varbinds: [] };
    };

    const values = await readSnmpOids(TARGET, [OID_CPU, OID_MEM]);

    // Vivacidade já provada pelo lote: o timeout individual não vira offline.
    expect(values).toEqual([62, null]);
  }, 10_000);

  it('falha passageira (silêncio) em UM GET individual é absorvida por retry', async () => {
    // MEM falha silenciosamente na 1ª tentativa individual e responde na 2ª —
    // simula um atraso pontual do firmware, não ausência real de dado.
    let memAttempts = 0;
    getBehavior = (oids) => {
      if (oids.length > 1) {
        return { error: namedError('RequestFailedError'), varbinds: [] };
      }
      const oid = oids[0];
      if (oid === OID_CPU) return { error: null, varbinds: [{ oid, value: 62 }] };
      memAttempts++;
      if (memAttempts === 1) return { error: namedError('RequestTimedOutError'), varbinds: [] };
      return { error: null, varbinds: [{ oid, value: 30 }] };
    };

    const values = await readSnmpOids(TARGET, [OID_CPU, OID_MEM]);

    // O retry absorveu o silêncio passageiro — o valor não se perdeu.
    expect(values).toEqual([62, 30]);
    expect(memAttempts).toBe(2);
  }, 10_000);

  it('rejeição de agente no lote alimenta rejectedOids (nunca timeout/silêncio)', async () => {
    getBehavior = (oids) => ({
      error: null,
      varbinds: [
        { oid: oids[0], value: '45 PERCENT' },
        { oid: oids[1], value: null, isError: true },
      ],
    });

    const rejected = new Set<string>();
    await readSnmpOids(TARGET, [OID_CPU, OID_TEMP_INVALIDO], rejected);

    expect(rejected).toEqual(new Set([OID_TEMP_INVALIDO]));
  });

  it('rejeição de agente no fallback individual alimenta rejectedOids', async () => {
    getBehavior = (oids) => {
      if (oids.length > 1) {
        return { error: namedError('RequestFailedError'), varbinds: [] };
      }
      const oid = oids[0];
      if (oid === OID_CPU) return { error: null, varbinds: [{ oid, value: 45 }] };
      // TEMP: rejeição conclusiva do agente (não timeout) em toda tentativa.
      return { error: namedError('RequestFailedError'), varbinds: [] };
    };

    const rejected = new Set<string>();
    const values = await readSnmpOids(TARGET, [OID_CPU, OID_TEMP_INVALIDO], rejected);

    expect(values).toEqual([45, null]);
    expect(rejected).toEqual(new Set([OID_TEMP_INVALIDO]));
  }, 10_000);

  it('silêncio persistente no fallback individual NÃO alimenta rejectedOids', async () => {
    getBehavior = (oids) => {
      if (oids.length > 1) {
        return { error: namedError('RequestFailedError'), varbinds: [] };
      }
      const oid = oids[0];
      if (oid === OID_CPU) return { error: null, varbinds: [{ oid, value: 45 }] };
      // TEMP nunca responde (mesmo após o retry) — é ambíguo, não conclusivo.
      return { error: namedError('RequestTimedOutError'), varbinds: [] };
    };

    const rejected = new Set<string>();
    const values = await readSnmpOids(TARGET, [OID_CPU, OID_TEMP_INVALIDO], rejected);

    expect(values).toEqual([45, null]);
    expect(rejected.size).toBe(0);
  }, 10_000);
});
