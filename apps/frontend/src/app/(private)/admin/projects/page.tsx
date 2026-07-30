'use client';

import { useState, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft, Check, Cpu, Download, FolderKanban, Loader2, Plus, Router, Trash2, X,
} from 'lucide-react';
import { apiGet, apiPost, apiDelete, sensitiveActionHeaders } from '@/lib/api-client';
import PasswordConfirmDialog from '@/components/PasswordConfirmDialog';
import { getGatewayConfigText } from '@/modules/projects/services/projects.service';

// ─── Types ──────────────────────────────────────────────────────────────────

interface SiteItem { id: string; name: string; tenantId: string; }
interface GatewayInfo { id: string; status: string; mqttUser?: string; mqttPass?: string; lastSeen?: string | null; _count?: { devices: number }; }
interface ProjectItem {
  id: string;
  name: string;
  address?: string | null;
  technicalContact?: string | null;
  siteId: string;
  tenantId: string;
  createdAt: string;
  gateway?: GatewayInfo | null;
}
type ProjectWithGateway = ProjectItem & { gateway: GatewayInfo };

function formatRelative(iso?: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

async function downloadGatewayConfig(projectId: string) {
  const text = await getGatewayConfigText(projectId);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  a.download = 'gateway-config.env';
  a.click();
}

// ─── New Project Modal ──────────────────────────────────────────────────────

interface GatewayOption { id: string; status?: string; siteNames: string[] }

/**
 * Gateways distintos usados por qualquer projeto do CLIENTE (todos os sites).
 * Um gateway físico pode atender sites diferentes (ex.: torres com rack central),
 * então a lista para vincular abrange o tenant inteiro, não só o site atual.
 */
function dedupeGateways(
  projects: ProjectItem[],
  siteNameById: Map<string, string>,
): GatewayOption[] {
  const map = new Map<string, GatewayOption>();
  for (const p of projects) {
    if (!p.gateway?.id) continue;
    const siteName = siteNameById.get(p.siteId) ?? p.siteId;
    const existing = map.get(p.gateway.id);
    if (existing) {
      if (!existing.siteNames.includes(siteName)) existing.siteNames.push(siteName);
    } else {
      map.set(p.gateway.id, { id: p.gateway.id, status: p.gateway.status, siteNames: [siteName] });
    }
  }
  return Array.from(map.values());
}

type GatewayMode = 'new' | 'existing';

interface NewProjectModalProps {
  siteId: string;
  tenantId: string;
  existingGateways: GatewayOption[];
  onClose: () => void;
  onCreated: () => void;
}

function NewProjectModal({ siteId, tenantId, existingGateways, onClose, onCreated }: NewProjectModalProps) {
  const hasExisting = existingGateways.length > 0;
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [technicalContact, setTechnicalContact] = useState('');
  const [gatewayMode, setGatewayMode] = useState<GatewayMode>('new');
  const [selectedGatewayId, setSelectedGatewayId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ProjectWithGateway | null>(null);

  const mutation = useMutation({
    mutationFn: (dto: { name: string; address?: string; technicalContact?: string; siteId: string; tenantId: string; gatewayId?: string }) =>
      apiPost<ProjectWithGateway>('/projects', dto),
    onSuccess: (proj) => { setCreated(proj); onCreated(); },
    onError: (err: Error) => setError(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError('Nome é obrigatório'); return; }

    const linkExisting = hasExisting && gatewayMode === 'existing';
    if (linkExisting && !selectedGatewayId) {
      setError('Selecione um gateway para vincular'); return;
    }

    mutation.mutate({
      name: name.trim(),
      address: address.trim() || undefined,
      technicalContact: technicalContact.trim() || undefined,
      siteId,
      tenantId,
      gatewayId: linkExisting ? selectedGatewayId : undefined,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md bg-card rounded-xl border border-border shadow-xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
          <h2 className="text-base font-semibold text-foreground">
            {created ? 'Projeto criado' : 'Novo Projeto'}
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>

        {!created ? (
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4 flex-1 overflow-y-auto">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Nome do projeto</label>
              <input
                type="text" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Ex: BMS Principal"
                className="w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Endereço (opcional)</label>
              <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Rua das Flores, 100" className="w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">Contato técnico (opcional)</label>
              <input type="text" value={technicalContact} onChange={(e) => setTechnicalContact(e.target.value)} placeholder="João Silva — (11) 99999-9999" className="w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500" />
            </div>

            {/* Gateway: criar novo ou vincular a um existente do mesmo cliente */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Gateway</label>
              {hasExisting ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setGatewayMode('new')}
                      className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${gatewayMode === 'new' ? 'border-cyan-600 bg-cyan-50 text-cyan-700' : 'border-border text-muted-foreground hover:bg-muted/50'}`}
                    >
                      Criar novo gateway
                    </button>
                    <button
                      type="button"
                      onClick={() => setGatewayMode('existing')}
                      className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${gatewayMode === 'existing' ? 'border-cyan-600 bg-cyan-50 text-cyan-700' : 'border-border text-muted-foreground hover:bg-muted/50'}`}
                    >
                      Vincular a existente
                    </button>
                  </div>
                  {gatewayMode === 'existing' ? (
                    <select
                      value={selectedGatewayId}
                      onChange={(e) => setSelectedGatewayId(e.target.value)}
                      className="mt-2 w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 cursor-pointer"
                    >
                      <option value="">Selecione um gateway do cliente...</option>
                      {existingGateways.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.id}{g.siteNames.length > 0 ? ` — ${g.siteNames.join(', ')}` : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <p className="text-[11px] text-muted-foreground mt-1.5">
                      Um gateway com credenciais MQTT exclusivas será gerado para este projeto.
                    </p>
                  )}
                  {gatewayMode === 'existing' && (
                    <p className="text-[11px] text-muted-foreground mt-1.5">
                      Útil quando vários sites (ex.: torres) enviam os equipamentos a um
                      único gateway central. Este site terá suas próprias controladoras e telas.
                    </p>
                  )}
                </>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  Um gateway com credenciais MQTT exclusivas será gerado automaticamente para este projeto.
                </p>
              )}
            </div>

            {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>}
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={onClose} className="flex-1 rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors">Cancelar</button>
              <button type="submit" disabled={mutation.isPending} className="flex-1 rounded-md bg-cyan-700 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2">
                {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Criar Projeto
              </button>
            </div>
          </form>
        ) : (
          <div className="px-6 py-5 space-y-4 flex-1 overflow-y-auto">
            <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
              <Check className="h-5 w-5 text-green-600 shrink-0" />
              <p className="text-sm text-green-800 font-medium">
                {gatewayMode === 'existing' && hasExisting
                  ? 'Projeto criado e vinculado ao gateway existente!'
                  : 'Projeto e gateway criados com sucesso!'}
              </p>
            </div>
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="bg-muted/30 px-4 py-2 border-b border-border">
                <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
                  {gatewayMode === 'existing' && hasExisting ? 'Gateway vinculado' : 'Credenciais do Gateway'}
                </p>
              </div>
              <div className="px-4 py-3 space-y-2">
                {[
                  ['Gateway ID', created.gateway.id],
                  ['MQTT User', created.gateway.mqttUser ?? '—'],
                  ['MQTT Pass', created.gateway.mqttPass ?? '—'],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-24 shrink-0">{label}</span>
                    <code className="text-xs font-mono text-foreground bg-muted/40 px-2 py-0.5 rounded flex-1 truncate">{value}</code>
                  </div>
                ))}
              </div>
            </div>
            <button onClick={() => void downloadGatewayConfig(created.id)} className="w-full flex items-center justify-center gap-2 h-9 text-sm font-medium rounded-md bg-cyan-700 text-white hover:bg-cyan-800 transition-colors">
              <Download className="h-4 w-4" />
              Baixar gateway-config.env
            </button>
            <button onClick={onClose} className="w-full h-9 text-sm rounded-md border border-border text-foreground hover:bg-muted/50 transition-colors">
              Concluir
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

function ProjectsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const qc = useQueryClient();
  const siteId = searchParams.get('siteId');
  const tenantId = searchParams.get('tenantId');
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const { data: projects = [], isLoading, error } = useQuery<ProjectItem[]>({
    queryKey: ['projects', siteId ?? null, tenantId ?? null],
    queryFn: () => {
      const params = new URLSearchParams();
      if (siteId) params.set('siteId', siteId);
      if (tenantId) params.set('tenantId', tenantId);
      return apiGet(`/projects?${params.toString()}`);
    },
    enabled: !!siteId,
  });

  const { data: site } = useQuery<SiteItem>({
    queryKey: ['site', siteId],
    queryFn: () => apiGet(`/sites/${siteId}`),
    enabled: !!siteId,
  });

  // Pool de gateways do CLIENTE inteiro (todos os sites) — um gateway físico
  // pode ser compartilhado entre sites (ex.: torres com rack central).
  const { data: tenantProjects = [] } = useQuery<ProjectItem[]>({
    queryKey: ['projects', 'tenant', tenantId ?? null],
    queryFn: () => apiGet(`/projects?tenantId=${tenantId}`),
    enabled: !!tenantId,
  });

  const { data: tenantSites = [] } = useQuery<SiteItem[]>({
    queryKey: ['sites', tenantId ?? null],
    queryFn: () => apiGet(`/sites?tenantId=${tenantId}`),
    enabled: !!tenantId,
  });

  const siteNameById = new Map(tenantSites.map((s) => [s.id, s.name]));
  const existingGateways = dedupeGateways(tenantProjects, siteNameById);

  const deleteMutation = useMutation({
    mutationFn: ({ id, token }: { id: string; token: string }) =>
      apiDelete(`/projects/${id}`, { headers: sensitiveActionHeaders(token) }),
    onSuccess: () => {
      setConfirmDeleteId(null);
      void qc.invalidateQueries({ queryKey: ['projects'] });
    },
  });

  if (!siteId) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        Nenhum site selecionado. Acesse esta tela a partir de um site em{' '}
        <button onClick={() => router.push('/admin/clients')} className="font-medium underline">Clientes → Sites</button>.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb / back */}
      <button
        onClick={() => router.push(`/admin/sites${tenantId ? `?tenantId=${tenantId}` : ''}`)}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar para Sites
      </button>

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            Projetos {site ? `— ${site.name}` : ''}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Sistemas implantados no site (BMS, CFTV, Energia...)
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 h-9 px-4 text-sm rounded-md font-medium bg-cyan-700 text-white hover:bg-cyan-800 transition-colors self-start"
        >
          <Plus className="h-4 w-4" />
          Novo Projeto
        </button>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-lg bg-muted/40 animate-pulse" />)}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Erro ao carregar projetos: {(error as Error).message}
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && projects.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-border rounded-xl">
          <FolderKanban className="h-14 w-14 text-muted-foreground/25 mb-4" />
          <h3 className="text-base font-medium text-foreground mb-1">Nenhum projeto cadastrado</h3>
          <p className="text-sm text-muted-foreground mb-5 max-w-sm">
            Crie o primeiro projeto deste site. Um gateway será gerado automaticamente.
          </p>
          <button onClick={() => setModalOpen(true)} className="flex items-center gap-2 h-9 px-4 text-sm rounded-md font-medium bg-cyan-700 text-white hover:bg-cyan-800 transition-colors">
            <Plus className="h-4 w-4" />
            Criar Primeiro Projeto
          </button>
        </div>
      )}

      {/* List */}
      {!isLoading && !error && projects.length > 0 && (
        <div className="border border-border rounded-xl overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground">Projeto</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-muted-foreground hidden sm:table-cell">Gateway</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-muted-foreground">Dispositivos</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-muted-foreground">Status</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-muted-foreground">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {projects.map((p) => {
                const gw = p.gateway;
                const online = gw?.status === 'online';
                return (
                  <tr
                    key={p.id}
                    className="hover:bg-muted/20 transition-colors cursor-pointer"
                    onClick={() => router.push(`/admin/projects/${p.id}`)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <FolderKanban className="h-4 w-4 text-slate-400 shrink-0" />
                        <div>
                          <span className="font-medium text-foreground block">{p.name}</span>
                          {p.address && <span className="text-[11px] text-muted-foreground">{p.address}</span>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      {gw ? (
                        <span className="font-mono text-xs bg-muted/40 text-foreground px-2 py-0.5 rounded">{gw.id}</span>
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center justify-center gap-1.5 text-xs text-foreground">
                        <Cpu className="h-3.5 w-3.5 text-slate-400" />
                        {gw?._count?.devices ?? 0}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {gw ? (
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${online ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-slate-100 text-slate-500 border border-slate-200'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-green-500' : 'bg-slate-400'}`} />
                          {online ? 'Online' : 'Offline'}
                        </span>
                      ) : <span className="text-xs text-muted-foreground">Sem gateway</span>}
                    </td>
                    <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => void downloadGatewayConfig(p.id)}
                          title="Baixar gateway-config.env"
                          className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-cyan-700 hover:bg-cyan-50 transition-colors"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => router.push(`/admin/projects/${p.id}`)}
                          title="Ver gateway"
                          className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-cyan-700 hover:bg-cyan-50 transition-colors"
                        >
                          <Router className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(p.id)}
                          title="Excluir projeto"
                          className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-50 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && tenantId && (
        <NewProjectModal
          siteId={siteId}
          tenantId={tenantId}
          existingGateways={existingGateways}
          onClose={() => setModalOpen(false)}
          onCreated={() => void qc.invalidateQueries({ queryKey: ['projects'] })}
        />
      )}

      {confirmDeleteId && (
        <PasswordConfirmDialog
          title="Excluir projeto?"
          description="O gateway e todos os dispositivos deste projeto serão excluídos permanentemente."
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

export default function ProjectsPage() {
  return (
    <Suspense>
      <ProjectsContent />
    </Suspense>
  );
}
