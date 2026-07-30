'use client';

import { useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import { getTenants, type TenantItem } from '@/modules/tenants/services/tenants.service';
import { getSites, type SiteItem } from '@/modules/sites/services/sites.service';
import { getProjects, type ProjectItem } from '@/modules/projects/services/projects.service';
import { addScadaProject, type ScadaProject } from '../services/scada.service';

interface AddProjectModalProps {
  isGlobal: boolean;
  fixedTenantId: string | null;
  /** IDs já presentes no SCADA — filtrados do select para não duplicar. */
  alreadyAddedIds: string[];
  onClose: () => void;
  onAdded: (project: ScadaProject) => void;
}

/**
 * Adiciona um projeto EXISTENTE ao SCADA. O projeto é quem carrega o gateway e,
 * por tabela, o acesso às controladoras do cliente — por isso é selecionado, não criado.
 */
export function AddProjectModal({ isGlobal, fixedTenantId, alreadyAddedIds, onClose, onAdded }: AddProjectModalProps) {
  const [tenantId, setTenantId] = useState(fixedTenantId ?? '');
  const [siteId, setSiteId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: tenants = [] } = useQuery<TenantItem[]>({
    queryKey: ['tenants'],
    queryFn: getTenants,
    enabled: isGlobal,
  });
  const { data: sites = [], isLoading: loadingSites } = useQuery<SiteItem[]>({
    queryKey: ['sites', tenantId],
    queryFn: () => getSites(tenantId),
    enabled: Boolean(tenantId),
  });
  const { data: projects = [], isLoading: loadingProjects } = useQuery<ProjectItem[]>({
    queryKey: ['projects', siteId, tenantId],
    queryFn: () => getProjects(siteId, tenantId),
    enabled: Boolean(siteId),
  });

  const addedSet = useMemo(() => new Set(alreadyAddedIds), [alreadyAddedIds]);
  const selectableProjects = projects.filter((p) => !addedSet.has(p.id));

  const mutation = useMutation({
    mutationFn: () => addScadaProject(projectId),
    onSuccess: (proj) => { onAdded(proj); onClose(); },
    onError: (err: Error) => setError(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!tenantId) { setError('Selecione o cliente'); return; }
    if (!siteId) { setError('Selecione o site'); return; }
    if (!projectId) { setError('Selecione o projeto'); return; }
    mutation.mutate();
  }

  const selectCls =
    'w-full rounded-lg border border-border px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-50 disabled:bg-muted';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">Adicionar Projeto</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-6 py-5">
          {/* Cliente */}
          {isGlobal && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Cliente *</span>
              <select
                value={tenantId}
                onChange={(e) => { setTenantId(e.target.value); setSiteId(''); setProjectId(''); }}
                className={selectCls}
              >
                <option value="">— selecionar —</option>
                {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
          )}

          {/* Site */}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Site *</span>
            <select
              value={siteId}
              onChange={(e) => { setSiteId(e.target.value); setProjectId(''); }}
              disabled={!tenantId || loadingSites}
              className={selectCls}
            >
              <option value="">{loadingSites ? 'Carregando…' : '— selecionar —'}</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>

          {/* Projeto (existente — é quem tem o gateway/controladoras) */}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Projeto *</span>
            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={!siteId || loadingProjects}
              className={selectCls}
            >
              <option value="">{loadingProjects ? 'Carregando…' : '— selecionar —'}</option>
              {selectableProjects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            {siteId && !loadingProjects && projects.length === 0 && (
              <span className="text-[11px] text-amber-600">Este site não tem projetos. Crie um projeto no onboarding antes.</span>
            )}
            {siteId && !loadingProjects && projects.length > 0 && selectableProjects.length === 0 && (
              <span className="text-[11px] text-muted-foreground">Todos os projetos deste site já estão no SCADA.</span>
            )}
            <span className="text-[11px] text-muted-foreground">
              O projeto carrega o gateway e o acesso às controladoras do cliente.
            </span>
          </label>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">Cancelar</button>
            <button type="submit" disabled={mutation.isPending} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-40 transition-colors">
              {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Adicionar
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
