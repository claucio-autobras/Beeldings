'use client';

import { useQuery } from '@tanstack/react-query';
import {
  getInfraspeakRequests,
  type InfraspeakRequestFilters,
} from '../services/infraspeak-api.service';

/**
 * Chamados da Infraspeak. A consulta bate na API externa (via backend), então
 * o refetch é mais espaçado que o de telemetria para respeitar o rate limit.
 */
export function useInfraspeakRequests(filters: InfraspeakRequestFilters = {}) {
  return useQuery({
    queryKey: ['infraspeak-requests', filters],
    queryFn: () => getInfraspeakRequests(filters),
    refetchInterval: 120_000,
    staleTime: 60_000,
    retry: false,
  });
}
