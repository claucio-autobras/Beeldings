import type { Response } from 'express';

/**
 * Cookie de sessão HttpOnly emitido pelo backend no login.
 *
 * O JWT NUNCA fica acessível ao JavaScript do frontend (mitiga roubo de sessão
 * via XSS): `httpOnly` impede leitura por script, `secure` restringe a HTTPS
 * (localhost é exceção permitida pelos browsers em dev) e `sameSite=Lax`
 * limita envio cross-site. O nome é diferente do cookie legado
 * `bluebee_access_token` (gravado via document.cookie) de propósito: sessões
 * antigas não casam com o novo nome e caem no login novamente.
 */
export const SESSION_COOKIE_NAME = 'bluebee_session';

/** Mesma validade do JWT (7 dias) — o cookie expira junto com o token. */
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax' as const,
  path: '/',
};

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, {
    ...COOKIE_OPTIONS,
    maxAge: SESSION_MAX_AGE_MS,
  });
}

export function clearSessionCookie(res: Response): void {
  // Mesmos atributos do set (exceto maxAge) — senão o browser não casa o cookie.
  res.clearCookie(SESSION_COOKIE_NAME, COOKIE_OPTIONS);
}

/**
 * Extrai o JWT do header `Cookie` sem depender do middleware cookie-parser.
 * Usado tanto pela estratégia JWT (HTTP) quanto pelo handshake do Socket.IO.
 */
export function readSessionCookie(
  req: { headers?: { cookie?: string | undefined } } | undefined | null,
): string | null {
  const raw = req?.headers?.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name !== SESSION_COOKIE_NAME) continue;
    const value = part.slice(eq + 1).trim();
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}
