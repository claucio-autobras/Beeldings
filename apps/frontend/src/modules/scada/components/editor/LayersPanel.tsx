'use client';

import { useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, GripVertical, Layers, Lock, LockOpen, PackagePlus, X } from 'lucide-react';
import { useEditorStore } from '../../store/editor.store';
import type { Widget, WidgetType } from '../../types/scada.types';

const TYPE_LABELS: Partial<Record<WidgetType, string>> = {
  'label-static': 'Texto', 'section-title': 'Título', 'value-dynamic': 'Valor',
  'label-value-block': 'Label + Valor', 'led-status': 'LED', gauge: 'Gauge',
  'traffic-light': 'Semáforo', 'numeric-display': 'Display', 'trend-arrow': 'Tendência',
  'alarm-indicator': 'Alarme', 'alarm-counter': 'Contador', 'device-counter': 'Contador de Dispositivos',
  chiller: 'Chiller', pump: 'Bomba',
  ahu: 'UTA', fan: 'Ventilador', valve: 'Válvula', generator: 'Gerador', meter: 'Medidor',
  controller: 'Controladora', compressor: 'Compressor', 'cooling-tower': 'Torre', 'fan-coil': 'Fan Coil',
  'electrical-panel': 'Quadro', tank: 'Reservatório', sensor: 'Sensor', 'smoke-detector': 'Detector Incêndio',
  camera: 'Câmera CFTV', lighting: 'Iluminação',
  line: 'Linha', rectangle: 'Retângulo', square: 'Quadrado', circle: 'Círculo',
  ellipse: 'Elipse', triangle: 'Triângulo', 'titled-area': 'Área', separator: 'Separador',
  icon: 'Ícone', hotspot: 'Hotspot', 'nav-button': 'Botão Nav', 'nav-sidebar': 'Sidebar', 'nav-toolbar': 'Toolbar',
};

function widgetLabel(w: Widget): string {
  if ('labelText' in w && w.labelText) return w.labelText;
  if ('text' in w && w.text) return w.text;
  if ('label' in w && typeof w.label === 'string' && w.label) return w.label;
  if ('title' in w && w.title) return w.title;
  return TYPE_LABELS[w.type] ?? w.type;
}

