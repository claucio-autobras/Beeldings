'use client';

import Link from 'next/link';
import { Edit2, Eye, Home, Loader2, Monitor, Pencil, Settings2, Trash2 } from 'lucide-react';
import type { ScadaScreen, ScadaScreenStatus } from '../types/scada.types';

const STATUS_CFG: Record<ScadaScreenStatus, { label: string; cls: string }> = {
  active:      { label: 'Ativa',      cls: 'bg-green-50 text-green-700 border border-green-200' },
  maintenance: { label: 'Manutenção', cls: 'bg-amber-50 text-amber-800 border border-amber-200' },
};

/** Card de uma tela SCADA — usado na visão de um projeto. */
export function ScreenCard({
  screen,
  canEdit,
  scopeLabel,
  onRename,
  onSetHome,
  onDelete,
  settingHome,
}: {
  screen: ScadaScreen;
  canEdit: boolean;
  scopeLabel?: string;
  onRename?: () => void;
  onSetHome?: () => void;
  onDelete?: () => void;
  settingHome?: boolean;
}) {
  const s = STATUS_CFG[screen.status] ?? STATUS_CFG.active;
  const updatedAt = new Date(screen.updatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card shadow-sm hover:shadow-md transition-shadow">
      <div className="relative flex h-44 items-center justify-center overflow-hidden rounded-t-xl bg-slate-900">
        <div className="flex flex-col items-center gap-2 opacity-50">
          <Monitor className="h-12 w-12 text-cyan-400" strokeWidth={1} />
          <span className="font-mono text-xs text-slate-400">{screen.width} × {screen.height}</span>
        </div>
        {/* Badge de tela inicial */}
        {screen.isHome && (
          <span className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-cyan-600 px-2 py-0.5 text-[10px] font-medium text-white shadow-sm">
            <Home className="h-3 w-3" strokeWidth={2} />
            Tela inicial
          </span>
        )}
        <span className={`absolute right-3 top-3 rounded-full px-2 py-0.5 text-[10px] font-medium ${s.cls}`}>{s.label}</span>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground line-clamp-1">{screen.name}</h3>
            {scopeLabel && <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{scopeLabel}</p>}
            {screen.description && <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{screen.description}</p>}
          </div>
          {canEdit && (onRename || onDelete) && (
            <div className="flex shrink-0 items-center gap-1">
              {onRename && (
                <button
                  type="button"
                  onClick={onRename}
                  title="Renomear tela"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              )}
              {onDelete && (
                <button
                  type="button"
                  onClick={onDelete}
                  title="Excluir tela"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Settings2 className="h-3 w-3" strokeWidth={1.5} />
            {screen.widgets.length} {screen.widgets.length === 1 ? 'componente' : 'componentes'}
          </span>
          <span className="text-border">·</span>
          <span>{updatedAt}</span>
        </div>

        {/* Controle de tela inicial */}
        {canEdit && onSetHome && (
          screen.isHome ? (
            <span className="flex items-center justify-center gap-1.5 rounded-lg bg-cyan-50 py-1.5 text-xs font-medium text-cyan-700">
              <Home className="h-3.5 w-3.5" strokeWidth={1.5} />
              Tela inicial do gateway
            </span>
          ) : (
            <button
              type="button"
              onClick={onSetHome}
              disabled={settingHome}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-border py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              {settingHome ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Home className="h-3.5 w-3.5" strokeWidth={1.5} />}
              Definir como inicial
            </button>
          )
        )}

        <div className="flex gap-2 pt-1">
          <Link href={`/scada-view/${screen.id}`} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
            <Eye className="h-3.5 w-3.5" strokeWidth={1.5} />
            Visualizar
          </Link>
          {canEdit && (
            <Link href={`/scada/editor/${screen.id}`} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary py-1.5 text-xs font-medium text-white hover:bg-primary/90 transition-colors">
              <Edit2 className="h-3.5 w-3.5" strokeWidth={1.5} />
              Editar
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
