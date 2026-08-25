/**
 * ReachabilityTracker — testes unitários.
 *
 * Cobre:
 *   1. Estado inicial → successPercent=100 (sem dados).
 *   2. Todos bem-sucedidos → 100%.
 *   3. Todos falhados → 0%.
 *   4. Mix 3/5 sucessos → 60%.
 *   5. Entradas expiradas são removidas da janela.
 *   6. Janela deslizante: entradas antigas são descartadas.
 *   7. lastLatencyMs retorna a latência do último ciclo.
 *   8. dispose limpa o estado.
 *   9. Após dispose, record não afeta mais o estado.
 */

import { ReachabilityTracker } from './reachability-tracker';

/** Cria um tracker com janela curta para testes de expiração. */
function shortWindowTracker(windowMs = 1000) {
  return new ReachabilityTracker(windowMs);
}

describe('ReachabilityTracker', () => {

  // ── 1. Estado inicial ──────────────────────────────────────────────────────
  it('1. sem dados → successPercent=100', () => {
    const tracker = new ReachabilityTracker();
    expect(tracker.successPercent()).toBe(100);
    expect(tracker.failurePercent()).toBe(0);
    expect(tracker.lastLatencyMs()).toBeNull();
    expect(tracker.windowSize()).toBe(0);
  });

  // ── 2. Todos bem-sucedidos ────────────────────────────────────────────────
  it('2. todos success=true → 100%', () => {
    const tracker = new ReachabilityTracker();
    tracker.record(true, 50);
    tracker.record(true, 60);
    tracker.record(true, 70);
    expect(tracker.successPercent()).toBe(100);
    expect(tracker.failurePercent()).toBe(0);
  });

  // ── 3. Todos falhados ──────────────────────────────────────────────────────
  it('3. todos success=false → 0%', () => {
    const tracker = new ReachabilityTracker();
    tracker.record(false, 3000);
    tracker.record(false, 3000);
    expect(tracker.successPercent()).toBe(0);
    expect(tracker.failurePercent()).toBe(100);
  });

  // ── 4. Mix 3/5 ────────────────────────────────────────────────────────────
  it('4. 3 de 5 bem-sucedidos → 60%', () => {
    const tracker = new ReachabilityTracker();
    tracker.record(true,  50);
    tracker.record(false, 3000);
    tracker.record(true,  55);
    tracker.record(false, 3000);
    tracker.record(true,  60);
    expect(tracker.successPercent()).toBeCloseTo(60);
  });

  // ── 5. Janela deslizante — expiração ──────────────────────────────────────
  it('5. entradas mais velhas que windowMs são removidas', async () => {
    const tracker = shortWindowTracker(100); // janela de 100ms
    tracker.record(false, 3000); // entra
    // Espera a janela expirar.
    await new Promise((r) => setTimeout(r, 110));
    tracker.record(true, 50); // novo ciclo
    // A falha antiga expirou — apenas o sucesso novo conta.
    expect(tracker.successPercent()).toBe(100);
    expect(tracker.windowSize()).toBe(1);
  });

  // ── 6. lastLatencyMs ──────────────────────────────────────────────────────
  it('6. lastLatencyMs retorna o último latencyMs registrado', () => {
    const tracker = new ReachabilityTracker();
    tracker.record(true, 100);
    tracker.record(true, 250);
    expect(tracker.lastLatencyMs()).toBe(250);
  });

  // ── 7. dispose ────────────────────────────────────────────────────────────
  it('7. dispose limpa o estado e impede novos registros', () => {
    const tracker = new ReachabilityTracker();
    tracker.record(false, 3000);
    tracker.record(false, 3000);
    expect(tracker.successPercent()).toBe(0);

    tracker.dispose();
    expect(tracker.windowSize()).toBe(0);
    expect(tracker.successPercent()).toBe(100); // reset para estado inicial

    // Registro após dispose não afeta.
    tracker.record(false, 3000);
    expect(tracker.windowSize()).toBe(0);
  });

  // ── 8. failurePercent complementar ────────────────────────────────────────
  it('8. successPercent + failurePercent = 100', () => {
    const tracker = new ReachabilityTracker();
    tracker.record(true, 50);
    tracker.record(false, 3000);
    const s = tracker.successPercent();
    const f = tracker.failurePercent();
    expect(s + f).toBeCloseTo(100);
  });
});
