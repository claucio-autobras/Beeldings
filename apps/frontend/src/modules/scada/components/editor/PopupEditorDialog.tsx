'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Copy, Layers, Lock, LockOpen, Move, Redo2, Trash2, Undo2, X } from 'lucide-react';
import { nanoid } from 'nanoid';
import type { PolygonWidget, ScadaPopupConfig, SavedComponent, Widget, WidgetType } from '../../types/scada.types';
import {
  normalizeScadaPopup,
  normalizeScadaPopupWidth,
  normalizeScadaPopupHeight,
  SCADA_POPUP_MIN_WIDTH,
  SCADA_POPUP_MAX_WIDTH,
  SCADA_POPUP_MIN_HEIGHT,
  SCADA_POPUP_MAX_HEIGHT,
  scaleScadaPolygonPoints,
} from '../../types/scada.types';
import type { ScreenDevice } from '../../types/virtual.types';
import { buildDefaultWidget } from './widgetDefaults';
import { WidgetRenderer } from '../widgets/WidgetRenderer';
import { PopupWidgetProperties, PropertyCategory } from './PropertiesPanel';
import {
  SCADA_WIDGET_DEFAULT_SIZES,
  WidgetPalette,
} from './WidgetPalette';

interface Props {
  popup: ScadaPopupConfig;
  onSave: (popup: ScadaPopupConfig) => void;
  onCancel: () => void;
  devices: ScreenDevice[];
  screen: { projectId?: string; tenantId: string };
  screenOpts: { value: string; label: string }[];
  components: SavedComponent[];
  onDeleteComponent: (id: string) => void;
}

interface DragState {
  id: string;
  startX: number;
  startY: number;
  x: number;
  y: number;
}

function cloneWidgets(widgets: Widget[]): Widget[] {
  return JSON.parse(JSON.stringify(widgets)) as Widget[];
}

/** Cópias de popup são independentes e nunca carregam uma composição filha. */
function remapPopupWidgets(widgets: Widget[]): Widget[] {
  return widgets.map((source) => {
    const copy = { ...source, id: `w-popup-${nanoid(8)}` } as Widget;
    delete copy.popup;
    if (copy.type === 'component-instance') {
      copy.children = remapPopupWidgets(copy.children);
    }
    return copy;
  });
}

function stripNestedPopupWidgets(widgets: Widget[]): Widget[] {
  return widgets.map((source) => {
    const copy = { ...source } as Widget;
    delete copy.popup;
    if (copy.type === 'component-instance') {
      copy.children = stripNestedPopupWidgets(copy.children);
    }
    return copy;
  });
}

