import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { isPinnedNavWidget, scaleScadaPolygonPoints } from '../types/scada.types';
import type { ComponentInstanceWidget, PolygonWidget, SavedComponent, ScadaScreen, ScreenSettings, Widget } from '../types/scada.types';
import {
  getScreen,
  updateScreen,
  getComponents,
  createComponent,
  deleteComponent as apiDeleteComponent,
} from '../services/scada.service';

// ─── Toast ───────────────────────────────────────────────────────────────────

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastMessage {
  id: string;
  kind: ToastKind;
  text: string;
}

// ─── History ─────────────────────────────────────────────────────────────────

interface HistoryEntry {
  widgets: Widget[];
}

// ─── State ───────────────────────────────────────────────────────────────────

interface EditorState {
  screen: ScadaScreen | null;
  loading: boolean;
  saving: boolean;
  notFound: boolean;
  selectedIds: string[];
  zoom: number;
  isDirty: boolean;
  previewMode: boolean;
  showProperties: boolean;
  toasts: ToastMessage[];
  clipboard: Widget[];
  /** Biblioteca global de componentes do tenant ("Meus Componentes"). */
  components: SavedComponent[];

  history: HistoryEntry[];
  historyIndex: number;

  // Actions
  loadScreen: (screenId: string) => Promise<void>;
  selectWidget: (id: string, multi?: boolean) => void;
  /** Define a seleção inteira de uma vez (ex.: seleção por intervalo nas Camadas). */
  setSelection: (ids: string[]) => void;
  clearSelection: () => void;
  addWidget: (widget: Widget) => void;
  updateWidget: (id: string, patch: Partial<Widget>, opts?: { history?: boolean }) => void;
  /** Atualiza propriedades de um filho sem expor sua geometria ao editor. */
  updateComponentChild: (instanceId: string, childId: string, patch: Partial<Widget>) => void;
  /** Reordena a pilha (z-index) a partir da ordem visual trás→frente dos ids. */
  reorderWidgets: (orderedIds: string[]) => void;
  /** Salva a seleção atual como componente reutilizável (biblioteca global do tenant). */
  saveComponent: (name: string) => void;
  /** Insere um componente da biblioteca como cópias independentes. */
  insertComponent: (componentId: string, anchor?: { x: number; y: number }) => void;
  /** Remove um componente da biblioteca global do tenant. */
  deleteComponent: (componentId: string) => void;
  /** Copia a seleção atual para a área de transferência interna (Ctrl+C). */
  copySelection: () => void;
  /** Cola a área de transferência com novos ids e leve deslocamento (Ctrl+V). */
  paste: () => void;
  deleteSelected: () => void;
  moveWidget: (id: string, x: number, y: number) => void;
  /** Move vários widgets de uma vez — posições exatas (sem snap; o chamador decide). */
  moveWidgets: (positions: { id: string; x: number; y: number }[], opts?: { history?: boolean }) => void;
  /** Desloca a seleção por (dx, dy) — nudge por teclado; coalesce pressões repetidas no undo. */
  nudgeSelection: (dx: number, dy: number) => void;
  /** Registra o estado atual dos widgets como um passo de histórico (fim de um arraste). */
  commitHistory: () => void;
  resizeWidget: (id: string, width: number, height: number, opts?: { history?: boolean }) => void;
  /** Redimensiona uma composição e escala seu snapshot de filhos sem alterar a biblioteca. */
  resizeComponentInstance: (
    id: string,
    bounds: { x: number; y: number; width: number; height: number },
    opts?: {
      history?: boolean;
      source?: { width: number; height: number; children: Widget[] };
    },
  ) => void;
  setZoom: (zoom: number) => void;
  undo: () => void;
  redo: () => void;
  save: () => Promise<void>;
  renameScreen: (name: string) => void;
  updateSettings: (patch: Partial<ScreenSettings>) => void;
  setPreviewMode: (on: boolean) => void;
  /** Modo de desenho de tubulação: cliques no canvas adicionam vértices da polilinha. */
  pipeDraw: boolean;
  setPipeDraw: (on: boolean) => void;
  polygonDraw: boolean;
  setPolygonDraw: (on: boolean) => void;
  setShowProperties: (on: boolean) => void;
  addToast: (kind: ToastKind, text: string) => void;
  removeToast: (id: string) => void;
}

const ZOOM_LEVELS = [0.5, 0.75, 1, 1.25, 1.5];

