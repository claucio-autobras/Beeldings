'use client';

import PasswordConfirmDialog from '@/components/PasswordConfirmDialog';

interface DeleteScreenDialogProps {
  screenName: string;
  isPending: boolean;
  error: string | null;
  onCancel: () => void;
  /** Recebe o token de confirmação de senha validado pelo backend. */
  onConfirm: (confirmationToken: string) => void;
}

/** Confirmação de exclusão de UMA tela SCADA (exige senha do operador). Não afeta o projeto nem o gateway. */
export function DeleteScreenDialog({ screenName, isPending, error, onCancel, onConfirm }: DeleteScreenDialogProps) {
  return (
    <PasswordConfirmDialog
      title="Excluir esta tela?"
      description={
        <>
          A tela <span className="font-medium text-foreground">{screenName}</span> será excluída
          permanentemente. Esta ação não pode ser desfeita.
        </>
      }
      isPending={isPending}
      error={error}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
