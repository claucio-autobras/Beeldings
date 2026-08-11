'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2, User, Users, X } from 'lucide-react';
import { apiGet, apiPost, apiDelete } from '@/lib/api-client';
import { useCurrentUser } from '@/hooks/useCurrentUser';

// ─── Types ────────────────────────────────────────────────────────────────────

type UserRole = 'ADMIN' | 'CCO' | 'SUPERVISOR' | 'CLIENTE' | 'VISUALIZADOR';

interface UserItem {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  tenantId?: string | null;
  createdAt: string;
}

interface TenantItem { id: string; name: string; }

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Admin', CCO: 'CCO', SUPERVISOR: 'Supervisor',
  CLIENTE: 'Cliente', VISUALIZADOR: 'Visualizador',
};

const ROLE_COLORS: Record<UserRole, string> = {
  ADMIN:        'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/60 dark:text-red-300 dark:border-red-800',
  CCO:          'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/60 dark:text-orange-300 dark:border-orange-800',
  SUPERVISOR:   'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800',
  CLIENTE:      'bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/60 dark:text-cyan-300 dark:border-cyan-800',
  VISUALIZADOR: 'bg-muted text-muted-foreground border-border',
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Perfis que podem definir role e tenant ao criar usuários
const PRIVILEGED_ROLES: UserRole[] = ['ADMIN', 'CCO', 'SUPERVISOR'];

// ─── Modal criar usuário ───────────────────────────────────────────────────────

interface CreateUserModalProps {
  tenants: TenantItem[];
  onClose: () => void;
  onCreated: () => void;
}

function CreateUserModal({ tenants, onClose, onCreated }: CreateUserModalProps) {
  const currentUser = useCurrentUser();
  const isPrivileged = PRIVILEGED_ROLES.includes(currentUser.role);

  const [name,     setName]     = useState('');
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  // Campos controlados apenas por perfis privilegiados
  const [role,     setRole]     = useState<UserRole>('CLIENTE');
  const [tenantId, setTenantId] = useState('');
  const [error,    setError]    = useState('');

  const needsTenant = role === 'CLIENTE' || role === 'VISUALIZADOR';

  const mutation = useMutation({
    mutationFn: () => {
      // Usuários não-privilegiados não podem escolher perfil nem tenant:
      // o backend receberá o perfil padrão CLIENTE e o tenant do próprio usuário logado.
      const effectiveRole     = isPrivileged ? role     : 'CLIENTE';
      const effectiveTenantId = isPrivileged
        ? (needsTenant ? (tenantId || undefined) : undefined)
        : (currentUser.tenantId ?? undefined);

      return apiPost('/auth/register', {
        name: name.trim(),
        email: email.trim(),
        password,
        role: effectiveRole,
        tenantId: effectiveTenantId,
      });
    },
    onSuccess: () => { onCreated(); onClose(); },
    onError: (err: Error) => setError(err.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md bg-card rounded-xl border border-border shadow-xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <User className="h-4 w-4 text-cyan-600" />
            Novo Usuário
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        <div className="px-5 py-4 space-y-3 flex-1 overflow-y-auto">
          {[
            { label: 'Nome completo', value: name, setter: setName, placeholder: 'João da Silva' },
            { label: 'E-mail', value: email, setter: setEmail, placeholder: 'joao@empresa.com', type: 'email' },
            { label: 'Senha temporária', value: password, setter: setPassword, placeholder: '••••••••', type: 'password' },
          ].map(({ label, value, setter, placeholder, type }) => (
            <div key={label}>
              <label className="block text-xs font-medium text-foreground mb-1">{label} *</label>
              <input
                type={type ?? 'text'}
                className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-600"
                placeholder={placeholder}
                value={value}
                onChange={(e) => setter(e.target.value)}
              />
            </div>
          ))}

          {/* Perfil de acesso — visível apenas para perfis privilegiados (ADMIN, CCO, SUPERVISOR).
              Removido do DOM para perfis não-privilegiados para evitar manipulação via DevTools. */}
          {isPrivileged && (
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Perfil de Acesso *</label>
              <select
                className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-600 cursor-pointer"
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
              >
                {(Object.keys(ROLE_LABELS) as UserRole[]).map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>
          )}

          {/* Site/Cliente — visível apenas para perfis privilegiados quando o perfil selecionado exige tenant.
              Para não-privilegiados, o tenant é herdado automaticamente do usuário logado. */}
          {isPrivileged && needsTenant && (
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">Site / Cliente</label>
              <select
                className="w-full h-9 px-3 text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-600 cursor-pointer"
                value={tenantId}
                onChange={(e) => setTenantId(e.target.value)}
              >
                <option value="">Selecione o cliente...</option>
                {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          )}

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-border shrink-0">
          <button onClick={onClose} className="h-9 px-4 text-sm border border-border rounded-md text-foreground hover:bg-muted/50 transition-colors">
            Cancelar
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!name.trim() || !email.trim() || !password || mutation.isPending}
            className="h-9 px-4 text-sm rounded-md font-medium bg-cyan-700 text-white hover:bg-cyan-800 disabled:opacity-50 flex items-center gap-2 transition-colors"
          >
            {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Criar Usuário
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Página ────────────────────────────────────────────────────────────────────

export default function UsersPage() {
  const qc = useQueryClient();
  const currentUser = useCurrentUser();
  const [showModal, setShowModal] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/auth/users/${id}`),
    onSuccess: () => {
      setConfirmDeleteId(null);
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const { data: users = [], isLoading, error } = useQuery<UserItem[]>({
    queryKey: ['users'],
    queryFn: () => apiGet<UserItem[]>('/auth/users'),
  });

  const { data: tenants = [] } = useQuery<TenantItem[]>({
    queryKey: ['tenants'],
    queryFn: () => apiGet('/tenants'),
  });

  const tenantMap = Object.fromEntries(tenants.map((t) => [t.id, t.name]));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10">
            <Users className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Usuários</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Gerencie os usuários e seus acessos à plataforma
            </p>
          </div>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="inline-flex shrink-0 items-center gap-2 self-start rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-cyan-700 sm:self-auto"
        >
          <Plus className="h-4 w-4" />
          Novo Usuário
        </button>
      </header>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-lg bg-muted/40 animate-pulse" />)}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400">
          Endpoint de usuários ainda não disponível. Os dados aparecerão quando o módulo estiver ativo.
        </div>
      )}

      {/* Empty */}
      {!isLoading && users.length === 0 && !error && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border bg-card px-6 py-16 text-center shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-500/10">
            <Users className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
          </div>
          <p className="text-sm text-muted-foreground">Nenhum usuário cadastrado ainda.</p>
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-dashed border-cyan-400 px-4 py-2 text-sm font-medium text-cyan-600 transition-colors hover:bg-cyan-50 dark:text-cyan-400 dark:hover:bg-cyan-950/40"
          >
            <Plus className="h-4 w-4" />
            Criar Primeiro Usuário
          </button>
        </div>
      )}

      {/* Table */}
      {!isLoading && users.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow duration-200 hover:shadow-md">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Usuário</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hidden sm:table-cell">E-mail</th>
                <th className="text-center px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Perfil</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Cliente</th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Criado em</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => (
                <tr key={u.id} className="transition-colors duration-150 hover:bg-muted/30">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <div className="h-8 w-8 rounded-full bg-cyan-500/10 flex items-center justify-center shrink-0 text-xs font-semibold text-cyan-600 dark:text-cyan-400">
                        {u.name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)}
                      </div>
                      <span className="font-medium text-foreground">{u.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 hidden sm:table-cell text-sm text-muted-foreground">{u.email}</td>
                  <td className="px-4 py-3.5 text-center">
                    <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-full border ${ROLE_COLORS[u.role]}`}>
                      {ROLE_LABELS[u.role]}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 hidden md:table-cell text-sm text-muted-foreground">
                    {u.tenantId ? (tenantMap[u.tenantId] ?? u.tenantId) : '—'}
                  </td>
                  <td className="px-4 py-3.5 text-right hidden lg:table-cell text-xs text-muted-foreground">
                    {formatDate(u.createdAt)}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    {/* Sem botão de excluir para ADMIN nem para o próprio
                        usuário logado — ninguém pode excluir a si mesmo. */}
                    {u.role !== 'ADMIN' && u.id !== currentUser.id && (
                      <button
                        onClick={() => setConfirmDeleteId(u.id)}
                        title="Excluir usuário"
                        className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 dark:hover:text-red-400 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <div className="border-t border-border bg-muted/20 px-5 py-2.5 text-xs text-muted-foreground">
            {users.length} usuário{users.length !== 1 ? 's' : ''} cadastrado{users.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {showModal && (
        <CreateUserModal
          tenants={tenants}
          onClose={() => setShowModal(false)}
          onCreated={() => void qc.invalidateQueries({ queryKey: ['users'] })}
        />
      )}

      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm bg-card rounded-xl border border-border shadow-xl p-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground">Excluir usuário?</h2>
            <p className="text-sm text-muted-foreground">
              Esta ação é irreversível. O usuário perderá acesso imediatamente.
            </p>
            {deleteMutation.error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                {(deleteMutation.error as Error).message}
              </p>
            )}
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="h-9 px-4 text-sm border border-border rounded-md text-foreground hover:bg-muted/50 transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => deleteMutation.mutate(confirmDeleteId)}
                disabled={deleteMutation.isPending}
                className="h-9 px-4 text-sm rounded-md font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 flex items-center gap-2 transition-colors"
              >
                {deleteMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
