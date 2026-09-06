'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { History, Loader2, RotateCcw, X } from 'lucide-react';
import { getScreenVersions, restoreScreenVersion, type ScadaScreenVersion } from '../services/scada.service';

export function ScreenVersionsModal({
  screenId,
  screenName,
  onClose,
  onRestored,
}: {
  screenId: string;
  screenName: string;
  onClose: () => void;
  onRestored: () => void;
}) {
  const qc = useQueryClient();
  const { data: versions = [], isLoading, error } = useQuery<ScadaScreenVersion[]>({
    queryKey: ['scada-screen-versions', screenId],
    queryFn: () => getScreenVersions(screenId),
  });
  const restore = useMutation({
    mutationFn: (versionId: string) => restoreScreenVersion(screenId, versionId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['scada-screen-versions', screenId] });
      onRestored();
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" role="dialog" aria-modal="true" aria-labelledby="screen-history-title">
      <div className="w-full max-w-lg overflow-hidden rounded-xl bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <History className="h-4 w-4 shrink-0 text-primary" strokeWidth={1.6} />
            <div className="min-w-0">
              <h2 id="screen-history-title" className="truncate text-sm font-semibold text-foreground">Histórico da tela</h2>
              <p className="truncate text-xs text-muted-foreground">{screenName}</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar histórico" className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[min(60vh,420px)] overflow-y-auto p-5">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Carregando versões…</div>
          ) : error ? (
            <p className="py-8 text-center text-sm text-red-600">{(error as Error).message}</p>
          ) : versions.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Ainda não há versões anteriores salvas.</p>
          ) : (
            <div className="space-y-2">
              {versions.map((version) => (
                <div key={version.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{version.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(version.createdAt).toLocaleString('pt-BR')} · {version.width}×{version.height}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={restore.isPending}
                    onClick={() => {
                      if (window.confirm('Restaurar esta versão? A versão atual também será preservada no histórico.')) restore.mutate(version.id);
                    }}
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-accent disabled:opacity-50"
                  >
                    {restore.isPending && restore.variables === version.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                    Restaurar
                  </button>
                </div>
              ))}
            </div>
          )}
          {restore.error && <p className="mt-3 text-xs text-red-600">{(restore.error as Error).message}</p>}
        </div>
      </div>
    </div>
  );
}