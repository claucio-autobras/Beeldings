/**
 * Testes unitários para computeRate() — cálculo de taxa de contadores SNMP.
 *
 * Cobre os seis casos críticos identificados na revisão de segurança:
 *   1. Primeira amostra → null (sem prévia, nenhum delta calculável).
 *   2. Taxa ordinária → B/s correto.
 *   3. Wrap de Counter32 → delta correto SEM pico de 4 GB.
 *   4. Reboot detectado (uptime diminuiu) → descarta (null).
 *   5. Reset sem sinal de uptime (tipo desconhecido) → descarta (null).
 *   6. Counter64 decresce → descarta (null), NUNCA fabricação de ~4 GB/s.
 *
 * computeRate é uma função pura exportada — nenhum mock ou setup de módulo
 * necessário. O estado de linha de base (counterSamples) fica no SnmpDriver
 * e é testado separadamente via runCycle().
 */

import { computeRate, type CounterSample } from './snmp.driver';

const COUNTER32_MAX = 4_294_967_295;

/** Timestamp de referência em ms (fixo para determinismo). */
const BASE_TS = 1_700_000_000_000;

/** sysUpTime de referência em ticks (100 ms por tick). */
const BASE_TICKS = 1_000_000;

/**
 * Constrói uma amostra anterior com o valor dado, `ageMsAgo` ms antes de
 * BASE_TS, e `upticksAgo` ticks antes de BASE_TICKS (padrão = 0).
 */
function prev(value: number, ageMsAgo: number, upticksAgo = 0): CounterSample {
  return {
    value,
    ts: BASE_TS - ageMsAgo,
    uptimeTicks: BASE_TICKS - upticksAgo,
  };
}

describe('computeRate()', () => {
  // ─── 1. Primeira amostra ────────────────────────────────────────────────────

  it('1. primeira amostra (prev=undefined): retorna null', () => {
    expect(computeRate(undefined, 1_000, BASE_TS, BASE_TICKS, 'counter32')).toBeNull();
    expect(computeRate(undefined, 1_000, BASE_TS, BASE_TICKS, 'counter64')).toBeNull();
    expect(computeRate(undefined, 1_000, BASE_TS, BASE_TICKS, undefined)).toBeNull();
  });

  // ─── 2. Taxa ordinária ──────────────────────────────────────────────────────

  it('2. Counter32 — incremento simples: taxa B/s correta', () => {
    // Prev: 1 MB lido 10 s atrás; agora: 1.2 MB → delta 200 kB em 10 s = 20 000 B/s
    const rate = computeRate(prev(1_000_000, 10_000), 1_200_000, BASE_TS, BASE_TICKS, 'counter32');
    expect(rate).toBeCloseTo(20_000);
  });

  it('2b. Counter64 — incremento simples: taxa B/s correta', () => {
    // Mesmo caso com Counter64 (tipo diferente, mesma aritmética em values < 2^53)
    const rate = computeRate(prev(1_000_000, 10_000), 1_200_000, BASE_TS, BASE_TICKS, 'counter64');
    expect(rate).toBeCloseTo(20_000);
  });

  // ─── 3. Wrap de Counter32 ───────────────────────────────────────────────────

  it('3. Counter32 wrap: delta correto sem spike de ~4 GB', () => {
    const prevVal = 4_294_900_000; // quase no teto
    const curr = 100_000;          // voltou ao início após wrap
    const elapsedS = 5;            // 5 segundos

    const expectedDelta = COUNTER32_MAX - prevVal + curr + 1;
    const rate = computeRate(prev(prevVal, elapsedS * 1000), curr, BASE_TS, BASE_TICKS, 'counter32');

    expect(rate).not.toBeNull();
    expect(rate).toBeCloseTo(expectedDelta / elapsedS, 0);

    // Sanidade: o delta de wrap deve ser pequeno (~168 kB), não gigantesco.
    expect(expectedDelta).toBeLessThan(1_000_000);
  });

  // ─── 4. Reboot detectado (uptime diminuiu) ──────────────────────────────────

  it('4. Reboot (uptimeTicks atual < anterior): retorna null', () => {
    // uptimeTicks atual = BASE_TICKS - 1000 < BASE_TICKS (anterior) → reboot
    const rate = computeRate(
      { value: 1_000_000, ts: BASE_TS - 5_000, uptimeTicks: BASE_TICKS },
      1_200_000,
      BASE_TS,
      BASE_TICKS - 1_000, // uptime atual MENOR que o anterior
      'counter32',
    );
    expect(rate).toBeNull();
  });

  // ─── 5. Reset sem sinal de uptime (tipo desconhecido) ───────────────────────

  it('5. Tipo desconhecido (undefined) com decréscimo: descarta (null)', () => {
    // Counter tipo desconhecido caiu — pode ser reset de firmware, não wrap.
    const rate = computeRate(prev(5_000_000, 10_000), 4_000_000, BASE_TS, BASE_TICKS, undefined);
    expect(rate).toBeNull();
  });

  it('5b. Tipo desconhecido — incremento normal: não descarta', () => {
    const rate = computeRate(prev(4_000_000, 10_000), 5_000_000, BASE_TS, BASE_TICKS, undefined);
    expect(rate).toBeCloseTo(100_000); // 1 MB em 10 s
  });

  // ─── 6. Counter64 decresce — jamais fabricação de 2^32 ─────────────────────

  it('6. Counter64 decresce: retorna null (nunca spike de ~4 GB/s)', () => {
    const rate = computeRate(prev(5_000_000, 10_000), 4_000_000, BASE_TS, BASE_TICKS, 'counter64');
    expect(rate).toBeNull();

    // Garante que a fabricação de Counter32 NÃO ocorreu.
    const falseSpike = (COUNTER32_MAX - 5_000_000 + 4_000_000 + 1) / 10;
    expect(rate).not.toBe(falseSpike);
  });

  it('6b. Counter64 muito grande, depois aumenta: taxa correta', () => {
    // Valores dentro de Number.MAX_SAFE_INTEGER para evitar perda de precisão.
    const bigPrev = 9_007_199_000_000_000; // próximo de 2^53
    const bigCurr = 9_007_199_100_000_000; // +100 MB
    const rate = computeRate(prev(bigPrev, 10_000), bigCurr, BASE_TS, BASE_TICKS, 'counter64');
    expect(rate).toBeCloseTo(10_000_000); // 100 MB / 10 s = 10 MB/s
  });

  // ─── Casos de borda ─────────────────────────────────────────────────────────

  it('elapsed zero: descarta (null)', () => {
    // nowMs === prev.ts → elapsed = 0
    const rate = computeRate(prev(1_000_000, 0), 2_000_000, BASE_TS, BASE_TICKS, 'counter32');
    expect(rate).toBeNull();
  });

  it('elapsed negativo (clock skew): descarta (null)', () => {
    // nowMs < prev.ts → elapsed negativo
    const rate = computeRate(prev(1_000_000, -1_000), 2_000_000, BASE_TS, BASE_TICKS, 'counter32');
    expect(rate).toBeNull();
  });

  it('valor igual ao anterior: taxa 0 B/s (sem decréscimo, sem erro)', () => {
    const rate = computeRate(prev(1_000_000, 10_000), 1_000_000, BASE_TS, BASE_TICKS, 'counter32');
    expect(rate).toBeCloseTo(0);
  });
});