let toastSeq = 0;
let lastNudgeAt = 0;

export const useEditorStore = create<EditorState>((set, get) => ({
  screen: null,
  loading: false,
  saving: false,
  notFound: false,
  selectedIds: [],
  zoom: 1,
  isDirty: false,
  previewMode: false,
  pipeDraw: false,
  polygonDraw: false,
  showProperties: false,
  toasts: [],
  clipboard: [],
  components: [],
  history: [],
  historyIndex: -1,

  async loadScreen(screenId) {
    set({ loading: true, notFound: false, screen: null });
    try {
      const found = await getScreen(screenId);
      const initial: HistoryEntry = { widgets: found.widgets };
      // Biblioteca global do tenant. Fallback: telas antigas (ainda não migradas)
      // podem ter componentes embutidos em settings.components — mescla sem duplicar.
      let components: SavedComponent[] = [];
      try {
        components = await getComponents(found.tenantId);
      } catch {
        // Biblioteca indisponível não impede a edição da tela.
      }
      const legacy = found.settings.components ?? [];
      const known = new Set(components.map((c) => c.id));
      for (const c of legacy) if (!known.has(c.id)) components.push(c);
      set({
        screen: { ...found },
        components,
        loading: false,
        selectedIds: [],
        isDirty: false,
        showProperties: false,
        previewMode: false,
        history: [initial],
        historyIndex: 0,
      });
    } catch {
      set({ loading: false, notFound: true, screen: null });
    }
  },

  selectWidget(id, multi = false) {
    set((s) => ({
      selectedIds: multi
        ? s.selectedIds.includes(id)
          ? s.selectedIds.filter((x) => x !== id)
          : [...s.selectedIds, id]
        : [id],
      showProperties: true,
    }));
  },

  setSelection(ids) {
    set({ selectedIds: ids, showProperties: ids.length > 0 });
  },

  clearSelection() {
    set({ selectedIds: [], showProperties: false });
  },

  addWidget(widget) {
    const { screen, history, historyIndex } = get();
    if (!screen) return;
    // Entra na frente da pilha (maior z-index) para ficar visível ao ser criado.
    const maxZ = screen.widgets.reduce((m, w) => Math.max(m, w.zIndex), 0);
    const widgets = [...screen.widgets, { ...widget, zIndex: maxZ + 1 }];
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ widgets });
    set({
      screen: { ...screen, widgets },
      history: newHistory,
      historyIndex: newHistory.length - 1,
      isDirty: true,
      selectedIds: [widget.id],
      showProperties: true,
    });
  },

  updateWidget(id, patch, opts) {
    const { screen, history, historyIndex } = get();
    if (!screen) return;
    const widgets = screen.widgets.map((w) => {
      if (w.id !== id) return w;
      const polygonPatch = patch as Partial<PolygonWidget>;
      if (w.type !== 'polygon' || polygonPatch.points !== undefined || (patch.width === undefined && patch.height === undefined)) {
        return { ...w, ...patch } as Widget;
      }
      const width = Number(patch.width ?? w.width);
      const height = Number(patch.height ?? w.height);
      return {
        ...w,
        ...patch,
        points: scaleScadaPolygonPoints(w.points, w.width, w.height, width, height),
      } as Widget;
    });
    if (opts?.history === false) {
      set({ screen: { ...screen, widgets }, isDirty: true });
      return;
    }
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ widgets });
    set({
      screen: { ...screen, widgets },
      history: newHistory,
      historyIndex: newHistory.length - 1,
      isDirty: true,
    });
  },

  updateComponentChild(instanceId, childId, patch) {
    const { screen, history, historyIndex } = get();
    if (!screen) return;
    // A child's geometry belongs to the saved composition. Even if a future
    // editor caller accidentally sends it, never let it break the instance.
    const { x: _x, y: _y, width: _width, height: _height, ...safePatch } =
      patch as Partial<Widget> & Record<string, unknown>;
    let changed = false;
    const updateChildren = (children: Widget[]): Widget[] => {
      let nextChanged = false;
      const next = children.map((child) => {
        if (child.id === childId) {
          changed = true;
          nextChanged = true;
          return { ...child, ...safePatch } as Widget;
        }
        if (child.type === 'component-instance') {
          const nestedChildren = updateChildren(child.children);
          if (nestedChildren !== child.children) {
            nextChanged = true;
            return { ...child, children: nestedChildren } as ComponentInstanceWidget;
          }
        }
        if (child.popup) {
          const popupChildren = updateChildren(child.popup.widgets);
          if (popupChildren !== child.popup.widgets) {
            nextChanged = true;
            return { ...child, popup: { ...child.popup, widgets: popupChildren } } as Widget;
          }
        }
        return child;
      });
      return nextChanged ? next : children;
    };
    const widgets = screen.widgets.map((widget) => {
      if (widget.id !== instanceId || widget.type !== 'component-instance') return widget;
      const children = updateChildren(widget.children);
      return children === widget.children ? widget : { ...widget, children } as ComponentInstanceWidget;
    });
    if (!changed) return;
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ widgets });
    set({
      screen: { ...screen, widgets },
      history: newHistory,
      historyIndex: newHistory.length - 1,
      isDirty: true,
    });
  },

  reorderWidgets(orderedIds) {
    const { screen, history, historyIndex } = get();
    if (!screen) return;
    const byId = new Map(screen.widgets.map((w) => [w.id, w]));
    // orderedIds vem na ordem visual trás→frente; z-index 1..N crescente.
    const ordered = orderedIds.map((id) => byId.get(id)).filter(Boolean) as Widget[];
    const missing = screen.widgets.filter((w) => !orderedIds.includes(w.id));
    const widgets = [...ordered, ...missing].map((w, i) => ({ ...w, zIndex: i + 1 } as Widget));
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ widgets });
    set({
      screen: { ...screen, widgets },
      history: newHistory,
      historyIndex: newHistory.length - 1,
      isDirty: true,
    });
  },

  saveComponent(name) {
    const { screen, selectedIds } = get();
    if (!screen || selectedIds.length === 0 || !name.trim()) return;
    // Barras fixas e itens travados não pertencem a uma composição móvel.
    const sel = screen.widgets.filter((w) =>
      selectedIds.includes(w.id) && !w.locked && !isPinnedNavWidget(w),
    );
    if (sel.length === 0) return;
    const minX = Math.min(...sel.map((w) => w.x));
    const minY = Math.min(...sel.map((w) => w.y));
    const maxX = Math.max(...sel.map((w) => w.x + w.width));
    const maxY = Math.max(...sel.map((w) => w.y + w.height));
    // Normaliza posição (relativa ao grupo) e z-index (1..n por ordem de pilha).
    const widgets = deepCloneWidgets(sel)
      .sort((a, b) => a.zIndex - b.zIndex)
      .map((w, i) => ({ ...w, x: w.x - minX, y: w.y - minY, zIndex: i + 1 } as Widget));
    const comp = { id: `c-${nanoid(8)}`, name: name.trim(), width: maxX - minX, height: maxY - minY, widgets };
    // Otimista: aparece já na lista; persiste na biblioteca global do tenant.
    set({ components: [...get().components, comp] });
    void createComponent({ ...comp, tenantId: screen.tenantId })
      .then(() => get().addToast('success', `Componente "${comp.name}" salvo`))
      .catch(() => {
        set({ components: get().components.filter((c) => c.id !== comp.id) });
        get().addToast('error', `Falha ao salvar o componente "${comp.name}"`);
      });
  },

  insertComponent(componentId, anchor) {
    const { screen, history, historyIndex } = get();
    if (!screen) return;
    const comp = get().components.find((c) => c.id === componentId);
    if (!comp) return;
    const baseX = anchor?.x ?? Math.round(screen.width / 2 - comp.width / 2);
    const baseY = anchor?.y ?? Math.round(screen.height / 2 - comp.height / 2);
    const maxZ = screen.widgets.reduce((m, w) => Math.max(m, w.zIndex), 0);
    // A definição vira UM widget externo. Os filhos permanecem relativos ao
    // canto da caixa e recebem ids novos para não compartilhar identidade com
    // a biblioteca nem com outra inserção.
    const children = remapWidgetIds(deepCloneWidgets(comp.widgets));
    const instance: ComponentInstanceWidget = {
      id: `w-${nanoid(8)}`,
      type: 'component-instance',
      x: baseX,
      y: baseY,
      width: comp.width,
      height: comp.height,
      opacity: 1,
      visible: true,
      zIndex: maxZ + 1,
      visibility: { mode: 'always' },
      componentId: comp.id,
      componentName: comp.name,
      children,
    };
    const widgets = [...screen.widgets, instance];
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ widgets });
    set({
      screen: { ...screen, widgets },
      history: newHistory,
      historyIndex: newHistory.length - 1,
      isDirty: true,
      selectedIds: [instance.id],
      showProperties: true,
    });
  },

  deleteComponent(componentId) {
    const { components } = get();
    const comp = components.find((c) => c.id === componentId);
    if (!comp) return;
    // Otimista: some da lista; a exclusão vale para todas as telas do tenant.
    set({ components: components.filter((c) => c.id !== componentId) });
    void apiDeleteComponent(componentId).catch(() => {
      set({ components: [...get().components, comp] });
      get().addToast('error', `Falha ao excluir o componente "${comp.name}"`);
    });
  },

  copySelection() {
    const { screen, selectedIds } = get();
    if (!screen || selectedIds.length === 0) return;
    const sel = screen.widgets.filter((w) => selectedIds.includes(w.id));
    set({ clipboard: deepCloneWidgets(sel) });
  },

  paste() {
    const { screen, clipboard, history, historyIndex } = get();
    if (!screen || clipboard.length === 0) return;
    const OFFSET = 20;
    const maxZ = screen.widgets.reduce((m, w) => Math.max(m, w.zIndex), 0);
    const clones = remapWidgetIds(deepCloneWidgets(clipboard)).map((w, i) => ({
      ...w,
      x: w.x + OFFSET,
      y: w.y + OFFSET,
      zIndex: maxZ + i + 1,
    }) as Widget);
    const widgets = [...screen.widgets, ...clones];
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ widgets });
    set({
      screen: { ...screen, widgets },
      history: newHistory,
      historyIndex: newHistory.length - 1,
      isDirty: true,
      selectedIds: clones.map((w) => w.id),
      showProperties: true,
      // Cascata: o próximo Ctrl+V cola deslocado a partir desta posição.
      clipboard: deepCloneWidgets(clones),
    });
  },

  deleteSelected() {
    const { screen, selectedIds, history, historyIndex } = get();
    if (!screen || selectedIds.length === 0) return;
    const removable = new Set(screen.widgets
      .filter((w) => selectedIds.includes(w.id) && !w.locked && !isPinnedNavWidget(w))
      .map((w) => w.id));
    if (removable.size === 0) return;
    const widgets = screen.widgets.filter((w) => !removable.has(w.id));
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ widgets });
    set({
      screen: { ...screen, widgets },
      selectedIds: [],
      showProperties: false,
      history: newHistory,
      historyIndex: newHistory.length - 1,
      isDirty: true,
    });
  },

  moveWidget(id, x, y) {
    const { screen } = get();
    const w = screen?.widgets.find((wd) => wd.id === id);
    if (w?.locked || (w && isPinnedNavWidget(w))) return;
    get().updateWidget(id, { x: snapToGrid(x), y: snapToGrid(y) });
  },

  moveWidgets(positions, opts) {
    const { screen, history, historyIndex } = get();
    if (!screen || positions.length === 0) return;
    const map = new Map(positions.map((p) => [p.id, p]));
    // Posições exatas: o snap (quando aplicável) é responsabilidade do chamador,
    // aplicado UMA vez ao grupo — nunca widget a widget (preserva offsets internos).
    let changed = false;
    const widgets = screen.widgets.map((w) => {
      const p = map.get(w.id);
      if (!p || w.locked || isPinnedNavWidget(w)) return w;
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      if (x === w.x && y === w.y) return w;
      changed = true;
      return { ...w, x, y } as Widget;
    });
    if (!changed) return;
    if (opts?.history === false) {
      set({ screen: { ...screen, widgets }, isDirty: true });
      return;
    }
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ widgets });
    set({
      screen: { ...screen, widgets },
      history: newHistory,
      historyIndex: newHistory.length - 1,
      isDirty: true,
    });
  },

  nudgeSelection(dx, dy) {
    const { screen, selectedIds, history, historyIndex } = get();
    if (!screen || selectedIds.length === 0) return;
    const sel = new Set(selectedIds);
    let changed = false;
    const widgets = screen.widgets.map((w) => {
      if (!sel.has(w.id) || w.locked || isPinnedNavWidget(w)) return w;
      changed = true;
      return { ...w, x: w.x + dx, y: w.y + dy } as Widget;
    });
    if (!changed) return;
    const now = Date.now();
    // Coalesce: pressões repetidas em sequência substituem o topo do histórico
    // (um único passo de undo por "rajada" de setas).
    const coalesce =
      now - lastNudgeAt < 900 && historyIndex > 0 && historyIndex === history.length - 1;
    lastNudgeAt = now;
    const base = history.slice(0, coalesce ? historyIndex : historyIndex + 1);
    const newHistory = [...base, { widgets }];
    set({
      screen: { ...screen, widgets },
      history: newHistory,
      historyIndex: newHistory.length - 1,
      isDirty: true,
    });
  },

  commitHistory() {
    const { screen, history, historyIndex } = get();
    if (!screen) return;
    const top = history[historyIndex];
    if (top && top.widgets === screen.widgets) return; // nada mudou desde o último passo
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ widgets: screen.widgets });
    set({ history: newHistory, historyIndex: newHistory.length - 1 });
  },

  resizeWidget(id, width, height, opts) {
    const widget = get().screen?.widgets.find((w) => w.id === id);
    if (widget?.locked || (widget && isPinnedNavWidget(widget))) return;
    if (widget?.type === 'component-instance') {
      get().resizeComponentInstance(id, {
        x: widget.x,
        y: widget.y,
        width,
        height,
      }, opts);
      return;
    }
    const nextWidth = Math.max(20, Math.round(width));
    const nextHeight = Math.max(20, Math.round(height));
    const geometry = widget?.type === 'polygon'
      ? { points: scaleScadaPolygonPoints(widget.points, widget.width, widget.height, nextWidth, nextHeight) }
      : {};
    get().updateWidget(id, {
      width: nextWidth,
      height: nextHeight,
      ...geometry,
    }, opts);
  },

  resizeComponentInstance(id, bounds, opts) {
    const { screen, history, historyIndex } = get();
    if (!screen) return;
    const current = screen.widgets.find((widget) => widget.id === id);
    if (!current || current.type !== 'component-instance' || current.locked || isPinnedNavWidget(current)) return;
    const width = Math.max(MIN_WIDGET_SIZE, Number.isFinite(bounds.width) ? bounds.width : current.width);
    const height = Math.max(MIN_WIDGET_SIZE, Number.isFinite(bounds.height) ? bounds.height : current.height);
    const normalizedWidth = Math.round(width);
    const normalizedHeight = Math.round(height);
    const x = Number.isFinite(bounds.x) ? bounds.x : current.x;
    const y = Number.isFinite(bounds.y) ? bounds.y : current.y;
    const next = {
      ...current,
      x: Math.round(x),
      y: Math.round(y),
      width: normalizedWidth,
      height: normalizedHeight,
      children: scaleComponentChildren(
        opts?.source?.children ?? current.children,
        opts?.source?.width ?? current.width,
        opts?.source?.height ?? current.height,
        normalizedWidth,
        normalizedHeight,
      ),
    } as ComponentInstanceWidget;
    if (
      next.x === current.x &&
      next.y === current.y &&
      next.width === current.width &&
      next.height === current.height
    ) return;
    const widgets = screen.widgets.map((widget) => widget.id === id ? next : widget);
    if (opts?.history === false) {
      set({ screen: { ...screen, widgets }, isDirty: true });
      return;
    }
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push({ widgets });
    set({
      screen: { ...screen, widgets },
      history: newHistory,
      historyIndex: newHistory.length - 1,
      isDirty: true,
    });
  },

  setZoom(zoom) {
    const clamped = ZOOM_LEVELS.reduce((prev, curr) =>
      Math.abs(curr - zoom) < Math.abs(prev - zoom) ? curr : prev,
    );
    set({ zoom: clamped });
  },

  undo() {
    const { history, historyIndex, screen } = get();
    if (historyIndex <= 0 || !screen) return;
    const idx = historyIndex - 1;
    set({
      screen: { ...screen, widgets: history[idx].widgets },
      historyIndex: idx,
      isDirty: true,
    });
  },

  redo() {
    const { history, historyIndex, screen } = get();
    if (historyIndex >= history.length - 1 || !screen) return;
    const idx = historyIndex + 1;
    set({
      screen: { ...screen, widgets: history[idx].widgets },
      historyIndex: idx,
      isDirty: true,
    });
  },

  async save() {
    const { screen, saving } = get();
    if (!screen || saving) return;
    set({ saving: true });
    try {
      const persisted = await updateScreen(screen.id, {
        name: screen.name,
        width: screen.width,
        height: screen.height,
        status: screen.status,
        widgets: screen.widgets,
        // `settings.components` é legado (biblioteca embutida) — nunca regravar;
        // o backend preserva o valor atual até a migração removê-lo.
        settings: (({ components: _legacy, ...rest }) => rest)(screen.settings),
      });
      set({ isDirty: false, saving: false, screen: { ...screen, updatedAt: persisted.updatedAt } });
      get().addToast('success', 'Tela salva com sucesso');
    } catch (err) {
      set({ saving: false });
      get().addToast('error', `Erro ao salvar: ${(err as Error).message}`);
    }
  },

  renameScreen(name) {
    const { screen } = get();
    if (!screen) return;
    set({ screen: { ...screen, name }, isDirty: true });
  },

  updateSettings(patch) {
    const { screen } = get();
    if (!screen) return;
    set({
      screen: { ...screen, settings: { ...screen.settings, ...patch } },
      isDirty: true,
    });
  },

  setPreviewMode(on) {
    set({ previewMode: on });
    if (on) set({ selectedIds: [], showProperties: false, pipeDraw: false, polygonDraw: false });
  },

  setPipeDraw(on) {
    set({ pipeDraw: on, polygonDraw: on ? false : get().polygonDraw });
    if (on) set({ selectedIds: [], showProperties: false });
  },

  setPolygonDraw(on) {
    set({ polygonDraw: on, pipeDraw: on ? false : get().pipeDraw });
    if (on) set({ selectedIds: [], showProperties: false });
  },

  setShowProperties(on) {
    set({ showProperties: on });
    if (!on) set({ selectedIds: [] });
  },

  addToast(kind, text) {
    const id = `toast-${++toastSeq}`;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => get().removeToast(id), 3500);
  },

  removeToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

