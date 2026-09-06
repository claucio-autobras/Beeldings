'use client';

import { CheckCircle, XCircle, X } from 'lucide-react';
import { useEditorStore } from '../../store/editor.store';

export function ToastNotification() {
  const { toasts, removeToast } = useEditorStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={[
            'flex items-center gap-3 rounded-lg px-4 py-3 shadow-lg pointer-events-auto',
            'animate-[fadeInUp_0.2s_ease-out]',
            t.kind === 'success'
              ? 'bg-green-900/90 border border-green-700 text-green-100'
              : t.kind === 'error'
                ? 'bg-red-900/90 border border-red-700 text-red-100'
                : 'bg-slate-800/90 border border-slate-600 text-slate-100',
          ].join(' ')}
        >
          {t.kind === 'success' && <CheckCircle className="h-4 w-4 shrink-0 text-green-400" strokeWidth={2} />}
          {t.kind === 'error' && <XCircle className="h-4 w-4 shrink-0 text-red-400" strokeWidth={2} />}
          <span className="text-sm">{t.text}</span>
          <button
            type="button"
            onClick={() => removeToast(t.id)}
            className="ml-2 shrink-0 opacity-60 hover:opacity-100 transition-opacity"
            aria-label="Fechar"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
