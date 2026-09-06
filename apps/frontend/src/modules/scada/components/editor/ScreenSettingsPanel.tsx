'use client';

import { useRef, useState } from 'react';
import { ImageOff, X } from 'lucide-react';
import { useEditorStore } from '../../store/editor.store';
import { resolveAssetUrl, uploadScadaAsset } from '../../services/scada.service';

interface Props {
  onClose: () => void;
}

export function ScreenSettingsPanel({ onClose }: Props) {
  const { screen, updateSettings, addToast } = useEditorStore();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  if (!screen) return null;
  const s = screen.settings;
  const tenantId = screen.tenantId;

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      // Sobe ao backend e guarda só a URL — o JSON da tela não carrega a imagem.
      setUploading(true);
      try {
        const url = await uploadScadaAsset(dataUrl, tenantId);
        updateSettings({ backgroundImage: url });
      } catch (err) {
        addToast('error', err instanceof Error ? err.message : 'Falha ao enviar imagem');
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="absolute right-4 top-14 z-50 w-72 rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
        <p className="text-xs font-semibold text-slate-200">Configurações da Tela</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          aria-label="Fechar"
        >
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>

      <div className="flex flex-col gap-4 p-4">
        {/* Background color */}
        <label className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">Cor de fundo</span>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={s.backgroundColor}
              onChange={(e) => updateSettings({ backgroundColor: e.target.value })}
              className="h-8 w-8 shrink-0 cursor-pointer rounded border border-slate-700 bg-transparent p-0.5"
            />
            <input
              type="text"
              value={s.backgroundColor}
              onChange={(e) => updateSettings({ backgroundColor: e.target.value })}
              className="flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-cyan-500"
            />
          </div>
        </label>

        {/* Grid opacity */}
        <label className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">
              Opacidade do grid
            </span>
            <span className="text-[10px] text-slate-400 tabular-nums">
              {Math.round(s.gridOpacity * 100)}%
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={s.gridOpacity}
            onChange={(e) => updateSettings({ gridOpacity: parseFloat(e.target.value) })}
            className="w-full accent-cyan-500"
          />
        </label>

        {/* Background image */}
        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] uppercase tracking-wider text-slate-500">
            Imagem de fundo
          </span>
          {s.backgroundImage ? (
            <div className="flex flex-col gap-2">
              <div
                className="h-20 w-full rounded border border-slate-700 bg-cover bg-center"
                style={{ backgroundImage: `url(${resolveAssetUrl(s.backgroundImage)})` }}
              />
              <button
                type="button"
                onClick={() => updateSettings({ backgroundImage: undefined })}
                className="flex items-center justify-center gap-1.5 rounded border border-slate-700 py-1.5 text-xs text-slate-400 hover:border-red-500 hover:text-red-400 transition-colors"
              >
                <ImageOff className="h-3.5 w-3.5" strokeWidth={1.5} />
                Remover imagem
              </button>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="rounded border border-dashed border-slate-600 px-3 py-3 text-xs text-slate-400 hover:border-cyan-500 hover:text-cyan-400 transition-colors text-center disabled:pointer-events-none disabled:opacity-60"
              >
                {uploading ? (
                  'Enviando…'
                ) : (
                  <>
                    Clique para enviar imagem
                    <br />
                    <span className="text-[10px] text-slate-600">.png .svg .jpg .jpeg .webp</span>
                  </>
                )}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".png,.svg,.jpg,.jpeg,.webp"
                className="hidden"
                onChange={handleImageUpload}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
