'use client';

import { createElement, useMemo, useState } from 'react';
import { ChevronDown, Search, Upload, X } from 'lucide-react';
import { useEditorStore } from '../../store/editor.store';
import { uploadScadaAsset } from '../../services/scada.service';
import { ICON_LIBRARY, getNavIcon, AssetIconImage } from '../widgets/scadaIcons';

/** Limite defensivo do arquivo enviado (ícones devem ser pequenos). */
const MAX_ICON_FILE_BYTES = 512 * 1024;

export interface IconPickerValue {
  iconName?: string;
  iconAssetUrl?: string;
}

interface Props {
  /** Nome do ícone atual (chave da biblioteca). */
  value: string;
  /** URL de imagem enviada (quando definida, tem precedência sobre o ícone). */
  assetUrl?: string;
  onChange: (patch: IconPickerValue) => void;
  /** Permite "sem ícone" (limpa iconName). */
  allowNone?: boolean;
  /** Mostra a opção "Enviar imagem" (PNG/JPG/SVG) via pipeline de assets SCADA. */
  allowUpload?: boolean;
}

/**
 * Seletor de ícone com grade de previews + busca, reutilizável em todos os
 * widgets que escolhem ícone (nav sidebar/toolbar/botão, hotspot, widget de
 * Ícone). Opcionalmente aceita upload de imagem do computador — o arquivo vai
 * para o pipeline de assets SCADA e só a URL fica no JSON da tela.
 */
export function IconPicker({ value, assetUrl, onChange, allowNone, allowUpload }: Props) {
  const tenantId = useEditorStore((s) => s.screen?.tenantId);
  const addToast = useEditorStore((s) => s.addToast);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [uploading, setUploading] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return ICON_LIBRARY;
    return ICON_LIBRARY.filter((e) =>
      e.name.toLowerCase().includes(q) || e.label.toLowerCase().includes(q) || (e.keywords ?? '').toLowerCase().includes(q));
  }, [query]);

  const current = ICON_LIBRARY.find((e) => e.name === value);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite reenviar o mesmo arquivo
    if (!file) return;
    if (file.size > MAX_ICON_FILE_BYTES) {
      addToast('error', 'Imagem muito grande para ícone (máx. 512 KB)');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      setUploading(true);
      try {
        const url = await uploadScadaAsset(dataUrl, tenantId);
        onChange({ iconAssetUrl: url });
        setOpen(false);
      } catch (err) {
        addToast('error', err instanceof Error ? err.message : 'Falha ao enviar imagem');
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200 outline-none transition-colors hover:border-cyan-500 focus:border-cyan-500"
      >
        {assetUrl ? (
          <AssetIconImage url={assetUrl} size={18} />
        ) : value ? (
          // Componentes da biblioteca são constantes de módulo — createElement evita
          // o falso positivo de "componente criado durante o render".
          <span className="shrink-0 text-slate-300">{createElement(getNavIcon(value), { size: 18, strokeWidth: 1.5 })}</span>
        ) : (
          <span className="h-[18px] w-[18px] shrink-0 rounded border border-dashed border-slate-600" />
        )}
        <span className="min-w-0 flex-1 truncate text-left">
          {assetUrl ? 'Imagem enviada' : current?.label ?? (value || '— sem ícone —')}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} strokeWidth={1.5} />
      </button>

      {open && (
        <div className="flex flex-col gap-2 rounded border border-slate-700 bg-slate-900 p-2">
          <div className="flex items-center gap-1.5 rounded border border-slate-700 bg-slate-800 px-2 py-1">
            <Search className="h-3 w-3 shrink-0 text-slate-500" strokeWidth={1.5} />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar ícone…"
              autoFocus
              className="min-w-0 flex-1 bg-transparent text-xs text-slate-200 outline-none placeholder:text-slate-500"
            />
            {query && (
              <button type="button" onClick={() => setQuery('')} className="text-slate-500 hover:text-slate-300">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="grid max-h-44 grid-cols-6 gap-1 overflow-y-auto pr-0.5">
            {allowNone && !query && (
              <button
                type="button"
                title="Sem ícone"
                onClick={() => { onChange({ iconName: '', iconAssetUrl: '' }); setOpen(false); }}
                className={`flex h-8 items-center justify-center rounded border text-slate-500 transition-colors ${!value && !assetUrl ? 'border-cyan-400 bg-cyan-500/10' : 'border-slate-700 hover:border-cyan-500'}`}
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.5} />
              </button>
            )}
            {filtered.map(({ name, label, Icon }) => (
              <button
                key={name}
                type="button"
                title={label}
                onClick={() => { onChange({ iconName: name, iconAssetUrl: '' }); setOpen(false); }}
                className={`flex h-8 items-center justify-center rounded border transition-colors ${name === value && !assetUrl ? 'border-cyan-400 bg-cyan-500/10 text-cyan-300' : 'border-slate-700 text-slate-300 hover:border-cyan-500 hover:text-cyan-300'}`}
              >
                <Icon size={16} strokeWidth={1.5} />
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="col-span-6 py-2 text-center text-[10px] text-slate-500">Nenhum ícone encontrado</p>
            )}
          </div>

          {allowUpload && (
            <label className={`flex items-center justify-center gap-2 rounded border border-dashed border-slate-600 py-1.5 text-[11px] text-slate-300 transition-colors ${uploading ? 'pointer-events-none opacity-60' : 'cursor-pointer hover:border-cyan-500 hover:text-cyan-400'}`}>
              <Upload className="h-3 w-3" strokeWidth={1.5} />
              {uploading ? 'Enviando…' : 'Enviar imagem (PNG/JPG/SVG)'}
              <input
                type="file"
                accept=".png,.jpg,.jpeg,.svg,image/png,image/jpeg,image/svg+xml"
                onChange={onFile}
                disabled={uploading}
                className="hidden"
              />
            </label>
          )}
        </div>
      )}

      {allowUpload && assetUrl && (
        <button
          type="button"
          onClick={() => onChange({ iconAssetUrl: '' })}
          className="rounded border border-slate-700 py-1 text-[11px] text-slate-400 transition-colors hover:border-red-500 hover:text-red-400"
        >
          Remover imagem (voltar ao ícone)
        </button>
      )}
    </div>
  );
}
