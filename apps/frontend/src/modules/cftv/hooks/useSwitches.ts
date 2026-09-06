import { useQuery } from '@tanstack/react-query';
import { getSwitches } from '../services/cftv.service';

export function useSwitches(tenantId?: string) {
  return useQuery({
    queryKey: ['cftv-switches', tenantId],
    queryFn: () => getSwitches(tenantId),
    refetchInterval: 30_000,
  });
}
