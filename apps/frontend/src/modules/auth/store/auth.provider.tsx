'use client';

import { useEffect, useLayoutEffect } from 'react';
import { getSession, refreshProfile, purgeLegacySession } from '../services/auth.service';
import { useAuthStore } from './auth.store';

interface AuthProviderProps {
  children: React.ReactNode;
}

/**
 * Inicializa o estado de autenticação:
 * - useLayoutEffect: hidrata do localStorage antes do primeiro paint (evita
 *   flash do spinner quando o usuário já tem sessão cacheada).
 * - useEffect: valida a sessão no backend via GET /auth/profile. Sessões
 *   inválidas/expiradas voltam ao login.
 * Deve ser renderizado dentro do layout raiz, acima de qualquer rota protegida.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  const { setSession, clearAuth, setLoading } = useAuthStore();

  // ── Passo 1: hidratação síncrona (antes do paint) ─────────────────────────
  // useLayoutEffect roda no cliente antes de o navegador pintar o frame.
  // Isso garante que sessões cacheadas nunca mostrem o spinner.
  useLayoutEffect(() => {
    purgeLegacySession();
    const existing = getSession();
    if (existing) {
      setSession(existing); // isLoading → false imediatamente
    } else {
      setLoading(false);    // não há sessão cacheada, para o spinner
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Passo 2: validação assíncrona no backend ───────────────────────────────
  useEffect(() => {
    const path = window.location.pathname;
    const isPublic =
      path.startsWith('/login') ||
      path.startsWith('/forgot-password') ||
      path.startsWith('/reset-password');
    // Páginas públicas não precisam validar uma sessão: além de evitar uma
    // chamada 401 inútil, isso mantém recuperação de senha independente do
    // estado de cookies do navegador.
    if (isPublic) return;

    const existing = getSession(); // lê de novo para o snapshot correto
    void refreshProfile().then((user) => {
      if (user) {
        setSession({ user });
        return;
      }
      // Sessão inválida (cookie ausente/expirado): limpa e redireciona ao login,
      // exceto em rotas públicas (a própria tela de login passa por aqui).
      clearAuth();
      if (!isPublic && existing) {
        window.location.href = '/login';
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <>{children}</>;
}
