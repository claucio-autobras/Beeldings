'use client';

import { useMutation } from '@tanstack/react-query';
import { Loader2, ShieldAlert } from 'lucide-react';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { apiPost } from '@/lib/api-client';

interface ConfirmPasswordResponse {
  confirmationToken: string;
  expiresInSeconds: number;
}

interface PasswordConfirmDialogProps {
  /** Título do diálogo, ex.: "Excluir cliente?" */
  title: string;
  /** Descrição das consequências da exclusão (aceita JSX). */
  description: ReactNode;
  /** Rótulo do botão de confirmação (padrão: "Excluir"). */
  confirmLabel?: string;
  /** true enquanto a exclusão em si está em andamento (após a senha validar). */
  isPending?: boolean;
  /** Erro da exclusão em si (exibido no diálogo). */
  error?: string | null;
  onCancel: () => void;
  /** Chamado com o token de confirmação após a senha ser validada no backend. */
  onConfirm: (confirmationToken: string) => void;
}

/**
 * Diálogo de confirmação de exclusão crítica por senha. O operador digita a
 * senha de login; ela é validada no backend (POST /auth/confirm-password) e,
 * se correta, o token de curta duração retornado é repassado a onConfirm para
 * ser enviado no header X-Sensitive-Action-Token da requisição DELETE.
 */
export default function PasswordConfirmDialog({
  title,
  description,
  confirmLabel = 'Excluir',
  isPending = false,
  error = null,
  onCancel,
  onConfirm,
}: PasswordConfirmDialogProps) {
  const [password, setPassword] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const verify = useMutation({
    mutationFn: (pwd: string) =>
      apiPost<ConfirmPasswordResponse>('/auth/confirm-password', { password: pwd }),
    onSuccess: (data) => {
      onConfirm(data.confirmationToken);
    },
  });

  const busy = verify.isPending || isPending;
  const displayError = error ?? (verify.error ? (verify.error as Error).message : null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    verify.mutate(password);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-500/15">
            <ShieldAlert className="h-5 w-5 text-red-600 dark:text-red-400" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">{title}</h3>
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</div>
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-foreground">
            Confirme com sua senha de acesso
          </label>
          <input
            ref={inputRef}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            placeholder="Sua senha"
            className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-red-400 focus:ring-2 focus:ring-red-200 disabled:opacity-60 dark:focus:ring-red-500/30"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            Por segurança, esta exclusão exige a senha do seu usuário.
          </p>
        </div>

        {displayError && (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            {displayError}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!password || busy}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
