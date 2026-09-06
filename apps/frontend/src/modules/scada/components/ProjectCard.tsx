'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, ChevronRight, Edit3, FolderKanban, Monitor, Trash2 } from 'lucide-react';

export interface ScadaProjectCardData {
  projectId: string;
  projectName: string;
  siteName?: string;
  siteLocation?: string | null;
  tenantName?: string;
  screenCount: number;
  coverImageUrl?: string | null;
}

interface ProjectCardProps {
  project: ScadaProjectCardData;
  canEdit?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}

/** Card de um projeto na landing do SCADA — cliente e local em evidência. */
export function ProjectCard({ project, canEdit, onEdit, onDelete }: ProjectCardProps) {
  const { projectId, projectName, siteName, siteLocation, tenantName, screenCount, coverImageUrl } = project;
  const [failedCoverUrl, setFailedCoverUrl] = useState<string | null>(null);
  const imageFailed = Boolean(coverImageUrl && failedCoverUrl === coverImageUrl);
  const clientSiteLabel = [tenantName?.trim(), siteName?.trim()].filter(Boolean).join(' — ') || '—';
  const locationLabel = siteLocation?.trim() || 'Localização não cadastrada';

  function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    onDelete?.();
  }

  return (
    <Link
      href={`/scada/project/${projectId}`}
      aria-label={`Abrir projeto ${projectName}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-gradient-to-br from-primary/20 via-primary/5 to-muted">
        {coverImageUrl && !imageFailed ? (
          <img
            src={coverImageUrl}
            alt={`Capa de ${projectName}`}
            onError={() => setFailedCoverUrl(coverImageUrl)}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-primary/20 via-primary/10 to-muted dark:from-primary/30 dark:via-primary/10 dark:to-muted">
            {coverImageUrl && imageFailed ? (
              <>
                <AlertTriangle className="h-10 w-10 text-amber-600/75" strokeWidth={1.2} />
                <span className="px-4 text-center text-[11px] font-medium text-muted-foreground">
                  Não foi possível carregar a capa
                </span>
              </>
            ) : (
              <FolderKanban className="h-12 w-12 text-primary/60" strokeWidth={1.2} />
            )}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-black/10" />
        <div className="absolute inset-x-0 top-0 flex items-start justify-end gap-1 p-3">
          {canEdit && onEdit && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onEdit();
              }}
              title="Editar capa do projeto"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-black/30 text-white backdrop-blur-sm transition-colors hover:bg-primary"
            >
              <Edit3 className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          )}
          {canEdit && onDelete && (
            <button
              type="button"
              onClick={handleDelete}
              title="Excluir telas do projeto"
              className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-black/30 text-white backdrop-blur-sm transition-colors hover:bg-red-600"
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
            </button>
          )}
          <ChevronRight className="mt-1 h-4 w-4 text-white drop-shadow transition-transform group-hover:translate-x-0.5" strokeWidth={1.5} />
        </div>
      </div>

      <div className="p-5">
        {/* Cliente + Site são a identificação principal do local físico. */}
        <h3 className="text-base font-semibold text-foreground line-clamp-1" title={clientSiteLabel}>
          {clientSiteLabel}
        </h3>
        <p className="mt-0.5 truncate text-sm text-muted-foreground" title={locationLabel}>
          {locationLabel}
        </p>
        <div className="mt-4 flex items-center gap-1.5 border-t border-border/70 pt-3 text-xs text-muted-foreground">
          <Monitor className="h-3.5 w-3.5" strokeWidth={1.5} />
          {screenCount} {screenCount === 1 ? 'tela' : 'telas'}
        </div>
      </div>
    </Link>
  );
}
