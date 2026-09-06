/**
 * Jitter determinístico de partida dos polls.
 *
 * Todos os devices de um gateway recebem a config no mesmo instante e, sem
 * jitter, disparam seus ciclos sincronizados — gerando rajadas periódicas de
 * leitura e de publicação MQTT a cada intervalo. Espalhar o PRIMEIRO ciclo de
 * cada device com um offset dentro do próprio intervalo dessincroniza os
 * ciclos de forma permanente (os intervalos seguintes preservam o offset).
 *
 * O offset é DETERMINÍSTICO (hash FNV-1a da chave do device): reaplicar a
 * mesma config produz o mesmo espalhamento, evitando que devices "troquem de
 * lugar" a cada republish da config.
 *
 * A telemetria publicada permanece idêntica — muda apenas o instante de
 * partida de cada ciclo.
 */
export function computeStartJitterMs(key: string, intervalMs: number): number {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    return 0;
  }
  // FNV-1a 32 bits — estável, sem dependências.
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % intervalMs;
}
