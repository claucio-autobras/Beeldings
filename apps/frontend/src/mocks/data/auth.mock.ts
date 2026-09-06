export type UserRole = 'ADMIN' | 'CCO' | 'SUPERVISOR' | 'CLIENTE' | 'VISUALIZADOR';

export interface MockUser {
  id: string;
  supabaseId: string;
  email: string;
  name: string;
  role: UserRole;
  tenantId: string | null;
}

export const mockUsers: MockUser[] = [
  {
    id: 'user-admin-01',
    supabaseId: 'sb-admin-01',
    email: 'admin@bluebee.com.br',
    name: 'Administrador BlueBee',
    role: 'ADMIN',
    tenantId: null,
  },
  {
    id: 'user-cco-01',
    supabaseId: 'sb-cco-01',
    email: 'cco@bluebee.com.br',
    name: 'Operador CCO',
    role: 'CCO',
    tenantId: null,
  },
  {
    id: 'user-supervisor-01',
    supabaseId: 'sb-supervisor-01',
    email: 'supervisor@bluebee.com.br',
    name: 'Supervisor Técnico',
    role: 'SUPERVISOR',
    tenantId: null,
  },
  {
    id: 'user-cliente-01',
    supabaseId: 'sb-cliente-01',
    email: 'cliente@empresa-demo.com.br',
    name: 'Gerente Empresa Demo',
    role: 'CLIENTE',
    tenantId: 'tenant-autobras',
  },
  {
    id: 'user-visualizador-01',
    supabaseId: 'sb-visualizador-01',
    email: 'view@empresa-demo.com.br',
    name: 'Visualizador Demo',
    role: 'VISUALIZADOR',
    tenantId: 'tenant-autobras',
  },
];

// Credenciais fixas para mock — qualquer senha funciona
export const MOCK_PASSWORD = 'qualquer';

export function findMockUserByEmail(email: string): MockUser | undefined {
  return mockUsers.find((u) => u.email === email);
}
