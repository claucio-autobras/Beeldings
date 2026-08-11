'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FolderKanban, Loader2, Plus } from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useSiteFilter } from '@/hooks/useSiteFilter';
import { useTenantFilter } from '@/hooks/useTenantFilter';
import { getTenants, type TenantItem } from '@/modules/tenants/services/tenants.service';
import { getSites, type SiteItem } from '@/modules/sites/services/sites.service';
import { getScadaProjects, getScreens, removeScadaProject, type ScadaProject } from '../services/scada.service';
import type { ScadaScreen } from '../types/scada.types';
import { ProjectCard, type ScadaProjectCardData } from '../components/ProjectCard';
import { AddProjectModal } from '../components/AddProjectModal';
import { RemoveProjectDialog } from '../components/RemoveProjectDialog';

const CAN_EDIT_ROLES = new Set(['ADMIN', 'CCO', 'SUPERVISOR']);
const GLOBAL_ROLES = new Set(['ADMIN', 'CCO', 'SUPERVISOR']);

export default function ScadaListPage() {
  const user = useCurrentUser();
  const router = useRouter();
  const qc = useQueryClient();
  const canEdit = CAN_EDIT_ROLES.has(user.role);
  const isGlobal = GLOBAL_ROLES.has(user.role);
  const { selectedTenantId } = useTenantFilter();
  // Globais: respeitam o cliente selecionado no topbar (null = todos). Demais: travados no próprio tenant.
  const tenantScope = isGlobal ? (selectedTenantId ?? undefined) : (user.tenantId ?? undefined);
  const { selectedSiteId } = useSiteFilter();

  const [showAdd, setShowAdd] = useState(false);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);

  const removeMutation = useMutation({
    mutationFn: ({ id, token }: { id: string; token: string }) => removeScadaProject(id, token),
    onSuccess: () => {
      setRemoving(null);
      qc.invalidateQueries({ queryKey: ['scada-projects'] });
    },
  });

  // Apenas os projetos adicionados ao SCADA viram card.
  const { data: scadaProjects = [], isLoading, isError, error } = useQuery<ScadaProject[]>({
    queryKey: ['scada-projects', tenantScope ?? 'all'],
    queryFn: () => getScadaProjects(tenantScope),
  });
  const { data: sites = [] } = useQuery<SiteItem[]>({
    queryKey: ['sites', 'all', tenantScope ?? 'all'],
    queryFn: () => getSites(tenantScope),
  });
  const { data: tenants = [] } = useQuery<TenantItem[]>({
    queryKey: ['tenants'],
    queryFn: getTenants,
    enabled: isGlobal,
  });
  // Telas (no mesmo escopo de cliente) só para contar quantas cada projeto possui.
  const { data: screens = [] } = useQuery<ScadaScreen[]>({
    queryKey: ['scada-screens', tenantScope ?? 'all'],
    queryFn: () => getScreens({ tenantId: tenantScope }),
  });

  const cards = useMemo<ScadaProjectCardData[]>(() => {
    const siteMap = new Map(sites.map((s) => [s.id, s.name]));
    const tenantMap = new Map(tenants.map((t) => [t.id, t.name]));
    const countByProject = screens.reduce<Record<string, number>>((acc, s) => {
      if (s.projectId) acc[s.projectId] = (acc[s.projectId] ?? 0) + 1;
      return acc;
    }, {});
    return scadaProjects
      .filter((p) => !selectedSiteId || p.siteId === selectedSiteId)
      .map((p) => ({
        projectId: p.id,
        projectName: p.name,
        siteName: siteMap.get(p.siteId),
        tenantName: tenantMap.get(p.tenantId),
        screenCount: countByProject[p.id] ?? 0,
      }));
  }, [scadaProjects, sites, tenants, screens, selectedSiteId]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Telas Graficas</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {scadaProjects.length} {scadaProjects.length === 1 ? 'projeto' : 'projetos'} — selecione um projeto para ver e criar telas
          </p>
        </div>
        {canEdit && (
          <button type="button" onClick={() => setShowAdd(true)} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors">
            <Plus className="h-4 w-4" strokeWidth={1.5} />
            Adicionar Projeto
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
          Carregando projetos…
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-red-200 bg-red-50 py-16">
          <p className="text-sm font-medium text-red-700">Erro ao carregar projetos</p>
          <p className="mt-1 text-xs text-red-600">{(error as Error)?.message}</p>
        </div>
      ) : scadaProjects.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card py-20">
          <FolderKanban className="h-10 w-10 text-muted-foreground" strokeWidth={1} />
          <p className="mt-3 text-sm font-medium text-foreground">Nenhuma projeto de interface</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {canEdit ? 'Clique em "Adicionar Projeto" para começar' : 'Aguarde o integrador configurar os projetos'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {cards.map((c) => (
            <ProjectCard
              key={c.projectId}
              project={c}
              canEdit={canEdit}
              onDelete={() => setRemoving({ id: c.projectId, name: c.projectName })}
            />
          ))}
        </div>
      )}

      {showAdd && (
        <AddProjectModal
          isGlobal={isGlobal}
          fixedTenantId={isGlobal ? null : (user.tenantId ?? null)}
          alreadyAddedIds={scadaProjects.map((p) => p.id)}
          onClose={() => setShowAdd(false)}
          onAdded={(proj) => {
            qc.invalidateQueries({ queryKey: ['scada-projects'] });
            router.push(`/scada/project/${proj.id}`);
          }}
        />
      )}

      {removing && (
        <RemoveProjectDialog
          projectName={removing.name}
          isPending={removeMutation.isPending}
          error={removeMutation.error ? (removeMutation.error as Error).message : null}
          onCancel={() => {
            setRemoving(null);
            removeMutation.reset();
          }}
          onConfirm={(token) => removeMutation.mutate({ id: removing.id, token })}
        />
      )}
    </div>
  );
}