function labelOf(widget: Widget): string {
  if (widget.editorLabel?.trim()) return widget.editorLabel.trim();
  if (widget.type === 'component-instance' && widget.componentName) return widget.componentName;
  if ('labelText' in widget && widget.labelText) return widget.labelText;
  if ('text' in widget && widget.text) return widget.text;
  if ('label' in widget && typeof widget.label === 'string' && widget.label) return widget.label;
  if ('title' in widget && widget.title) return widget.title;
  return widget.type;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function PopupEditorDialog({
  popup, onSave, onCancel, devices, screen, screenOpts, components, onDeleteComponent,
}: Props) {
  const first = normalizeScadaPopup(popup) ?? popup;
  const [draft, setDraft] = useState<ScadaPopupConfig>(() => ({ ...first, widgets: cloneWidgets(first.widgets) }));
  const draftRef = useRef(draft);
  const [history, setHistory] = useState<Widget[][]>(() => [cloneWidgets(first.widgets)]);
  const historyRef = useRef(history);
  const [historyIndex, setHistoryIndex] = useState(0);
  const historyIndexRef = useRef(0);
  const [selectedIds, setSelectedIds] = useState<string[]>(first.widgets[0] ? [first.widgets[0].id] : []);
  const [clipboard, setClipboard] = useState<Widget[]>([]);
  const dragRef = useRef<DragState | null>(null);
  const resizeRef = useRef<{ id: string; startX: number; startY: number; width: number; height: number } | null>(null);
  const [dragLayerId, setDragLayerId] = useState<string | null>(null);
  const [overLayerId, setOverLayerId] = useState<string | null>(null);
  const [dropAfter, setDropAfter] = useState(false);
  const [pipeDraw, setPipeDraw] = useState(false);
  const [pipePoints, setPipePoints] = useState<{ x: number; y: number }[]>([]);
  const [polygonDraw, setPolygonDraw] = useState(false);
  const [polygonPoints, setPolygonPoints] = useState<{ x: number; y: number }[]>([]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<string | null>(null);

  const selected = draft.widgets.find((widget) => widget.id === selectedIds[0]) ?? null;

  function setDraftLatest(next: ScadaPopupConfig) {
    draftRef.current = next;
    setDraft(next);
  }

  function updateDimensions(patch: Partial<Pick<ScadaPopupConfig, 'width' | 'height'>>) {
    const current = draftRef.current;
    setDraftLatest({
      ...current,
      width: patch.width === undefined ? current.width : normalizeScadaPopupWidth(patch.width),
      height: patch.height === undefined ? current.height : normalizeScadaPopupHeight(patch.height),
    });
  }

  function updateTransientWidgets(updater: (widgets: Widget[]) => Widget[]) {
    const current = draftRef.current;
    setDraftLatest({ ...current, widgets: updater(current.widgets) });
  }

  function commitWidgets(widgets: Widget[]) {
    const clean = stripNestedPopupWidgets(cloneWidgets(widgets));
    const next = { ...draftRef.current, widgets: clean };
    setDraftLatest(next);
    const nextHistory = [...historyRef.current.slice(0, historyIndexRef.current + 1), cloneWidgets(clean)];
    historyRef.current = nextHistory;
    historyIndexRef.current = nextHistory.length - 1;
    setHistory(nextHistory);
    setHistoryIndex(nextHistory.length - 1);
  }

  function updateSelected(patch: Partial<Widget>) {
    if (!selectedIds[0]) return;
    updateWidgetById(selectedIds[0], patch);
  }

  function updateWidgetById(id: string, patch: Partial<Widget>) {
    const current = draftRef.current.widgets.find((widget) => widget.id === id);
    if (!current) return;
    const width = clamp(Number(patch.width ?? current.width), 10, draftRef.current.width - current.x);
    const height = clamp(Number(patch.height ?? current.height), 10, draftRef.current.height - current.y);
    const geometry = current.type === 'polygon' && (patch.width !== undefined || patch.height !== undefined)
      ? { points: scaleScadaPolygonPoints(current.points, current.width, current.height, width, height) }
      : {};
    const bounded = {
      ...patch,
      width,
      height,
      ...geometry,
      x: clamp(Number(patch.x ?? current.x), 0, Math.max(0, draftRef.current.width - width)),
      y: clamp(Number(patch.y ?? current.y), 0, Math.max(0, draftRef.current.height - height)),
    } as Partial<Widget>;
    updateTransientWidgets((widgets) => widgets.map((widget) =>
      widget.id === id ? ({ ...widget, ...bounded } as Widget) : widget,
    ));
    // Property controls are individual edits and should each be undoable.
    commitWidgets(draftRef.current.widgets);
  }

  function updateComponentChild(instanceId: string, childId: string, patch: Partial<Widget>) {
    const instance = draftRef.current.widgets.find((widget) => widget.id === instanceId);
    if (!instance || instance.type !== 'component-instance') return;
    const safePatch = { ...patch } as Partial<Widget> & Record<string, unknown>;
    delete safePatch.x;
    delete safePatch.y;
    delete safePatch.width;
    delete safePatch.height;
    const update = (children: Widget[]): Widget[] => children.map((child) => {
      if (child.id === childId) return { ...child, ...safePatch } as Widget;
      if (child.type === 'component-instance') return { ...child, children: update(child.children) };
      return child;
    });
    updateWidgetById(instanceId, { children: update(instance.children) } as Partial<Widget>);
  }

  function addWidget(type: WidgetType, width: number, height: number, overrides?: Partial<Widget>, anchor?: { x: number; y: number }) {
    const point = anchor
      ? { x: anchor.x, y: anchor.y }
      : { x: (draftRef.current.width - width) / 2, y: (draftRef.current.height - height) / 2 };
    const x = clamp(Math.round(point.x / 10) * 10, 0, Math.max(0, draftRef.current.width - width));
    const y = clamp(Math.round(point.y / 10) * 10, 0, Math.max(0, draftRef.current.height - height));
    const widget = buildDefaultWidget(type, x, y, width, height);
    const next = overrides ? ({ ...widget, ...overrides } as Widget) : widget;
    commitWidgets([...draftRef.current.widgets, next]);
    setSelectedIds([next.id]);
  }

  function insertComponent(componentId: string, anchor?: { x: number; y: number }) {
    const component = components.find((item) => item.id === componentId);
    if (!component) return;
    const x = clamp(Math.round((anchor?.x ?? (draftRef.current.width - component.width) / 2) / 10) * 10, 0, Math.max(0, draftRef.current.width - component.width));
    const y = clamp(Math.round((anchor?.y ?? (draftRef.current.height - component.height) / 2) / 10) * 10, 0, Math.max(0, draftRef.current.height - component.height));
    const instance: Widget = {
      id: `w-popup-${nanoid(8)}`,
      type: 'component-instance',
      x, y, width: component.width, height: component.height,
      opacity: 1, visible: true,
      zIndex: Math.max(0, ...draftRef.current.widgets.map((item) => item.zIndex)) + 1,
      visibility: { mode: 'always' },
      componentId: component.id,
      componentName: component.name,
      children: remapPopupWidgets(cloneWidgets(component.widgets)),
    } as Widget;
    commitWidgets([...draftRef.current.widgets, instance]);
    setSelectedIds([instance.id]);
  }

  function duplicateSelected() {
    if (!selected) return;
    const copy = remapPopupWidgets([selected])[0];
    const next = {
      ...copy,
      x: clamp(selected.x + 20, 0, Math.max(0, draftRef.current.width - selected.width)),
      y: clamp(selected.y + 20, 0, Math.max(0, draftRef.current.height - selected.height)),
      zIndex: Math.max(0, ...draftRef.current.widgets.map((item) => item.zIndex)) + 1,
    } as Widget;
    commitWidgets([...draftRef.current.widgets, next]);
    setSelectedIds([next.id]);
  }

  function pasteClipboard() {
    if (!clipboard.length) return;
    const copies = remapPopupWidgets(clipboard).map((item, index) => ({
      ...item,
      x: clamp(item.x + 20, 0, Math.max(0, draftRef.current.width - item.width)),
      y: clamp(item.y + 20, 0, Math.max(0, draftRef.current.height - item.height)),
      zIndex: Math.max(0, ...draftRef.current.widgets.map((widget) => widget.zIndex)) + index + 1,
    }));
    commitWidgets([...draftRef.current.widgets, ...copies]);
    setSelectedIds(copies.map((item) => item.id));
  }

  function copySelected() {
    const copies = draftRef.current.widgets.filter((widget) => selectedIds.includes(widget.id));
    if (copies.length) setClipboard(cloneWidgets(copies));
  }

  function undo() {
    if (historyIndexRef.current <= 0) return;
    const nextIndex = historyIndexRef.current - 1;
    historyIndexRef.current = nextIndex;
    setHistoryIndex(nextIndex);
    setDraftLatest({ ...draftRef.current, widgets: cloneWidgets(historyRef.current[nextIndex]) });
    setSelectedIds((ids) => ids.filter((id) => historyRef.current[nextIndex].some((widget) => widget.id === id)));
  }

  function redo() {
    if (historyIndexRef.current >= historyRef.current.length - 1) return;
    const nextIndex = historyIndexRef.current + 1;
    historyIndexRef.current = nextIndex;
    setHistoryIndex(nextIndex);
    setDraftLatest({ ...draftRef.current, widgets: cloneWidgets(historyRef.current[nextIndex]) });
  }

  function moveLayer(direction: -1 | 1) {
    if (!selected) return;
    const ordered = [...draftRef.current.widgets].sort((a, b) => a.zIndex - b.zIndex);
    const index = ordered.findIndex((item) => item.id === selected.id);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;
    [ordered[index], ordered[nextIndex]] = [ordered[nextIndex], ordered[index]];
    commitWidgets(ordered.map((item, i) => ({ ...item, zIndex: i + 1 })));
  }

  function deleteSelected() {
    if (!selectedIds.length) return;
    commitWidgets(draftRef.current.widgets.filter((widget) => !selectedIds.includes(widget.id)));
    setSelectedIds([]);
  }

  function startMove(e: React.MouseEvent, widget: Widget) {
    if (e.button !== 0 || widget.locked || pipeDraw || polygonDraw) return;
    e.stopPropagation();
    e.preventDefault();
    const multi = e.ctrlKey || e.metaKey;
    let ids = selectedIds;
    if (multi) {
      ids = selectedIds.includes(widget.id) ? selectedIds.filter((id) => id !== widget.id) : [...selectedIds, widget.id];
      setSelectedIds(ids);
    } else if (!selectedIds.includes(widget.id)) {
      ids = [widget.id];
      setSelectedIds(ids);
    }
    const items = draftRef.current.widgets.filter((item) => ids.includes(item.id) && !item.locked).map((item) => ({ id: item.id, x: item.x, y: item.y }));
    dragRef.current = { id: widget.id, startX: e.clientX, startY: e.clientY, x: widget.x, y: widget.y };
    const movedItems = items.length ? items : [{ id: widget.id, x: widget.x, y: widget.y }];
    let moved = false;
    const onMove = (event: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = event.clientX - dragRef.current.startX;
      const dy = event.clientY - dragRef.current.startY;
      if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
      const anchor = movedItems.find((item) => item.id === widget.id) ?? movedItems[0];
      const nextX = clamp(Math.round((anchor.x + dx) / 10) * 10, 0, Math.max(0, draftRef.current.width - widget.width));
      const nextY = clamp(Math.round((anchor.y + dy) / 10) * 10, 0, Math.max(0, draftRef.current.height - widget.height));
      const deltaX = nextX - anchor.x;
      const deltaY = nextY - anchor.y;
      updateTransientWidgets((widgets) => widgets.map((item) => {
        const original = movedItems.find((source) => source.id === item.id);
        return original ? { ...item, x: clamp(original.x + deltaX, 0, Math.max(0, draftRef.current.width - item.width)), y: clamp(original.y + deltaY, 0, Math.max(0, draftRef.current.height - item.height)) } as Widget : item;
      }));
    };
    const onUp = () => {
      if (moved) commitWidgets(draftRef.current.widgets);
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onUp);
  }

  function startResize(e: React.MouseEvent, widget: Widget) {
    if (e.button !== 0 || widget.locked) return;
    e.stopPropagation();
    e.preventDefault();
    resizeRef.current = { id: widget.id, startX: e.clientX, startY: e.clientY, width: widget.width, height: widget.height };
    let moved = false;
    const onMove = (event: MouseEvent) => {
      const state = resizeRef.current;
      if (!state) return;
      moved = true;
      updateTransientWidgets((widgets) => widgets.map((item) => {
        if (item.id !== state.id) return item;
        const width = clamp(Math.round((state.width + event.clientX - state.startX) / 10) * 10, 20, Math.max(20, draftRef.current.width - item.x));
        const height = clamp(Math.round((state.height + event.clientY - state.startY) / 10) * 10, 20, Math.max(20, draftRef.current.height - item.y));
        return item.type === 'polygon'
          ? { ...item, width, height, points: scaleScadaPolygonPoints(item.points, item.width, item.height, width, height) }
          : { ...item, width, height } as Widget;
      }));
    };
    const onUp = () => {
      if (moved) commitWidgets(draftRef.current.widgets);
      resizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onUp);
  }

  function reorderLayer(targetId: string) {
    if (!dragLayerId || dragLayerId === targetId) return;
    const ordered = [...draftRef.current.widgets].sort((a, b) => a.zIndex - b.zIndex);
    const from = ordered.findIndex((item) => item.id === dragLayerId);
    const target = ordered.findIndex((item) => item.id === targetId);
    if (from < 0 || target < 0) return;
    const [moving] = ordered.splice(from, 1);
    const insertAt = dropAfter ? target + (from < target ? 0 : 1) : target + (from < target ? -1 : 0);
    ordered.splice(Math.max(0, Math.min(ordered.length, insertAt)), 0, moving);
    commitWidgets(ordered.map((item, index) => ({ ...item, zIndex: index + 1 })));
    setDragLayerId(null);
    setOverLayerId(null);
  }

  function canvasPoint(e: React.DragEvent | React.MouseEvent) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return {
      x: clamp(Math.round((e.clientX - rect.left) / 10) * 10, 0, draftRef.current.width),
      y: clamp(Math.round((e.clientY - rect.top) / 10) * 10, 0, draftRef.current.height),
    };
  }

  function finishPipe() {
    if (pipePoints.length < 2) {
      setPipeDraw(false);
      setPipePoints([]);
      return;
    }
    const minX = Math.min(...pipePoints.map((point) => point.x));
    const minY = Math.min(...pipePoints.map((point) => point.y));
    const maxX = Math.max(...pipePoints.map((point) => point.x));
    const maxY = Math.max(...pipePoints.map((point) => point.y));
    const widget = buildDefaultWidget('pipe', minX, minY, Math.max(20, maxX - minX), Math.max(20, maxY - minY)) as Widget & { points: { x: number; y: number }[] };
    widget.points = pipePoints.map((point) => ({ x: point.x - minX, y: point.y - minY }));
    commitWidgets([...draftRef.current.widgets, widget]);
    setSelectedIds([widget.id]);
    setPipeDraw(false);
    setPipePoints([]);
  }

  function finishPolygon() {
    const points = polygonPoints.filter((point, index) => index === 0 || point.x !== polygonPoints[index - 1].x || point.y !== polygonPoints[index - 1].y);
    if (points.length < 3) {
      setPolygonDraw(false);
      setPolygonPoints([]);
      return;
    }
    const minX = Math.min(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxX = Math.max(...points.map((point) => point.x));
    const maxY = Math.max(...points.map((point) => point.y));
    const widget = buildDefaultWidget('polygon', minX, minY, Math.max(20, maxX - minX), Math.max(20, maxY - minY)) as PolygonWidget;
    widget.points = points.map((point) => ({ x: point.x - minX, y: point.y - minY }));
    commitWidgets([...draftRef.current.widgets, widget]);
    setSelectedIds([widget.id]);
    setPolygonDraw(false);
    setPolygonPoints([]);
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (pipeDraw) { setPipeDraw(false); setPipePoints([]); return; }
        if (polygonDraw) { setPolygonDraw(false); setPolygonPoints([]); return; }
        onCancel();
      }
      if (event.key === 'Enter' && pipeDraw) {
        event.preventDefault();
        finishPipe();
        return;
      }
      if (event.key === 'Enter' && polygonDraw) {
        event.preventDefault();
        finishPolygon();
        return;
      }
      const target = event.target as HTMLElement | null;
      const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName ?? '') || Boolean(target?.isContentEditable);
      if (inField) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelected(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteClipboard(); }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        deleteSelected();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const orderedLayers = [...draft.widgets].sort((a, b) => a.zIndex - b.zIndex);

  return (
    <div className="fixed inset-0 z-[100100] flex items-center justify-center bg-slate-950/80 p-3 sm:p-5" role="dialog" aria-modal="true" aria-label="Editor do popup">
      <div className="flex h-[min(860px,94vh)] w-[min(1400px,100%)] min-h-0 flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-slate-700 px-4">
          <Layers className="h-4 w-4 text-cyan-400" />
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-slate-100">Editar conteúdo do popup</h2>
            <p className="text-[10px] text-slate-500">Mesma composição da tela principal · popups aninhados são bloqueados</p>
          </div>
          <div className="hidden items-center gap-2 sm:flex">
            <label className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500">
              Largura
              <input
                aria-label="Largura do popup"
                data-testid="scada-popup-width"
                type="number"
                min={SCADA_POPUP_MIN_WIDTH}
                max={SCADA_POPUP_MAX_WIDTH}
                value={draft.width}
                onChange={(event) => updateDimensions({ width: Number(event.target.value) })}
                className="w-16 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-xs normal-case tracking-normal text-slate-200 outline-none focus:border-cyan-500"
              />
            </label>
            <label className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500">
              Altura
              <input
                aria-label="Altura do popup"
                data-testid="scada-popup-height"
                type="number"
                min={SCADA_POPUP_MIN_HEIGHT}
                max={SCADA_POPUP_MAX_HEIGHT}
                value={draft.height}
                onChange={(event) => updateDimensions({ height: Number(event.target.value) })}
                className="w-16 rounded border border-slate-700 bg-slate-950 px-1.5 py-1 text-xs normal-case tracking-normal text-slate-200 outline-none focus:border-cyan-500"
              />
            </label>
          </div>
          <button type="button" onClick={undo} disabled={historyIndex === 0} title="Desfazer" className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30"><Undo2 className="h-4 w-4" /></button>
          <button type="button" onClick={redo} disabled={historyIndex >= history.length - 1} title="Refazer" className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30"><Redo2 className="h-4 w-4" /></button>
          <button type="button" onClick={onCancel} aria-label="Cancelar edição" className="rounded p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-4 w-4" /></button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          <div className="flex h-[clamp(110px,20vh,170px)] w-full shrink-0 flex-col border-b border-slate-700 lg:h-full lg:w-56 lg:border-b-0 lg:border-r">
            <WidgetPalette
              onDropWidget={(type, size, overrides, anchor) => addWidget(type, size.w, size.h, overrides, anchor)}
              components={components}
              onInsertComponent={insertComponent}
              onDeleteComponent={onDeleteComponent}
              onStartPipeDraw={() => { setPipeDraw(true); setPipePoints([]); }}
              onStartPolygonDraw={() => { setPolygonDraw(true); setPolygonPoints([]); }}
            />
          </div>
          <main
            className="relative flex min-h-[240px] min-w-0 flex-1 items-center justify-center overflow-auto bg-slate-950 p-4 sm:p-6 lg:min-h-0"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              const point = canvasPoint(event);
              if (!point) return;
              const componentData = event.dataTransfer.getData('application/scada-component');
              if (componentData) {
                const { componentId } = JSON.parse(componentData) as { componentId: string };
                insertComponent(componentId, point);
                return;
              }
              const raw = event.dataTransfer.getData('application/scada-widget');
              if (!raw) return;
              const data = JSON.parse(raw) as { type: WidgetType; defaultSize?: { w: number; h: number }; overrides?: Partial<Widget> };
              const size = data.defaultSize ?? SCADA_WIDGET_DEFAULT_SIZES[data.type] ?? { w: 120, h: 80 };
              addWidget(data.type, size.w, size.h, data.overrides, point);
            }}
            onMouseDown={(event) => {
              if (pipeDraw) {
                const point = canvasPoint(event);
                if (point) setPipePoints((current) => [...current, point]);
              } else if (polygonDraw) {
                const point = canvasPoint(event);
                if (point) setPolygonPoints((current) => [...current, point]);
              } else if (event.target === event.currentTarget) setSelectedIds([]);
            }}
            onDoubleClick={(event) => {
              if (pipeDraw) { event.stopPropagation(); finishPipe(); }
              else if (polygonDraw) { event.stopPropagation(); finishPolygon(); }
            }}
          >
            <div
              ref={canvasRef}
              data-testid="scada-popup-editor-canvas"
              className={`relative shrink-0 overflow-hidden ${pipeDraw || polygonDraw ? 'cursor-crosshair' : ''}`}
               style={{ boxSizing: 'border-box', width: draft.width, height: draft.height, background: draft.backgroundColor, border: `${draft.borderWidth}px solid ${draft.borderColor}`, borderRadius: draft.borderRadius, backgroundImage: 'radial-gradient(#334155 1px, transparent 1px)', backgroundSize: '20px 20px' }}
              onMouseDown={(event) => {
                if (!pipeDraw && !polygonDraw) return;
                const point = canvasPoint(event);
                if (point) {
                  if (pipeDraw) setPipePoints((current) => [...current, point]);
                  else setPolygonPoints((current) => [...current, point]);
                }
                event.stopPropagation();
              }}
            >
              {pipeDraw && pipePoints.length > 0 && (
                <svg className="pointer-events-none absolute inset-0 z-[100003]" width={draft.width} height={draft.height}>
                  <polyline points={pipePoints.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#22D3EE" strokeWidth="3" strokeDasharray="7 5" />
                </svg>
              )}
              {polygonDraw && polygonPoints.length > 0 && (
                <svg className="pointer-events-none absolute inset-0 z-[100003]" width={draft.width} height={draft.height}>
                  <polygon points={polygonPoints.map((point) => `${point.x},${point.y}`).join(' ')} fill="rgba(34,211,238,0.14)" stroke="#22D3EE" strokeWidth="3" strokeDasharray="7 5" strokeLinejoin="round" />
                </svg>
              )}
              {draft.widgets.slice().sort((a, b) => a.zIndex - b.zIndex).map((widget) => (
                <Fragment key={widget.id}>
                  <WidgetRenderer
                    widget={{ ...widget, popup: undefined }}
                    isEditor
                    staticRender
                    isSelected={selectedIds.includes(widget.id)}
                    onClick={(id, multi) => setSelectedIds((current) => multi ? (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]) : [id])}
                    onMouseDown={(event) => startMove(event, widget)}
                  />
                  {selectedIds.includes(widget.id) && !widget.locked && (
                    <button type="button" aria-label="Redimensionar widget do popup" onMouseDown={(event) => startResize(event, widget)} className="absolute z-[100002] h-3 w-3 cursor-se-resize rounded-sm border border-white bg-cyan-500" style={{ left: widget.x + widget.width - 6, top: widget.y + widget.height - 6, pointerEvents: 'auto' }} />
                  )}
                </Fragment>
              ))}
            </div>
          </main>
          <aside className="flex h-[clamp(180px,28vh,240px)] w-full min-h-0 shrink-0 flex-col border-t border-slate-700 bg-slate-800 lg:h-full lg:w-[320px] lg:border-l lg:border-t-0">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="flex shrink-0 items-center gap-2 border-b border-slate-700 px-3 py-3">
                <Layers className="h-3.5 w-3.5 text-slate-400" />
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Camadas ({draft.widgets.length})</p>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto py-2">
                {orderedLayers.map((widget, index) => {
                  const isSelected = selectedIds.includes(widget.id);
                  const over = overLayerId === widget.id && dragLayerId !== widget.id;
                  return (
                    <div
                      key={widget.id}
                      draggable
                      onDragStart={() => setDragLayerId(widget.id)}
                      onDragEnd={() => { setDragLayerId(null); setOverLayerId(null); }}
                      onDragOver={(event) => { event.preventDefault(); setOverLayerId(widget.id); setDropAfter(event.clientY > event.currentTarget.getBoundingClientRect().top + event.currentTarget.getBoundingClientRect().height / 2); }}
                      onDrop={() => reorderLayer(widget.id)}
                      onClick={(event) => {
                        if (event.shiftKey && anchorRef.current) {
                          const start = orderedLayers.findIndex((item) => item.id === anchorRef.current);
                          const end = index;
                          setSelectedIds(orderedLayers.slice(Math.min(start, end), Math.max(start, end) + 1).map((item) => item.id));
                        } else if (event.ctrlKey || event.metaKey) {
                          setSelectedIds((current) => current.includes(widget.id) ? current.filter((id) => id !== widget.id) : [...current, widget.id]);
                        } else setSelectedIds([widget.id]);
                        anchorRef.current = widget.id;
                      }}
                      className={`group mx-2 flex cursor-pointer items-center gap-1 rounded px-2 py-1.5 text-xs select-none ${isSelected ? 'bg-cyan-600/20 text-cyan-300' : 'text-slate-300 hover:bg-slate-700'} ${over ? (dropAfter ? 'border-b-2 border-cyan-500' : 'border-t-2 border-cyan-500') : ''}`}
                    >
                      <Move className="h-3.5 w-3.5 shrink-0 cursor-grab text-slate-500" />
                      <span className={`min-w-0 flex-1 truncate ${widget.locked ? 'text-slate-500' : ''}`}>{labelOf(widget)}</span>
                      <span className="shrink-0 text-[9px] uppercase text-slate-500">{widget.type}</span>
                      <button type="button" title={widget.locked ? 'Destravar componente' : 'Travar componente'} onClick={(event) => { event.stopPropagation(); updateWidgetById(widget.id, { locked: !widget.locked }); }} className="rounded p-0.5 text-slate-400 hover:bg-slate-600 hover:text-white">
                        {widget.locked ? <Lock className="h-3 w-3 text-cyan-400" /> : <LockOpen className="h-3 w-3 opacity-0 group-hover:opacity-100" />}
                      </button>
                    </div>
                  );
                })}
              </div>
              <div className="flex shrink-0 gap-1 border-t border-slate-700 p-2">
                <button type="button" title="Mover para trás" onClick={() => moveLayer(-1)} disabled={!selected} className="flex-1 rounded border border-slate-700 py-1 text-[10px] text-slate-300 hover:text-white disabled:opacity-30"><ArrowDown className="mr-1 inline h-3 w-3" />Atrás</button>
                <button type="button" title="Mover para frente" onClick={() => moveLayer(1)} disabled={!selected} className="flex-1 rounded border border-slate-700 py-1 text-[10px] text-slate-300 hover:text-white disabled:opacity-30"><ArrowUp className="mr-1 inline h-3 w-3" />Frente</button>
                <button type="button" title="Copiar" onClick={copySelected} disabled={!selected} className="rounded border border-slate-700 p-1 text-slate-300 hover:text-white disabled:opacity-30"><Copy className="h-3 w-3" /></button>
                <button type="button" title="Colar" onClick={pasteClipboard} disabled={!clipboard.length} className="rounded border border-slate-700 px-2 text-[10px] text-slate-300 hover:text-white disabled:opacity-30">Colar</button>
                <button type="button" title="Duplicar" onClick={duplicateSelected} disabled={!selected} className="rounded border border-slate-700 px-2 text-[10px] text-slate-300 hover:text-white disabled:opacity-30">Dup.</button>
                <button type="button" title="Excluir" onClick={deleteSelected} disabled={!selected} className="rounded border border-red-900/60 p-1 text-red-300 hover:bg-red-950/40 disabled:opacity-30"><Trash2 className="h-3 w-3" /></button>
              </div>
            </div>
            {selected && (
              <div className="min-h-0 flex-[2] overflow-y-auto border-t border-slate-700">
                <div className="border-b border-slate-700 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Propriedades — {selected.type}</p>
                </div>
                {selected.type === 'component-instance' ? (
                  <div className="text-[10px] text-slate-400">
                    <PropertyCategory id={`popup-instance-layout-${selected.id}`} title="Layout" resetKey={selected.id}>
                      <div className="p-3 text-[10px] text-slate-500">
                        Geometria: {selected.x}, {selected.y} · {selected.width} × {selected.height}
                      </div>
                    </PropertyCategory>
                    <PropertyCategory id={`popup-instance-identification-${selected.id}`} title="Identificação" resetKey={selected.id}>
                      <div className="space-y-2 p-3">
                        <label className="block">Rótulo da camada<input value={selected.editorLabel ?? ''} onChange={(event) => updateSelected({ editorLabel: event.target.value })} className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200" /></label>
                        <p>Componente reutilizável: {selected.componentName}. A caixa é movida como uma unidade; os elementos internos mantêm geometria própria.</p>
                      </div>
                    </PropertyCategory>
                    {selected.children.length > 0 && (
                      <PropertyCategory id={`popup-instance-content-${selected.id}`} title="Conteúdo/configuração" resetKey={selected.id}>
                        <div className="space-y-2 p-2">
                          {selected.children.map((child, index) => (
                          <details key={child.id} className="rounded border border-slate-700 bg-slate-900/50">
                            <summary className="cursor-pointer px-2 py-1.5 text-xs text-slate-300">
                              {index + 1}. {labelOf(child)}
                            </summary>
                            <div className="border-t border-slate-700">
                              {child.type === 'component-instance' ? (
                                <p className="p-3 text-amber-400/80">Composições aninhadas mantêm o snapshot salvo e não recebem outro popup.</p>
                              ) : (
                                <PopupWidgetProperties
                                  widget={child}
                                  upd={(patch) => updateComponentChild(selected.id, child.id, patch)}
                                  devices={devices}
                                  screen={screen}
                                  screenOpts={screenOpts}
                                  resetKey={`${selected.id}:${child.id}`}
                                />
                              )}
                            </div>
                          </details>
                          ))}
                        </div>
                      </PropertyCategory>
                    )}
                  </div>
                ) : (
                  <PopupWidgetProperties
                    widget={selected}
                    upd={updateSelected}
                    devices={devices}
                    screen={screen}
                    screenOpts={screenOpts}
                    resetKey={selected.id}
                  />
                )}
              </div>
            )}
          </aside>
        </div>
        <footer className="flex h-14 shrink-0 items-center justify-between gap-2 border-t border-slate-700 px-4">
          <p className="hidden text-[10px] text-slate-500 sm:block">{pipeDraw || polygonDraw ? 'Clique no canvas para criar vértices · duplo clique/Enter finaliza · Esc cancela' : 'Arraste para mover · Ctrl/Shift+clique seleciona vários'}</p>
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={onCancel} className="rounded px-3 py-1.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-white">Cancelar</button>
            <button type="button" onClick={() => onSave({ ...draftRef.current, widgets: stripNestedPopupWidgets(cloneWidgets(draftRef.current.widgets)) })} className="flex items-center gap-1.5 rounded bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-500"><Check className="h-3.5 w-3.5" />Aplicar conteúdo</button>
          </div>
        </footer>
      </div>
    </div>
  );
}