import * as http from 'http';
import { createHash, randomBytes } from 'crypto';

/** Timeout de cada requisição ISAPI (ms). */
const ISAPI_TIMEOUT_MS = 5_000;

export interface IsapiCredentials {
  ip: string;
  port?: number;
  username: string;
  password: string;
}

function md5(s: string): string {
  return createHash('md5').update(s).digest('hex');
}

/** GET HTTP simples com headers, resolvendo status+body (nunca rejeita). */
function httpGet(
  options: { host: string; port: number; path: string; headers?: Record<string, string> },
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string } | null> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        host: options.host,
        port: options.port,
        path: options.path,
        method: 'GET',
        headers: options.headers,
        timeout: ISAPI_TIMEOUT_MS,
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => {
          if (body.length < 65536) body += c;
        });
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body }),
        );
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve(null));
    req.end();
  });
}

/** Monta o header Authorization de digest (RFC 2617, qop=auth). */
export function buildDigestAuth(
  wwwAuthenticate: string,
  username: string,
  password: string,
  method: string,
  uri: string,
): string | null {
  const params: Record<string, string> = {};
  for (const m of wwwAuthenticate.matchAll(/(\w+)=(?:"([^"]*)"|([^\s,]+))/g)) {
    params[m[1].toLowerCase()] = m[2] ?? m[3] ?? '';
  }
  const realm = params.realm;
  const nonce = params.nonce;
  if (!realm || !nonce) return null;

  const ha1 = md5(`${username}:${realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const qop = (params.qop ?? '').split(',').map((q) => q.trim()).includes('auth')
    ? 'auth'
    : null;

  let response: string;
  let extra = '';
  if (qop) {
    const cnonce = randomBytes(8).toString('hex');
    const nc = '00000001';
    response = md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`);
    extra = `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  } else {
    response = md5(`${ha1}:${nonce}:${ha2}`);
  }
  const opaque = params.opaque ? `, opaque="${params.opaque}"` : '';
  return (
    `Digest username="${username}", realm="${realm}", nonce="${nonce}", ` +
    `uri="${uri}", response="${response}"${extra}${opaque}` +
    (params.algorithm ? `, algorithm=${params.algorithm}` : '')
  );
}

/** Extrai <deviceUpTime>N</deviceUpTime> (segundos) do XML de status ISAPI. */
export function parseIsapiUptime(xml: string): number | null {
  const m = /<deviceUpTime>\s*(\d+)\s*<\/deviceUpTime>/i.exec(xml);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Uptime REAL da câmera via ISAPI (Hikvision): GET /ISAPI/System/status com
 * autenticação digest. Retorna segundos, ou null quando a câmera não expõe
 * ISAPI / credenciais inválidas / timeout — o motor cai para a próxima camada.
 * Nunca loga nem propaga a senha.
 */
export async function fetchIsapiUptime(creds: IsapiCredentials): Promise<number | null> {
  const path = '/ISAPI/System/status';
  const port = creds.port ?? 80;
  const first = await httpGet({ host: creds.ip, port, path });
  if (!first) return null;

  if (first.status === 200) return parseIsapiUptime(first.body);
  if (first.status !== 401) return null;

  const challenge = first.headers['www-authenticate'];
  const header = typeof challenge === 'string' ? challenge : challenge?.[0];
  if (!header || !/digest/i.test(header)) return null;

  const auth = buildDigestAuth(header, creds.username, creds.password, 'GET', path);
  if (!auth) return null;

  const second = await httpGet({
    host: creds.ip,
    port,
    path,
    headers: { Authorization: auth },
  });
  if (!second || second.status !== 200) return null;
  return parseIsapiUptime(second.body);
}
