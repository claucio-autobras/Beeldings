'use client';

import { useEffect } from 'react';
import { getSession, refreshProfile, purgeLegacySession } from '../services/auth.service';
import { useAuthStore } from './auth.store';

interface AuthProviderProps {
  children: React.ReactNode;
}

/**
 * Inicializa o estado de autenticação: hidrata do localStorage (só o usuário —
 * o token vive em cookie HttpOnly) e valida a sessão no backend via
 * GET /auth/profile. Sessões inválidas/expiradas voltam ao login.
 * Deve ser renderizado dentro do layout raiz, acima de qualquer rota protegida.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const { setSession, clearAuth, setLoading } = useAuthStore();

  useEffect(() => {
    // Transição: remove o token legado (localStorage + cookie legível por JS).
    purgeLegacySession();

    const existing = getSession();
    if (existing) {
      // Hidratação otimista para a UI não piscar; a validação roda em seguida.
      setSession(existing);
    } else {
      setLoading(false);
    }

    void refreshProfile().then((user) => {
      if (user) {
        setSession({ user });
        return;
      }
      // Sessão inválida (cookie ausente/expirado): limpa e volta ao login,
      // exceto em rotas públicas (a própria tela de login passa por aqui).
      clearAuth();
      const path = window.location.pathname;
      const isPublic = path.startsWith('/login') || path.startsWith('/forgot-password');
      if (!isPublic && existing) {
        window.location.href = '/login';
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
}
