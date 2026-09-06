'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Download, Edit2, Eye, History, Home, Loader2, MoreHorizontal, Pencil, Settings2, Trash2 } from 'lucide-react';
import type { ScadaScreen, ScadaScreenStatus } from '../types/scada.types';

const STATUS_CFG: Record<ScadaScreenStatus, { label: string; cls: string }> = {
  active: {
    label: 'Ativa',
    cls: 'border border-emerald-400/25 bg-slate-950/65 text-emerald-300',
  },
  maintenance: {
    label: 'Manutenção',
    cls: 'border border-amber-400/30 bg-slate-950/65 text-amber-200',
  },
};

/** Miniatura decorativa: comunica a linguagem visual de uma tela SCADA sem ser
 * confundida com uma captura ou com os dados reais da tela. */
function ScadaPreviewArtwork() {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full opacity-75"
      viewBox="0 0 320 154"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="scada-preview-wash" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#0e7490" stopOpacity="0.22" />
          <stop offset="0.55" stopColor="#0f172a" stopOpacity="0" />
          <stop offset="1" stopColor="#172554" stopOpacity="0.35" />
        </linearGradient>
        <linearGradient id="scada-preview-chart" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#22d3ee" stopOpacity="0.24" />
          <stop offset="1" stopColor="#22d3ee" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect width="320" height="154" fill="url(#scada-preview-wash)" />
      <path d="M0 26H320M0 52H320M0 78H320M0 104H320M0 130H320" stroke="#67e8f9" strokeOpacity="0.08" />
      <path d="M24 0V154M48 0V154M72 0V154M96 0V154M120 0V154M144 0V154M168 0V154M192 0V154M216 0V154M240 0V154M264 0V154M288 0V154" stroke="#67e8f9" strokeOpacity="0.06" />

      <rect x="16" y="18" width="52" height="118" rx="3" fill="#0b2030" fillOpacity="0.8" stroke="#155e75" strokeOpacity="0.75" />
      <rect x="24" y="27" width="31" height="5" rx="1" fill="#22d3ee" fillOpacity="0.38" />
      <rect x="24" y="39" width="36" height="3" rx="1" fill="#64748b" fillOpacity="0.6" />
      <rect x="24" y="49" width="29" height="3" rx="1" fill="#0e7490" fillOpacity="0.75" />
      <rect x="24" y="64" width="36" height="3" rx="1" fill="#475569" fillOpacity="0.8" />
      <rect x="24" y="73" width="24" height="3" rx="1" fill="#475569" fillOpacity="0.55" />
      <rect x="24" y="91" width="38" height="17" rx="2" fill="#0e7490" fillOpacity="0.13" stroke="#22d3ee" strokeOpacity="0.16" />
      <circle cx="31" cy="99" r="3" fill="#34d399" fillOpacity="0.85" />
      <rect x="38" y="97" width="18" height="3" rx="1" fill="#a7f3d0" fillOpacity="0.55" />
      <rect x="24" y="119" width="30" height="3" rx="1" fill="#475569" fillOpacity="0.55" />

      <rect x="82" y="18" width="102" height="56" rx="3" fill="#0b2030" fillOpacity="0.52" stroke="#164e63" strokeOpacity="0.8" />
      <path d="M94 57L108 48L122 53L136 35L151 44L165 30L174 37" fill="none" stroke="#22d3ee" strokeOpacity="0.68" strokeWidth="2" />
      <path d="M94 57L108 48L122 53L136 35L151 44L165 30L174 37V64H94Z" fill="url(#scada-preview-chart)" />
      <circle cx="165" cy="30" r="3" fill="#67e8f9" fillOpacity="0.8" />
      <rect x="94" y="26" width="28" height="3" rx="1" fill="#64748b" fillOpacity="0.7" />

      <rect x="198" y="18" width="106" height="118" rx="3" fill="#0b2030" fillOpacity="0.45" stroke="#164e63" strokeOpacity="0.7" />
      <rect x="210" y="29" width="80" height="4" rx="1" fill="#475569" fillOpacity="0.7" />
      <rect x="210" y="42" width="22" height="58" rx="2" fill="#164e63" fillOpacity="0.55" />
      <rect x="238" y="54" width="22" height="46" rx="2" fill="#0e7490" fillOpacity="0.64" />
      <rect x="266" y="37" width="22" height="63" rx="2" fill="#22d3ee" fillOpacity="0.28" />
      <path d="M210 119H289M210 110H289" stroke="#67e8f9" strokeOpacity="0.15" />
      <circle cx="216" cy="120" r="2.5" fill="#34d399" fillOpacity="0.8" />
      <rect x="223" y="118" width="31" height="4" rx="1" fill="#64748b" fillOpacity="0.55" />
    </svg>
  );
}

