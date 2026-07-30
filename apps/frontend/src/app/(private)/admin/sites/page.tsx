'use client';

import { useState, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, Building2, ChevronRight, FolderKanban, Loader2, Network, Plus, Trash2, X,
} from 'lucide-react';
import { apiGet, apiPost, apiDelete, sensitiveActionHeaders } from '@/lib/api-client';
import PasswordConfirmDialog from '@/components/PasswordConfirmDialog';

// ─── Types ──────────────────────────────────────────────────────────────────

interface TenantItem { id: string; name: string; slug: string; active?: boolean; }
interface SiteItem {
  id: string;
  name: string;
  tenantId: string;
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
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (dto: { name: string; tenantId: string }) => apiPost<SiteItem>('/sites', dto),
    onSuccess: () => { onCreated(); onClose(); },
    onError: (err: Error) => setError(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError('Nome é obrigatório'); return; }
    if (!tenantId) { setError('Selecione um cliente antes de criar um site'); return; }
    mutation.mutate({ name: name.trim(), tenantId });
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
              placeholder="Ex: Unidade Morumbi"
              className="w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
              autoFocus
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">
              Uma localidade física do cliente. Os projetos (BMS, CFTV, Energia...) são criados dentro dela.
            </p>
          </div>
          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}
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

// ─── Page ──────────────────────────────────────────────────────────────────────

function SitesContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const tenantId = searchParams.get('tenantId');
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

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
    <div className="space-y-6">
      {/* Voltar */}
      <button
        onClick={() => router.push('/admin/clients')}
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar para Clientes
      </button>

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground flex items-center gap-2 flex-wrap">
            Sites {tenantName ? `— ${tenantName}` : ''}
            {tenantInactive && (
              <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300">
                Inativo
              </span>
            )}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Localidades físicas do cliente. Clique em um site para ver seus projetos.
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          disabled={!tenantId}
          title={!tenantId ? 'Acesse a partir de um cliente para criar sites' : undefined}
          className="flex items-center gap-2 h-9 px-4 text-sm rounded-md font-medium bg-cyan-700 text-white hover:bg-cyan-800 disabled:opacity-50 transition-colors self-start"
        >
          <Plus className="h-4 w-4" />
          Novo Site
        </button>
      </div>

      {!tenantId && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Selecione um cliente em <button onClick={() => router.push('/admin/clients')} className="font-medium underline">Clientes</button> e clique em “Ver Sites” para gerenciar os sites daquele cliente.
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
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Erro ao carregar sites: {(error as Error).message}
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && sites.length === 0 && tenantId && (
        <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-border rounded-xl">
          <Network className="h-14 w-14 text-muted-foreground/25 mb-4" />
          <h3 className="text-base font-medium text-foreground mb-1">Nenhum site cadastrado</h3>
          <p className="text-sm text-muted-foreground mb-5 max-w-sm">
            Crie o primeiro site (localidade física) deste cliente para começar.
          </p>
          <button onClick={() => setModalOpen(true)} className="flex items-center gap-2 h-9 px-4 text-sm rounded-md font-medium bg-cyan-700 text-white hover:bg-cyan-800 transition-colors">
            <Plus className="h-4 w-4" />
            Criar Primeiro Site
          </button>
        </div>
      )}

      {/* List */}
      {!isLoading && !error && sites.length > 0 && (
        <div className="border border-border rounded-xl overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Site</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-muted-foreground hidden sm:table-cell">Projetos</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground hidden md:table-cell">Criado em</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sites.map((site) => (
                <tr
                  key={site.id}
                  className="hover:bg-muted/20 transition-colors cursor-pointer"
                  onClick={() => router.push(`/admin/projects?siteId=${site.id}&tenantId=${site.tenantId}`)}
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <Building2 className="h-4 w-4 text-slate-400 shrink-0" />
                      <span className="font-medium text-foreground">{site.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center hidden sm:table-cell">
                    <span className="inline-flex items-center gap-1.5 text-slate-700">
                      <FolderKanban className="h-3.5 w-3.5 text-slate-400" />
                      {site._count?.projects ?? 0}
                    </span>
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell text-muted-foreground">
                    {formatDate(site.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => router.push(`/admin/projects?siteId=${site.id}&tenantId=${site.tenantId}`)}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-cyan-700 hover:text-cyan-900 hover:underline transition-colors"
                      >
                        Ver Projetos
                        <ChevronRight className="h-3.5 w-3.5" />
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
      )}

      {modalOpen && tenantId && (
        <NewSiteModal
          tenantId={tenantId}
          onClose={() => setModalOpen(false)}
          onCreated={() => void qc.invalidateQueries({ queryKey: ['sites'] })}
        />
      )}

      {confirmDeleteId && (
        <PasswordConfirmDialog
          title="Excluir site?"
          description="Todos os projetos, gateways e dispositivos deste site serão excluídos permanentemente."
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
