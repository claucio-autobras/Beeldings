'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useCurrentUser } from '@/hooks/useCurrentUser';

// Perfis com acesso à área de CCO (centro de comandos)
const ALLOWED_ROLES = ['ADMIN', 'CCO'] as const;

export default function CcoLayout({ children }: { children: React.ReactNode }) {
  const user = useCurrentUser();
  const router = useRouter();

  const isAllowed = (ALLOWED_ROLES as readonly string[]).includes(user.role);

  useEffect(() => {
    if (!isAllowed) {
      router.replace('/403');
    }
  }, [isAllowed, router]);

  // Evita flash de conteúdo restrito antes do redirecionamento
  if (!isAllowed) {
    return null;
  }

  return <>{children}</>;
}
