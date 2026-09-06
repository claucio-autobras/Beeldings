import { useQuery } from '@tanstack/react-query';
import { getDevices } from '../services/devices.service';

export function useDevices(tenantId?: string) {
  return useQuery({
    queryKey: ['devices', tenantId],
    queryFn: () => getDevices(tenantId),
    refetchInterval: 30_000,
  });
}