function snapToGrid(v: number, grid = 10): number {
  return Math.round(v / grid) * grid;
}

const MIN_WIDGET_SIZE = 10;

/**
 * Escala um snapshot de composição em relação ao tamanho do pai anterior.
 * Cada composição aninhada recebe uma segunda transformação em relação ao
 * próprio tamanho, preservando seus offsets e proporções relativos.
 */
function scaleComponentChildren(
  children: Widget[],
  oldWidth: number,
  oldHeight: number,
  newWidth: number,
  newHeight: number,
): Widget[] {
  const scaleX = oldWidth > 0 ? newWidth / oldWidth : 1;
  const scaleY = oldHeight > 0 ? newHeight / oldHeight : 1;
  return children.map((child) => {
    const width = Math.max(MIN_WIDGET_SIZE, Math.round(child.width * scaleX));
    const height = Math.max(MIN_WIDGET_SIZE, Math.round(child.height * scaleY));
    const scaled = {
      ...child,
      x: Math.round(child.x * scaleX),
      y: Math.round(child.y * scaleY),
      width,
      height,
    } as Widget;
    if (scaled.type === 'polygon') {
      scaled.points = scaleScadaPolygonPoints((child as PolygonWidget).points, child.width, child.height, width, height);
    }
    if (scaled.type === 'component-instance') {
      scaled.children = scaleComponentChildren(
        scaled.children,
        child.width,
        child.height,
        width,
        height,
      );
    }
    return scaled;
  });
}

