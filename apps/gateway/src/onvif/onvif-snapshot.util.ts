import * as http from 'http';
import * as https from 'https';
import { spawn } from 'child_process';
import { buildDigestAuth } from '../cameras/isapi.util';

/** Timeout de cada captura de frame (ms). */
const SNAPSHOT_TIMEOUT_MS = 8_000;

/** Tamanho máximo do JPEG aceito (bytes) — precisa caber com folga no MQTT. */
export const MAX_FRAME_BYTES = 700 * 1024;

/** Erro de captura classificado (mensagens claras até a UI). */
export type SnapshotErrorCode =
  | 'UNSUPPORTED' // câmera não expõe snapshot nem frame RTSP extraível
  | 'AUTH' // credenciais recusadas no endpoint de snapshot
  | 'UNREACHABLE' // câmera não respondeu
  | 'TOO_LARGE' // frame excede o limite de tamanho p/ MQTT
  | 'UNKNOWN';

export class SnapshotError extends Error {
  constructor(
    public readonly code: SnapshotErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SnapshotError';
  }
}

/** GET HTTP binário com headers; nunca rejeita (resolve null em erro de rede). */
function httpGetBinary(
  target: URL,
  headers: Record<string, string> | undefined,
  timeoutMs: number,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer } | null> {
  return new Promise((resolve) => {
    const mod = target.protocol === 'https:' ? https : http;
    const req = mod.request(
      {
        host: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: 'GET',
        headers,
        timeout: timeoutMs,
        // Câmeras costumam usar certificado self-signed no snapshot HTTPS.
        ...(target.protocol === 'https:' ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let aborted = false;
        res.on('data', (c: Buffer) => {
          size += c.length;
          if (size > MAX_FRAME_BYTES * 2) {
            // Frame absurdamente grande: corta a conexão (não acumula memória).
            aborted = true;
            req.destroy();
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.alloc(0) });
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          if (aborted) return;
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve(null));
    req.end();
  });
}

/** Verifica a assinatura JPEG (FF D8) no início do buffer. */
function isJpeg(buf: Buffer): boolean {
  return buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8;
}

/**
 * Busca o frame JPEG na URI de snapshot da câmera, com autenticação
 * digest (RFC 2617) ou basic conforme o desafio do servidor.
 * A senha nunca aparece em logs ou mensagens de erro.
 */
export async function fetchSnapshotJpeg(params: {
  uri: string;
  username: string;
  password: string;
  timeoutMs?: number;
}): Promise<Buffer> {
  let target: URL;
  try {
    target = new URL(params.uri);
  } catch {
    throw new SnapshotError('UNSUPPORTED', 'URI de snapshot inválida informada pela câmera.');
  }
  const timeoutMs = params.timeoutMs ?? SNAPSHOT_TIMEOUT_MS;

  const first = await httpGetBinary(target, undefined, timeoutMs);
  if (!first) {
    throw new SnapshotError('UNREACHABLE', 'A câmera não respondeu na URI de snapshot.');
  }

  let result = first;
  if (first.status === 401) {
    const challenge = first.headers['www-authenticate'];
    const header = typeof challenge === 'string' ? challenge : challenge?.[0];
    let auth: string | null = null;
    if (header && /digest/i.test(header)) {
      auth = buildDigestAuth(
        header,
        params.username,
        params.password,
        'GET',
        `${target.pathname}${target.search}`,
      );
    }
    if (!auth) {
      // Basic como último recurso (desafio Basic ou digest malformado).
      auth =
        'Basic ' + Buffer.from(`${params.username}:${params.password}`).toString('base64');
    }
    const second = await httpGetBinary(target, { Authorization: auth }, timeoutMs);
    if (!second) {
      throw new SnapshotError('UNREACHABLE', 'A câmera não respondeu na URI de snapshot.');
    }
    if (second.status === 401 || second.status === 403) {
      throw new SnapshotError('AUTH', 'A câmera recusou as credenciais no snapshot.');
    }
    result = second;
  }

  if (result.status !== 200) {
    throw new SnapshotError(
      'UNSUPPORTED',
      `A câmera respondeu HTTP ${result.status} na URI de snapshot.`,
    );
  }
  if (!isJpeg(result.body)) {
    throw new SnapshotError('UNSUPPORTED', 'A câmera não devolveu um JPEG no snapshot.');
  }
  if (result.body.length > MAX_FRAME_BYTES) {
    throw new SnapshotError(
      'TOO_LARGE',
      'O frame da câmera excede o tamanho máximo suportado pela visualização ao vivo.',
    );
  }
  return result.body;
}

/**
 * Fallback: extrai UM frame JPEG do stream RTSP via ffmpeg (quando instalado
 * na máquina do gateway). Sem ffmpeg no PATH → UNSUPPORTED (erro claro, sem
 * travar). A URI RTSP recebe as credenciais embutidas (nunca logada).
 */
export function captureRtspFrame(params: {
  rtspUri: string;
  username: string;
  password: string;
  timeoutMs?: number;
}): Promise<Buffer> {
  const timeoutMs = params.timeoutMs ?? SNAPSHOT_TIMEOUT_MS;
  let target: URL;
  try {
    target = new URL(params.rtspUri);
  } catch {
    return Promise.reject(
      new SnapshotError('UNSUPPORTED', 'URI RTSP inválida informada pela câmera.'),
    );
  }
  if (!target.username && params.username) {
    target.username = encodeURIComponent(params.username);
    target.password = encodeURIComponent(params.password);
  }

  return new Promise((resolve, reject) => {
    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-rtsp_transport', 'tcp',
      '-i', target.toString(),
      '-frames:v', '1',
      '-q:v', '5',
      '-f', 'image2',
      'pipe:1',
    ];
    let settled = false;
    const done = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(killTimer);
      fn();
    };

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      reject(
        new SnapshotError('UNSUPPORTED', 'Extração de frame RTSP indisponível (ffmpeg ausente).'),
      );
      return;
    }

    const killTimer = setTimeout(() => {
      try {
        proc.kill('SIGKILL');
      } catch {
        // best-effort
      }
      done(() =>
        reject(new SnapshotError('UNREACHABLE', 'Tempo esgotado ao capturar frame do RTSP.')),
      );
    }, timeoutMs);

    const chunks: Buffer[] = [];
    let size = 0;
    proc.stdout?.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_FRAME_BYTES * 2) {
        try {
          proc.kill('SIGKILL');
        } catch {
          // best-effort
        }
        done(() =>
          reject(
            new SnapshotError(
              'TOO_LARGE',
              'O frame da câmera excede o tamanho máximo suportado pela visualização ao vivo.',
            ),
          ),
        );
        return;
      }
      chunks.push(c);
    });
    proc.on('error', () => {
      // ffmpeg não instalado (ENOENT) ou falhou ao iniciar.
      done(() =>
        reject(
          new SnapshotError('UNSUPPORTED', 'Extração de frame RTSP indisponível (ffmpeg ausente).'),
        ),
      );
    });
    proc.on('close', (code) => {
      const body = Buffer.concat(chunks);
      if (code === 0 && isJpeg(body)) {
        if (body.length > MAX_FRAME_BYTES) {
          done(() =>
            reject(
              new SnapshotError(
                'TOO_LARGE',
                'O frame da câmera excede o tamanho máximo suportado pela visualização ao vivo.',
              ),
            ),
          );
          return;
        }
        done(() => resolve(body));
      } else {
        done(() =>
          reject(
            new SnapshotError('UNREACHABLE', 'Não foi possível extrair um frame do stream RTSP.'),
          ),
        );
      }
    });
  });
}
