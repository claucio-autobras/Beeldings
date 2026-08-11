'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  User,
  Mail,
  ShieldCheck,
  Building2,
  Lock,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { apiGet, apiPatch } from '@/lib/api-client';
import { useCurrentUser, type UserRole } from '@/hooks/useCurrentUser';
import { useAuthStore } from '@/modules/auth/store/auth.store';
import { updateStoredUser } from '@/modules/auth/services/auth.service';

// ─── Types ──────────────────────────────────────────────────────────────────

interface ProfileResponse {
  id: string;
  supabaseId: string;
  name: string;
  email: string;
  role: UserRole;
  tenantId: string | null;
}

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Administrador',
  CCO: 'CCO',
  SUPERVISOR: 'Supervisor',
  CLIENTE: 'Cliente',
  VISUALIZADOR: 'Visualizador',
};

// ─── Feedback inline ──────────────────────────────────────────────────────────

function Feedback({ type, message }: { type: 'success' | 'error'; message: string }) {
  const ok = type === 'success';
  const Icon = ok ? CheckCircle2 : AlertCircle;
  return (
    <div
      className={[
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
        ok
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
          : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300',
      ].join(' ')}
    >
      <Icon className="h-4 w-4 shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  );
}

// ─── Campo de formulário ───────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}

function Field({ label, icon: Icon, children }: FieldProps) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
        {label}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 disabled:opacity-60';

// ─── Página ────────────────────────────────────────────────────────────────────

export default function AccountPage() {
  const currentUser = useCurrentUser();
  const queryClient = useQueryClient();
  const session = useAuthStore((s) => s.session);
  const setSession = useAuthStore((s) => s.setSession);

  const { data: profile, isLoading } = useQuery<ProfileResponse>({
    queryKey: ['profile'],
    queryFn: () => apiGet<ProfileResponse>('/auth/profile'),
  });

  // ── Estado do formulário de perfil ──
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [profileMsg, setProfileMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    if (profile) {
      setName(profile.name);
      setEmail(profile.email);
    }
  }, [profile]);

  // ── Estado do formulário de senha ──
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const role = (profile?.role ?? currentUser.role) as UserRole;

  // ── Mutation: atualizar perfil ──
  const profileMutation = useMutation({
    mutationFn: (payload: { name: string; email: string }) =>
      apiPatch<ProfileResponse>('/account/profile', payload),
    onSuccess: (updated) => {
      setProfileMsg({ type: 'success', text: 'Perfil atualizado com sucesso.' });
      queryClient.setQueryData(['profile'], updated);
      // Reflete nome/e-mail na sessão (Topbar, etc.) e persiste no storage
      // para sobreviver ao reload (AuthProvider restaura do localStorage).
      if (session) {
        const updatedUser = { ...session.user, name: updated.name, email: updated.email };
        setSession({ ...session, user: updatedUser });
        updateStoredUser(updatedUser);
      }
    },
    onError: (err: Error) => {
      setProfileMsg({ type: 'error', text: err.message || 'Não foi possível atualizar o perfil.' });
    },
  });

  // ── Mutation: alterar senha ──
  const passwordMutation = useMutation({
    mutationFn: (payload: { currentPassword: string; newPassword: string }) =>
      apiPatch<{ success: boolean }>('/account/password', payload),
    onSuccess: () => {
      setPasswordMsg({ type: 'success', text: 'Senha alterada com sucesso.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    },
    onError: (err: Error) => {
      setPasswordMsg({ type: 'error', text: err.message || 'Não foi possível alterar a senha.' });
    },
  });

  function handleProfileSubmit(e: React.FormEvent) {
    e.preventDefault();
    setProfileMsg(null);
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (trimmedName.length < 2) {
      setProfileMsg({ type: 'error', text: 'O nome deve ter ao menos 2 caracteres.' });
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setProfileMsg({ type: 'error', text: 'Informe um e-mail válido.' });
      return;
    }
    profileMutation.mutate({ name: trimmedName, email: trimmedEmail });
  }

  function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPasswordMsg(null);
    if (newPassword.length < 6) {
      setPasswordMsg({ type: 'error', text: 'A nova senha deve ter ao menos 6 caracteres.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordMsg({ type: 'error', text: 'A confirmação não confere com a nova senha.' });
      return;
    }
    if (currentPassword === newPassword) {
      setPasswordMsg({ type: 'error', text: 'A nova senha deve ser diferente da atual.' });
      return;
    }
    passwordMutation.mutate({ currentPassword, newPassword });
  }

  const profileDirty =
    !!profile && (name.trim() !== profile.name || email.trim() !== profile.email);

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Header */}
      <header className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10">
          <User className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Minha Conta</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Gerencie os dados do seu perfil e a sua senha de acesso
          </p>
        </div>
      </header>

      {/* Cartão de identidade */}
      <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="flex items-center gap-3 bg-muted/30 border-b border-border px-4 py-3">
          <div className="h-10 w-10 rounded-full bg-cyan-600 flex items-center justify-center shrink-0 text-sm font-semibold text-white shadow-sm">
            {currentUser.initials}
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">
              {profile?.name ?? currentUser.name}
            </h2>
            <p className="truncate text-xs text-muted-foreground">
              {profile?.email ?? currentUser.email}
            </p>
          </div>
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-300">
            <ShieldCheck className="h-3 w-3" />
            {ROLE_LABELS[role] ?? role}
          </span>
        </div>
        {currentUser.tenantName && (
          <div className="flex items-center gap-2.5 px-4 py-3 text-sm text-muted-foreground">
            <Building2 className="h-4 w-4 text-cyan-600 dark:text-cyan-400 shrink-0" />
            Cliente / Site: <span className="font-medium text-foreground">{currentUser.tenantName}</span>
          </div>
        )}
      </section>

      {/* Dados do perfil */}
      <section className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <User className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
          Dados do perfil
        </h3>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
          </div>
        ) : (
          <form onSubmit={handleProfileSubmit} className="space-y-4">
            <Field label="Nome" icon={User}>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
                placeholder="Seu nome"
                disabled={profileMutation.isPending}
              />
            </Field>
            <Field label="E-mail" icon={Mail}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                placeholder="voce@empresa.com.br"
                disabled={profileMutation.isPending}
              />
            </Field>
            {profileMsg && <Feedback type={profileMsg.type} message={profileMsg.text} />}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={profileMutation.isPending || !profileDirty}
                className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {profileMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Salvar alterações
              </button>
            </div>
          </form>
        )}
      </section>

      {/* Alterar senha */}
      <section className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Lock className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
          Alterar senha
        </h3>
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          <Field label="Senha atual" icon={Lock}>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={inputClass}
              autoComplete="current-password"
              disabled={passwordMutation.isPending}
            />
          </Field>
          <Field label="Nova senha" icon={Lock}>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={inputClass}
              autoComplete="new-password"
              placeholder="Mínimo de 6 caracteres"
              disabled={passwordMutation.isPending}
            />
          </Field>
          <Field label="Confirmar nova senha" icon={Lock}>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className={inputClass}
              autoComplete="new-password"
              disabled={passwordMutation.isPending}
            />
          </Field>
          {passwordMsg && <Feedback type={passwordMsg.type} message={passwordMsg.text} />}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={
                passwordMutation.isPending ||
                !currentPassword ||
                !newPassword ||
                !confirmPassword
              }
              className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {passwordMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Alterar senha
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
