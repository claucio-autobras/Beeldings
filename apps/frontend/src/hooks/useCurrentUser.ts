'use client';

import { useState, useEffect } from 'react';
import { useAuthStore, selectUser } from '@/modules/auth/store/auth.store';

export type UserRole = 'ADMIN' | 'CCO' | 'SUPERVISOR' | 'CLIENTE' | 'VISUALIZADOR';

export interface CurrentUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  tenantId: string | null;
  tenantName: string | null;
  initials: string;
}

const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === 'true';
const MOCK_ROLE_KEY = 'bluebee_mock_role';

const MOCK_PROFILES: Record<UserRole, CurrentUser> = {
  ADMIN: {
    id: 'user-admin-001',
    name: 'Admin Autobras',
    email: 'admin@autobras.com.br',
    role: 'ADMIN',
    tenantId: null,
    tenantName: null,
    initials: 'AA',
  },
  CCO: {
    id: 'user-cco-001',
    name: 'Carlos CCO',
    email: 'cco@autobras.com.br',
    role: 'CCO',
    tenantId: null,
    tenantName: null,
    initials: 'CC',
  },
  SUPERVISOR: {
    id: 'user-supervisor-001',
    name: 'Sandra Supervisora',
    email: 'supervisora@autobras.com.br',
    role: 'SUPERVISOR',
    tenantId: null,
    tenantName: null,
    initials: 'SS',
  },
  CLIENTE: {
    id: 'user-cliente-001',
    name: 'Claucio Santos',
    email: 'claucio@empresademo.com.br',
    role: 'CLIENTE',
    tenantId: 'tenant-autobras',
    tenantName: 'Empresa Demo',
    initials: 'JS',
  },
  VISUALIZADOR: {
    id: 'user-visualizador-001',
    name: 'Maria Visualizadora',
    email: 'maria@empresademo.com.br',
    role: 'VISUALIZADOR',
    tenantId: 'tenant-autobras',
    tenantName: 'Empresa Demo',
    initials: 'MV',
  },
};

function getMockRoleFromStorage(): UserRole {
  if (typeof window === 'undefined') return 'ADMIN';
  const stored = localStorage.getItem(MOCK_ROLE_KEY);
  if (stored && stored in MOCK_PROFILES) return stored as UserRole;
  return 'ADMIN';
}

export function setMockRole(role: UserRole): void {
  localStorage.setItem(MOCK_ROLE_KEY, role);
  window.dispatchEvent(new Event('bluebee_role_change'));
}

function buildInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function useCurrentUser(): CurrentUser {
  const authUser = useAuthStore(selectUser);
  const [mockRole, setMockRoleState] = useState<UserRole>('ADMIN');

  useEffect(() => {
    if (!USE_MOCK) return;
    setMockRoleState(getMockRoleFromStorage());
    const handler = () => setMockRoleState(getMockRoleFromStorage());
    window.addEventListener('bluebee_role_change', handler);
    return () => window.removeEventListener('bluebee_role_change', handler);
  }, []);

  // Modo real: constrói CurrentUser a partir da sessão autenticada
  if (!USE_MOCK && authUser) {
    return {
      id: authUser.id,
      name: authUser.name,
      email: authUser.email,
      role: authUser.role as UserRole,
      tenantId: authUser.tenantId,
      tenantName: null,
      initials: buildInitials(authUser.name),
    };
  }

  // Modo mock ou sessão ainda não carregada
  return MOCK_PROFILES[mockRole];
}
