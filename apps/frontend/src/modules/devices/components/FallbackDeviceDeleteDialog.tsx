'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import PasswordConfirmDialog from '@/components/PasswordConfirmDialog';
import { useT } from '@/lib/i18n';
import type { Device } from '@/mocks/data/devices.mock';
import { deleteDevice } from '../services/devices.service';

interface Props {
  device: Device;
  onClose: () => void;
  onDeleted: (deviceId: string) => void;
}

/**
 * Diálogo de fallback para dispositivos sem modal de edição dedicado
 * (ex.: onvif, snmp). Exibe os dados básicos e permite excluir o dispositivo
 * usando o fluxo de confirmação por senha (X-Sensitive-Action-Token).
 */
export default function FallbackDeviceDeleteDialog({ device, onClose, onDeleted }: Props) {
  const t = useT();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const deleteMut = useMutation({
    mutationFn: ({ token }: { token: string }) => deleteDevice(device.id, token),
    onSuccess: () => {
      onDeleted(device.id);
    },
    onError: (err: Error) => {
      setDeleteError(err.message ?? t('Erro ao remover dispositivo. Tente novamente.'));
    },
  });

  function handleDelete(token: string) {
    setDeleteError('');
    deleteMut.mutate({ token });
  }

  const protocolLabel = device.protocol?.toUpperCase() ?? '—';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">
            {t('Dispositivo')}: {device.name}
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label={t('Fechar')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body — informações básicas */}
        <div className="px-5 py-5 space-y-3">
          <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('Nome')}</span>
              <span className="font-medium text-foreground">{device.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('Protocolo')}</span>
              <span className="font-medium text-foreground">{protocolLabel}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('Local')}</span>
              <span className="font-medium text-foreground">{device.site ?? '—'}</span>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {t(
              'Este tipo de dispositivo é gerenciado em outra área do sistema. Aqui você pode apenas remover o registro.',
            )}
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-5 py-4">
          <button
            onClick={() => { setDeleteError(''); setConfirmDelete(true); }}
            disabled={deleteMut.isPending}
            className="h-9 px-3 text-sm border border-red-200 rounded-md text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {deleteMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('Remover dispositivo')}
          </button>

          <button
            onClick={onClose}
            disabled={deleteMut.isPending}
            className="h-9 px-4 text-sm border border-border rounded-md text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
          >
            {t('Fechar')}
          </button>
        </div>
      </div>

      {/* Confirmação por senha */}
      {confirmDelete && (
        <PasswordConfirmDialog
          title={t('Remover dispositivo?')}
          description={
            <>
              {t('O dispositivo')}{' '}
              <span className="font-medium text-foreground">{device.name}</span>{' '}
              {t(
                'e todos os seus pontos, históricos e alarmes serão excluídos permanentemente. Esta ação não pode ser desfeita.',
              )}
            </>
          }
          confirmLabel={t('Remover')}
          isPending={deleteMut.isPending}
          error={deleteError || null}
          onCancel={() => { setConfirmDelete(false); setDeleteError(''); }}
          onConfirm={(token) => handleDelete(token)}
        />
      )}
    </div>
  );
}
