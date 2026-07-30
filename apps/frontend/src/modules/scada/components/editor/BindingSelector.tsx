'use client';

import { useState } from 'react';
import { Check, Link2, Loader2, Search, Unlink } from 'lucide-react';
import { useEditorStore } from '../../store/editor.store';
import { useScreenDevices } from '../../hooks/useScreenDevices';
import { useScreenTelemetry, formatTelemetryValue } from '../../hooks/useScreenTelemetry';
import { isCameraDevice, type ScreenDevice } from '../../types/virtual.types';

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

type AnyPoint = ScreenDevice['points'][number];

function pointType(p: AnyPoint): string {
  if ('objectType' in p) return String(p.objectType);
  if ('registerType' in p) return p.registerType.toUpperCase();
  return '';
}

/**
 * Unidade a anexar em valores analógicos. Só para pontos Modbus — os BACnet
 * mantêm a exibição sem unidade (comportamento anterior, sem regressão).
 */
function pointUnit(p: AnyPoint): string | undefined {
  if ('registerType' in p) return p.unit || undefined;
  return undefined;
}

export function BindingSelector({ deviceId, tag, onBind, onUnbind, cameraMode }: BindingProps) {
  const screen = useEditorStore((s) => s.screen);
  const { devices: allDevices, loading, gatewayId } = useScreenDevices(screen?.projectId, screen?.tenantId);
  const { getValue } = useScreenTelemetry(allDevices, allDevices.length > 0);
  const [search, setSearch] = useState('');

  // Widget de câmera: só câmeras CFTV; demais widgets: sem câmeras (universo BMS).
  const devices = cameraMode
    ? allDevices.filter(isCameraDevice)
    : allDevices.filter((d) => !isCameraDevice(d));

  const selectedDevice = devices.find((d) => d.id === deviceId);
  const filteredPoints = (selectedDevice?.points ?? []).filter((p) =>
    p.tag.toLowerCase().includes(search.toLowerCase()),
  );

  const isBound = Boolean(deviceId && tag);
  const boundPoint = isBound ? selectedDevice?.points.find((p) => p.tag === tag) : undefined;
  const boundValue = isBound
    ? formatTelemetryValue(
        getValue(deviceId, tag),
        boundPoint ? pointType(boundPoint) : undefined,
        boundPoint ? pointUnit(boundPoint) : undefined,
      )
    : '—';

  return (
    <div className="border-b border-slate-700/60 pb-4">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3">
        <Link2 className="h-3.5 w-3.5 text-cyan-400" strokeWidth={1.5} />
        <p className="text-[10px] font-semibold uppercase tracking-widest text-cyan-400">
          Binding de Ponto
        </p>
      </div>

      <div className="flex flex-col gap-2 px-4">
        {/* Estados de contexto */}
        {!screen?.projectId ? (
          <p className="rounded border border-amber-800/40 bg-amber-900/20 px-3 py-2 text-[11px] text-amber-300">
            Esta tela não está vinculada a um projeto — não há controladoras para vincular.
          </p>
        ) : loading && devices.length === 0 ? (
          <div className="flex items-center gap-2 px-1 py-2 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
            Carregando controladoras…
          </div>
        ) : devices.length === 0 ? (
          <p className="rounded border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] text-slate-400">
            {cameraMode
              ? 'Nenhuma câmera cadastrada no gateway deste projeto.'
              : `Nenhuma controladora cadastrada no gateway deste projeto${gatewayId ? ` (${gatewayId})` : ''}.`}
          </p>
        ) : (
          <>
            {/* Device selector */}
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">
                {cameraMode ? 'Câmera' : 'Controladora'}
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
                    {d.protocol === 'virtual'
                      ? `🧪 ${d.name} (Bancada de Testes)`
                      : `${d.name} (${d.protocol.toUpperCase()})`}
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
                      <li key={p.tag}>
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
                          <span className="shrink-0 text-[9px] text-slate-500">{pointType(p)}</span>
                          <span className="shrink-0 font-mono text-[10px] text-slate-400 tabular-nums">
                            {formatTelemetryValue(getValue(deviceId, p.tag), pointType(p), pointUnit(p))}
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
              <p className="font-mono text-xs text-slate-400 tabular-nums">
                Valor atual: {boundValue}
              </p>
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
