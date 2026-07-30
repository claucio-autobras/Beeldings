'use client';

/**
 * Estado otimista COMPARTILHADO de comandos por ponto (deviceId+tag).
 *
 * Ao enviar um comando (botão, ícone com ação de clique, slider), o valor
 * comandado é registrado aqui e passa a ser servido pelo `getValue` do
 * useScreenTelemetry para TODOS os widgets vinculados ao mesmo ponto — o
 * feedback visual é imediato e cliques em sequência alternam corretamente
 * (o toggle calcula o alvo a partir do valor efetivo, não do valor antigo).
 *
 * O valor pendente é descartado quando:
 * - a telemetria ao vivo confirma o MESMO valor (reconciliação no getValue);
 * - o comando falha (clearPendingCommand no useScreenCommand);
 * - expira o timeout de segurança (telemetria nunca confirmou).
 */

/** Timeout de segurança: descarta o pendente se a telemetria não confirmar. */
const PENDING_TTL_MS = 25_000;

interface PendingCommand {
  value: number;
  expiresAt: number;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingCommand>();
const listeners = new Set<() => void>();
/** Versão monotônica — muda a cada alteração (para useSyncExternalStore). */
let version = 0;

function key(deviceId: string, tag: string): string {
  return `${deviceId}|${tag}`;
}

function notify(): void {
  version += 1;
  for (const fn of listeners) fn();
}

/** Registra o valor comandado de um ponto (substitui pendente anterior). */
export function setPendingCommand(deviceId: string, tag: string, value: number): void {
  const k = key(deviceId, tag);
  const prev = pending.get(k);
  if (prev) clearTimeout(prev.timer);
  const timer = setTimeout(() => {
    pending.delete(k);
    notify();
  }, PENDING_TTL_MS);
  pending.set(k, { value, expiresAt: Date.now() + PENDING_TTL_MS, timer });
  notify();
}

/** Descarta o pendente de um ponto (falha de comando ou confirmação ao vivo). */
export function clearPendingCommand(deviceId: string, tag: string): void {
  const k = key(deviceId, tag);
  const entry = pending.get(k);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(k);
  notify();
}

/** Valor pendente de um ponto, ou null se não houver (ou já expirou). */
export function getPendingCommand(deviceId: string, tag: string): number | null {
  const entry = pending.get(key(deviceId, tag));
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) return null;
  return entry.value;
}

/** Assina mudanças no conjunto de pendentes (para re-render dos widgets). */
export function subscribePendingCommands(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Snapshot para useSyncExternalStore — muda a cada alteração. */
export function pendingCommandsVersion(): number {
  return version;
}
