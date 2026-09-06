import { useQuery } from '@tanstack/react-query';
import {
  getCommandHistory,
  type CommandHistoryFilters,
} from '../services/commands.service';

/**
 * Query do histórico de comandos. Os filtros que reduzem o conjunto no servidor
 * (tenant e período) entram na queryKey; gateway/usuário/resultado são aplicados
 * na própria tela sobre o conjunto retornado.
 */
export function useCommandHistory(filters: CommandHistoryFilters) {
  return useQuery({
    queryKey: [
      'command-history',
      filters.tenantId ?? null,
      filters.from?.toISOString() ?? null,
      filters.to?.toISOString() ?? null,
    ],
    queryFn: () => getCommandHistory(filters),
    staleTime: 10_000,
  });
}
