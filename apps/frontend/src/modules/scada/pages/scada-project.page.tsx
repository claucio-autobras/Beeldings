'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, FlaskConical, Loader2, Monitor, Plus } from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { getProject, type ProjectItem } from '@/modules/projects/services/projects.service';
import { getSites, type SiteItem } from '@/modules/sites/services/sites.service';
import { getTenants, type TenantItem } from '@/modules/tenants/services/tenants.service';
import { getScreens, setScreenHome, deleteScreen } from '../services/scada.service';
import type { ScadaScreen } from '../types/scada.types';
import { ScreenCard } from '../components/ScreenCard';
import { SimulatorBench } from '../components/SimulatorBench';
import { CreateScreenModal } from '../components/CreateScreenModal';
import { RenameScreenModal } from '../components/RenameScreenModal';
import { DeleteScreenDialog } from '../components/DeleteScreenDialog';

const CAN_EDIT_ROLES = new Set(['ADMIN', 'CCO', 'SUPERVISOR']);
const GLOBAL_ROLES = new Set(['ADMIN', 'CCO', 'SUPERVISOR']);

export default function ScadaProjectPage({ projectId }: { projectId: string }) {
  const user = useCurrentUser();
  const canEdit = CAN_EDIT_ROLES.has(user.role);
  const isGlobal = GLOBAL_ROLES.has(user.role);
  const qc = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const [showBench, setShowBench] = useState(false);

  const homeMutation = useMutation({
    mutationFn: (id: string) => setScreenHome(id),
    onSuccess: () => refreshScreens(),
  });
  const deleteMutation = useMutation({
    mutationFn: ({ id, token }: { id: string; token: string }) => deleteScreen(id, token),
    onSuccess: () => { setDeleting(null); refreshScreens(); },
  });

  const { data: project, isLoading: loadingProject, isError, error } = useQuery<ProjectItem>({
    queryKey: ['project', projectId],
    queryFn: () => getProject(projectId),
  });
  const { data: sites = [] } = useQuery<SiteItem[]>({
    queryKey: ['sites', 'all', user.tenantId],
    queryFn: () => getSites(isGlobal ? undefined : (user.tenantId ?? undefined)),
  });
  const { data: tenants = [] } = useQuery<TenantItem[]>({
    queryKey: ['tenants'],
    queryFn: getTenants,
    enabled: isGlobal,
  });
  const { data: screens = [], isLoading: loadingScreens } = useQuery<ScadaScreen[]>({
    queryKey: ['scada-screens', 'project', projectId],
    queryFn: () => getScreens({ projectId }),
  });

  const siteName = project ? sites.find((s) => s.id === project.siteId)?.name : undefined;
  const tenantName = project ? tenants.find((t) => t.id === project.tenantId)?.name : undefined;
  const scope = [tenantName, siteName].filter(Boolean).join(' · ');

  function refreshScreens() {
    qc.invalidateQueries({ queryKey: ['scada-screens', 'project', projectId] });
    qc.invalidateQueries({ queryKey: ['scada-screens'] });
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-red-200 bg-red-50 py-16">
        <p className="text-sm font-medium text-red-700">Erro ao carregar projeto</p>
        <p className="mt-1 text-xs text-red-600">{(error as Error)?.message}</p>
        <Link href="/scada" className="mt-3 text-xs font-medium text-primary hover:underline">Voltar para Projetos</Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <Link href="/scada" className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-3.5 w-3.5" strokeWidth={1.5} />
            Projetos
          </Link>
          <h1 className="mt-1 truncate text-2xl font-semibold text-foreground">
            {loadingProject ? 'Carregando…' : (project?.name ?? 'Projeto')}
          </h1>
          {scope && <p className="mt-0.5 text-sm text-muted-foreground">{scope}</p>}
        </div>
        {canEdit && project && (
          <div className="flex shrink-0 items-center gap-2">
            <button type="button" onClick={() => setShowBench(true)} className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-accent transition-colors">
              <FlaskConical className="h-4 w-4" strokeWidth={1.5} />
              Bancada de Testes
            </button>
            <button type="button" onClick={() => setShowModal(true)} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors">
              <Plus className="h-4 w-4" strokeWidth={1.5} />
              Nova Tela
            </button>
          </div>
        )}
      </div>

      {loadingScreens ? (
        <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.5} />
          Carregando telas…
        </div>
      ) : screens.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card py-20">
          <Monitor className="h-10 w-10 text-muted-foreground" strokeWidth={1} />
          <p className="mt-3 text-sm font-medium text-foreground">Nenhuma tela neste Cliente</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {canEdit ? 'Clique em "Nova Tela" para criar a primeira' : 'Aguarde o integrador configurar as telas'}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {screens.map((s) => (
            <ScreenCard
              key={s.id}
              screen={s}
              canEdit={canEdit}
              onRename={() => setRenaming({ id: s.id, name: s.name })}
              onSetHome={() => homeMutation.mutate(s.id)}
              onDelete={() => setDeleting({ id: s.id, name: s.name })}
              settingHome={homeMutation.isPending && homeMutation.variables === s.id}
            />
          ))}
        </div>
      )}

      {showModal && project && (
        <CreateScreenModal
          tenantId={project.tenantId}
          siteId={project.siteId}
          projectId={project.id}
          onClose={() => setShowModal(false)}
          onCreated={refreshScreens}
        />
      )}

      {showBench && project && (
        <SimulatorBench
          projectId={project.id}
          tenantId={project.tenantId}
          onClose={() => setShowBench(false)}
        />
      )}

      {renaming && (
        <RenameScreenModal
          screenId={renaming.id}
          currentName={renaming.name}
          onClose={() => setRenaming(null)}
          onRenamed={refreshScreens}
        />
      )}

      {deleting && (
        <DeleteScreenDialog
          screenName={deleting.name}
          isPending={deleteMutation.isPending}
          error={deleteMutation.error ? (deleteMutation.error as Error).message : null}
          onCancel={() => {
            setDeleting(null);
            deleteMutation.reset();
          }}
          onConfirm={(token) => deleteMutation.mutate({ id: deleting.id, token })}
        />
      )}
    </div>
  );
}
