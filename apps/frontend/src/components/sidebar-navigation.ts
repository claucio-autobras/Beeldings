import type { UserRole } from '@/hooks/useCurrentUser';

export const SCADA_FALLBACK_LABEL = 'Telas';

const OPERATOR_ROLES = new Set<UserRole>(['CLIENTE', 'VISUALIZADOR']);
const GLOBAL_ROLES = new Set<UserRole>(['ADMIN', 'CCO', 'SUPERVISOR']);

/**
 * Resolve o texto do atalho SCADA sem usar dados fora do escopo do usuário.
 *
 * Enquanto a consulta ainda não respondeu (ou em caso de erro/vazio), mantém
 * "Telas". Assim a sidebar não exibe temporariamente um site de outro usuário
 * nem muda de ordem enquanto os dados são carregados.
 */
export function resolveScadaNavLabel(
  role: UserRole,
  sites: readonly { name: string }[] | undefined,
  tenantName?: string | null,
): string {
  if (GLOBAL_ROLES.has(role)) return 'Sites';
  if (!OPERATOR_ROLES.has(role) || !sites || sites.length === 0) {
    return SCADA_FALLBACK_LABEL;
  }

  if (sites.length === 1) {
    const siteName = sites[0]?.name.trim();
    return siteName || SCADA_FALLBACK_LABEL;
  }

  const clientName = tenantName?.trim();
  return clientName || SCADA_FALLBACK_LABEL;
}