import { useQuery } from '@tanstack/react-query';
import { getNvrs } from '../services/cftv.service';

export function useNvrs(tenantId?: string) {
  return useQuery({
    queryKey: ['cftv-nvrs', tenantId],
    queryFn: () => getNvrs(tenantId),
    refetchInterval: 30_000,
  });
}
