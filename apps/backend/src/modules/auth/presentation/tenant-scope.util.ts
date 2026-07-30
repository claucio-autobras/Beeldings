import { ForbiddenException } from '@nestjs/common';
import type { AuthenticatedUser } from '../domain/interfaces/auth.interface.js';
import { UserRole } from '../domain/interfaces/auth.interface.js';

/**
 * Papéis com visão global (equipe Autobras): enxergam todos os clientes.
 * Mesmo critério do dashboard e do comms-health.
 */
export const GLOBAL_ROLES: ReadonlySet<UserRole> = new Set<UserRole>([
  UserRole.ADMIN,
  UserRole.CCO,
  UserRole.SUPERVISOR,
]);

export function isGlobalRole(user: Pick<AuthenticatedUser, 'role'>): boolean {
  return GLOBAL_ROLES.has(user.role);
}

/**
 * Resolve o escopo de tenant de uma consulta:
 * - Papel global: pode filtrar pelo tenant pedido na query, ou ver todos
 *   (retorna undefined = sem filtro).
 * - Papel de cliente (CLIENTE/VISUALIZADOR): SEMPRE travado no próprio
 *   tenant. Um tenantId pedido na query é ignorado. Se o usuário não tem
 *   cliente associado, NEGA — nunca pode cair no escopo "todos os clientes".
 *
 * Achado da auditoria multi-tenant: vários controllers usavam o fallback
 * `user.tenantId ?? ''`, e os services tratam string vazia como "sem filtro",
 * vazando dados de todos os clientes para usuários sem tenant.
 */
export function resolveTenantScope(
  user: AuthenticatedUser,
  requestedTenantId?: string,
): string | undefined {
  if (isGlobalRole(user)) {
    return requestedTenantId || undefined;
  }
  if (!user.tenantId) {
    throw new ForbiddenException('Usuário sem cliente associado');
  }
  return user.tenantId;
}

/**
 * Escopo de tenant para operações que recebem tenantId no BODY (cadastros,
 * scans, testes de conexão): papel global usa o tenant do body; papel de
 * cliente SEMPRE usa o próprio tenant (o body é ignorado) e é negado se não
 * tiver cliente associado.
 */
export function resolveBodyTenantScope(
  user: AuthenticatedUser,
  bodyTenantId?: string,
): string | undefined {
  if (isGlobalRole(user)) {
    return bodyTenantId || undefined;
  }
  if (!user.tenantId) {
    throw new ForbiddenException('Usuário sem cliente associado');
  }
  return user.tenantId;
}
