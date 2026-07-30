import { create } from 'zustand';
import { nanoid } from 'nanoid';
import type { SavedComponent, ScadaScreen, ScreenSettings, Widget } from '../types/scada.types';
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
  resizeWidget: (id: string, width: number, height: number) => void;
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
    const widgets = screen.widgets.map((w) =>
      w.id === id ? ({ ...w, ...patch } as Widget) : w,
    );
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
    const sel = screen.widgets.filter((w) => selectedIds.includes(w.id));
    if (sel.length === 0) return;
    const minX = Math.min(...sel.map((w) => w.x));
    const minY = Math.min(...sel.map((w) => w.y));
    const maxX = Math.max(...sel.map((w) => w.x + w.width));
    const maxY = Math.max(...sel.map((w) => w.y + w.height));
    // Normaliza posição (relativa ao grupo) e z-index (1..n por ordem de pilha).
    const widgets = [...sel]
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
    // comp.widgets já vem ordenado por z asc — reatribui ids e z na frente da pilha.
    const clones = comp.widgets.map((w, i) =>
      ({ ...w, id: `w-${nanoid(8)}`, x: w.x + baseX, y: w.y + baseY, zIndex: maxZ + i + 1 } as Widget),
    );
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
    set({ clipboard: JSON.parse(JSON.stringify(sel)) as Widget[] });
  },

  paste() {
    const { screen, clipboard, history, historyIndex } = get();
    if (!screen || clipboard.length === 0) return;
    const OFFSET = 20;
    const maxZ = screen.widgets.reduce((m, w) => Math.max(m, w.zIndex), 0);
    const clones = clipboard.map((w, i) => ({
      ...(JSON.parse(JSON.stringify(w)) as Widget),
      id: `w-${nanoid(8)}`,
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
      clipboard: clones.map((w) => ({ ...(JSON.parse(JSON.stringify(w)) as Widget) })),
    });
  },

  deleteSelected() {
    const { screen, selectedIds, history, historyIndex } = get();
    if (!screen || selectedIds.length === 0) return;
    const widgets = screen.widgets.filter((w) => !selectedIds.includes(w.id));
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
    if (w?.locked) return;
    get().updateWidget(id, { x: snapToGrid(x), y: snapToGrid(y) });
  },

  moveWidgets(positions, opts) {
    const { screen, history, historyIndex } = get();
    if (!screen || positions.length === 0) return;
    const map = new Map(positions.map((p) => [p.id, p]));
    // Posições exatas: o snap (quando aplicável) é responsabilidade do chamador,
    // aplicado UMA vez ao grupo — nunca widget a widget (preserva offsets internos).
    const widgets = screen.widgets.map((w) => {
      const p = map.get(w.id);
      return p && !w.locked ? ({ ...w, x: Math.round(p.x), y: Math.round(p.y) } as Widget) : w;
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

  nudgeSelection(dx, dy) {
    const { screen, selectedIds, history, historyIndex } = get();
    if (!screen || selectedIds.length === 0) return;
    const sel = new Set(selectedIds);
    let changed = false;
    const widgets = screen.widgets.map((w) => {
      if (!sel.has(w.id) || w.locked) return w;
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

  resizeWidget(id, width, height) {
    get().updateWidget(id, { width: Math.max(20, width), height: Math.max(20, height) });
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
    if (on) set({ selectedIds: [], showProperties: false, pipeDraw: false });
  },

  setPipeDraw(on) {
    set({ pipeDraw: on });
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
