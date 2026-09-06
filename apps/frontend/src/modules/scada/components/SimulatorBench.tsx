'use client';

import { useState } from 'react';
import { Loader2, Plus, Trash2, X } from 'lucide-react';
import { useVirtualBench } from '../hooks/useVirtualBench';
import { VirtualPointControl } from './VirtualPointControl';
import type { NewVirtualPoint, VirtualKind, VirtualState } from '../types/virtual.types';

interface Props {
  projectId: string;
  tenantId?: string;
  onClose: () => void;
}

const KIND_OPTS: { value: VirtualKind; label: string }[] = [
  { value: 'analog', label: 'Analógico' },
  { value: 'digital', label: 'Digital (ON/OFF)' },
  { value: 'multistate', label: 'Multistate' },
];

/**
 * Modal (tema claro) da Bancada de Testes: cria, lista e edita pontos virtuais
 * de um projeto. Os valores alterados aqui refletem ao vivo nos widgets/alarmes/
 * trends vinculados, sem afetar a produção.
 */
export function SimulatorBench({ projectId, tenantId, onClose }: Props) {
  const { points, loading, ready, ensureError, retryEnsure, addPoints, setValue, removePoint } = useVirtualBench(projectId, tenantId);

  const [tag, setTag] = useState('');
  const [kind, setKind] = useState<VirtualKind>('analog');
  const [unit, setUnit] = useState('');
  const [statesText, setStatesText] = useState('Desligado, Baixa, Alta');
  // Confirmação simples (sem senha) antes de remover um ponto virtual.
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);

  const sorted = [...points].sort((a, b) => a.tag.localeCompare(b.tag));

  function handleAdd() {
    const cleanTag = tag.trim();
    if (!cleanTag) return;

    const point: NewVirtualPoint = { tag: cleanTag, kind, unit: unit.trim() || undefined };
    if (kind === 'multistate') {
      const states: VirtualState[] = statesText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((label, i) => ({ value: i, label }));
      if (states.length < 2) return;
      point.states = states;
    }
    addPoints.mutate([point], {
      onSuccess: () => {
        setTag('');
        setUnit('');
      },
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">Bancada de Testes</h2>
            <p className="text-[11px] text-slate-500">Pontos virtuais — simulam telemetria sem hardware real.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <div className="border-b border-slate-200 bg-slate-50 px-5 py-3">
          {ensureError && (
            <div className="mb-3 flex items-center justify-between gap-3 rounded border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-[11px] text-red-600">
                Não foi possível carregar a bancada: {ensureError.message}
              </p>
              <button
                type="button"
                onClick={retryEnsure}
                className="shrink-0 rounded bg-red-600 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-red-700"
              >
                Tentar novamente
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">Tag</span>
              <input
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                placeholder="TEMP_SALA"
                className="w-40 rounded border border-slate-300 bg-card px-2 py-1 text-xs text-foreground outline-none focus:border-cyan-500"
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">Tipo</span>
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as VirtualKind)}
                className="rounded border border-slate-300 bg-card px-2 py-1 text-xs text-foreground outline-none focus:border-cyan-500"
              >
                {KIND_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            {kind !== 'digital' && kind !== 'multistate' && (
              <label className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wider text-slate-500">Unidade</span>
                <input
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="°C"
                  className="w-20 rounded border border-slate-300 bg-card px-2 py-1 text-xs text-foreground outline-none focus:border-cyan-500"
                />
              </label>
            )}
            {kind === 'multistate' && (
              <label className="flex flex-1 flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-wider text-slate-500">Estados (separados por vírgula)</span>
                <input
                  value={statesText}
                  onChange={(e) => setStatesText(e.target.value)}
                  placeholder="Desligado, Baixa, Alta"
                  className="w-full rounded border border-slate-300 bg-card px-2 py-1 text-xs text-foreground outline-none focus:border-cyan-500"
                />
              </label>
            )}
            <button
              type="button"
              onClick={handleAdd}
              disabled={!ready || addPoints.isPending || !tag.trim()}
              className="inline-flex items-center gap-1 rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
            >
              {addPoints.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Adicionar
            </button>
          </div>
          {addPoints.isError && (
            <p className="mt-2 text-[11px] text-red-600">{(addPoints.error as Error).message}</p>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading ? (
            <div className="flex items-center gap-2 py-6 text-xs text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando…
            </div>
          ) : sorted.length === 0 ? (
            <p className="py-6 text-center text-xs text-slate-400">Nenhum ponto virtual ainda. Crie o primeiro acima.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-slate-100">
              {sorted.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-foreground">{p.tag}</p>
                    <p className="text-[10px] text-slate-400">{p.objectType} · {p.kind}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <VirtualPointControl
                      point={p}
                      disabled={setValue.isPending}
                      onChange={(value) => setValue.mutate({ pointId: p.id, value })}
                    />
                    {confirmRemoveId === p.id ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-500">Remover?</span>
                        <button
                          type="button"
                          onClick={() =>
                            removePoint.mutate(p.id, { onSettled: () => setConfirmRemoveId(null) })
                          }
                          disabled={removePoint.isPending}
                          className="flex items-center gap-1 rounded bg-red-600 px-2 py-0.5 text-[10px] font-medium text-white hover:bg-red-700 disabled:opacity-50"
                        >
                          {removePoint.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
                          Sim
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmRemoveId(null)}
                          disabled={removePoint.isPending}
                          className="rounded border border-slate-300 px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                        >
                          Não
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveId(p.id)}
                        disabled={removePoint.isPending}
                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
