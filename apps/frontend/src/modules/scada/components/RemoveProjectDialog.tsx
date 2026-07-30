'use client';

import PasswordConfirmDialog from '@/components/PasswordConfirmDialog';

interface RemoveProjectDialogProps {
  projectName: string;
  isPending: boolean;
  error: string | null;
  onCancel: () => void;
  /** Recebe o token de confirmação de senha validado pelo backend. */
  onConfirm: (confirmationToken: string) => void;
}

/** Confirmação de exclusão das telas SCADA de um projeto (exige senha do operador; NUNCA apaga o gateway). */
export function RemoveProjectDialog({ projectName, isPending, error, onCancel, onConfirm }: RemoveProjectDialogProps) {
  return (
    <PasswordConfirmDialog
      title="Excluir as telas deste projeto?"
      confirmLabel="Remover"
      description={
        <>
          <span>
            Todas as telas SCADA de <span className="font-medium text-foreground">{projectName}</span> serão
            excluídas permanentemente. Esta ação não pode ser desfeita.
          </span>
          <span className="mt-2 block rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
            O projeto, o gateway e os dispositivos do cliente <span className="font-medium">não</span> são afetados.
          </span>
        </>
      }
      isPending={isPending}
      error={error}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
