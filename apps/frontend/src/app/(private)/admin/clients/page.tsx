'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, ExternalLink, Calendar, Server, Loader2, Trash2, Ban, CircleCheck, Palette } from 'lucide-react';
import { apiGet, apiPost, apiPatch, apiDelete, sensitiveActionHeaders } from '@/lib/api-client';
import PasswordConfirmDialog from '@/components/PasswordConfirmDialog';
import { BrandingModal } from './BrandingModal';
import { resolveTenantLogoUrl } from '@/modules/tenants/services/tenants.service';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Tenant {
  id: string;
  name: string;
  slug: string;
  active?: boolean;
  logoUrl?: string | null;
  accentColor?: string | null;
  createdAt: string;
  siteCount?: number;
}

interface CreateTenantDto {
  name: string;
  slug: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

// ─── Modal ───────────────────────────────────────────────────────────────────

interface NewClientModalProps {
  onClose: () => void;
  onCreated: () => void;
}

function NewClientModal({ onClose, onCreated }: NewClientModalProps) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugManual, setSlugManual] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (dto: CreateTenantDto) => apiPost<Tenant>('/tenants', dto),
    onSuccess: () => {
      onCreated();
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  function handleNameChange(val: string) {
    setName(val);
    if (!slugManual) setSlug(slugify(val));
  }

  function handleSlugChange(val: string) {
    setSlugManual(true);
    setSlug(val);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError('Nome é obrigatório'); return; }
    if (!slug.trim()) { setError('Slug é obrigatório'); return; }
    mutation.mutate({ name: name.trim(), slug: slug.trim() });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-card rounded-xl shadow-xl w-full max-w-md border border-slate-200 max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h2 className="text-base font-semibold text-foreground">Novo Cliente</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 flex-1 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Nome da empresa
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Ex: Empresa ABC Ltda"
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Slug
              <span className="ml-1 text-xs text-slate-400 font-normal">(identificador único)</span>
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => handleSlugChange(e.target.value)}
              placeholder="empresa-abc"
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 dark:text-red-300 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex-1 rounded-md bg-cyan-700 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-800 disabled:opacity-50 transition-colors"
            >
              {mutation.isPending ? 'Salvando...' : 'Criar Cliente'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ClientsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmDeactivate, setConfirmDeactivate] = useState<Tenant | null>(null);
  const [brandingTenant, setBrandingTenant] = useState<Tenant | null>(null);

  const { data: tenants, isLoading, isError, error } = useQuery<Tenant[]>({
    queryKey: ['tenants'],
    queryFn: () => apiGet<Tenant[]>('/tenants'),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, token }: { id: string; token: string }) =>
      apiDelete(`/tenants/${id}`, { headers: sensitiveActionHeaders(token) }),
    onSuccess: () => {
      setConfirmDeleteId(null);
      void queryClient.invalidateQueries({ queryKey: ['tenants'] });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      apiPatch<Tenant>(`/tenants/${id}/status`, { active }),
    onSuccess: () => {
      setConfirmDeactivate(null);
      void queryClient.invalidateQueries({ queryKey: ['tenants'] });
    },
  });

  function handleToggleStatus(tenant: Tenant) {
    if (tenant.active === false) {
      // Reativar não é destrutivo — sem confirmação.
      statusMutation.mutate({ id: tenant.id, active: true });
    } else {
      setConfirmDeactivate(tenant);
    }
  }

  function handleCreated() {
    void queryClient.invalidateQueries({ queryKey: ['tenants'] });
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Clientes</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Gestão de tenants — empresas monitoradas na plataforma
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 h-9 px-4 text-sm rounded-md font-medium bg-cyan-700 text-white hover:bg-cyan-800 transition-colors self-start"
        >
          <Plus className="h-4 w-4" />
          Novo Cliente
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 rounded-lg bg-slate-100 animate-pulse" />
          ))}
        </div>
      )}

      {/* Error */}
      {isError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          Erro ao carregar clientes: {(error as Error).message}
        </div>
      )}

      {/* Empty */}
      {!isLoading && !isError && tenants?.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Building2 className="h-12 w-12 text-slate-300 mb-4" />
          <h3 className="text-base font-medium text-foreground mb-1">Nenhum cliente cadastrado</h3>
          <p className="text-sm text-slate-500 mb-5">
            Adicione o primeiro cliente para começar a monitorar.
          </p>
          <button
            onClick={() => setModalOpen(true)}
            className="flex items-center gap-2 h-9 px-4 text-sm rounded-md font-medium bg-cyan-700 text-white hover:bg-cyan-800 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Novo Cliente
          </button>
        </div>
      )}

      {/* Table */}
      {!isLoading && !isError && tenants && tenants.length > 0 && (
        <div className="border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 font-medium text-slate-600">Cliente</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600 hidden sm:table-cell">Slug</th>
                <th className="text-center px-4 py-3 font-medium text-slate-600 hidden md:table-cell">Sites</th>
                <th className="text-left px-4 py-3 font-medium text-slate-600 hidden lg:table-cell">Criado em</th>
                <th className="text-right px-4 py-3 font-medium text-slate-600">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {tenants.map((tenant) => (
                <tr key={tenant.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {tenant.logoUrl ? (
                        <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0 overflow-hidden bg-white ring-1 ring-slate-200">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={resolveTenantLogoUrl(tenant.logoUrl) ?? ''} alt="" className="h-full w-full object-contain p-0.5" />
                        </div>
                      ) : (
                        <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${tenant.active === false ? 'bg-slate-100 dark:bg-slate-700' : 'bg-cyan-100'}`}>
                          <Building2 className={`h-4 w-4 ${tenant.active === false ? 'text-slate-400' : 'text-cyan-700 dark:text-cyan-300'}`} />
                        </div>
                      )}
                      <span className={`font-medium ${tenant.active === false ? 'text-slate-400 dark:text-slate-500' : 'text-foreground'}`}>{tenant.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {tenant.active === false ? (
                      <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300">
                        Inativo
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                        Ativo
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <span className="font-mono text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                      {tenant.slug}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center hidden md:table-cell">
                    <div className="flex items-center justify-center gap-1 text-foreground">
                      <Server className="h-3.5 w-3.5 text-slate-400" />
                      {tenant.siteCount ?? 0}
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    <div className="flex items-center gap-1.5 text-slate-500">
                      <Calendar className="h-3.5 w-3.5" />
                      {formatDate(tenant.createdAt)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => router.push(`/admin/sites?tenantId=${tenant.id}`)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-cyan-700 hover:text-cyan-900 dark:text-cyan-400 dark:hover:text-cyan-300 hover:underline transition-colors"
                      >
                        Ver Sites
                        <ExternalLink className="h-3 w-3" />
                      </button>
                      <button
                        onClick={() => setBrandingTenant(tenant)}
                        title="Identidade visual (logo e cor)"
                        className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-cyan-700 hover:bg-cyan-50 transition-colors"
                      >
                        <Palette className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleToggleStatus(tenant)}
                        disabled={statusMutation.isPending}
                        title={tenant.active === false ? 'Reativar cliente' : 'Inativar cliente'}
                        className={`inline-flex items-center justify-center h-7 w-7 rounded-md transition-colors disabled:opacity-50 ${
                          tenant.active === false
                            ? 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'
                            : 'text-muted-foreground hover:text-amber-600 hover:bg-amber-50'
                        }`}
                      >
                        {tenant.active === false ? (
                          <CircleCheck className="h-3.5 w-3.5" />
                        ) : (
                          <Ban className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(tenant.id)}
                        title="Excluir cliente"
                        className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary */}
      {tenants && tenants.length > 0 && (
        <p className="text-xs text-slate-400">
          {tenants.length} cliente{tenants.length !== 1 ? 's' : ''} cadastrado{tenants.length !== 1 ? 's' : ''}
        </p>
      )}

      {/* Modal criar */}
      {modalOpen && (
        <NewClientModal
          onClose={() => setModalOpen(false)}
          onCreated={handleCreated}
        />
      )}

      {/* Modal identidade visual (logo + cor) */}
      {brandingTenant && (
        <BrandingModal
          tenant={brandingTenant}
          onClose={() => setBrandingTenant(null)}
        />
      )}

      {/* Modal confirmar inativação */}
      {confirmDeactivate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => { setConfirmDeactivate(null); statusMutation.reset(); }} />
          <div className="relative bg-card rounded-xl shadow-xl w-full max-w-md border border-slate-200 p-6">
            <h2 className="text-base font-semibold text-foreground">Inativar cliente?</h2>
            <p className="mt-2 text-sm text-slate-600">
              Os usuários de <span className="font-medium">{confirmDeactivate.name}</span> perderão o acesso
              imediatamente e as notificações de alarme serão silenciadas. Os dados e o histórico
              são preservados e o cliente pode ser reativado a qualquer momento.
            </p>
            {statusMutation.error && (
              <p className="mt-3 text-sm text-red-600 dark:text-red-300 bg-red-50 border border-red-200 rounded-md px-3 py-2">
                {(statusMutation.error as Error).message}
              </p>
            )}
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                onClick={() => { setConfirmDeactivate(null); statusMutation.reset(); }}
                className="flex-1 rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={statusMutation.isPending}
                onClick={() => statusMutation.mutate({ id: confirmDeactivate.id, active: false })}
                className="flex-1 rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {statusMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Inativar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal confirmar exclusão (exige senha do operador) */}
      {confirmDeleteId && (
        <PasswordConfirmDialog
          title="Excluir cliente?"
          description="Todos os sites, dispositivos, gateways e usuários deste cliente serão excluídos permanentemente."
          isPending={deleteMutation.isPending}
          error={deleteMutation.error ? (deleteMutation.error as Error).message : null}
          onCancel={() => {
            setConfirmDeleteId(null);
            deleteMutation.reset();
          }}
          onConfirm={(token) => deleteMutation.mutate({ id: confirmDeleteId, token })}
        />
      )}
    </div>
  );
}
