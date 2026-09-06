'use client';

import { useState, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, Building2, ChevronRight, FolderKanban, Info, Loader2, Network, Pencil, Plus, Trash2, X,
} from 'lucide-react';
import { apiGet, apiPost, apiDelete, apiPatch, sensitiveActionHeaders } from '@/lib/api-client';
import PasswordConfirmDialog from '@/components/PasswordConfirmDialog';

// ─── Types ──────────────────────────────────────────────────────────────────

interface TenantItem { id: string; name: string; slug: string; active?: boolean; }
interface SiteItem {
  id: string;
  name: string;
  tenantId: string;
  location?: string | null;
  responsibleName?: string | null;
  createdAt: string;
  _count?: { projects: number };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── New Site Modal ───────────────────────────────────────────────────────────

interface NewSiteModalProps {
  tenantId: string;
  onClose: () => void;
  onCreated: () => void;
}

function NewSiteModal({ tenantId, onClose, onCreated }: NewSiteModalProps) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [responsibleName, setResponsibleName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (dto: { name: string; tenantId: string; location?: string; responsibleName?: string }) =>
      apiPost<SiteItem>('/sites', dto),
    onSuccess: () => { onCreated(); onClose(); },
    onError: (err: Error) => setError(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError('Nome é obrigatório'); return; }
    if (!tenantId) { setError('Selecione um cliente antes de criar um site'); return; }
    mutation.mutate({
      name: name.trim(),
      tenantId,
      location: location.trim() || undefined,
      responsibleName: responsibleName.trim() || undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md bg-card rounded-xl border border-border shadow-xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-base font-semibold text-foreground">Novo Site</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 flex-1 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Nome do site</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Site Morumbi"
              className="w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Uma localidade física do cliente. Os gateways (BMS, CFTV, Energia...) são cadastrados dentro dela.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Endereço (opcional)</label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Rua das Flores, 100 — São Paulo/SP"
              className="w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Contato técnico (opcional)</label>
            <input
              type="text"
              value={responsibleName}
              onChange={(e) => setResponsibleName(e.target.value)}
              placeholder="João Silva — (11) 99999-9999"
              className="w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
            />
          </div>
          {error && <p className="text-sm text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-md px-3 py-2">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors">Cancelar</button>
            <button type="submit" disabled={mutation.isPending} className="flex-1 rounded-md bg-cyan-700 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
              {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Criar Site
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Edit Site Modal ──────────────────────────────────────────────────────────

interface EditSiteModalProps {
  site: SiteItem;
  onClose: () => void;
  onSaved: () => void;
}

function EditSiteModal({ site, onClose, onSaved }: EditSiteModalProps) {
  const [name, setName] = useState(site.name);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (dto: { name: string }) =>
      apiPatch<SiteItem>(`/sites/${site.id}`, dto),
    onSuccess: () => { onSaved(); onClose(); },
    onError: (err: Error) => setError(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) { setError('Nome é obrigatório'); return; }
    if (trimmed === site.name) { onClose(); return; }
    mutation.mutate({ name: trimmed });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md bg-card rounded-xl border border-border shadow-xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-base font-semibold text-foreground">Renomear Site</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 flex-1 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">Nome do site</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Mooca – Torre A"
              className="w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              autoFocus
            />
          </div>

          {/* Aviso sobre IDs dos gateways */}
          <div className="flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-3 dark:border-amber-800 dark:bg-amber-950/40">
            <Info className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <p className="text-[12px] leading-relaxed text-amber-800 dark:text-amber-300">
              Os gateways já cadastrados neste site mantêm o ID gerado com o nome anterior
              (ex.: <code className="font-mono bg-amber-100 dark:bg-amber-900/60 px-1 rounded">gw-{toSlug(site.name)}-…</code>).
              A operação em campo não é afetada — apenas o slug no ID ficará defasado.
            </p>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-md px-3 py-2">{error}</p>}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={mutation.isPending}
              className="flex-1 rounded-md bg-cyan-700 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
            >
              {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Salvar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Gera um slug legível do nome para exibir no aviso (não precisa ser idêntico ao backend). */
function toSlug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 20);
}

// ─── Page ──────────────────────────────────────────────────────────────────────

function SitesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const tenantId = searchParams.get('tenantId');
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [editingSite, setEditingSite] = useState<SiteItem | null>(null);

  const { data: sites = [], isLoading, error } = useQuery<SiteItem[]>({
    queryKey: ['sites', tenantId ?? null],
    queryFn: () => apiGet(`/sites${tenantId ? `?tenantId=${tenantId}` : ''}`),
  });

  const { data: tenants = [] } = useQuery<TenantItem[]>({
    queryKey: ['tenants'],
    queryFn: () => apiGet('/tenants'),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, token }: { id: string; token: string }) =>
      apiDelete(`/sites/${id}`, { headers: sensitiveActionHeaders(token) }),
    onSuccess: () => {
      setConfirmDeleteId(null);
      void qc.invalidateQueries({ queryKey: ['sites'] });
    },
  });

  const currentTenant = tenantId ? tenants.find((t) => t.id === tenantId) : undefined;
  const tenantName = tenantId ? (currentTenant?.name ?? 'Cliente') : null;
  const tenantInactive = currentTenant?.active === false;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {/* Voltar */}
      <button
        onClick={() => router.push('/admin/clients')}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar para Clientes
      </button>

      {/* Header */}
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10">
            <Network className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-foreground flex items-center gap-2 flex-wrap">
              Sites {tenantName ? `— ${tenantName}` : ''}
              {tenantInactive && (
                <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  Inativo
                </span>
              )}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Localidades físicas do cliente. Clique em um site para ver seus gateways.
            </p>
          </div>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          disabled={!tenantId}
          title={!tenantId ? 'Acesse a partir de um cliente para criar sites' : undefined}
          className="inline-flex shrink-0 items-center gap-2 self-start rounded-lg bg-cyan-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-cyan-700 disabled:opacity-50 sm:self-auto"
        >
          <Plus className="h-4 w-4" />
          Novo Site
        </button>
      </header>

      {!tenantId && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          Selecione um cliente em <button onClick={() => router.push('/admin/clients')} className="font-medium underline">Clientes</button> e clique em "Ver Sites" para gerenciar os sites daquele cliente.
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-lg bg-muted/40 animate-pulse" />)}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300">
          Erro ao carregar sites: {(error as Error).message}
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && sites.length === 0 && tenantId && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border bg-card px-6 py-16 text-center shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-500/10">
            <Network className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-foreground">Nenhum site cadastrado</h3>
            <p className="mx-auto max-w-sm text-xs text-muted-foreground">
              Crie o primeiro site (localidade física) deste cliente para começar.
            </p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-dashed border-cyan-400 px-4 py-2 text-sm font-medium text-cyan-600 transition-colors hover:bg-cyan-50 dark:text-cyan-400 dark:hover:bg-cyan-950/40"
          >
            <Plus className="h-4 w-4" />
            Criar Primeiro Site
          </button>
        </div>
      )}

      {/* List */}
      {!isLoading && !error && sites.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow duration-200 hover:shadow-md">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Site</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Contato técnico</th>
                <th className="text-center px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hidden sm:table-cell">Gateways</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Criado em</th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sites.map((site) => (
                <tr
                  key={site.id}
                  className="transition-colors duration-150 hover:bg-muted/30 cursor-pointer"
                  onClick={() => router.push(`/admin/projects?siteId=${site.id}&tenantId=${site.tenantId}`)}
                >
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0 bg-cyan-500/10">
                        <Building2 className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
                      </div>
                      <div className="min-w-0">
                        <span className="font-medium text-foreground block">{site.name}</span>
                        {site.location && (
                          <span className="text-[11px] text-muted-foreground block truncate">{site.location}</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 hidden lg:table-cell text-muted-foreground">
                    {site.responsibleName || '—'}
                  </td>
                  <td className="px-4 py-3.5 text-center hidden sm:table-cell">
                    <span className="inline-flex items-center gap-1.5 text-foreground">
                      <FolderKanban className="h-3.5 w-3.5 text-muted-foreground/70" />
                      {site._count?.projects ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 hidden md:table-cell text-muted-foreground">
                    {formatDate(site.createdAt)}
                  </td>
                  <td className="px-4 py-3.5 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => router.push(`/admin/projects?siteId=${site.id}&tenantId=${site.tenantId}`)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-cyan-700 hover:text-cyan-900 dark:text-cyan-400 dark:hover:text-cyan-300 hover:underline transition-colors"
                      >
                        Ver Gateways
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setEditingSite(site)}
                        title="Renomear site"
                        className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-cyan-600 hover:bg-cyan-50 dark:hover:bg-cyan-950/40 transition-colors"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(site.id)}
                        title="Excluir site"
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
          <div className="border-t border-border bg-muted/20 px-5 py-2.5 text-xs text-muted-foreground">
            {sites.length} site{sites.length !== 1 ? 's' : ''} cadastrado{sites.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {modalOpen && tenantId && (
        <NewSiteModal
          tenantId={tenantId}
          onClose={() => setModalOpen(false)}
          onCreated={() => void qc.invalidateQueries({ queryKey: ['sites'] })}
        />
      )}

      {editingSite && (
        <EditSiteModal
          site={editingSite}
          onClose={() => setEditingSite(null)}
          onSaved={() => void qc.invalidateQueries({ queryKey: ['sites'] })}
        />
      )}

      {confirmDeleteId && (
        <PasswordConfirmDialog
          title="Excluir site?"
          description="Todos os gateways e dispositivos deste site serão excluídos permanentemente."
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

export default function SitesPage() {
  return (
    <Suspense>
      <SitesContent />
    </Suspense>
  );
}