/** Card de uma tela SCADA — usado na visão de um projeto. */
export function ScreenCard({
  screen,
  canEdit,
  scopeLabel,
  onRename,
  onSetHome,
  onDelete,
  onExport,
  onHistory,
  settingHome,
}: {
  screen: ScadaScreen;
  canEdit: boolean;
  scopeLabel?: string;
  onRename?: () => void;
  onSetHome?: () => void;
  onDelete?: () => void;
  onExport?: () => void;
  onHistory?: () => void;
  settingHome?: boolean;
}) {
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const s = STATUS_CFG[screen.status] ?? STATUS_CFG.active;
  const updatedAt = new Date(screen.updatedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const hasActions = canEdit && Boolean(onRename || onSetHome || onDelete || onExport || onHistory);

  useEffect(() => {
    if (!actionsOpen) return;

    function handlePointerDown(event: PointerEvent) {
      if (!actionsRef.current?.contains(event.target as Node)) {
        setActionsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setActionsOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [actionsOpen]);

  return (
    <div
      data-testid={`card-screen-${screen.id}`}
      className="scada-screen-card group relative flex h-full min-w-0 flex-col rounded-[14px] border border-cyan-700/60 bg-card shadow-sm transition-[box-shadow,border-color] duration-200 hover:border-cyan-500/80 hover:shadow-lg focus-within:border-cyan-500/80 dark:border-cyan-500/45 dark:shadow-black/20"
    >
      <div className="scada-screen-preview relative aspect-[1.76] min-h-[158px] shrink-0 overflow-hidden rounded-t-[13px] border-b border-cyan-700/45 px-3 sm:min-h-[168px]">
        <ScadaPreviewArtwork />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-slate-950/10 via-transparent to-slate-950/45" />
        {/* Badge de tela inicial */}
        {screen.isHome && (
          <span data-testid={`status-home-screen-${screen.id}`} className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full border border-amber-300/20 bg-slate-950/70 px-2 py-1 text-[10px] font-semibold text-amber-100 shadow-sm shadow-cyan-950/30">
            <Home className="h-3 w-3 text-amber-300" strokeWidth={2} />
            Inicial
          </span>
        )}
        <span data-testid={`status-screen-${screen.id}`} className={`absolute right-3 top-3 rounded-full px-2 py-1 text-[10px] font-semibold shadow-sm ${s.cls}`}>{s.label}</span>
        <div className="scada-card-actions pointer-events-auto absolute inset-x-3 top-1/2 z-10 flex -translate-y-1/2 justify-center gap-2 opacity-0 transition-opacity duration-200 group-focus-within:opacity-100">
          <Link
            href={`/scada-view/${screen.id}`}
            title={`Visualizar ${screen.name}`}
            data-testid={`link-view-screen-${screen.id}`}
            onClick={(event) => event.stopPropagation()}
            className="flex h-9 min-w-0 max-w-[104px] flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/60 bg-slate-950/80 px-2 text-xs font-semibold text-white shadow-lg backdrop-blur-sm transition-colors hover:border-cyan-300 hover:bg-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
          >
            <Eye className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
            <span className="truncate">Visualizar</span>
          </Link>
          {canEdit && (
            <Link
              href={`/scada/editor/${screen.id}`}
              title={`Editar ${screen.name}`}
              data-testid={`link-edit-screen-${screen.id}`}
              onClick={(event) => event.stopPropagation()}
              className="flex h-9 min-w-0 flex-1 max-w-[84px] items-center justify-center gap-1.5 rounded-lg bg-cyan-500 px-2 text-xs font-semibold text-slate-950 shadow-lg transition-colors hover:bg-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 focus-visible:ring-offset-2 focus-visible:ring-offset-cyan-900"
            >
              <Edit2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
              <span className="truncate">Editar</span>
            </Link>
          )}
        </div>
      </div>

      <div className="relative flex min-h-[78px] flex-1 flex-col rounded-b-[13px] bg-card px-3.5 py-3">
        <div className={`min-h-0 flex-1 overflow-hidden ${hasActions ? 'pr-9' : ''}`}>
          <h3 data-testid={`text-screen-name-${screen.id}`} className="truncate text-[15px] font-semibold leading-5 text-foreground">{screen.name}</h3>
          {scopeLabel && <p data-testid={`text-screen-context-${screen.id}`} className="truncate text-[11px] font-medium leading-4 text-primary/80">{scopeLabel}</p>}
          {screen.description && <p data-testid={`text-screen-description-${screen.id}`} className="truncate text-[11px] leading-4 text-muted-foreground">{screen.description}</p>}
        </div>

        <div className="mt-2 flex min-w-0 items-center gap-x-2 border-t border-border/70 pt-2 text-[11px] text-muted-foreground">
          <span data-testid={`text-screen-components-${screen.id}`} className="inline-flex items-center gap-1 whitespace-nowrap">
            <Settings2 className="h-3 w-3 shrink-0" strokeWidth={1.5} />
            {screen.widgets.length} {screen.widgets.length === 1 ? 'componente' : 'componentes'}
          </span>
          <span className="h-3 w-px shrink-0 bg-border" aria-hidden="true" />
          <span data-testid={`text-screen-updated-${screen.id}`} className="inline-flex items-center gap-1 whitespace-nowrap">
            <CalendarDays className="h-3 w-3 shrink-0" strokeWidth={1.5} />
            {updatedAt}
          </span>
        </div>

        {hasActions && (
          <div ref={actionsRef} className="absolute right-3 top-3">
            <button
              type="button"
              onClick={() => setActionsOpen((open) => !open)}
              title="Ações da tela"
              aria-label={`Ações da tela ${screen.name}`}
              aria-haspopup="menu"
              aria-expanded={actionsOpen}
              data-testid={`button-screen-menu-${screen.id}`}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-muted/70 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
            >
              <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} />
            </button>
            {actionsOpen && (
              <div
                role="menu"
                aria-label="Ações da tela"
                data-testid={`screen-actions-menu-${screen.id}`}
                className="absolute bottom-9 right-0 z-30 min-w-[172px] overflow-hidden rounded-lg border border-border bg-popover p-1 shadow-xl"
              >
                {onRename && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setActionsOpen(false); onRename(); }}
                    title="Renomear tela"
                    aria-label="Renomear tela"
                    data-testid={`button-rename-screen-${screen.id}`}
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
                    Renomear
                  </button>
                )}
                {onSetHome && !screen.isHome && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setActionsOpen(false); onSetHome(); }}
                    disabled={settingHome}
                    title="Definir como tela inicial"
                    aria-label={`Definir ${screen.name} como tela inicial`}
                    data-testid={`button-set-home-screen-${screen.id}`}
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {settingHome ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" /> : <Home className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />}
                    Definir como inicial
                  </button>
                )}
                {onExport && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setActionsOpen(false); onExport(); }}
                    title="Exportar tela visual"
                    aria-label={`Exportar ${screen.name}`}
                    data-testid={`button-export-screen-${screen.id}`}
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Download className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
                    Exportar tela visual
                  </button>
                )}
                {onHistory && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setActionsOpen(false); onHistory(); }}
                    title="Ver histórico da tela"
                    aria-label={`Ver histórico de ${screen.name}`}
                    data-testid={`button-history-screen-${screen.id}`}
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <History className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.5} />
                    Histórico / restaurar
                  </button>
                )}
                {onDelete && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => { setActionsOpen(false); onDelete(); }}
                    title="Excluir tela"
                    aria-label="Excluir tela"
                    data-testid={`button-delete-screen-${screen.id}`}
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-xs font-medium text-destructive transition-colors hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
                    Excluir
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
