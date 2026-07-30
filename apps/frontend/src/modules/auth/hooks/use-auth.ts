'use client';

import { useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  signIn,
  signOut,
  getSession,
} from '../services/auth.service';
import {
  useAuthStore,
  selectUser,
  selectIsAuthenticated,
} from '../store/auth.store';
import type { LoginCredentials, AuthUser } from '../types/auth.types';

export interface UseAuthReturn {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session, isLoading, setSession, setLoading, clearAuth } = useAuthStore();
  const user = useAuthStore(selectUser);
  const isAuthenticated = useAuthStore(selectIsAuthenticated);

  // Inicializa sessão do localStorage na montagem
  useEffect(() => {
    const existing = getSession();
    if (existing) {
      setSession(existing);
    } else {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = useCallback(
    async (credentials: LoginCredentials): Promise<void> => {
      setLoading(true);
      try {
        const newSession = await signIn(credentials);
        // Descarta qualquer cache do React Query do usuário anterior ANTES de
        // autenticar o novo. O QueryClient vive durante toda a aba (SPA), então
        // sem isso dados do usuário anterior (ex.: lista de usuários do admin)
        // vazariam por instantes para o novo usuário. Ver fix do flash do admin.
        queryClient.clear();
        setSession(newSession);
        router.push('/dashboard');
      } catch (err) {
        setLoading(false);
        throw err;
      }
    },
    [setSession, setLoading, router, queryClient],
  );

  const logout = useCallback(async (): Promise<void> => {
    await signOut();
    clearAuth();
    // Limpa o cache do React Query para não vazar dados entre sessões.
    queryClient.clear();
    router.push('/login');
  }, [clearAuth, router, queryClient]);

  return { user, isAuthenticated, isLoading, login, logout };
}
