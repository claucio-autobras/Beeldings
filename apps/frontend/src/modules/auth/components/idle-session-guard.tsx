'use client';

import { AlertTriangle } from 'lucide-react';
import { useIdleLogout } from '../hooks/use-idle-logout';

/**
 * Ativa o encerramento automático da sessão por inatividade e exibe um aviso
 * com contagem regressiva pouco antes do logout.
 * Deve viver dentro do AuthProvider/QueryClientProvider.
 */
export function IdleSessionGuard() {
  const { warning, secondsLeft, stayConnected, logout } = useIdleLogout();

  if (!warning) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="idle-warning-title"
    >
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-xl">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h2 id="idle-warning-title" className="text-sm font-semibold text-foreground">
              Sessão prestes a expirar
            </h2>
            <p className="text-xs text-muted-foreground">Por inatividade</p>
          </div>
        </div>

        <p className="mt-4 text-sm text-muted-foreground">
          Sua sessão será encerrada em{' '}
          <span className="font-semibold text-foreground">{secondsLeft}s</span>. Deseja continuar
          conectado?
        </p>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/40"
          >
            Sair agora
          </button>
          <button
            type="button"
            onClick={stayConnected}
            className="rounded-md bg-cyan-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-cyan-700"
          >
            Continuar conectado
          </button>
        </div>
      </div>
    </div>
  );
}
