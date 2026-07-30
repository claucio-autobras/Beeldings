'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import { createScreen } from '../services/scada.service';

interface CreateScreenModalProps {
  /** Contexto do projeto — vem do card/projeto aberto, não é escolhido aqui. */
  tenantId: string;
  siteId?: string;
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}

/**
 * Modal de criação de tela DENTRO de um projeto já selecionado.
 * Diferente do fluxo antigo, não pede Cliente/Site/Projeto — apenas nome e dimensões.
 */
export function CreateScreenModal({ tenantId, siteId, projectId, onClose, onCreated }: CreateScreenModalProps) {
  const [name, setName] = useState('');
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      createScreen({ name: name.trim(), tenantId, siteId, projectId, width, height }),
    onSuccess: () => { onCreated(); onClose(); },
    onError: (err: Error) => setError(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError('Informe o nome da tela'); return; }
    mutation.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">Nova Tela SCADA</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-6 py-5">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">Nome da tela *</span>
            <input
              type="text" value={name} onChange={(e) => setName(e.target.value)} autoFocus
              placeholder="Ex.: Sistema HVAC — Bloco B"
              className="rounded-lg border border-border px-3 py-2 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Largura (px)</span>
              <input type="number" value={width} onChange={(e) => setWidth(Number(e.target.value))} min={320} max={3840}
                className="rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">Altura (px)</span>
              <input type="number" value={height} onChange={(e) => setHeight(Number(e.target.value))} min={240} max={2160}
                className="rounded-lg border border-border px-3 py-2 text-sm outline-none focus:border-primary" />
            </label>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted transition-colors">Cancelar</button>
            <button type="submit" disabled={mutation.isPending} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-40 transition-colors">
              {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Criar Tela
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