export function LayersPanel() {
  const { screen, selectedIds, selectWidget, setSelection, reorderWidgets, saveComponent, updateWidget } = useEditorStore();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [dropAfter, setDropAfter] = useState(false);
  const [savingName, setSavingName] = useState<string | null>(null);
  const anchorRef = useRef<number | null>(null);

  function confirmSave() {
    if (savingName && savingName.trim()) saveComponent(savingName);
    setSavingName(null);
  }

  // Ordem visual: topo = trás (z-index menor), base = frente (z-index maior).
  const ordered = [...(screen?.widgets ?? [])].sort((a, b) => a.zIndex - b.zIndex);
  const orderIds = ordered.map((w) => w.id);

  function applyMove(id: string, dir: -1 | 1) {
    const idx = orderIds.indexOf(id);
    const ni = idx + dir;
    if (ni < 0 || ni >= orderIds.length) return;
    const next = [...orderIds];
    [next[idx], next[ni]] = [next[ni], next[idx]];
    reorderWidgets(next);
  }

  function handleRowClick(e: React.MouseEvent, id: string, index: number) {
    // Shift = intervalo a partir da âncora; Ctrl/Cmd = alterna; clique simples = único.
    if (e.shiftKey && anchorRef.current !== null) {
      const a = anchorRef.current;
      const [lo, hi] = a <= index ? [a, index] : [index, a];
      setSelection(orderIds.slice(lo, hi + 1));
      return;
    }
    if (e.ctrlKey || e.metaKey) selectWidget(id, true);
    else selectWidget(id, false);
    anchorRef.current = index;
  }

  function reset() { setDragId(null); setOverId(null); setDropAfter(false); }

  function handleDrop(targetId: string) {
    if (!dragId || dragId === targetId) { reset(); return; }
    const without = orderIds.filter((id) => id !== dragId);
    let idx = without.indexOf(targetId);
    if (idx === -1) { reset(); return; }
    if (dropAfter) idx += 1;
    without.splice(idx, 0, dragId);
    reorderWidgets(without);
    reset();
  }

  return (
    <aside className="flex min-h-0 flex-[2] flex-col border-t border-slate-700 bg-slate-800 overflow-hidden">
      <div className="shrink-0 flex items-center gap-2 border-b border-slate-700 px-4 py-3">
        <Layers className="h-3.5 w-3.5 text-slate-400" strokeWidth={1.5} />
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Camadas</p>
        <button
          type="button"
          disabled={selectedIds.length === 0}
          onClick={() => setSavingName('')}
          title="Salvar seleção como componente"
          className="ml-auto rounded p-1 text-slate-400 hover:bg-slate-700 hover:text-cyan-400 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
        >
          <PackagePlus className="h-3.5 w-3.5" strokeWidth={1.5} />
        </button>
      </div>

      {savingName !== null && (
        <div className="shrink-0 flex items-center gap-1.5 border-b border-slate-700 bg-slate-900/60 px-3 py-2">
          <input
            type="text"
            value={savingName}
            autoFocus
            onChange={(e) => setSavingName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') confirmSave(); if (e.key === 'Escape') setSavingName(null); }}
            placeholder="Nome do componente"
            className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500"
          />
          <button type="button" onClick={confirmSave} disabled={!savingName.trim()} title="Salvar" className="rounded p-1 text-cyan-400 hover:bg-slate-700 disabled:opacity-30">
            <Check className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => setSavingName(null)} title="Cancelar" className="rounded p-1 text-slate-400 hover:bg-slate-700">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-2">
        {ordered.length === 0 ? (
          <p className="px-4 py-6 text-center text-[11px] text-slate-500">Nenhum componente na tela</p>
        ) : (
          <ul className="px-2">
            {ordered.map((w, index) => {
              const selected = selectedIds.includes(w.id);
              const isOver = overId === w.id && dragId !== w.id;
              return (
                <li
                  key={w.id}
                  draggable
                  onDragStart={() => setDragId(w.id)}
                  onDragEnd={reset}
                  onDragOver={(e) => {
                    e.preventDefault();
                    const r = e.currentTarget.getBoundingClientRect();
                    setOverId(w.id);
                    setDropAfter(e.clientY > r.top + r.height / 2);
                  }}
                  onDrop={() => handleDrop(w.id)}
                  onClick={(e) => handleRowClick(e, w.id, index)}
                  className={`group flex items-center gap-1.5 rounded px-2 py-1.5 text-xs cursor-pointer transition-colors select-none ${
                    selected ? 'bg-cyan-600/20 text-cyan-300' : 'text-slate-300 hover:bg-slate-700'
                  } ${isOver ? (dropAfter ? 'border-b-2 border-cyan-500' : 'border-t-2 border-cyan-500') : ''}`}
                >
                  <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-slate-500 group-hover:text-slate-400" strokeWidth={1.5} />
                  <span className={`min-w-0 flex-1 truncate ${w.locked ? 'text-slate-500' : ''}`}>{widgetLabel(w)}</span>
                  <span className="shrink-0 text-[9px] uppercase tracking-wide text-slate-500">{TYPE_LABELS[w.type] ?? w.type}</span>
                  <button
                    type="button"
                    title={w.locked ? 'Destravar componente' : 'Travar componente'}
                    onClick={(e) => { e.stopPropagation(); updateWidget(w.id, { locked: !w.locked }); }}
                    className={`shrink-0 rounded p-0.5 transition-colors ${
                      w.locked
                        ? 'text-cyan-400 hover:bg-slate-600'
                        : 'text-slate-400 opacity-0 hover:bg-slate-600 hover:text-white group-hover:opacity-100'
                    }`}
                  >
                    {w.locked ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
                  </button>
                  <div className="flex shrink-0 items-center opacity-0 group-hover:opacity-100">
                    <button
                      type="button"
                      title="Mover para trás"
                      onClick={(e) => { e.stopPropagation(); applyMove(w.id, -1); }}
                      className="rounded p-0.5 text-slate-400 hover:bg-slate-600 hover:text-white"
                    >
                      <ChevronUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      title="Mover para frente"
                      onClick={(e) => { e.stopPropagation(); applyMove(w.id, 1); }}
                      className="rounded p-0.5 text-slate-400 hover:bg-slate-600 hover:text-white"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="shrink-0 border-t border-slate-700 px-4 py-2">
        <p className="text-[10px] text-slate-500">Topo = atrás · Base = frente · Ctrl/Shift+clique p/ vários</p>
      </div>
    </aside>
  );
}
