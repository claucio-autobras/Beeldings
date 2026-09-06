'use client';

import { useState } from 'react';
import { Check, Loader2, Search, Unlink } from 'lucide-react';
import { useEditorStore } from '../../store/editor.store';
import { useScreenDevices } from '../../hooks/useScreenDevices';
import { useScreenTelemetry } from '../../hooks/useScreenTelemetry';
import { isCameraDevice } from '../../types/virtual.types';
import {
  dedupePointsByTag,
  deviceOptionLabel,
  formatPointValue,
  pointBadgeLabel,
} from './bindingSelectorOptions';

interface BindingProps {
  deviceId: string;
  tag: string;
  onBind: (deviceId: string, tag: string) => void;
  onUnbind: () => void;
  /**
   * Modo câmera (widget de câmera CFTV): lista apenas câmeras e, ao escolher
   * uma, o ponto é resolvido automaticamente (STATUS) — sem seleção de ponto.
   */
  cameraMode?: boolean;
}

export function BindingSelector({ deviceId, tag, onBind, onUnbind, cameraMode }: BindingProps) {
  const screen = useEditorStore((s) => s.screen);
  const { devices: allDevices, loading, gatewayId } = useScreenDevices(screen?.projectId, screen?.tenantId);
  const { getValue } = useScreenTelemetry(allDevices, allDevices.length > 0);
  const [search, setSearch] = useState('');

  // Widget de câmera: só câmeras CFTV. Demais widgets: TODOS os equipamentos
  // do gateway, câmeras inclusive (rótulo distingue o tipo de monitoramento;
  // deviceOptionLabel) — o vínculo genérico deixou de excluir câmeras.
  const devices = cameraMode ? allDevices.filter(isCameraDevice) : allDevices;

  const selectedDevice = devices.find((d) => d.id === deviceId);
  // Descarta pontos com tag duplicada (registros legados ainda não
  // higienizados no cadastro) — nunca gera `key` React repetida nem mostra o
  // mesmo ponto duas vezes.
  const devicePoints = dedupePointsByTag(selectedDevice?.points ?? []);
  const filteredPoints = devicePoints.filter((p) =>
    p.tag.toLowerCase().includes(search.toLowerCase()),
  );

  const isBound = Boolean(deviceId && tag);
  const boundPoint = isBound ? devicePoints.find((p) => p.tag === tag) : undefined;
  // Ponto salvo pode não existir mais no equipamento selecionado (tela salva
  // por versão antiga, ou o widget foi repontado para outro equipamento sem
  // desvincular primeiro) — nunca deixa o valor "vazar" de outro ponto.
  const boundPointMissing = isBound && Boolean(selectedDevice) && !boundPoint;
  const boundValue = isBound && boundPoint ? formatPointValue(boundPoint, getValue(deviceId, tag)) : '—';

  return (
    <div className="pb-4">
      <div className="flex flex-col gap-2 px-4 pt-2">
        {/* Estados de contexto */}
        {!screen?.projectId ? (
          <p className="rounded border border-amber-800/40 bg-amber-900/20 px-3 py-2 text-[11px] text-amber-300">
            Esta tela não está vinculada a um gateway — não há equipamentos para vincular.
          </p>
        ) : loading && devices.length === 0 ? (
          <div className="flex items-center gap-2 px-1 py-2 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
            Carregando equipamentos…
          </div>
        ) : devices.length === 0 ? (
          <p className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] text-slate-400">
            {cameraMode
              ? 'Nenhuma câmera cadastrada neste gateway.'
              : `Nenhum equipamento cadastrado neste gateway${gatewayId ? ` (${gatewayId})` : ''}.`}
          </p>
        ) : (
          <>
            {/* Device selector */}
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">
                {cameraMode ? 'Câmera' : 'Controladora / equipamento'}
              </span>
              <select
                value={deviceId}
                onChange={(e) => {
                  // Câmera: ponto resolvido automaticamente (STATUS) — binding em 1 passo.
                  onBind(e.target.value, cameraMode && e.target.value ? 'STATUS' : '');
                  setSearch('');
                }}
                className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500"
              >
                <option value="">— selecionar —</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {deviceOptionLabel(d)}
                  </option>
                ))}
              </select>
            </label>

            {cameraMode && selectedDevice && (
              <p className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] text-slate-400">
                Estado, telemetria e popup são resolvidos automaticamente a partir
                dos pontos da câmera.
              </p>
            )}

            {/* Point list */}
            {!cameraMode && selectedDevice && (
              <>
                <label className="flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500">Ponto</span>
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" strokeWidth={1.5} />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Buscar ponto..."
                      className="w-full rounded border border-slate-700 bg-slate-900 py-1 pl-6 pr-2 text-xs text-slate-200 placeholder-slate-600 outline-none focus:border-cyan-500"
                    />
                  </div>
                </label>

                <ul className="max-h-40 overflow-y-auto rounded border border-slate-700 bg-slate-900">
                  {filteredPoints.length === 0 && (
                    <li className="px-3 py-2 text-xs text-slate-600">Nenhum ponto encontrado</li>
                  )}
                  {filteredPoints.map((p) => {
                    const isSelected = p.tag === tag;
                    return (
                      <li key={p.id}>
                        <button
                          type="button"
                          onClick={() => onBind(deviceId, p.tag)}
                          className={[
                            'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors',
                            isSelected ? 'bg-cyan-900/40 text-cyan-300' : 'text-slate-300 hover:bg-slate-800',
                          ].join(' ')}
                        >
                          {isSelected
                            ? <Check className="h-3 w-3 shrink-0 text-cyan-400" strokeWidth={2} />
                            : <span className="h-3 w-3 shrink-0" />}
                          <span className="flex-1 truncate text-xs">{p.tag}</span>
                          <span className="shrink-0 text-[9px] text-slate-500">{pointBadgeLabel(p)}</span>
                          <span className="shrink-0 font-mono text-[10px] text-slate-400 tabular-nums">
                            {formatPointValue(p, getValue(deviceId, p.tag))}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </>
        )}

        {/* Bound indicator */}
        {isBound && (
          <div className="flex items-center justify-between rounded bg-cyan-900/20 border border-cyan-800/40 px-3 py-2">
            <div className="min-w-0">
              <p className="text-[10px] text-cyan-400">Vinculado</p>
              <p className="truncate text-xs font-medium text-slate-200">{tag}</p>
              {boundPointMissing ? (
                <p className="text-[11px] text-amber-400">
                  Este ponto não existe mais no equipamento selecionado.
                </p>
              ) : (
                <p className="font-mono text-xs text-slate-400 tabular-nums">
                  Valor atual: {boundValue}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onUnbind}
              className="ml-2 shrink-0 flex items-center gap-1 rounded px-2 py-1 text-[10px] text-slate-400 hover:bg-slate-700 hover:text-white transition-colors"
            >
              <Unlink className="h-3 w-3" strokeWidth={1.5} />
              Desvincular
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
