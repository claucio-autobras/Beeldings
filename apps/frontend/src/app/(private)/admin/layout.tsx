'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useCurrentUser } from '@/hooks/useCurrentUser';

// Rotas dentro de /admin que exigem perfil privilegiado (ADMIN, CCO, SUPERVISOR)
const PRIVILEGED_PREFIXES = [
  '/admin/clients',
  '/admin/sites',
  '/admin/projects',
  '/admin/gateways',
  '/admin/gateway-agent',
  '/admin/settings',
  '/admin/cluster',
  '/admin/knowledge',
];

// Perfis com acesso completo à área de administração
const PRIVILEGED_ROLES = ['ADMIN', 'CCO', 'SUPERVISOR'] as const;

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = useCurrentUser();
  const pathname = usePathname();
  const router = useRouter();

  const isPrivileged = (PRIVILEGED_ROLES as readonly string[]).includes(user.role);
  const requiresPrivilege = PRIVILEGED_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  useEffect(() => {
    if (requiresPrivilege && !isPrivileged) {
      router.replace('/403');
    }
  }, [requiresPrivilege, isPrivileged, router]);

  // Evita flash de conteúdo restrito antes do redirecionamento
  if (requiresPrivilege && !isPrivileged) {
    return null;
  }

  return <>{children}</>;
}
