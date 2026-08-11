'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Settings,
  User,
  Mail,
  Building2,
  FolderKanban,
  MapPin,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Bell,
  Plus,
  Pencil,
  Trash2,
  X,
  MessageCircle,
  Phone,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useCurrentUser, type UserRole } from '@/hooks/useCurrentUser';
import { useT } from '@/lib/i18n';
import {
  getTenants,
  updateTenant,
  createTenant,
  type TenantItem,
} from '../services/settings.service';
import {
  getProjects,
  updateProject,
  type ProjectItem,
} from '@/modules/projects/services/projects.service';
import {
  getRecipients,
  createRecipient,
  updateRecipient,
  deleteRecipient,
  type NotificationRecipient,
  type CreateRecipientDto,
  type UpdateRecipientDto,
} from '../services/notification-recipients.service';
import {
  getSites,
  updateSite,
  type SiteItem,
} from '@/modules/sites/services/sites.service';
import PhoneInput from '@/components/PhoneInput';
import { isValidPhone, normalizePhone } from '@/lib/phone';

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
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400'
          : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400',
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
  action,
  contentClassName,
  children,
}: {
  title: string;
  description?: string;
  icon: React.ComponentType<{ className?: string }>;
  action?: React.ReactNode;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow duration-200 hover:shadow-md">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/30 px-5 py-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-cyan-500/10">
          <Icon className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
        </div>
        {action}
      </div>
      <div className={`flex-1 ${contentClassName ?? 'p-5'}`}>{children}</div>
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

// ─── Toggle chip ───────────────────────────────────────────────────────────────

function ToggleChip({
  checked,
  onChange,
  disabled,
  icon: Icon,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      className={[
        'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
        checked
          ? 'border-cyan-500 bg-cyan-50 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300'
          : 'border-border bg-background text-muted-foreground hover:bg-muted/50',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
      ].join(' ')}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

// ─── Cliente / Tenant ───────────────────────────────────────────────────────────

function TenantSection({
  role,
  selectedTenantId,
  onTenantChange,
  onTenantCreated,
}: {
  role: UserRole;
  selectedTenantId: string;
  onTenantChange: (id: string) => void;
  onTenantCreated: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const canEdit = role !== 'VISUALIZADOR';
  const isAdmin = role === 'ADMIN';

  const { data: tenants = [], isLoading } = useQuery<TenantItem[]>({
    queryKey: ['tenants'],
    queryFn: getTenants,
  });

  // ── Edit existing tenant ──
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [msg, setMsg] = useState<Msg>(null);

  const selected = tenants.find((t) => t.id === selectedTenantId) ?? null;

  useEffect(() => {
    if (tenants.length > 0 && !selectedTenantId) {
      onTenantChange(tenants[0].id);
    }
  }, [tenants, selectedTenantId, onTenantChange]);

  useEffect(() => {
    if (selected) {
      setName(selected.name);
      setSlug(selected.slug);
      setMsg(null);
    }
  }, [selected]);

  const editMutation = useMutation({
    mutationFn: (payload: { id: string; name: string; slug: string }) =>
      updateTenant(payload.id, { name: payload.name, slug: payload.slug }),
    onSuccess: (updated) => {
      setMsg({ type: 'success', text: t('Cliente atualizado com sucesso.') });
      queryClient.setQueryData<TenantItem[]>(['tenants'], (prev) =>
        prev ? prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)) : prev,
      );
      void queryClient.invalidateQueries({ queryKey: ['tenants'] });
    },
    onError: (err: Error) =>
      setMsg({ type: 'error', text: err.message || t('Não foi possível atualizar o cliente.') }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!selected) return;
    if (name.trim().length < 2) {
      setMsg({ type: 'error', text: t('O nome deve ter ao menos 2 caracteres.') });
      return;
    }
    editMutation.mutate({ id: selected.id, name: name.trim(), slug: slug.trim() });
  }

  const dirty = !!selected && (name.trim() !== selected.name || slug.trim() !== selected.slug);

  // ── Create new tenant (inline form) ──
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [recipName, setRecipName] = useState('');
  const [recipEmail, setRecipEmail] = useState('');
  const [recipPhone, setRecipPhone] = useState('');
  const [createMsg, setCreateMsg] = useState<Msg>(null);

  // Auto-generate slug from name
  useEffect(() => {
    setNewSlug(
      newName
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, ''),
    );
  }, [newName]);

  const createMutation = useMutation({
    mutationFn: createTenant,
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ['tenants'] });
      onTenantChange(created.id);
      onTenantCreated();
      setShowCreate(false);
      setNewName('');
      setNewSlug('');
      setRecipName('');
      setRecipEmail('');
      setRecipPhone('');
      setCreateMsg(null);
    },
    onError: (err: Error) =>
      setCreateMsg({ type: 'error', text: err.message || t('Não foi possível criar o cliente.') }),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreateMsg(null);
    if (newName.trim().length < 2) {
      setCreateMsg({ type: 'error', text: t('O nome deve ter ao menos 2 caracteres.') });
      return;
    }
    if (!newSlug.trim()) {
      setCreateMsg({ type: 'error', text: t('Informe um slug válido.') });
      return;
    }
    if (!recipName.trim()) {
      setCreateMsg({ type: 'error', text: t('Informe o nome do destinatário inicial.') });
      return;
    }
    const emailTrimmed = recipEmail.trim();
    const phoneTrimmed = recipPhone.trim();
    if (!emailTrimmed && !phoneTrimmed) {
      setCreateMsg({ type: 'error', text: t('Informe ao menos e-mail ou telefone do destinatário.') });
      return;
    }
    if (emailTrimmed && !EMAIL_REGEX.test(emailTrimmed)) {
      setCreateMsg({ type: 'error', text: t('Informe um e-mail válido para o destinatário.') });
      return;
    }
    if (phoneTrimmed && !isValidPhone(normalizePhone(phoneTrimmed))) {
      setCreateMsg({
        type: 'error',
        text: t('Telefone incompleto ou inválido. Ex.: (11) 91234-5678.'),
      });
      return;
    }
    createMutation.mutate({
      name: newName.trim(),
      slug: newSlug.trim(),
      initialRecipient: {
        name: recipName.trim(),
        email: emailTrimmed || undefined,
        phone: phoneTrimmed || undefined,
        emailEnabled: !!emailTrimmed,
        whatsappEnabled: !!phoneTrimmed,
      },
    });
  }

  return (
    <SectionCard
      title={t('Cliente')}
      description={t('Dados da empresa monitorada')}
      icon={Building2}
    >
      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('Carregando…')}
        </div>
      ) : tenants.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('Nenhum cliente disponível.')}</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {tenants.length > 1 && (
            <Field label={t('Selecionar cliente')} icon={Building2}>
              <select
                value={selectedTenantId}
                onChange={(e) => onTenantChange(e.target.value)}
                className={`${inputClass} cursor-pointer`}
              >
                {tenants.map((ten) => (
                  <option key={ten.id} value={ten.id}>
                    {ten.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <Field label={t('Nome da empresa')} icon={Building2}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder={t('Ex: Empresa ABC Ltda')}
              disabled={!canEdit || editMutation.isPending}
            />
          </Field>
          <Field label={t('Slug (identificador único)')} icon={ShieldCheck}>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className={`${inputClass} font-mono`}
              placeholder="empresa-abc"
              disabled={!canEdit || editMutation.isPending}
            />
          </Field>
          <Feedback msg={msg} />
          {canEdit && (
            <div className="flex justify-end">
              <SaveButton pending={editMutation.isPending} disabled={!dirty}>
                {t('Salvar cliente')}
              </SaveButton>
            </div>
          )}
          {!canEdit && (
            <p className="text-xs text-muted-foreground">
              {t('Seu perfil tem acesso somente de leitura a estes dados.')}
            </p>
          )}
        </form>
      )}

      {/* ── Criar novo cliente (ADMIN only) ── */}
      {isAdmin && (
        <div className="mt-5 pt-5 border-t border-border">
          <button
            type="button"
            onClick={() => { setShowCreate((v) => !v); setCreateMsg(null); }}
            className="inline-flex items-center gap-2 text-sm font-medium text-cyan-600 hover:text-cyan-700 transition-colors"
          >
            {showCreate ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {showCreate ? t('Cancelar criação') : t('Criar novo cliente')}
          </button>

          {showCreate && (
            <form onSubmit={handleCreate} className="mt-4 space-y-4 rounded-lg border border-dashed border-cyan-400 bg-cyan-50/40 dark:bg-cyan-950/20 p-4">
              <p className="text-xs font-semibold text-cyan-700 dark:text-cyan-300 uppercase tracking-wide">
                {t('Novo cliente')}
              </p>
              <Field label={t('Nome da empresa')} icon={Building2}>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className={inputClass}
                  placeholder={t('Ex: Empresa XYZ Ltda')}
                  disabled={createMutation.isPending}
                />
              </Field>
              <Field label={t('Slug (identificador único)')} icon={ShieldCheck}>
                <input
                  type="text"
                  value={newSlug}
                  onChange={(e) => setNewSlug(e.target.value)}
                  className={`${inputClass} font-mono`}
                  placeholder="empresa-xyz"
                  disabled={createMutation.isPending}
                />
              </Field>

              <div className="border-t border-cyan-200 dark:border-cyan-800 pt-4 space-y-3">
                <p className="text-xs font-medium text-muted-foreground">
                  {t('Destinatário inicial')} —{' '}
                  <span className="text-cyan-700 dark:text-cyan-400">
                    {t('obrigatório')}
                  </span>
                </p>
                <Field label={t('Nome do destinatário')} icon={User}>
                  <input
                    type="text"
                    value={recipName}
                    onChange={(e) => setRecipName(e.target.value)}
                    className={inputClass}
                    placeholder={t('Ex.: João Silva')}
                    disabled={createMutation.isPending}
                  />
                </Field>
                <Field label={t('E-mail')} icon={Mail}>
                  <input
                    type="email"
                    value={recipEmail}
                    onChange={(e) => setRecipEmail(e.target.value)}
                    className={inputClass}
                    placeholder={t('joao@empresa.com.br')}
                    disabled={createMutation.isPending}
                  />
                </Field>
                <Field label={t('Telefone (WhatsApp)')} icon={Phone}>
                  <PhoneInput
                    value={recipPhone}
                    onChange={setRecipPhone}
                    className={inputClass}
                    placeholder="(11) 91234-5678"
                    disabled={createMutation.isPending}
                  />
                </Field>
                <p className="text-xs text-muted-foreground">
                  {t('Informe ao menos e-mail ou telefone. O destinatário receberá alarmes do cliente.')}
                </p>
              </div>

              <Feedback msg={createMsg} />
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-700 disabled:opacity-50"
                >
                  {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t('Criar cliente')}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </SectionCard>
  );
}

// ─── Site ────────────────────────────────────────────────────────────────────────

function SiteSection({
  role,
  selectedTenantId,
  selectedSiteId,
  onSiteChange,
}: {
  role: UserRole;
  selectedTenantId: string;
  selectedSiteId: string;
  onSiteChange: (id: string) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const canEdit = role !== 'VISUALIZADOR';

  const { data: sites = [], isLoading } = useQuery<SiteItem[]>({
    queryKey: ['sites', selectedTenantId],
    queryFn: () => getSites(selectedTenantId || undefined),
    enabled: !!selectedTenantId,
  });

  const [location, setLocation] = useState('');
  const [responsibleName, setResponsibleName] = useState('');
  const [msg, setMsg] = useState<Msg>(null);

  const selectedSite = sites.find((s) => s.id === selectedSiteId) ?? null;

  // Seed selectedSiteId when sites load or when tenantId changes
  useEffect(() => {
    if (sites.length > 0 && !selectedSiteId) {
      onSiteChange(sites[0].id);
    }
  }, [sites, selectedSiteId, onSiteChange]);

  useEffect(() => {
    if (selectedSite) {
      setLocation(selectedSite.location ?? '');
      setResponsibleName(selectedSite.responsibleName ?? '');
      setMsg(null);
    }
  }, [selectedSite]);

  const mutation = useMutation({
    mutationFn: (payload: { id: string; location: string | null; responsibleName: string | null }) =>
      updateSite(payload.id, {
        location: payload.location,
        responsibleName: payload.responsibleName,
      }),
    onSuccess: (updated) => {
      setMsg({ type: 'success', text: t('Site atualizado com sucesso.') });
      queryClient.setQueryData<SiteItem[]>(['sites', selectedTenantId], (prev) =>
        prev ? prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)) : prev,
      );
    },
    onError: (err: Error) =>
      setMsg({ type: 'error', text: err.message || t('Não foi possível atualizar o site.') }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!selectedSite) return;
    mutation.mutate({
      id: selectedSite.id,
      location: location.trim() || null,
      responsibleName: responsibleName.trim() || null,
    });
  }

  const dirty =
    !!selectedSite &&
    ((location.trim() || null) !== (selectedSite.location ?? null) ||
      (responsibleName.trim() || null) !== (selectedSite.responsibleName ?? null));

  return (
    <SectionCard
      title={t('Site')}
      description={t('Localização física e responsável do site')}
      icon={MapPin}
    >
      {!selectedTenantId ? (
        <p className="text-sm text-muted-foreground">{t('Selecione um cliente primeiro.')}</p>
      ) : isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('Carregando…')}
        </div>
      ) : sites.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('Nenhum site cadastrado para este cliente.')}</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {sites.length > 1 && (
            <Field label={t('Selecionar site')} icon={MapPin}>
              <select
                value={selectedSiteId}
                onChange={(e) => onSiteChange(e.target.value)}
                className={`${inputClass} cursor-pointer`}
              >
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {sites.length === 1 && selectedSite && (
            <p className="text-sm font-medium text-foreground">{selectedSite.name}</p>
          )}
          <Field label={t('Local')} icon={MapPin}>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className={inputClass}
              placeholder={t('Ex.: Rua das Flores, 100 — Bloco B')}
              disabled={!canEdit || mutation.isPending}
            />
          </Field>
          <Field label={t('Nome do responsável')} icon={User}>
            <input
              type="text"
              value={responsibleName}
              onChange={(e) => setResponsibleName(e.target.value)}
              className={inputClass}
              placeholder={t('Ex.: João Silva')}
              disabled={!canEdit || mutation.isPending}
            />
          </Field>
          <Feedback msg={msg} />
          {canEdit ? (
            <div className="flex justify-end">
              <SaveButton pending={mutation.isPending} disabled={!dirty}>
                {t('Salvar site')}
              </SaveButton>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t('Seu perfil tem acesso somente de leitura a estes dados.')}
            </p>
          )}
        </form>
      )}
    </SectionCard>
  );
}

// ─── Projeto ─────────────────────────────────────────────────────────────────────

function ProjectSection({
  role,
  selectedTenantId,
  selectedSiteId,
}: {
  role: UserRole;
  selectedTenantId: string;
  selectedSiteId: string;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const canEdit = GLOBAL_ROLES.includes(role);

  const { data: projects = [], isLoading } = useQuery<ProjectItem[]>({
    queryKey: ['settings', 'projects', selectedTenantId, selectedSiteId],
    queryFn: () => getProjects(selectedSiteId || undefined, selectedTenantId || undefined),
    enabled: !!selectedTenantId,
  });

  const [selectedId, setSelectedId] = useState('');
  const [name, setName] = useState('');
  const [msg, setMsg] = useState<Msg>(null);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  // Reset selection when tenant or site changes
  useEffect(() => {
    setSelectedId('');
  }, [selectedTenantId, selectedSiteId]);

  useEffect(() => {
    if (projects.length > 0 && !selectedId) {
      setSelectedId(projects[0].id);
    }
  }, [projects, selectedId]);

  useEffect(() => {
    if (selected) {
      setName(selected.name);
      setMsg(null);
    }
  }, [selected]);

  const mutation = useMutation({
    mutationFn: (payload: { id: string; name: string }) =>
      updateProject(payload.id, { name: payload.name }),
    onSuccess: (updated) => {
      setMsg({ type: 'success', text: t('Projeto atualizado com sucesso.') });
      queryClient.setQueryData<ProjectItem[]>(['settings', 'projects', selectedTenantId, selectedSiteId], (prev) =>
        prev ? prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)) : prev,
      );
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (err: Error) =>
      setMsg({ type: 'error', text: err.message || t('Não foi possível atualizar o projeto.') }),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!selected) return;
    if (name.trim().length < 2) {
      setMsg({ type: 'error', text: t('O nome deve ter ao menos 2 caracteres.') });
      return;
    }
    mutation.mutate({ id: selected.id, name: name.trim() });
  }

  const dirty = !!selected && name.trim() !== selected.name;

  return (
    <SectionCard
      title={t('Projeto')}
      description={t('Sistemas implantados no site selecionado')}
      icon={FolderKanban}
    >
      {!selectedTenantId ? (
        <p className="text-sm text-muted-foreground">{t('Selecione um cliente primeiro.')}</p>
      ) : isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('Carregando…')}
        </div>
      ) : projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {selectedSiteId
            ? t('Nenhum projeto disponível para este site.')
            : t('Nenhum projeto disponível para este cliente.')}
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {projects.length > 1 && (
            <Field label={t('Selecionar projeto')} icon={FolderKanban}>
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
          <Field label={t('Nome do projeto')} icon={FolderKanban}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
              placeholder={t('Ex: BMS Principal')}
              disabled={!canEdit || mutation.isPending}
            />
          </Field>
          <Feedback msg={msg} />
          {canEdit ? (
            <div className="flex justify-end">
              <SaveButton pending={mutation.isPending} disabled={!dirty}>
                {t('Salvar projeto')}
              </SaveButton>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              {t('Seu perfil tem acesso somente de leitura a estes dados.')}
            </p>
          )}
        </form>
      )}
    </SectionCard>
  );
}

// ─── Recipient Dialog ──────────────────────────────────────────────────────────

interface RecipientFormState {
  name: string;
  email: string;
  phone: string;
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  alarms: boolean;
  insights: boolean;
  allSites: boolean;
  siteIds: string[];
  active: boolean;
}

const EMPTY_FORM: RecipientFormState = {
  name: '',
  email: '',
  phone: '',
  emailEnabled: true,
  whatsappEnabled: false,
  alarms: true,
  insights: false,
  allSites: true,
  siteIds: [],
  active: true,
};

function recipientToForm(r: NotificationRecipient): RecipientFormState {
  return {
    name: r.name,
    email: r.email ?? '',
    phone: r.phone ?? '',
    emailEnabled: r.emailEnabled,
    whatsappEnabled: r.whatsappEnabled,
    alarms: r.alarms,
    insights: r.insights,
    allSites: r.allSites,
    siteIds: r.sites.map((s) => s.id),
    active: r.active,
  };
}

function validateForm(form: RecipientFormState): string | null {
  if (!form.name.trim()) return 'Informe o nome do destinatário';
  if (!form.email.trim() && !form.phone.trim())
    return 'Informe ao menos um contato: e-mail ou telefone';
  if (!form.emailEnabled && !form.whatsappEnabled)
    return 'Habilite ao menos um canal: E-mail ou WhatsApp';
  if (form.emailEnabled && !form.email.trim())
    return 'Canal E-mail habilitado, mas e-mail não informado';
  if (form.whatsappEnabled && !form.phone.trim())
    return 'Canal WhatsApp habilitado, mas telefone não informado';
  if (form.email.trim() && !EMAIL_REGEX.test(form.email.trim()))
    return 'Informe um e-mail válido';
  if (form.phone.trim()) {
    const normalized = normalizePhone(form.phone.trim());
    if (!isValidPhone(normalized))
      return 'Telefone incompleto ou inválido. Ex.: (11) 91234-5678';
  }
  if (!form.allSites && form.siteIds.length === 0)
    return 'Informe ao menos um site quando "Todos os sites" estiver desabilitado';
  return null;
}

function RecipientDialog({
  editing,
  tenantId,
  sites,
  sitesLoading,
  onSave,
  onClose,
  pending,
  error,
}: {
  editing: NotificationRecipient | null;
  tenantId: string;
  sites: SiteItem[];
  sitesLoading: boolean;
  onSave: (dto: CreateRecipientDto | UpdateRecipientDto, isEdit: boolean) => void;
  onClose: () => void;
  pending: boolean;
  error: string | null;
}) {
  const t = useT();
  const [form, setForm] = useState<RecipientFormState>(
    editing ? recipientToForm(editing) : EMPTY_FORM,
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  function set<K extends keyof RecipientFormState>(key: K, val: RecipientFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: val }));
    setLocalError(null);
  }

  function toggleSite(id: string) {
    setForm((prev) => {
      const has = prev.siteIds.includes(id);
      return {
        ...prev,
        siteIds: has ? prev.siteIds.filter((s) => s !== id) : [...prev.siteIds, id],
      };
    });
    setLocalError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = validateForm(form);
    if (err) { setLocalError(err); return; }

    const normalizedPhone = form.phone.trim() ? normalizePhone(form.phone.trim()) : undefined;

    const dto: CreateRecipientDto = {
      tenantId,
      name: form.name.trim(),
      email: form.email.trim() || undefined,
      phone: normalizedPhone,
      emailEnabled: form.emailEnabled,
      whatsappEnabled: form.whatsappEnabled,
      alarms: form.alarms,
      insights: form.insights,
      allSites: form.allSites,
      siteIds: form.allSites ? [] : form.siteIds,
      active: form.active,
    };
    onSave(dto, !!editing);
  }

  const displayError = localError ?? error;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-xl border border-border bg-background shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between bg-muted/30 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">
            {editing ? t('Editar Destinatário') : t('Novo Destinatário')}
          </h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
          <Field label={t('Nome do destinatário')} icon={User}>
            <input
              type="text"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className={inputClass}
              placeholder={t('Ex.: João Silva')}
              disabled={pending}
              autoFocus
            />
          </Field>

          <Field label={t('E-mail')} icon={Mail}>
            <input
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
              className={inputClass}
              placeholder={t('voce@empresa.com')}
              disabled={pending}
            />
          </Field>

          <Field label={t('Telefone (WhatsApp)')} icon={Phone}>
            <PhoneInput
              value={form.phone}
              onChange={(v) => set('phone', v)}
              className={inputClass}
              placeholder="(11) 91234-5678"
              disabled={pending}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              {t('Digite DDD e número. Para internacional, comece com + e o código do país.')}
            </p>
          </Field>

          <div className="space-y-1.5">
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Bell className="h-3.5 w-3.5 text-cyan-600" />
              {t('Canais habilitados')}
            </span>
            <div className="flex flex-wrap gap-2">
              <ToggleChip
                checked={form.emailEnabled}
                onChange={(v) => set('emailEnabled', v)}
                disabled={pending}
                icon={Mail}
                label="E-mail"
              />
              <ToggleChip
                checked={form.whatsappEnabled}
                onChange={(v) => set('whatsappEnabled', v)}
                disabled={pending}
                icon={MessageCircle}
                label="WhatsApp"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Bell className="h-3.5 w-3.5 text-cyan-600" />
              {t('Categorias de notificação')}
            </span>
            <div className="flex flex-wrap gap-2">
              <ToggleChip
                checked={form.alarms}
                onChange={(v) => set('alarms', v)}
                disabled={pending}
                icon={AlertCircle}
                label={t('Alarmes')}
              />
              <ToggleChip
                checked={form.insights}
                onChange={(v) => set('insights', v)}
                disabled={pending}
                icon={CheckCircle2}
                label={t('Insights da IA')}
              />
            </div>
          </div>

          <div className="space-y-2">
            <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <MapPin className="h-3.5 w-3.5 text-cyan-600" />
              {t('Escopo de sites')}
            </span>
            <div className="flex gap-2">
              <ToggleChip
                checked={form.allSites}
                onChange={() => set('allSites', true)}
                disabled={pending}
                icon={Building2}
                label={t('Todos os sites do cliente')}
              />
              <ToggleChip
                checked={!form.allSites}
                onChange={() => set('allSites', false)}
                disabled={pending}
                icon={MapPin}
                label={t('Sites específicos')}
              />
            </div>

            {!form.allSites && (
              <div className="mt-2 rounded-lg border border-border bg-muted/10 max-h-40 overflow-y-auto">
                {sitesLoading ? (
                  <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {t('Carregando sites…')}
                  </div>
                ) : sites.length === 0 ? (
                  <p className="p-3 text-xs text-muted-foreground">{t('Nenhum site disponível')}</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {sites.map((site) => (
                      <li key={site.id}>
                        <label className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-muted/30 transition-colors">
                          <input
                            type="checkbox"
                            checked={form.siteIds.includes(site.id)}
                            onChange={() => toggleSite(site.id)}
                            disabled={pending}
                            className="accent-cyan-600"
                          />
                          <span className="text-sm text-foreground">{site.name}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set('active', e.target.checked)}
              disabled={pending}
              className="accent-cyan-600 h-4 w-4"
            />
            <span className="text-sm text-foreground">{t('Destinatário ativo')}</span>
          </label>

          {displayError && (
            <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{displayError}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
            >
              {t('Cancelar')}
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-700 disabled:opacity-50"
            >
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? t('Salvar') : t('Criar')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Delete Confirm Dialog ─────────────────────────────────────────────────────

function DeleteConfirmDialog({
  recipient,
  onConfirm,
  onClose,
  pending,
}: {
  recipient: NotificationRecipient;
  onConfirm: () => void;
  onClose: () => void;
  pending: boolean;
}) {
  const t = useT();
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}
    >
      <div className="w-full max-w-sm rounded-xl border border-border bg-background shadow-2xl p-5 space-y-4">
        <div className="flex items-start gap-3">
          <Trash2 className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-sm font-semibold text-foreground">{t('Excluir destinatário')}</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {t('Tem certeza que deseja excluir')}{' '}
              <span className="font-medium text-foreground">{recipient.name}</span>?{' '}
              {t('Esta ação não pode ser desfeita.')}
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={pending}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
          >
            {t('Cancelar')}
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {pending ? t('Excluindo…') : t('Excluir')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Notification Recipients Section ──────────────────────────────────────────

function NotificationRecipientsSection({
  role,
  selectedTenantId,
  tenants,
}: {
  role: UserRole;
  selectedTenantId: string;
  tenants: TenantItem[];
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const canEdit = role !== 'VISUALIZADOR';

  const { data: sites = [], isLoading: sitesLoading } = useQuery<SiteItem[]>({
    queryKey: ['sites', selectedTenantId],
    queryFn: () => getSites(selectedTenantId || undefined),
    enabled: !!selectedTenantId,
  });

  const {
    data: recipients = [],
    isLoading,
    isError,
  } = useQuery<NotificationRecipient[]>({
    queryKey: ['notification-recipients', selectedTenantId],
    queryFn: () => getRecipients(selectedTenantId || undefined),
    enabled: !!selectedTenantId,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<NotificationRecipient | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<NotificationRecipient | null>(null);
  const [toast, setToast] = useState<Msg>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const saveMutation = useMutation({
    mutationFn: (vars: { dto: CreateRecipientDto | UpdateRecipientDto; isEdit: boolean; id?: string }) =>
      vars.isEdit && vars.id
        ? updateRecipient(vars.id, vars.dto as UpdateRecipientDto)
        : createRecipient(vars.dto as CreateRecipientDto),
    onSuccess: (_, vars) => {
      void queryClient.invalidateQueries({ queryKey: ['notification-recipients', selectedTenantId] });
      setDialogOpen(false);
      setEditing(null);
      setDialogError(null);
      setToast({
        type: 'success',
        text: vars.isEdit
          ? t('Destinatário atualizado com sucesso.')
          : t('Destinatário criado com sucesso.'),
      });
    },
    onError: (err: Error) => {
      setDialogError(err.message || t('Não foi possível salvar o destinatário.'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteRecipient(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notification-recipients', selectedTenantId] });
      setDeleting(null);
      setToast({ type: 'success', text: t('Destinatário excluído com sucesso.') });
    },
    onError: (err: Error) => {
      setDeleting(null);
      setToast({ type: 'error', text: err.message || t('Não foi possível excluir o destinatário.') });
    },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      updateRecipient(id, { active }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notification-recipients', selectedTenantId] });
    },
    onError: (err: Error) => {
      setToast({ type: 'error', text: err.message || t('Não foi possível salvar o destinatário.') });
    },
  });

  function openCreate() {
    setEditing(null);
    setDialogError(null);
    setDialogOpen(true);
  }

  function openEdit(r: NotificationRecipient) {
    setEditing(r);
    setDialogError(null);
    setDialogOpen(true);
  }

  function handleSave(dto: CreateRecipientDto | UpdateRecipientDto, isEdit: boolean) {
    saveMutation.mutate({ dto, isEdit, id: editing?.id });
  }

  const tenantName = tenants.find((ten) => ten.id === selectedTenantId)?.name ?? '';

  const badgeClass =
    'inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-medium';

  return (
    <>
      <SectionCard
        title={t('Destinatários de Notificação')}
        description={t('Quem deve receber alarmes e insights por e-mail ou WhatsApp')}
        icon={Bell}
        action={
          canEdit && selectedTenantId && !isLoading && !isError ? (
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-2 text-xs font-medium text-white shadow-sm transition-colors hover:bg-cyan-700"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('Novo destinatário')}
            </button>
          ) : undefined
        }
        contentClassName="p-0"
      >
        {!selectedTenantId ? (
          <p className="p-5 text-sm text-muted-foreground">{t('Selecione um cliente primeiro.')}</p>
        ) : isLoading ? (
          <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t('Carregando destinatários…')}
          </div>
        ) : isError ? (
          <p className="p-5 text-sm text-red-600 dark:text-red-400">{t('Não foi possível carregar os destinatários.')}</p>
        ) : (
          <div>
            {(toast || (tenants.length > 1 && tenantName)) && (
              <div className="space-y-3 px-5 pt-4">
                {toast && <Feedback msg={toast} />}
                {tenants.length > 1 && tenantName && (
                  <p className="text-xs text-muted-foreground">
                    {t('Cliente')}: <span className="font-medium text-foreground">{tenantName}</span>
                  </p>
                )}
              </div>
            )}

            {recipients.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-4 px-6 py-14 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-500/10">
                  <Bell className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-foreground">{t('Nenhum destinatário cadastrado.')}</p>
                  <p className="mx-auto max-w-sm text-xs text-muted-foreground">
                    {t('Este cliente não possui destinatários — alarmes e insights não serão entregues.')}
                  </p>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={openCreate}
                    className="inline-flex items-center gap-2 rounded-lg border border-dashed border-cyan-400 px-4 py-2 text-sm font-medium text-cyan-600 transition-colors hover:bg-cyan-50 dark:text-cyan-400 dark:hover:bg-cyan-950/40"
                  >
                    <Plus className="h-4 w-4" />
                    {t('Novo destinatário')}
                  </button>
                )}
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-y border-border bg-muted/30">
                      <th className="px-5 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('Nome')}</th>
                      <th className="hidden px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground sm:table-cell">{t('Contato')}</th>
                      <th className="hidden px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground md:table-cell">{t('Canais')}</th>
                      <th className="hidden px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground lg:table-cell">{t('Categorias')}</th>
                      <th className="hidden px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground md:table-cell">{t('Escopo')}</th>
                      <th className="px-4 py-3 text-center text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('Ativo')}</th>
                      {canEdit && <th className="px-4 py-3" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {recipients.map((r) => (
                      <tr key={r.id} className="transition-colors duration-150 hover:bg-muted/30">
                        <td className="px-5 py-3.5 align-top">
                          <div className="font-medium text-foreground">{r.name}</div>
                          {/* Category badges inline on narrow screens (dedicated column from lg up) */}
                          <div className="mt-1 flex flex-wrap gap-1 lg:hidden">
                            {r.alarms && (
                              <span className={`${badgeClass} border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300`}>{t('Alarmes')}</span>
                            )}
                            {r.insights && (
                              <span className={`${badgeClass} border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300`}>{t('Insights da IA')}</span>
                            )}
                          </div>
                        </td>
                        <td className="hidden px-4 py-3.5 align-top text-muted-foreground sm:table-cell">
                          <div className="space-y-1">
                            {r.email && (
                              <div className="flex items-center gap-1.5">
                                <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                                <span className="truncate">{r.email}</span>
                              </div>
                            )}
                            {r.phone && (
                              <div className="flex items-center gap-1.5 whitespace-nowrap">
                                <MessageCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                                {r.phone}
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="hidden px-4 py-3.5 align-top md:table-cell">
                          <div className="flex flex-wrap gap-1.5">
                            {r.emailEnabled && (
                              <span className={`${badgeClass} border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-300`}>
                                <Mail className="h-3 w-3" />
                                E-mail
                              </span>
                            )}
                            {r.whatsappEnabled && (
                              <span className={`${badgeClass} border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-950/60 dark:text-green-300`}>
                                <MessageCircle className="h-3 w-3" />
                                WhatsApp
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="hidden px-4 py-3.5 align-top lg:table-cell">
                          <div className="flex flex-wrap gap-1.5">
                            {r.alarms && (
                              <span className={`${badgeClass} border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/60 dark:text-amber-300`}>{t('Alarmes')}</span>
                            )}
                            {r.insights && (
                              <span className={`${badgeClass} border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/60 dark:text-blue-300`}>{t('Insights da IA')}</span>
                            )}
                          </div>
                        </td>
                        <td className="hidden px-4 py-3.5 align-top text-xs text-muted-foreground md:table-cell">
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                            {r.allSites ? (
                              <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                            ) : (
                              <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                            )}
                            {r.allSites
                              ? t('Todos os sites')
                              : `${r.sites.length} ${r.sites.length === 1 ? t('site') : t('sites')}`}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-center align-top">
                          <button
                            type="button"
                            onClick={() => canEdit && toggleActiveMutation.mutate({ id: r.id, active: !r.active })}
                            disabled={!canEdit || toggleActiveMutation.isPending}
                            title={r.active ? t('Ativo') : t('Inativo')}
                            className={[
                              'inline-flex items-center justify-center w-8 h-5 rounded-full transition-colors',
                              r.active ? 'bg-cyan-500' : 'bg-muted-foreground/30',
                              !canEdit ? 'cursor-default' : 'cursor-pointer',
                            ].join(' ')}
                          >
                            <span
                              className={[
                                'block w-3.5 h-3.5 rounded-full bg-white transition-transform shadow-sm',
                                r.active ? 'translate-x-1.5' : '-translate-x-1.5',
                              ].join(' ')}
                            />
                          </button>
                        </td>
                        {canEdit && (
                          <td className="px-4 py-3.5 align-top">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => openEdit(r)}
                                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
                                title={t('Editar')}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleting(r)}
                                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                                title={t('Excluir')}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="border-t border-border bg-muted/20 px-5 py-2.5 text-xs text-muted-foreground">
                  {recipients.length}{' '}
                  {recipients.length === 1 ? t('destinatário') : t('destinatários')}
                </div>
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {dialogOpen && (
        <RecipientDialog
          editing={editing}
          tenantId={selectedTenantId}
          sites={sites}
          sitesLoading={sitesLoading}
          onSave={handleSave}
          onClose={() => { setDialogOpen(false); setDialogError(null); }}
          pending={saveMutation.isPending}
          error={dialogError}
        />
      )}

      {deleting && (
        <DeleteConfirmDialog
          recipient={deleting}
          onConfirm={() => deleteMutation.mutate(deleting.id)}
          onClose={() => setDeleting(null)}
          pending={deleteMutation.isPending}
        />
      )}
    </>
  );
}

// ─── Página ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const user = useCurrentUser();
  const t = useT();

  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [selectedSiteId, setSelectedSiteId] = useState('');

  const { data: tenants = [] } = useQuery<TenantItem[]>({
    queryKey: ['tenants'],
    queryFn: getTenants,
  });

  // Seed selectedTenantId on first load
  useEffect(() => {
    if (tenants.length > 0 && !selectedTenantId) {
      setSelectedTenantId(tenants[0].id);
    }
  }, [tenants, selectedTenantId]);

  // Reset selectedSiteId when tenant changes
  function handleTenantChange(id: string) {
    setSelectedTenantId(id);
    setSelectedSiteId('');
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10">
            <Settings className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground">{t('Ajustes')}</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t('Configure clientes, sites, projetos e destinatários de notificação')}
            </p>
          </div>
        </div>
        <span className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border border-border bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />
          {ROLE_LABELS[user.role] ?? user.role}
        </span>
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        <TenantSection
          role={user.role}
          selectedTenantId={selectedTenantId}
          onTenantChange={handleTenantChange}
          onTenantCreated={() => setSelectedSiteId('')}
        />
        <SiteSection
          role={user.role}
          selectedTenantId={selectedTenantId}
          selectedSiteId={selectedSiteId}
          onSiteChange={setSelectedSiteId}
        />
        <div className="md:col-span-2 xl:col-span-1">
          <ProjectSection
            role={user.role}
            selectedTenantId={selectedTenantId}
            selectedSiteId={selectedSiteId}
          />
        </div>
      </div>

      <NotificationRecipientsSection
        role={user.role}
        selectedTenantId={selectedTenantId}
        tenants={tenants}
      />
    </div>
  );
}
