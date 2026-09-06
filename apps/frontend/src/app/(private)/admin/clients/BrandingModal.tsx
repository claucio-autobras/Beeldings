'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, Palette, Trash2, Upload } from 'lucide-react';
import {
  resolveTenantLogoUrl,
  updateTenantBranding,
  type TenantBrandingDto,
} from '@/modules/tenants/services/tenants.service';

/**
 * Paleta curada de cores de destaque — tons médios/escuros que funcionam como
 * acento (linha, brilho, badge) nos temas claro e escuro sem problema de
 * contraste, já que a cor nunca fica atrás de texto.
 */
const ACCENT_PALETTE = [
  '#0e7490', // ciano
  '#1d4ed8', // azul
  '#4f46e5', // índigo
  '#7c3aed', // violeta
  '#be185d', // rosa
  '#dc2626', // vermelho
  '#ea580c', // laranja
  '#ca8a04', // âmbar
  '#16a34a', // verde
  '#0d9488', // teal
  '#475569', // grafite
];

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

interface BrandingModalProps {
  tenant: { id: string; name: string; logoUrl?: string | null; accentColor?: string | null };
  onClose: () => void;
}

export function BrandingModal({ tenant, onClose }: BrandingModalProps) {
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  // Estado editável: undefined = sem alteração; null = remover.
  const [name, setName] = useState(tenant.name);
  const [logoDataUrl, setLogoDataUrl] = useState<string | null | undefined>(undefined);
  const [accentColor, setAccentColor] = useState<string | null>(tenant.accentColor ?? null);

  const currentLogo =
    logoDataUrl !== undefined ? logoDataUrl : resolveTenantLogoUrl(tenant.logoUrl);

  const mutation = useMutation({
    mutationFn: (dto: TenantBrandingDto) => updateTenantBranding(tenant.id, dto),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tenants'] });
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  function handleFile(file: File) {
    setError(null);
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Formato não suportado. Use PNG, JPG, WebP ou SVG.');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError('Imagem muito grande. O limite é 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setLogoDataUrl(reader.result as string);
    reader.onerror = () => setError('Não foi possível ler o arquivo.');
    reader.readAsDataURL(file);
  }

  function handleSave() {
    setError(null);
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setError('O nome do cliente não pode ficar vazio.');
      return;
    }
    const dto: TenantBrandingDto = {};
    if (trimmedName !== tenant.name) dto.name = trimmedName;
    if (logoDataUrl !== undefined) dto.logoDataUrl = logoDataUrl;
    if ((accentColor ?? null) !== (tenant.accentColor ?? null)) dto.accentColor = accentColor;
    if (Object.keys(dto).length === 0) {
      onClose();
      return;
    }
    mutation.mutate(dto);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-card rounded-xl shadow-xl w-full max-w-lg border border-slate-200 max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-slate-900">Identidade do cliente</h2>
            <p className="text-xs text-slate-500 mt-0.5">{tenant.name}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">
            &times;
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 flex-1 overflow-y-auto">
          {/* Nome */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Nome</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome do cliente"
              className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
            />
            <p className="mt-1.5 text-[11px] text-slate-400">O identificador (slug) não muda ao renomear.</p>
          </div>

          {/* Logo */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Logotipo</label>
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-slate-200">
                {currentLogo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={currentLogo} alt="Logo" className="h-full w-full object-contain p-1.5" />
                ) : (
                  <Palette className="h-6 w-6 text-slate-300" />
                )}
              </div>
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {currentLogo ? 'Trocar logo' : 'Enviar logo'}
                </button>
                {currentLogo && (
                  <button
                    type="button"
                    onClick={() => setLogoDataUrl(null)}
                    className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Remover logo
                  </button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept={ACCEPTED_TYPES.join(',')}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = '';
                }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">PNG, JPG, WebP ou SVG · até 2 MB · fundo transparente fica melhor.</p>
          </div>

          {/* Cor de destaque */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Cor de destaque</label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setAccentColor(null)}
                title="Sem cor"
                className={`flex h-7 w-7 items-center justify-center rounded-full border text-[10px] text-slate-400 transition-all ${
                  accentColor === null ? 'border-slate-500 ring-2 ring-slate-300' : 'border-slate-200 hover:border-slate-400'
                }`}
              >
                &empty;
              </button>
              {ACCENT_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setAccentColor(c)}
                  title={c}
                  className={`h-7 w-7 rounded-full transition-all ${
                    accentColor === c ? 'ring-2 ring-offset-2 ring-slate-400 scale-110' : 'hover:scale-110'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* Pré-visualização */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Pré-visualização (topbar)</label>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 flex justify-center">
              <div className="flex items-center gap-2.5">
                {currentLogo && (
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200/80"
                    style={accentColor ? { boxShadow: `0 0 0 1px ${accentColor}33, 0 1px 2px 0 rgb(0 0 0 / 0.05)` } : undefined}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={currentLogo} alt="" className="h-full w-full object-contain p-1" />
                  </div>
                )}
                <div className="min-w-0 flex flex-col items-start">
                  <span className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.14em] leading-none text-slate-400">
                    {accentColor && (
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: accentColor, boxShadow: `0 0 6px ${accentColor}99` }}
                      />
                    )}
                    Cliente
                  </span>
                  <span className="mt-0.5 max-w-[220px] truncate text-[15px] font-semibold leading-tight tracking-tight text-slate-800">
                    {name.trim() || tenant.name}
                  </span>
                  <span
                    className="mt-1 h-px w-full rounded-full"
                    style={{
                      background: accentColor
                        ? `linear-gradient(90deg, ${accentColor} 0%, ${accentColor}66 60%, transparent 100%)`
                        : 'linear-gradient(90deg, #e2e8f0 0%, transparent 100%)',
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">{error}</p>
          )}
        </div>

        <div className="flex gap-3 px-6 py-4 border-t border-slate-100 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={handleSave}
            className="flex-1 rounded-md bg-cyan-700 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-800 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
          >
            {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Salvar
          </button>
        </div>
      </div>
    </div>
  );
}
