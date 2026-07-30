import { useQuery } from '@tanstack/react-query';
import { getCameras } from '../services/cftv.service';

export function useCameras(tenantId?: string) {
  return useQuery({
    queryKey: ['cftv-cameras', tenantId],
    queryFn: () => getCameras(tenantId),
    refetchInterval: 30_000,
  });
}
