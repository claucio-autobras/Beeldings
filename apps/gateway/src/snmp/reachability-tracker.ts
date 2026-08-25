/**
 * ReachabilityTracker — rastreador de alcançabilidade SNMP.
 *
 * Mantém uma janela deslizante de resultados de polling (sucesso/falha) para
 * calcular o percentual de sucesso nos últimos N milissegundos.
 *
 * Padrão de uso:
 *   - `record(reachable, latencyMs)` — chamado a cada ciclo de polling.
 *   - `successPercent()` — retorna o sucesso % na janela atual.
 *   - `lastLatencyMs()` — latência do ciclo mais recente (null se sem dados).
 *   - `dispose()` — libera recursos.
 */

/** Entrada da janela deslizante. */
interface ReachabilityEntry {
  ts: number;        // wall-clock ms
  success: boolean;
  latencyMs: number; // latência do ciclo
}

/** Janela padrão: 5 minutos. */
export const REACHABILITY_WINDOW_MS = 5 * 60 * 1000;

export class ReachabilityTracker {
  private readonly windowMs: number;
  private entries: ReachabilityEntry[] = [];
  private disposed = false;

  constructor(windowMs: number = REACHABILITY_WINDOW_MS) {
    this.windowMs = windowMs;
  }

  /**
   * Registra o resultado de um ciclo de polling.
   * @param reachable true quando o dispositivo respondeu ao SNMP.
   * @param latencyMs duração do ciclo em ms.
   */
  record(reachable: boolean, latencyMs: number): void {
    if (this.disposed) return;
    const now = Date.now();
    this.entries.push({ ts: now, success: reachable, latencyMs });
    this.prune(now);
  }

  /**
   * Percentual de ciclos bem-sucedidos na janela de tempo (0–100).
   * Retorna 100 quando não há entradas (estado inicial — ainda sem dados).
   */
  successPercent(): number {
    this.prune(Date.now());
    if (this.entries.length === 0) return 100;
    const successes = this.entries.filter((e) => e.success).length;
    return (successes / this.entries.length) * 100;
  }

  /**
   * Percentual de falhas na janela (0–100).
   * Inverso de successPercent().
   */
  failurePercent(): number {
    return 100 - this.successPercent();
  }

  /**
   * Latência do ciclo mais recente (ms).
   * Retorna null quando não há entradas.
   */
  lastLatencyMs(): number | null {
    if (this.entries.length === 0) return null;
    return this.entries[this.entries.length - 1].latencyMs;
  }

  /**
   * Número de entradas ativas na janela (diagnóstico/teste).
   */
  windowSize(): number {
    this.prune(Date.now());
    return this.entries.length;
  }

  dispose(): void {
    this.disposed = true;
    this.entries = [];
  }

  /** Remove entradas fora da janela. */
  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    // Mantém apenas entradas dentro da janela.
    let i = 0;
    while (i < this.entries.length && this.entries[i].ts < cutoff) {
      i++;
    }
    if (i > 0) {
      this.entries = this.entries.slice(i);
    }
  }
}
