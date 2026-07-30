import { execFile } from 'child_process';

/** Nº de pacotes por medição de perda. */
const PING_COUNT = 4;

/** Timeout duro do processo ping (ms). */
const PING_PROCESS_TIMEOUT_MS = 12_000;

/**
 * Perda de pacotes via ping ativo (Camada 3 — fallback universal).
 *
 * Usa o binário `ping` do sistema (funciona sem raw socket em Windows e
 * Linux, onde o gateway roda em campo). Retorna a perda em % (0–100) ou
 * null quando a medição não foi possível (binário ausente, saída
 * irreconhecível). Host 100% inalcançável = 100 (perda é um dado).
 */
export function pingPacketLoss(ip: string): Promise<number | null> {
  const isWindows = process.platform === 'win32';
  const args = isWindows
    ? ['-n', String(PING_COUNT), '-w', '2000', ip]
    : ['-c', String(PING_COUNT), '-W', '2', ip];

  return new Promise((resolve) => {
    execFile(
      'ping',
      args,
      { timeout: PING_PROCESS_TIMEOUT_MS, windowsHide: true },
      (error, stdout) => {
        const out = String(stdout ?? '');
        const loss = parsePingLoss(out);
        if (loss !== null) {
          resolve(loss);
          return;
        }
        // Sem % na saída: exit!=0 com saída vazia = host inalcançável (100%);
        // binário ausente/erro de spawn = medição indisponível (null).
        if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          resolve(null);
          return;
        }
        resolve(error ? 100 : null);
      },
    );
  });
}

/**
 * Extrai a perda de pacotes (%) da saída do ping — cobre Linux
 * ("25% packet loss"), Windows en ("(25% loss)") e pt-BR ("(25% de perda)").
 */
export function parsePingLoss(output: string): number | null {
  const m = /(\d+(?:[.,]\d+)?)\s*%/.exec(output);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, n));
}
