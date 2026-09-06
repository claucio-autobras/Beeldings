'use client';

import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { updateScadaProjectCover, type ScadaProject } from '../services/scada.service';

interface ProjectCoverModalProps {
  project: ScadaProject;
  onClose: () => void;
  onSaved: (project: ScadaProject) => void;
}

const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/svg+xml,image/gif';
const ALLOWED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml', 'image/gif']);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Edita somente a capa de um projeto SCADA. O estado indefinido significa
 * "não alterar"; null é enviado explicitamente para remover a capa.
 */
export function ProjectCoverModal({ project, onClose, onSaved }: ProjectCoverModalProps) {
  const [coverImageDataUrl, setCoverImageDataUrl] = useState<string | null | undefined>(undefined);
  const [coverImageError, setCoverImageError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [readingCover, setReadingCover] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: () => {
      if (coverImageDataUrl === undefined) {
        throw new Error('Selecione uma imagem ou remova a capa atual');
      }
      return updateScadaProjectCover(project.id, coverImageDataUrl);
    },
    onSuccess: (updatedProject) => {
      onSaved(updatedProject);
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  const previewUrl = coverImageDataUrl === undefined
    ? project.coverImageUrl
    : coverImageDataUrl;
  const hasChanges = coverImageDataUrl !== undefined;

  function handleCoverChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setCoverImageError(null);
    setError(null);
    setCoverImageDataUrl(undefined);
    setPreviewFailed(false);
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
      setCoverImageError('Tipo não suportado. Use PNG, JPG, WEBP, SVG ou GIF.');
      e.target.value = '';
      return;
    }
    if (file.size === 0) {
      setCoverImageError('O arquivo de imagem está vazio.');
      e.target.value = '';
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setCoverImageError('A imagem excede o limite de 5 MB.');
      e.target.value = '';
      return;
    }

    setReadingCover(true);
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) {
        setCoverImageError('Não foi possível ler a imagem.');
        setReadingCover(false);
        return;
      }
      setCoverImageDataUrl(result);
      setReadingCover(false);
    };
    reader.onerror = () => {
      setCoverImageError('Não foi possível ler a imagem.');
      setReadingCover(false);
    };
    reader.readAsDataURL(file);
  }

  function removeCover() {
    setError(null);
    setCoverImageError(null);
    setCoverImageDataUrl(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!hasChanges || readingCover || mutation.isPending) return;
    mutation.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">Editar capa</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{project.name}</p>
          </div>
          <button type="button" onClick={onClose} disabled={mutation.isPending || readingCover} className="text-muted-foreground hover:text-foreground disabled:opacity-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 px-6 py-5">
          {previewUrl && !previewFailed ? (
            <div className="relative overflow-hidden rounded-lg border border-border bg-muted">
              <img
                src={previewUrl}
                alt={`Prévia da capa de ${project.name}`}
                onError={() => setPreviewFailed(true)}
                className="h-40 w-full object-cover"
              />
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-black/55 px-2 py-1.5 text-white">
                <span className="text-[11px]">{coverImageDataUrl ? 'Nova capa selecionada' : 'Capa atual'}</span>
                <button type="button" onClick={removeCover} disabled={mutation.isPending || readingCover} className="rounded px-2 py-0.5 text-[11px] font-medium hover:bg-white/20 disabled:opacity-50">
                  Remover capa
                </button>
              </div>
            </div>
          ) : (
            <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/40">
              <ImagePlus className="h-10 w-10 text-muted-foreground/50" strokeWidth={1.2} />
              {previewUrl && previewFailed && (
                <p className="px-4 text-center text-[11px] text-muted-foreground">
                  Não foi possível carregar a capa atual. Você pode selecionar outra ou removê-la.
                </p>
              )}
            </div>
          )}

          <label className="flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-border bg-muted/40 px-3 py-4 text-center transition-colors hover:border-primary/60 hover:bg-primary/5">
            <span className="text-xs text-muted-foreground">
              {readingCover ? 'Lendo imagem…' : 'Selecionar nova capa'}
              <span className="mt-1 block text-[10px] text-muted-foreground/70">PNG, JPG, WEBP, SVG ou GIF · até 5 MB</span>
            </span>
            <input
              ref={coverInputRef}
              type="file"
              accept={ACCEPTED_IMAGE_TYPES}
              onChange={handleCoverChange}
              disabled={readingCover || mutation.isPending}
              className="sr-only"
            />
          </label>
          {coverImageError && <p className="text-[11px] text-red-600">{coverImageError}</p>}
          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} disabled={mutation.isPending || readingCover} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:opacity-50">
              Cancelar
            </button>
            <button type="submit" disabled={!hasChanges || mutation.isPending || readingCover || Boolean(coverImageError)} className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 disabled:opacity-40 transition-colors">
              {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Salvar capa
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}