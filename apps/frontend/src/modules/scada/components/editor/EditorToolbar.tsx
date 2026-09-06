'use client';

import { useState, useRef } from 'react';
import Link from 'next/link';
import { Maximize2, Minimize2, Redo2, Save, Settings, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { useEditorStore } from '../../store/editor.store';
import { ScreenSettingsPanel } from './ScreenSettingsPanel';

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5];
const ZOOM_LABELS: Record<number, string> = { 0.5: '50%', 0.75: '75%', 1: '100%', 1.25: '125%', 1.5: '150%' };

export function EditorToolbar() {
  const { screen, zoom, isDirty, historyIndex, history, undo, redo, save, setZoom, renameScreen, previewMode, setPreviewMode } = useEditorStore();
  const [editingName, setEditingName] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  function handleNameDoubleClick() {
    setEditingName(true);
    setTimeout(() => nameInputRef.current?.select(), 0);
  }
  function commitName(e: React.FocusEvent<HTMLInputElement> | React.KeyboardEvent) {
    if ('key' in e && e.key !== 'Enter') return;
    renameScreen(nameInputRef.current?.value ?? screen?.name ?? '');
    setEditingName(false);
  }
  function zoomIn() {
    const idx = ZOOM_LEVELS.indexOf(zoom);
    if (idx < ZOOM_LEVELS.length - 1) setZoom(ZOOM_LEVELS[idx + 1]);
  }
  function zoomOut() {
    const idx = ZOOM_LEVELS.indexOf(zoom);
    if (idx > 0) setZoom(ZOOM_LEVELS[idx - 1]);
  }

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;
  const backHref = screen?.projectId ? `/scada/project/${screen.projectId}` : '/scada';

  // ── Preview / maximized mode toolbar ────────────────────────────────────────
  if (previewMode) {
    return (
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-slate-700/60 bg-slate-900/95 px-4 backdrop-blur">
        <span className="text-sm font-medium text-slate-300">
          {screen?.name ?? ''}
          <span className="ml-2 text-xs text-slate-500">— modo de visualização</span>
        </span>
        <button
          type="button"
          onClick={() => setPreviewMode(false)}
          className="flex items-center gap-1.5 rounded bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-600 transition-colors"
        >
          <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.5} />
          Sair do modo de visualização
        </button>
      </header>
    );
  }

  return (
    <header className="relative flex h-12 shrink-0 items-center gap-2 border-b border-slate-700 bg-slate-900 px-4">
      {/* Fechar editor — volta para as telas do projeto (respeita alterações não salvas) */}
      <Link
        href={backHref}
        title="Fechar editor"
        aria-label="Fechar editor"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
      >
        <X className="h-4 w-4" strokeWidth={1.5} />
      </Link>
      <div className="h-5 w-px bg-slate-700" />

      {/* Screen name */}
      <div className="flex items-center gap-2 min-w-0 mr-2">
        {editingName ? (
          <input ref={nameInputRef} defaultValue={screen?.name ?? ''} className="rounded border border-cyan-500 bg-slate-800 px-2 py-0.5 text-sm text-white outline-none focus:ring-1 focus:ring-cyan-500" onBlur={commitName} onKeyDown={commitName} autoFocus />
        ) : (
          <span onDoubleClick={handleNameDoubleClick} className="cursor-text truncate text-sm font-medium text-slate-100 hover:text-white" title="Duplo clique para renomear">
            {isDirty ? `${screen?.name ?? '...'} *` : (screen?.name ?? '...')}
          </span>
        )}
      </div>

      <div className="flex-1" />

      {/* Screen settings */}
      <button type="button" onClick={() => setShowSettings((v) => !v)} className={`flex h-8 items-center gap-1.5 rounded px-2.5 text-xs transition-colors ${showSettings ? 'bg-slate-700 text-cyan-400' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`} title="Configurações da tela">
        <Settings className="h-3.5 w-3.5" strokeWidth={1.5} />
        <span className="hidden sm:inline">Canvas</span>
      </button>

      {/* Zoom */}
      <div className="flex items-center gap-0.5 rounded-md border border-slate-700 bg-slate-800 px-1">
        <button type="button" onClick={zoomOut} disabled={zoom === ZOOM_LEVELS[0]} className="flex h-7 w-7 items-center justify-center text-slate-400 hover:text-white disabled:opacity-30 transition-colors" aria-label="Reduzir zoom">
          <ZoomOut className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
        <span className="min-w-[2.5rem] text-center text-xs text-slate-300 tabular-nums">{ZOOM_LABELS[zoom] ?? `${Math.round(zoom * 100)}%`}</span>
        <button type="button" onClick={zoomIn} disabled={zoom === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]} className="flex h-7 w-7 items-center justify-center text-slate-400 hover:text-white disabled:opacity-30 transition-colors" aria-label="Aumentar zoom">
          <ZoomIn className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </div>

      {/* Undo / Redo */}
      <button type="button" onClick={undo} disabled={!canUndo} className="flex h-8 w-8 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30 transition-colors" title="Desfazer (Ctrl+Z)">
        <Undo2 className="h-4 w-4" strokeWidth={1.5} />
      </button>
      <button type="button" onClick={redo} disabled={!canRedo} className="flex h-8 w-8 items-center justify-center rounded text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30 transition-colors" title="Refazer (Ctrl+Y)">
        <Redo2 className="h-4 w-4" strokeWidth={1.5} />
      </button>

      {/* Maximize / Preview */}
      <button type="button" onClick={() => setPreviewMode(true)} className="flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white transition-colors" title="Visualizar em tela cheia">
        <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.5} />
        <span className="hidden sm:inline">Preview</span>
      </button>

      {/* Save */}
      <button type="button" onClick={save} disabled={!isDirty} className="flex items-center gap-1.5 rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
        <Save className="h-3.5 w-3.5" strokeWidth={1.5} />
        Salvar
      </button>

      {/* Screen settings panel */}
      {showSettings && <ScreenSettingsPanel onClose={() => setShowSettings(false)} />}
    </header>
  );
}
