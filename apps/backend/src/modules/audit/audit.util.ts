/**
 * Utilitários da trilha de auditoria: extração e mascaramento de IP de origem.
 */

interface RequestLike {
  ip?: string;
  ips?: string[];
  headers?: Record<string, unknown>;
  socket?: { remoteAddress?: string };
}

/**
 * Extrai o IP do cliente. Atrás do proxy do Next/Replit o `req.ip` costuma ser
 * loopback, então preferimos o primeiro IP de `x-forwarded-for`. Retorna `null`
 * quando indisponível (a coluna Origem fica vazia).
 */
export function getClientIp(req: RequestLike | undefined): string | null {
  if (!req) return null;

  const forwarded = req.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return normalizeIp(first);
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    const first = String(forwarded[0]).split(',')[0]?.trim();
    if (first) return normalizeIp(first);
  }

  const realIp = req.headers?.['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) return normalizeIp(realIp.trim());

  if (req.ip) return normalizeIp(req.ip);
  if (Array.isArray(req.ips) && req.ips.length > 0) return normalizeIp(req.ips[0]);
  if (req.socket?.remoteAddress) return normalizeIp(req.socket.remoteAddress);

  return null;
}

/** Remove o prefixo IPv4-mapeado-em-IPv6 (`::ffff:`) comum no Node. */
function normalizeIp(ip: string): string {
  return ip.startsWith('::ffff:') ? ip.slice('::ffff:'.length) : ip;
}

/**
 * Mascara o IP para exibição (ex.: `189.45.x.x`). IPv4: mantém os 2 primeiros
 * octetos; IPv6: mantém os 2 primeiros grupos. Retorna '' quando ausente.
 */
export function maskIp(ip: string | null | undefined): string {
  if (!ip) return '';
  const trimmed = ip.trim();
  if (!trimmed) return '';

  if (trimmed.includes('.') && !trimmed.includes(':')) {
    const parts = trimmed.split('.');
    if (parts.length === 4) return `${parts[0]}.${parts[1]}.x.x`;
    return trimmed;
  }

  // IPv6 (inclui loopback ::1)
  const groups = trimmed.split(':').filter((g) => g.length > 0);
  if (groups.length >= 2) return `${groups[0]}:${groups[1]}:x`;
  return trimmed;
}
