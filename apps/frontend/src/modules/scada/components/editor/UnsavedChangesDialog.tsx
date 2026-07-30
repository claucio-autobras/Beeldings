'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';

interface Props {
  /** Quando salvando, desabilita os botões e mostra spinner em "Salvar e sair". */
  saving: boolean;
  /** Descarta as alterações e sai. */
  onDiscard: () => void;
  /** Salva e, em caso de sucesso, sai. */
  onSaveAndLeave: () => void;
  /** Permanece no editor. */
  onCancel: () => void;
}

export function UnsavedChangesDialog({ saving, onDiscard, onSaveAndLeave, onCancel }: Props) {
  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-4"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="unsaved-title"
      onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onCancel(); }}
    >
      <div className="w-full max-w-sm rounded-lg border border-slate-700 bg-slate-900 p-5 shadow-2xl">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/15">
            <AlertTriangle className="h-5 w-5 text-amber-400" strokeWidth={2} />
          </div>
          <div className="min-w-0">
            <h2 id="unsaved-title" className="text-sm font-semibold text-slate-100">
              Alterações não salvas
            </h2>
            <p className="mt-1 text-xs leading-relaxed text-slate-400">
              Você fez alterações nesta tela que ainda não foram salvas. Se sair agora, elas serão perdidas.
              Deseja realmente sair do editor?
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-40 transition-colors"
          >
            Continuar editando
          </button>
          <button
            type="button"
            onClick={onDiscard}
            disabled={saving}
            className="rounded border border-red-700/60 px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-900/40 hover:text-red-200 disabled:opacity-40 transition-colors"
          >
            Sair sem salvar
          </button>
          <button
            type="button"
            onClick={onSaveAndLeave}
            disabled={saving}
            className="flex items-center justify-center gap-1.5 rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
            Salvar e sair
          </button>
        </div>
      </div>
    </div>
  );
}