/** JSON é suficiente aqui: widgets são dados de tela sem instâncias de classe. */
function deepCloneWidgets(widgets: Widget[]): Widget[] {
  return JSON.parse(JSON.stringify(widgets)) as Widget[];
}

/** Renova ids também dentro de instâncias aninhadas ao copiar/inserir. */
function remapWidgetIds(widgets: Widget[]): Widget[] {
  return widgets.map((widget) => {
    const copy = { ...widget, id: `w-${nanoid(8)}` } as Widget;
    if (copy.popup) {
      copy.popup = {
        ...copy.popup,
        widgets: remapPopupWidgetIds(deepCloneWidgets(copy.popup.widgets)),
      };
    }
    if (copy.type === 'component-instance') {
      copy.children = remapWidgetIds(copy.children);
    }
    return copy;
  });
}

/** Copiar um widget também copia a composição do popup sem compartilhar ids. */
function remapPopupWidgetIds(widgets: Widget[]): Widget[] {
  return widgets.map((widget) => {
    const copy = { ...widget, id: `w-${nanoid(8)}` } as Widget;
    // A composição do popup é um limite de recursão: filhos não podem hospedar
    // outro popup, nem mesmo quando vieram de uma tela/componente antigo.
    delete copy.popup;
    if (copy.type === 'component-instance') {
      copy.children = remapPopupWidgetIds(copy.children);
    }
    return copy;
  });
}
