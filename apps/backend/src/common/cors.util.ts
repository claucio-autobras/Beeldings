/**
 * Resolve as origens permitidas para CORS (HTTP e Socket.IO).
 *
 * - `CORS_ORIGINS` (lista separada por vírgula) tem prioridade em qualquer
 *   ambiente — permite apontar domínios customizados.
 * - Em produção sem `CORS_ORIGINS`, cai para os domínios do deploy Replit
 *   (`REPLIT_DOMAINS`), prefixados com https://, para que o frontend publicado
 *   continue funcionando sem configuração extra.
 * - Em desenvolvimento retorna `null` = permissivo (qualquer origem), pois o
 *   frontend acessa o backend via proxy do Next e via preview do Replit.
 *
 * Retorno: array de origens exatas, ou `null` para "permitir qualquer origem".
 */
export function resolveCorsOrigins(): string[] | null {
  const fromEnv = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (fromEnv.length > 0) return fromEnv;

  if (process.env.NODE_ENV === 'production') {
    const replitDomains = (process.env.REPLIT_DOMAINS ?? '')
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => (d.startsWith('http') ? d : `https://${d}`));
    // Produção sem nenhuma origem configurada: nega cross-origin (o frontend
    // servido pelo mesmo domínio — via rewrites do Next — não usa CORS).
    return replitDomains;
  }

  return null;
}
