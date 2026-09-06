'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { AuthProvider } from '@/modules/auth/store/auth.provider';
import { IdleSessionGuard } from '@/modules/auth/components/idle-session-guard';
import { PreferencesProvider } from '@/modules/preferences/preferences.provider';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchInterval: 30_000,
            // Voltar o foco à aba não deve disparar refetch/rerender (fazia o
            // binding piscar "Carregando controladoras…"). Os dados já são
            // mantidos frescos via refetchInterval; a telemetria ao vivo chega
            // por Socket.IO (não por React Query), então não é afetada.
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <PreferencesProvider>
          <IdleSessionGuard />
          {children}
        </PreferencesProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
