import { ForbiddenException } from '@nestjs/common';
import { assertCanEditCriticality } from './criticality-role.util.js';

/**
 * Criticidade (estrela do card Ativos Críticos) é decisão do perfil técnico:
 * ADMIN/CCO/SUPERVISOR podem alterar; perfis cliente são rejeitados no backend
 * mesmo que a UI escondida seja contornada.
 */
describe('assertCanEditCriticality (proteção de perfil da estrela)', () => {
  it.each(['ADMIN', 'CCO', 'SUPERVISOR'])('permite o perfil técnico %s', (role) => {
    expect(() => assertCanEditCriticality({ role })).not.toThrow();
  });

  it.each(['CLIENTE', 'VISUALIZADOR'])('rejeita o perfil cliente %s com 403', (role) => {
    expect(() => assertCanEditCriticality({ role })).toThrow(ForbiddenException);
  });
});
