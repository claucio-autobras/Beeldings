'use client';

import Link from 'next/link';
import { ChevronRight, FolderKanban, Monitor, Trash2 } from 'lucide-react';

export interface ScadaProjectCardData {
  projectId: string;
  projectName: string;
  siteName?: string;
  tenantName?: string;
  screenCount: number;
}

interface ProjectCardProps {
  project: ScadaProjectCardData;
  canEdit?: boolean;
  onDelete?: () => void;
}

/** Card de um Projeto na landing do SCADA — Cliente em evidência, depois Site e Projeto. */
export function ProjectCard({ project, canEdit, onDelete }: ProjectCardProps) {
  const { projectId, projectName, siteName, tenantName, screenCount } = project;

  function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onDelete?.();
  }

  return (
    <Link
      href={`/scada/project/${projectId}`}
      className="group flex flex-col rounded-xl border border-border bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="flex items-start justify-between">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
          <FolderKanban className="h-5 w-5 text-primary" strokeWidth={1.5} />
        </div>
        <div className="flex items-center gap-1">
          {canEdit && onDelete && (
            <button
              type="button"
              onClick={handleDelete}
              title="Excluir telas do projeto"
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          )}
          <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" strokeWidth={1.5} />
        </div>
      </div>

      <div className="mt-4">
        {/* Cliente em evidência */}
        <h3 className="text-base font-semibold text-foreground line-clamp-1">{tenantName ?? '—'}</h3>
        {/* Site */}
        {siteName && <p className="mt-0.5 text-sm text-muted-foreground line-clamp-1">{siteName}</p>}
        {/* Projeto */}
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground line-clamp-1">
          <span className="font-medium uppercase tracking-wide text-[10px] text-muted-foreground/70">Projeto</span>
          <span className="truncate font-medium text-foreground">{projectName}</span>
        </p>
      </div>

      <div className="mt-4 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Monitor className="h-3.5 w-3.5" strokeWidth={1.5} />
        {screenCount} {screenCount === 1 ? 'tela' : 'telas'}
      </div>
    </Link>
  );
}
