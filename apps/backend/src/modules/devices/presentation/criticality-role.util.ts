import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '../../auth/domain/interfaces/auth.interface.js';

/** Perfis técnicos autorizados a marcar/desmarcar criticidade (estrela). */
const TECHNICAL_ROLES: ReadonlySet<string> = new Set([
  UserRole.ADMIN,
  UserRole.CCO,
  UserRole.SUPERVISOR,
]);

/**
 * A marcação de criticidade (card "Ativos Críticos") e o papel operacional dos
 * pontos são decisões do perfil técnico. Perfis cliente (CLIENTE/VISUALIZADOR)
 * não veem a estrela na UI e o backend também rejeita a alteração.
 */
export function assertCanEditCriticality(user: { role: string }): void {
  if (!TECHNICAL_ROLES.has(user.role)) {
    throw new ForbiddenException(
      'Apenas o perfil técnico (ADMIN/CCO/SUPERVISOR) pode alterar a criticidade',
    );
  }
}
