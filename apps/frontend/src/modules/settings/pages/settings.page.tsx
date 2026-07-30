'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Settings,
  User,
  Mail,
  Lock,
  Building2,
  FolderKanban,
  MapPin,
  Phone,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
} from 'lucide-react';
import { useCurrentUser, type UserRole } from '@/hooks/useCurrentUser';
import { useAuthStore } from '@/modules/auth/store/auth.store';
import { updateStoredUser } from '@/modules/auth/services/auth.service';
import {
  getProfile,
  updateProfile,
  changePassword,
  getTenants,
  updateTenant,
  type ProfileResponse,
  type TenantItem,
} from '../services/settings.service';
import {
  getProjects,
  updateProject,
  type ProjectItem,
} from '@/modules/projects/services/projects.service';

const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Administrador',
  CCO: 'CCO',
  SUPERVISOR: 'Supervisor',
  CLIENTE: 'Cliente',
  VISUALIZADOR: 'Visualizador',
};

const GLOBAL_ROLES: UserRole[] = ['ADMIN', 'CCO', 'SUPERVISOR'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Msg = { type: 'success' | 'error'; text: string } | null;

// ─── UI primitives ─────────────────────────────────────────────────────────────

function Feedback({ msg }: { msg: Msg }) {
  if (!msg) return null;
  const ok = msg.type === 'success';
  const Icon = ok ? CheckCircle2 : AlertCircle;
  return (
    <div
      className={[
        'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
        ok
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-red-200 bg-red-50 text-red-700',
      ].join(' ')}
    >
      <Icon className="h-4 w-4 shrink-0 mt-0.5" />
      <span>{msg.text}</span>
    </div>
  );
}

function Field({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-cyan-600" />
        {label}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 disabled:opacity-60 disabled:cursor-not-allowed';

function SectionCard({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-border rounded-xl overflow-hidden">
      <div className="flex items-center gap-2.5 bg-muted/30 border-b border-border px-4 py-3">
        <Icon className="h-4 w-4 text-cyan-600 shrink-0" />
        <div>
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function SaveButton({
  pending,
  disabled,
  children,
}: {
  pending: boolean;
  disabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {pending && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  );
}

// ─── Perfil ─────────────────────────────────────────────────────────────────────

function ProfileSection() {
  const queryClient = useQueryClient();
  const session = useAuthStore((s) => s.session);
  const setSession = useAuthStore((s) => s.setSession);

  const { data: profile, isLoading } = useQuery<ProfileResponse>({
    queryKey: ['profile'],
    queryFn: getProfile,
  });

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [profileMsg, setProfileMsg] = useState<Msg>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordMsg, setPasswordMsg] = useState<Msg>(null);

  useEffect(() => {
    if (profile) {
      setName(profile.name);
      setEmail(profile.email);
    }
  }, [profile]);

  const profileMutation = useMutation({
    mutationFn: updateProfile,
    onSuccess: (updated) => {
      setProfileMsg({ type: 'success', text: 'Perfil atualizado com sucesso.' });
      queryClient.setQueryData(['profile'], updated);
      // Atualiza sessão em memória e persiste no storage para o reload
      // (AuthProvider restaura a sessão do localStorage).
      if (session) {
        const updatedUser = { ...session.user, name: updated.name, email: updated.email };
        setSession({ ...session, user: updatedUser });
        updateStoredUser(updatedUser);
      }
    },
    onError: (err: Error) =>
      setProfileMsg({ type: 'error', text: err.message || 'Não foi possível atualizar o perfil.' }),
  });

  const passwordMutation = useMutation({
    mutationFn: changePassword,
    onSuccess: () => {
      setPasswordMsg({ type: 'success', text: 'Senha alterada com sucesso.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    },
    onError: (err: Error) =>
      setPasswordMsg({ type: 'error', text: err.message || 'Não foi possível alterar a senha.' }),
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
    if (!EMAIL_REGEX.test(trimmedEmail)) {
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
    <SectionCard title="Perfil" description="Dados do usuário conectado" icon={User}>
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : (
        <div className="space-y-6">
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
            <Feedback msg={profileMsg} />
            <div className="flex justify-end">
              <SaveButton pending={profileMutation.isPending} disabled={!profileDirty}>
                Salvar perfil
              </SaveButton>
            </div>
          </form>

          <div className="border-t border-border pt-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground mb-4">
              <Lock className="h-4 w-4 text-cyan-600" />
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
              <Feedback msg={passwordMsg} />
              <div className="flex justify-end">
                <SaveButton
                  pending={passwordMutation.isPending}
                  disabled={!currentPassword || !newPassword || !confirmPassword}
                >
                  Alterar senha
                </SaveButton>
              </div>
            </form>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

// ─── Cliente / Tenant ───────────────────────────────────────────────────────────

function TenantSection({ role }: { role: UserRole }) {
  const queryClient = useQueryClient();
  const canEdit = role !== 'VISUALIZADOR';

  const { data: tenants = [], isLoading } = useQuery<TenantItem[]>({
    queryKey: ['tenants'],
    queryFn: getTenants,
  });

  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [msg, setMsg] = useState<Msg>(null);

  const selected = tenants.find((t) => t.id === selectedId) ?? null;

  // Seleciona o primeiro tenant assim que a lista carrega.
  useEffect(() => {
    if (tenants.length > 0 && !selectedId) {
      setSelectedId(tenants[0].id);
    }
  }, [tenants, selectedId]);

  useEffect(() => {
    if (selected) {
      setName(selected.name);
      setSlug(selected.slug);
      setMsg(null);
    }
  }, [selected]);

  const mutation = useMutation({
    mutationFn: (payload: { id: string; name: string; slug: string }) =>
      updateTenant(payload.id, { name: payload.name, slug: payload.slug }),
    onSuccess: (updated) => {
      setMsg({ type: 'success', text: 'Cliente atualizado com sucesso.' });
      queryClient.setQueryData<TenantItem[]>(['tenants'], (prev) =>
        prev ? prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)) : prev,
      );
      void queryClient.invalidateQueries({ queryKey: ['tenants'] });
    },
    onError: (err: Error) =>
      setMsg({ type: 'error', text: err.message || 'Não foi possível atualizar o cliente.' }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!selected) return;
    if (name.trim().length < 2) {
      setMsg({ type: 'error', text: 'O nome deve ter ao menos 2 caracteres.' });
      return;
    }
    mutation.mutate({ id: selected.id, name: name.trim(), slug: slug.trim() });
  }

  const dirty = !!selected && (name.trim() !== selected.name || slug.trim() !== selected.slug);

  return (
    <SectionCard
      title="Cliente"
      description="Dados da empresa monitorada"
      icon={Building2}
    >
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : tenants.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum cliente disponível.</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {tenants.length > 1 && (
            <Field label="Selecionar cliente" icon={Building2}>
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className={`${inputClass} cursor-pointer`}
              >
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Nome da empresa" icon={Building2}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder="Ex: Empresa ABC Ltda"
              disabled={!canEdit || mutation.isPending}
            />
          </Field>
          <Field label="Slug (identificador único)" icon={ShieldCheck}>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className={`${inputClass} font-mono`}
              placeholder="empresa-abc"
              disabled={!canEdit || mutation.isPending}
            />
          </Field>
          <Feedback msg={msg} />
          {canEdit && (
            <div className="flex justify-end">
              <SaveButton pending={mutation.isPending} disabled={!dirty}>
                Salvar cliente
              </SaveButton>
            </div>
          )}
          {!canEdit && (
            <p className="text-xs text-muted-foreground">
              Seu perfil tem acesso somente de leitura a estes dados.
            </p>
          )}
        </form>
      )}
    </SectionCard>
  );
}

// ─── Projeto ─────────────────────────────────────────────────────────────────────

function ProjectSection({ role }: { role: UserRole }) {
  const queryClient = useQueryClient();
  const canEdit = GLOBAL_ROLES.includes(role);

  const { data: projects = [], isLoading } = useQuery<ProjectItem[]>({
    queryKey: ['settings', 'projects'],
    queryFn: () => getProjects(),
  });

  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [technicalContact, setTechnicalContact] = useState('');
  const [msg, setMsg] = useState<Msg>(null);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  useEffect(() => {
    if (projects.length > 0 && !selectedId) {
      setSelectedId(projects[0].id);
    }
  }, [projects, selectedId]);

  useEffect(() => {
    if (selected) {
      setName(selected.name);
      setAddress(selected.address ?? '');
      setTechnicalContact(selected.technicalContact ?? '');
      setMsg(null);
    }
  }, [selected]);

  const mutation = useMutation({
    mutationFn: (payload: {
      id: string;
      name: string;
      address: string | null;
      technicalContact: string | null;
    }) =>
      updateProject(payload.id, {
        name: payload.name,
        address: payload.address,
        technicalContact: payload.technicalContact,
      }),
    onSuccess: (updated) => {
      setMsg({ type: 'success', text: 'Projeto atualizado com sucesso.' });
      queryClient.setQueryData<ProjectItem[]>(['settings', 'projects'], (prev) =>
        prev ? prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)) : prev,
      );
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (err: Error) =>
      setMsg({ type: 'error', text: err.message || 'Não foi possível atualizar o projeto.' }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!selected) return;
    if (name.trim().length < 2) {
      setMsg({ type: 'error', text: 'O nome deve ter ao menos 2 caracteres.' });
      return;
    }
    mutation.mutate({
      id: selected.id,
      name: name.trim(),
      address: address.trim() || null,
      technicalContact: technicalContact.trim() || null,
    });
  }

  const dirty =
    !!selected &&
    (name.trim() !== selected.name ||
      (address.trim() || null) !== (selected.address ?? null) ||
      (technicalContact.trim() || null) !== (selected.technicalContact ?? null));

  return (
    <SectionCard
      title="Projeto"
      description="Configurações dos sistemas implantados"
      icon={FolderKanban}
    >
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
        </div>
      ) : projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum projeto disponível.</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {projects.length > 1 && (
            <Field label="Selecionar projeto" icon={FolderKanban}>
              <select
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
                className={`${inputClass} cursor-pointer`}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Nome do projeto" icon={FolderKanban}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder="Ex: BMS Principal"
              disabled={!canEdit || mutation.isPending}
            />
          </Field>
          <Field label="Endereço" icon={MapPin}>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className={inputClass}
              placeholder="Rua das Flores, 100"
              disabled={!canEdit || mutation.isPending}
            />
          </Field>
          <Field label="Contato técnico" icon={Phone}>
            <input
              type="text"
              value={technicalContact}
              onChange={(e) => setTechnicalContact(e.target.value)}
              className={inputClass}
              placeholder="João Silva — (11) 99999-9999"
              disabled={!canEdit || mutation.isPending}
            />
          </Field>
          <Feedback msg={msg} />
          {canEdit ? (
            <div className="flex justify-end">
              <SaveButton pending={mutation.isPending} disabled={!dirty}>
                Salvar projeto
              </SaveButton>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Seu perfil tem acesso somente de leitura a estes dados.
            </p>
          )}
        </form>
      )}
    </SectionCard>
  );
}

// ─── Página ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const user = useCurrentUser();

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-foreground">
          <Settings className="h-5 w-5 text-cyan-600" />
          Ajustes
        </h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Gerencie seu perfil, o cliente e os projetos —{' '}
          <span className="font-medium">{ROLE_LABELS[user.role] ?? user.role}</span>
        </p>
      </div>

      <ProfileSection />
      <TenantSection role={user.role} />
      <ProjectSection role={user.role} />
    </div>
  );
}
