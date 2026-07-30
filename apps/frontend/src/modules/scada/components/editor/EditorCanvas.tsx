'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import Link from 'next/link';
import { Pin } from 'lucide-react';
import { isPinnedNavWidget, clampPinnedToolbarH, clampPinnedSidebarW, type Widget, type WidgetType, type PipeWidget, type PipePoint } from '../../types/scada.types';
import { useEditorStore } from '../../store/editor.store';
import { useScreenDevices } from '../../hooks/useScreenDevices';
import { useScreenTelemetry } from '../../hooks/useScreenTelemetry';
import { useScreenAlarmGroups } from '../../hooks/useScreenAlarmGroups';
import { useScreenCommand } from '../../hooks/useScreenCommand';
import { useProjectLayout } from '../../hooks/useProjectLayout';
import { WidgetRenderer } from '../widgets/WidgetRenderer';
import { scalePipePoints } from '../widgets/PipeWidget';
import { NavToolbarWidgetView } from '../widgets/NavToolbarWidget';
import { NavSidebarWidgetView } from '../widgets/NavSidebarWidget';
import { ViewerBenchPanel } from '../ViewerBenchPanel';
import { buildDefaultWidget } from './widgetDefaults';
import { resolveAssetUrl } from '../../services/scada.service';

const GRID_SIZE = 20;
const SNAP_THRESHOLD = 6; // px (na folha) — distância para "grudar" no alinhamento
const PIPE_SNAP_THRESHOLD = 12; // px (na folha) — pontas da tubulação grudam em equipamentos

/**
 * Encaixe das pontas da tubulação: procura, entre os widgets de equipamento
 * (qualquer widget que não seja tubulação nem barra fixa), a âncora mais
 * próxima do ponto — centro ou meio de cada borda — dentro do raio de snap.
 */
function computePipeEndSnap(
  p: PipePoint,
  widgets: Widget[],
  excludeId?: string,
): PipePoint | null {
  let best: PipePoint | null = null;
  let bestD = PIPE_SNAP_THRESHOLD + 0.001;
  for (const w of widgets) {
    if (w.id === excludeId || w.type === 'pipe' || isPinnedNavWidget(w)) continue;
    const cx = w.x + w.width / 2;
    const cy = w.y + w.height / 2;
    const anchors: PipePoint[] = [
      { x: cx, y: cy },              // centro
      { x: w.x, y: cy },             // borda esquerda
      { x: w.x + w.width, y: cy },   // borda direita
      { x: cx, y: w.y },             // borda superior
      { x: cx, y: w.y + w.height },  // borda inferior
    ];
    for (const a of anchors) {
      const d = Math.hypot(a.x - p.x, a.y - p.y);
      if (d < bestD) { bestD = d; best = a; }
    }
  }
  return best;
}

// Getter neutro para a renderização estática do editor (fora do Preview): os
// widgets nunca leem telemetria ao vivo — desenham a aparência de projeto.
const STATIC_GET_VALUE = () => null;

/** Calcula posição com snap de alinhamento e as linhas-guia (trás→frente). */
function computeSnap(
  px: number, py: number, w: number, h: number,
  vLines: number[], hLines: number[], threshold: number,
): { x: number; y: number; guideX: number | null; guideY: number | null } {
  let x = px, guideX: number | null = null, bestX = threshold + 0.001;
  const candX = [{ e: px, off: 0 }, { e: px + w / 2, off: w / 2 }, { e: px + w, off: w }];
  for (const line of vLines) for (const c of candX) {
    const d = Math.abs(c.e - line);
    if (d <= threshold && d < bestX) { bestX = d; x = line - c.off; guideX = line; }
  }
  let y = py, guideY: number | null = null, bestY = threshold + 0.001;
  const candY = [{ e: py, off: 0 }, { e: py + h / 2, off: h / 2 }, { e: py + h, off: h }];
  for (const line of hLines) for (const c of candY) {
    const d = Math.abs(c.e - line);
    if (d <= threshold && d < bestY) { bestY = d; y = line - c.off; guideY = line; }
  }
  return { x, y, guideX, guideY };
}

/**
 * Selo sobre a barra fixa de referência (layout do projeto vindo de OUTRA tela):
 * identifica a origem e leva ao editor da tela onde a barra é editável.
 */
function PinnedRefBadge({ sourceScreenId, sourceScreenName, style }: {
  sourceScreenId: string;
  sourceScreenName: string;
  style?: React.CSSProperties;
}) {
  return (
    <Link
      href={`/scada/editor/${sourceScreenId}`}
      onMouseDown={(e) => e.stopPropagation()}
      className="absolute flex items-center gap-1 rounded bg-slate-900/90 border border-cyan-500/50 px-1.5 py-0.5 text-[10px] text-cyan-300 hover:bg-slate-800 transition-colors"
      style={{ pointerEvents: 'auto', zIndex: 99999, ...style }}
      title={`Barra fixa do projeto — editável apenas na tela "${sourceScreenName}"`}
    >
      <Pin className="h-3 w-3" strokeWidth={1.5} />
      Layout do projeto — editar em “{sourceScreenName}”
    </Link>
  );
}

interface DragState {
  items: { id: string; origX: number; origY: number }[];
  startX: number;
  startY: number;
}

export function EditorCanvas() {
  const {
    screen, zoom, selectedIds, selectWidget, setSelection, clearSelection, addWidget, moveWidget, moveWidgets,
    updateWidget, reorderWidgets, copySelection, paste, clipboard, deleteSelected, previewMode, setPreviewMode, insertComponent,
    pipeDraw, setPipeDraw,
  } = useEditorStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [panOffset, setPanOffset] = useState({ x: 40, y: 40 });
  const [previewScale, setPreviewScale] = useState({ x: 1, y: 1 });
  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0 });
  const spaceDown = useRef(false);
  // Seleção por retângulo (marquee) na área vazia do canvas.
  const marqueeRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const resizeRef = useRef<{ handle: string; startX: number; startY: number; o: { x: number; y: number; w: number; h: number }; id: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; onWidget: boolean } | null>(null);
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  // Desenho de tubulação: vértices já clicados + posição atual do cursor (rubber band).
  const [pipePts, setPipePts] = useState<PipePoint[]>([]);
  const [pipeCursor, setPipeCursor] = useState<PipePoint | null>(null);
  // Indicador visual do encaixe da ponta da tubulação num equipamento.
  const [pipeSnap, setPipeSnap] = useState<PipePoint | null>(null);

  // Telemetria real (mesma fonte do viewer) — controladoras do projeto da tela.
  const { devices } = useScreenDevices(screen?.projectId, screen?.tenantId);
  const { getValue: getTagValue, getReading: getTagReading, getPointStatus: getTagStatus } = useScreenTelemetry(devices, devices.length > 0);
  const { getGroupAggregate } = useScreenAlarmGroups(screen?.tenantId, screen?.projectId, Boolean(screen));
  const sendCommand = useScreenCommand(devices);

  // Layout do projeto (barras fixas em outras telas) — referência não-editável.
  const { layout: projectLayout } = useProjectLayout(screen?.projectId);
  const refToolbar = projectLayout?.toolbar && projectLayout.toolbar.sourceScreenId !== screen?.id
    ? projectLayout.toolbar : null;
  const refSidebar = projectLayout?.sidebar && projectLayout.sidebar.sourceScreenId !== screen?.id
    ? projectLayout.sidebar : null;

  // Preview: a folha preenche TODA a área (sem faixas laterais nem rolagem),
  // esticando em cada eixo de forma independente.
  useEffect(() => {
    if (!previewMode || !screen || !containerRef.current) return;
    const el = containerRef.current;
    const update = () => setPreviewScale({ x: el.clientWidth / screen.width, y: el.clientHeight / screen.height });
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, [previewMode, screen]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space' && !spaceDown.current) {
        spaceDown.current = true;
        if (!previewMode && containerRef.current) containerRef.current.style.cursor = 'grab';
      }
      if (e.key === 'Escape') {
        if (previewMode) { setPreviewMode(false); return; }
        useEditorStore.getState().clearSelection();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); useEditorStore.getState().undo(); }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); useEditorStore.getState().redo(); }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !previewMode) {
        const tag = (e.target as HTMLElement).tagName;
        if (tag !== 'INPUT' && tag !== 'TEXTAREA') { e.preventDefault(); deleteSelected(); }
      }
      // Copiar / colar / setas — ignora quando o foco está em campo de texto.
      const active = document.activeElement as HTMLElement | null;
      const inField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(active?.tagName ?? '') || Boolean(active?.isContentEditable);
      // Nudge por setas: 1px, ou passo do grid com Shift. Não rola a página.
      if (!previewMode && !inField && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        const store = useEditorStore.getState();
        if (store.selectedIds.length > 0) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          store.nudgeSelection(dx, dy);
          return;
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && !previewMode && !inField) {
        e.preventDefault(); useEditorStore.getState().copySelection();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v' && !previewMode && !inField) {
        e.preventDefault(); useEditorStore.getState().paste();
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (e.code === 'Space') {
        spaceDown.current = false;
        if (containerRef.current) containerRef.current.style.cursor = 'default';
      }
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp); };
  }, [deleteSelected, previewMode, setPreviewMode]);

  // Wheel
  useEffect(() => {
    const el = containerRef.current;
    if (!el || previewMode) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      if (e.ctrlKey) {
        const store = useEditorStore.getState();
        const levels = [0.5, 0.75, 1, 1.25, 1.5];
        const idx = levels.indexOf(store.zoom);
        const delta = e.deltaY > 0 ? -1 : 1;
        const newIdx = Math.max(0, Math.min(levels.length - 1, idx + delta));
        store.setZoom(levels[newIdx]);
      } else {
        setPanOffset((prev) => ({ x: prev.x - e.deltaX, y: prev.y - e.deltaY }));
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [previewMode]);

  // ── Desenho de tubulação (clicar pontos no canvas) ─────────────────────────
  /** Coordenadas do cursor na folha (px da tela, já sem zoom). */
  function sheetPoint(e: { clientX: number; clientY: number }): PipePoint | null {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: (e.clientX - rect.left) / zoom, y: (e.clientY - rect.top) / zoom };
  }

  /** Próximo vértice: preferência a ângulos retos (segurar Alt libera o ângulo). */
  function pipeNextPoint(e: { clientX: number; clientY: number; altKey: boolean }): PipePoint | null {
    const p = sheetPoint(e);
    if (!p) return null;
    let x = Math.round(p.x / 10) * 10;
    let y = Math.round(p.y / 10) * 10;
    const last = pipePts[pipePts.length - 1];
    if (last && !e.altKey) {
      // Ortogonal: colapsa o eixo de menor deslocamento.
      if (Math.abs(x - last.x) >= Math.abs(y - last.y)) y = last.y;
      else x = last.x;
    }
    // Encaixe em equipamento próximo (Alt desativa, mesma convenção do ângulo livre).
    if (!e.altKey && screen) {
      const snap = computePipeEndSnap(p, screen.widgets);
      setPipeSnap(snap);
      if (snap) return { ...snap };
    } else {
      setPipeSnap(null);
    }
    return { x, y };
  }

  function finishPipe() {
    // Remove vértices consecutivos duplicados.
    const pts = pipePts.filter((p, i) => i === 0 || p.x !== pipePts[i - 1].x || p.y !== pipePts[i - 1].y);
    setPipePts([]);
    setPipeCursor(null);
    setPipeSnap(null);
    setPipeDraw(false);
    if (pts.length < 2) return;
    const minX = Math.min(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxX = Math.max(...pts.map((p) => p.x));
    const maxY = Math.max(...pts.map((p) => p.y));
    const w = Math.max(maxX - minX, 2);
    const h = Math.max(maxY - minY, 2);
    const widget = buildDefaultWidget('pipe', minX, minY, w, h) as PipeWidget;
    widget.points = pts.map((p) => ({ x: p.x - minX, y: p.y - minY }));
    addWidget(widget);
  }

  // Enter finaliza, Esc cancela o desenho da tubulação.
  useEffect(() => {
    if (!pipeDraw) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setPipePts([]);
        setPipeCursor(null);
        setPipeSnap(null);
        setPipeDraw(false);
      }
      if (e.key === 'Enter') { e.preventDefault(); finishPipe(); }
    }
    // capture=true para vencer o handler global de Escape (limpar seleção).
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipeDraw, pipePts]);

  // ── Edição de vértices da tubulação selecionada ─────────────────────────────
  /** Regrava os vértices (coords absolutas na folha) renormalizando o bounding box. */
  function commitPipeAbsPoints(id: string, absPts: PipePoint[]) {
    const minX = Math.min(...absPts.map((p) => p.x));
    const minY = Math.min(...absPts.map((p) => p.y));
    const w = Math.max(Math.max(...absPts.map((p) => p.x)) - minX, 2);
    const h = Math.max(Math.max(...absPts.map((p) => p.y)) - minY, 2);
    updateWidget(id, {
      x: minX, y: minY, width: w, height: h,
      points: absPts.map((p) => ({ x: p.x - minX, y: p.y - minY })),
    } as Partial<Widget>, { history: false });
  }

  /** Arraste de um vértice (idx) — Alt livre; padrão gruda no grid de 10px. */
  function startPipeVertexDrag(e: React.MouseEvent, pipe: PipeWidget, idx: number, absPtsInit?: PipePoint[]) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const absPts = absPtsInit ?? scalePipePoints(pipe).map((p) => ({ x: p.x + pipe.x, y: p.y + pipe.y }));
    const startX = e.clientX, startY = e.clientY;
    const orig = { ...absPts[idx] };
    let moved = false;
    const isEndpoint = idx === 0 || idx === absPts.length - 1;
    function onMove(ev: MouseEvent) {
      if (ev.buttons === 0) { onUp(); return; }
      const nx = orig.x + (ev.clientX - startX) / zoom;
      const ny = orig.y + (ev.clientY - startY) / zoom;
      moved = true;
      const next = [...absPts];
      // Pontas (primeiro/último vértice) grudam em equipamentos próximos (Alt desativa).
      const snap = isEndpoint && !ev.altKey
        ? computePipeEndSnap({ x: nx, y: ny }, useEditorStore.getState().screen?.widgets ?? [], pipe.id)
        : null;
      setPipeSnap(snap);
      next[idx] = snap
        ? { ...snap }
        : ev.altKey
          ? { x: Math.round(nx), y: Math.round(ny) }
          : { x: Math.round(nx / 10) * 10, y: Math.round(ny / 10) * 10 };
      absPts[idx] = next[idx];
      commitPipeAbsPoints(pipe.id, next);
    }
    function onUp() {
      setPipeSnap(null);
      if (moved) useEditorStore.getState().commitHistory();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onUp);
  }

  /** Insere um vértice no meio do trecho `segIdx` e já inicia o arraste dele. */
  function insertPipeVertex(e: React.MouseEvent, pipe: PipeWidget, segIdx: number) {
    if (e.button !== 0) return;
    const abs = scalePipePoints(pipe).map((p) => ({ x: p.x + pipe.x, y: p.y + pipe.y }));
    const mid = {
      x: Math.round((abs[segIdx].x + abs[segIdx + 1].x) / 2),
      y: Math.round((abs[segIdx].y + abs[segIdx + 1].y) / 2),
    };
    const next = [...abs.slice(0, segIdx + 1), mid, ...abs.slice(segIdx + 1)];
    commitPipeAbsPoints(pipe.id, next);
    startPipeVertexDrag(e, pipe, segIdx + 1, next);
  }

  /** Remove um vértice (duplo clique) — mantém no mínimo 2 pontos. */
  function removePipeVertex(pipe: PipeWidget, idx: number) {
    const abs = scalePipePoints(pipe).map((p) => ({ x: p.x + pipe.x, y: p.y + pipe.y }));
    if (abs.length <= 2) return;
    commitPipeAbsPoints(pipe.id, abs.filter((_, i) => i !== idx));
    useEditorStore.getState().commitHistory();
  }

  // Widget drag-move (move o grupo inteiro quando há multi-seleção)
  function onWidgetMouseDown(e: React.MouseEvent, widget: Widget) {
    if (previewMode || e.button !== 0 || !screen) return;
    // Em modo de desenho de tubulação, os cliques passam para o canvas (adicionar vértice).
    if (pipeDraw) return;
    // Travado: ignora clique/arraste na tela (não seleciona, move nem redimensiona).
    if (widget.locked) return;
    e.stopPropagation();
    const multiKey = e.ctrlKey || e.metaKey;

    // Define a seleção e o grupo a arrastar.
    let groupIds: string[];
    if (multiKey) {
      selectWidget(widget.id, true);
      groupIds = [widget.id]; // ao alternar com Ctrl, arrasta só este
    } else if (selectedIds.includes(widget.id) && selectedIds.length > 1) {
      groupIds = selectedIds; // já faz parte de uma seleção múltipla — arrasta o grupo
    } else {
      selectWidget(widget.id, false);
      groupIds = [widget.id];
    }

    const byId = new Map(screen.widgets.map((w) => [w.id, w]));
    const items = groupIds
      .map((id) => byId.get(id))
      .filter((w): w is Widget => Boolean(w))
      .map((w) => ({ id: w.id, origX: w.x, origY: w.y }));

    // O widget clicado é a âncora do grupo: o snap ao grid é calculado UMA vez
    // sobre ele e o MESMO delta é aplicado a todos (offsets internos preservados).
    const anchor = items.find((it) => it.id === widget.id) ?? items[0];
    dragRef.current = { items, startX: e.clientX, startY: e.clientY };
    let moved = false; // exige movimento mínimo — clique simples só seleciona
    function endDrag() {
      if (dragRef.current && moved) useEditorStore.getState().commitHistory();
      dragRef.current = null;
      setGuides({ x: null, y: null });
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', endDrag);
      window.removeEventListener('blur', endDrag);
    }
    function onMouseMove(ev: MouseEvent) {
      if (!dragRef.current) return;
      // mouseup perdido (fora da janela/iframe): sem botão pressionado → encerra.
      if (ev.buttons === 0) { endDrag(); return; }
      const rawDx = ev.clientX - dragRef.current.startX;
      const rawDy = ev.clientY - dragRef.current.startY;
      if (!moved && Math.abs(rawDx) < 3 && Math.abs(rawDy) < 3) return;
      moved = true;
      const dx = rawDx / zoom;
      const dy = rawDy / zoom;
      if (dragRef.current.items.length === 1 && screen) {
        const it = dragRef.current.items[0];
        const px = it.origX + dx;
        const py = it.origY + dy;
        const dragged = byId.get(it.id);
        if (!dragged) { moveWidget(it.id, px, py); return; }
        // Linhas-guia: bordas/centro dos outros widgets + bordas/centro da folha.
        const vLines: number[] = [0, screen.width / 2, screen.width];
        const hLines: number[] = [0, screen.height / 2, screen.height];
        for (const o of screen.widgets) {
          if (o.id === dragged.id || isPinnedNavWidget(o)) continue;
          vLines.push(o.x, o.x + o.width / 2, o.x + o.width);
          hLines.push(o.y, o.y + o.height / 2, o.y + o.height);
        }
        const T = SNAP_THRESHOLD / zoom;
        const s = computeSnap(px, py, dragged.width, dragged.height, vLines, hLines, T);
        const fx = s.guideX !== null ? s.x : Math.round(s.x / 10) * 10;
        const fy = s.guideY !== null ? s.y : Math.round(s.y / 10) * 10;
        updateWidget(it.id, { x: fx, y: fy }, { history: false });
        setGuides({ x: s.guideX, y: s.guideY });
      } else {
        // Snap do GRUPO: arredonda a posição da âncora ao grid e deriva um delta
        // único, aplicado igualmente a todos — as distâncias relativas nunca mudam.
        const snappedAX = Math.round((anchor.origX + dx) / 10) * 10;
        const snappedAY = Math.round((anchor.origY + dy) / 10) * 10;
        const gdx = snappedAX - anchor.origX;
        const gdy = snappedAY - anchor.origY;
        const positions = dragRef.current.items.map((it) => ({ id: it.id, x: it.origX + gdx, y: it.origY + gdy }));
        moveWidgets(positions, { history: false });
      }
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', endDrag);
    window.addEventListener('blur', endDrag);
  }

  // Redimensionar pela alça (8 direções). Não passa pela grade para evitar drift.
  function startResize(e: React.MouseEvent, handle: string, widget: Widget) {
    if (previewMode || e.button !== 0 || widget.locked) return;
    e.stopPropagation();
    e.preventDefault();
    resizeRef.current = { handle, startX: e.clientX, startY: e.clientY, o: { x: widget.x, y: widget.y, w: widget.width, h: widget.height }, id: widget.id };
    let resized = false;
    function onMove(ev: MouseEvent) {
      const r = resizeRef.current;
      if (!r) return;
      if (ev.buttons === 0) { onUp(); return; }
      const dx = (ev.clientX - r.startX) / zoom;
      const dy = (ev.clientY - r.startY) / zoom;
      const MIN = 10;
      let { x, y, w, h } = r.o;
      if (r.handle.includes('e')) w = Math.max(MIN, r.o.w + dx);
      if (r.handle.includes('s')) h = Math.max(MIN, r.o.h + dy);
      if (r.handle.includes('w')) { const nw = Math.max(MIN, r.o.w - dx); x = r.o.x + (r.o.w - nw); w = nw; }
      if (r.handle.includes('n')) { const nh = Math.max(MIN, r.o.h - dy); y = r.o.y + (r.o.h - nh); h = nh; }
      resized = true;
      updateWidget(r.id, { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) }, { history: false });
    }
    function onUp() {
      if (resizeRef.current && resized) useEditorStore.getState().commitHistory();
      resizeRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('blur', onUp);
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('blur', onUp);
  }

  function onWidgetContextMenu(e: React.MouseEvent, widget: Widget) {
    if (previewMode) return;
    e.preventDefault();
    e.stopPropagation();
    if (!selectedIds.includes(widget.id)) selectWidget(widget.id, false);
    setMenu({ x: e.clientX, y: e.clientY, onWidget: true });
  }
  function onCanvasContextMenu(e: React.MouseEvent) {
    if (previewMode) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, onWidget: false });
  }
  function bringToFront() {
    if (!screen) return;
    const order = [...screen.widgets].sort((a, b) => a.zIndex - b.zIndex).map((w) => w.id);
    const sel = order.filter((id) => selectedIds.includes(id));
    const rest = order.filter((id) => !selectedIds.includes(id));
    reorderWidgets([...rest, ...sel]);
  }
  function sendToBack() {
    if (!screen) return;
    const order = [...screen.widgets].sort((a, b) => a.zIndex - b.zIndex).map((w) => w.id);
    const sel = order.filter((id) => selectedIds.includes(id));
    const rest = order.filter((id) => !selectedIds.includes(id));
    reorderWidgets([...sel, ...rest]);
  }

  function onCanvasMouseDown(e: React.MouseEvent) {
    if (previewMode) return;
    if (menu) setMenu(null);
    if (e.button === 1 || spaceDown.current) {
      isPanning.current = true;
      panStart.current = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
      if (containerRef.current) containerRef.current.style.cursor = 'grabbing';
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    // Modo de desenho de tubulação: cada clique adiciona um vértice.
    if (pipeDraw) {
      const p = pipeNextPoint(e);
      if (p) setPipePts((prev) => [...prev, p]);
      return;
    }
    // Início de uma seleção por retângulo na área vazia (coords da folha).
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) { clearSelection(); return; }
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;
    marqueeRef.current = { startX: x, startY: y, moved: false };
    setMarquee({ x, y, w: 0, h: 0 });
  }
  function onCanvasMouseMove(e: React.MouseEvent) {
    if (isPanning.current) {
      setPanOffset({ x: e.clientX - panStart.current.x, y: e.clientY - panStart.current.y });
      return;
    }
    if (pipeDraw) {
      setPipeCursor(pipeNextPoint(e));
      return;
    }
    const m = marqueeRef.current;
    if (!m) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = (e.clientX - rect.left) / zoom;
    const cy = (e.clientY - rect.top) / zoom;
    const x = Math.min(m.startX, cx);
    const y = Math.min(m.startY, cy);
    const w = Math.abs(cx - m.startX);
    const h = Math.abs(cy - m.startY);
    if (w > 3 || h > 3) m.moved = true;
    setMarquee({ x, y, w, h });
    // Seleciona os widgets que intersectam o retângulo (ignora os travados).
    const ids = (screen?.widgets ?? [])
      .filter((wd) => !wd.locked && !isPinnedNavWidget(wd) && x < wd.x + wd.width && x + w > wd.x && y < wd.y + wd.height && y + h > wd.y)
      .map((wd) => wd.id);
    setSelection(ids);
  }
  function onCanvasMouseUp() {
    const m = marqueeRef.current;
    if (m) {
      marqueeRef.current = null;
      setMarquee(null);
      // Clique simples na área vazia (sem arrastar) → limpa a seleção.
      if (!m.moved) clearSelection();
    }
    if (isPanning.current) {
      isPanning.current = false;
      if (containerRef.current) containerRef.current.style.cursor = spaceDown.current ? 'grab' : 'default';
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    if (previewMode) return;
    e.preventDefault();
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!canvasRect) return;
    const x = Math.round(((e.clientX - canvasRect.left) / zoom) / 10) * 10;
    const y = Math.round(((e.clientY - canvasRect.top) / zoom) / 10) * 10;

    // Componente salvo da biblioteca?
    const compRaw = e.dataTransfer.getData('application/scada-component');
    if (compRaw) {
      const { componentId } = JSON.parse(compRaw) as { componentId: string };
      insertComponent(componentId, { x, y });
      return;
    }

    const raw = e.dataTransfer.getData('application/scada-widget');
    if (!raw) return;
    const { type, defaultSize, overrides } = JSON.parse(raw) as {
      type: WidgetType;
      defaultSize: { w: number; h: number };
      overrides?: Partial<Widget>;
    };
    const widget = buildDefaultWidget(type, x, y, defaultSize.w, defaultSize.h);
    addWidget(overrides ? ({ ...widget, ...overrides } as Widget) : widget);
  }, [zoom, addWidget, insertComponent, previewMode]);

  if (!screen) return null;

  const { settings } = screen;
  const bgImageUrl = resolveAssetUrl(settings.backgroundImage);
  const gridOpacity = settings.gridOpacity;
  const dotColor = `rgba(148,163,184,${(0.18 * gridOpacity).toFixed(2)})`;
  const dotGrid = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='${GRID_SIZE}' height='${GRID_SIZE}'%3E%3Ccircle cx='${GRID_SIZE / 2}' cy='${GRID_SIZE / 2}' r='1' fill='${encodeURIComponent(dotColor)}'/%3E%3C/svg%3E")`;

  const sortedWidgets = [...screen.widgets].sort((a, b) => a.zIndex - b.zIndex);
  const selWidget = selectedIds.length === 1 ? screen.widgets.find((w) => w.id === selectedIds[0]) ?? null : null;
  const runMenu = (fn: () => void) => { fn(); setMenu(null); };

  // ── Preview mode — fullscreen canvas ──────────────────────────────────────
  if (previewMode) {
    // Barras fixas do projeto: a desta tela (estado vivo do editor) tem
    // prioridade sobre a persistida em outra tela.
    const ownToolbar = screen.widgets.find((w) => w.type === 'nav-toolbar' && isPinnedNavWidget(w));
    const ownSidebar = screen.widgets.find((w) => w.type === 'nav-sidebar' && isPinnedNavWidget(w));
    const previewToolbar = (ownToolbar ?? refToolbar?.widget) as (Widget & { type: 'nav-toolbar' }) | undefined;
    const previewSidebar = (ownSidebar ?? refSidebar?.widget) as (Widget & { type: 'nav-sidebar' }) | undefined;
    const previewWidgets = sortedWidgets.filter((w) => !isPinnedNavWidget(w));
    const previewNavigate = (id: string) => useEditorStore.getState().loadScreen(id);
    return (
      <div className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden bg-slate-900">
        {previewToolbar && (
          <div style={{ height: clampPinnedToolbarH(previewToolbar.height), flexShrink: 0 }}>
            <NavToolbarWidgetView widget={previewToolbar} currentScreenId={screen.id} onNavigate={previewNavigate} />
          </div>
        )}
        <div className="flex flex-1 min-h-0 min-w-0">
          {previewSidebar && (
            <div style={{ width: clampPinnedSidebarW(previewSidebar.width), flexShrink: 0 }}>
              <NavSidebarWidgetView widget={previewSidebar} currentScreenId={screen.id} onNavigate={previewNavigate} />
            </div>
          )}
          <div ref={containerRef} className="relative flex-1 min-h-0 min-w-0 overflow-hidden flex items-center justify-center bg-slate-900">
        <div style={{
          position: 'relative',
          width: screen.width,
          height: screen.height,
          backgroundColor: settings.backgroundColor,
          backgroundImage: bgImageUrl ? `url(${bgImageUrl})` : 'none',
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          transform: `scale(${previewScale.x}, ${previewScale.y})`,
          transformOrigin: 'center center',
          flexShrink: 0,
        }}>
          {previewWidgets.map((widget) => (
            <WidgetRenderer
              key={widget.id}
              widget={widget}
              getTagValue={getTagValue}
              getTagStatus={getTagStatus}
              getTagReading={getTagReading}
              devices={devices}
              getGroupAggregate={getGroupAggregate}
              onCommand={sendCommand}
              onNavigate={(id) => useEditorStore.getState().loadScreen(id)}
              currentScreenId={screen.id}
              isEditor={false}
              screenScope={{ tenantId: screen.tenantId, siteId: screen.siteId }}
            />
          ))}
            </div>
          </div>
        </div>
        <ViewerBenchPanel devices={devices} projectId={screen.projectId} positionClassName="bottom-10 right-3" />
        <div className="pointer-events-none fixed bottom-3 right-3 rounded bg-slate-800/80 px-2 py-0.5 text-[10px] text-slate-400">
          ESC para sair
        </div>
      </div>
    );
  }

  // ── Editor mode ──────────────────────────────────────────────────────────
  // Barras fixas (desta tela OU de outra) ficam ENCAIXADAS ao redor da folha,
  // exatamente como o viewer reserva o espaço delas — a folha exibida é a
  // mesma área útil da visualização (WYSIWYG). A barra própria continua
  // selecionável/editável clicando nela no encaixe.
  const ownToolbarW = screen.widgets.find((w) => w.type === 'nav-toolbar' && isPinnedNavWidget(w));
  const ownSidebarW = screen.widgets.find((w) => w.type === 'nav-sidebar' && isPinnedNavWidget(w));
  const dockToolbar = ownToolbarW ?? refToolbar?.widget;
  const dockSidebar = ownSidebarW ?? refSidebar?.widget;
  const dockToolbarH = dockToolbar ? clampPinnedToolbarH(dockToolbar.height) : 0;
  const dockSidebarW = dockSidebar ? clampPinnedSidebarW(dockSidebar.width) : 0;
  const canvasWidgets = sortedWidgets.filter((w) => !isPinnedNavWidget(w));
  const dockSelectStyle = (id: string): React.CSSProperties =>
    selectedIds.includes(id)
      ? { outline: '1.5px solid #06B6D4', outlineOffset: -1.5 }
      : {};
  const onDockMouseDown = (e: React.MouseEvent, widget: Widget) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    selectWidget(widget.id, false);
  };
  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden bg-slate-950"
      onMouseDown={onCanvasMouseDown}
      onMouseMove={onCanvasMouseMove}
      onMouseUp={onCanvasMouseUp}
      onMouseLeave={onCanvasMouseUp}
      onDoubleClick={pipeDraw ? finishPipe : undefined}
      onContextMenu={onCanvasContextMenu}
      style={pipeDraw ? { cursor: 'crosshair' } : undefined}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <div style={{ position: 'absolute', left: panOffset.x, top: panOffset.y, transform: `scale(${zoom})`, transformOrigin: '0 0' }}>
        {/* Toolbar fixa — encaixada ACIMA da folha (mesma reserva do viewer). */}
        {dockToolbar && (
          <div
            style={{
              position: 'relative',
              width: dockSidebarW + screen.width,
              height: dockToolbarH,
              overflow: 'hidden',
              boxShadow: '0 0 0 1px rgba(6,182,212,0.3)',
              ...(ownToolbarW ? dockSelectStyle(ownToolbarW.id) : { pointerEvents: 'none', opacity: 0.85, outline: '1.5px dashed rgba(6,182,212,0.6)', outlineOffset: -1.5 }),
            }}
            onMouseDown={ownToolbarW ? (e) => onDockMouseDown(e, ownToolbarW) : undefined}
            onContextMenu={ownToolbarW ? (e) => onWidgetContextMenu(e, ownToolbarW) : undefined}
          >
            <NavToolbarWidgetView widget={dockToolbar as Widget & { type: 'nav-toolbar' }} currentScreenId={screen.id} isEditor />
            {refToolbar && !ownToolbarW && (
              <PinnedRefBadge sourceScreenId={refToolbar.sourceScreenId} sourceScreenName={refToolbar.sourceScreenName} style={{ right: 8, top: 6 }} />
            )}
          </div>
        )}
        <div style={{ display: 'flex' }}>
          {/* Sidebar fixa — encaixada à ESQUERDA da folha (mesma reserva do viewer). */}
          {dockSidebar && (
            <div
              style={{
                position: 'relative',
                width: dockSidebarW,
                height: screen.height,
                flexShrink: 0,
                overflow: 'hidden',
                boxShadow: '0 0 0 1px rgba(6,182,212,0.3)',
                ...(ownSidebarW ? dockSelectStyle(ownSidebarW.id) : { pointerEvents: 'none', opacity: 0.85, outline: '1.5px dashed rgba(6,182,212,0.6)', outlineOffset: -1.5 }),
              }}
              onMouseDown={ownSidebarW ? (e) => onDockMouseDown(e, ownSidebarW) : undefined}
              onContextMenu={ownSidebarW ? (e) => onWidgetContextMenu(e, ownSidebarW) : undefined}
            >
              <NavSidebarWidgetView widget={dockSidebar as Widget & { type: 'nav-sidebar' }} currentScreenId={screen.id} isEditor />
              {refSidebar && !ownSidebarW && (
                <PinnedRefBadge sourceScreenId={refSidebar.sourceScreenId} sourceScreenName={refSidebar.sourceScreenName} style={{ left: 8, bottom: 8 }} />
              )}
            </div>
          )}
        <div
          ref={canvasRef}
          style={{
            position: 'relative',
            width: screen.width,
            height: screen.height,
            backgroundColor: settings.backgroundColor,
            backgroundImage: bgImageUrl
              ? `${dotGrid}, url(${bgImageUrl})`
              : dotGrid,
            backgroundSize: bgImageUrl
              ? `${GRID_SIZE}px ${GRID_SIZE}px, cover`
              : `${GRID_SIZE}px ${GRID_SIZE}px`,
            backgroundPosition: bgImageUrl ? '0 0, center' : '0 0',
            boxShadow: '0 0 0 1px rgba(6,182,212,0.3), 0 8px 32px rgba(0,0,0,0.6)',
            overflow: 'hidden',
          }}
        >
          {canvasWidgets.map((widget) => (
            <WidgetRenderer
              key={widget.id}
              widget={widget}
              getTagValue={STATIC_GET_VALUE}
              isSelected={selectedIds.includes(widget.id)}
              isEditor
              staticRender
              currentScreenId={screen.id}
              onMouseDown={(e) => onWidgetMouseDown(e, widget)}
              onContextMenu={(e) => onWidgetContextMenu(e, widget)}
            />
          ))}
          {marquee && (
            <div
              style={{
                position: 'absolute', left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h,
                border: '1px solid #06B6D4', background: 'rgba(6,182,212,0.12)', pointerEvents: 'none', zIndex: 99999,
              }}
            />
          )}
          {/* Desenho de tubulação em andamento: polilinha + rubber band + vértices */}
          {pipeDraw && (
            <svg width={screen.width} height={screen.height} style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', zIndex: 100001, overflow: 'visible' }}>
              {pipePts.length > 0 && (
                <polyline
                  points={[...pipePts, ...(pipeCursor ? [pipeCursor] : [])].map((p) => `${p.x},${p.y}`).join(' ')}
                  fill="none" stroke="#22D3EE" strokeWidth={3 / zoom} strokeDasharray={`${8 / zoom} ${5 / zoom}`} strokeLinejoin="round"
                />
              )}
              {pipePts.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={4 / zoom} fill="#fff" stroke="#06B6D4" strokeWidth={1.5 / zoom} />
              ))}
              {pipePts.length === 0 && pipeCursor && (
                <circle cx={pipeCursor.x} cy={pipeCursor.y} r={4 / zoom} fill="rgba(255,255,255,0.6)" stroke="#06B6D4" strokeWidth={1.5 / zoom} />
              )}
            </svg>
          )}
          {pipeDraw && (
            <div style={{ position: 'absolute', left: 8, top: 8, zIndex: 100002, pointerEvents: 'none' }} className="rounded bg-slate-900/90 border border-cyan-500/50 px-2 py-1 text-[10px] text-cyan-300">
              Clique para adicionar vértices (Alt = ângulo livre e sem encaixe) — duplo clique/Enter finaliza, Esc cancela
            </div>
          )}
          {/* Vértices editáveis da tubulação selecionada */}
          {!previewMode && !pipeDraw && selWidget?.type === 'pipe' && !selWidget.locked && (() => {
            const pipe = selWidget as PipeWidget;
            const abs = scalePipePoints(pipe).map((p) => ({ x: p.x + pipe.x, y: p.y + pipe.y }));
            return (
              <>
                {/* Pontos médios: clique adiciona um vértice no trecho */}
                {abs.slice(0, -1).map((p, i) => {
                  const q = abs[i + 1];
                  return (
                    <div
                      key={`mid-${i}`}
                      title="Adicionar vértice"
                      // eslint-disable-next-line react-hooks/refs
                      onMouseDown={(e) => insertPipeVertex(e, pipe, i)}
                      style={{
                        position: 'absolute', left: (p.x + q.x) / 2 - 3.5 / zoom, top: (p.y + q.y) / 2 - 3.5 / zoom,
                        width: 7 / zoom, height: 7 / zoom, borderRadius: '50%',
                        background: 'rgba(6,182,212,0.35)', border: `${1 / zoom}px solid #06B6D4`,
                        cursor: 'copy', zIndex: 100000,
                      }}
                    />
                  );
                })}
                {/* Vértices: arrastar move (Alt = livre); duplo clique remove */}
                {abs.map((p, i) => (
                  <div
                    key={`v-${i}`}
                    title="Arrastar vértice — duplo clique remove"
                    // eslint-disable-next-line react-hooks/refs
                    onMouseDown={(e) => startPipeVertexDrag(e, pipe, i)}
                    onDoubleClick={(e) => { e.stopPropagation(); removePipeVertex(pipe, i); }}
                    style={{
                      position: 'absolute', left: p.x - 5 / zoom, top: p.y - 5 / zoom,
                      width: 10 / zoom, height: 10 / zoom, borderRadius: '50%',
                      background: '#fff', border: `${1.5 / zoom}px solid #06B6D4`,
                      cursor: 'grab', zIndex: 100001,
                    }}
                  />
                ))}
              </>
            );
          })()}
          {/* Alças de redimensionar (apenas com 1 widget selecionado e não travado) */}
          {!previewMode && selWidget && !selWidget.locked && selWidget.type !== 'pipe' && !isPinnedNavWidget(selWidget) && [
            { k: 'nw', c: 'nwse-resize', x: selWidget.x, y: selWidget.y },
            { k: 'n', c: 'ns-resize', x: selWidget.x + selWidget.width / 2, y: selWidget.y },
            { k: 'ne', c: 'nesw-resize', x: selWidget.x + selWidget.width, y: selWidget.y },
            { k: 'e', c: 'ew-resize', x: selWidget.x + selWidget.width, y: selWidget.y + selWidget.height / 2 },
            { k: 'se', c: 'nwse-resize', x: selWidget.x + selWidget.width, y: selWidget.y + selWidget.height },
            { k: 's', c: 'ns-resize', x: selWidget.x + selWidget.width / 2, y: selWidget.y + selWidget.height },
            { k: 'sw', c: 'nesw-resize', x: selWidget.x, y: selWidget.y + selWidget.height },
            { k: 'w', c: 'ew-resize', x: selWidget.x, y: selWidget.y + selWidget.height / 2 },
          ].map((hd) => (
            <div
              key={hd.k}
              // startResize só escreve em resizeRef dentro do handler de evento
              // (nunca durante o render) — falso positivo da regra de refs.
              // eslint-disable-next-line react-hooks/refs
              onMouseDown={(e) => startResize(e, hd.k, selWidget)}
              style={{
                position: 'absolute', left: hd.x - 4 / zoom, top: hd.y - 4 / zoom, width: 8 / zoom, height: 8 / zoom,
                background: '#fff', border: `${1 / zoom}px solid #06B6D4`, borderRadius: 2 / zoom, cursor: hd.c, zIndex: 100000,
              }}
            />
          ))}
          {/* Guias de alinhamento durante o arraste */}
          {guides.x !== null && (
            <div style={{ position: 'absolute', left: guides.x, top: 0, width: Math.max(1 / zoom, 0.5), height: screen.height, background: '#F472B6', pointerEvents: 'none', zIndex: 100002 }} />
          )}
          {guides.y !== null && (
            <div style={{ position: 'absolute', left: 0, top: guides.y, width: screen.width, height: Math.max(1 / zoom, 0.5), background: '#F472B6', pointerEvents: 'none', zIndex: 100002 }} />
          )}
          {/* Indicador de encaixe da ponta da tubulação num equipamento */}
          {pipeSnap && (
            <div
              style={{
                position: 'absolute', left: pipeSnap.x - 8 / zoom, top: pipeSnap.y - 8 / zoom,
                width: 16 / zoom, height: 16 / zoom, borderRadius: '50%',
                border: `${2 / zoom}px solid #F472B6`, background: 'rgba(244,114,182,0.25)',
                pointerEvents: 'none', zIndex: 100003,
              }}
            />
          )}
        </div>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-3 right-3 rounded bg-slate-800/80 px-2 py-0.5 text-[10px] text-slate-400 tabular-nums">
        {screen.width} × {screen.height} — {Math.round(zoom * 100)}%
      </div>

      {/* Menu de contexto (botão direito) */}
      {menu && (
        <>
          <div className="fixed inset-0 z-[100000]" onMouseDown={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }} />
          <div className="fixed z-[100001] min-w-[170px] rounded-md border border-slate-700 bg-slate-800 py-1 text-xs text-slate-200 shadow-xl" style={{ left: menu.x, top: menu.y }}>
            {menu.onWidget ? (
              <>
                <button type="button" className="flex w-full items-center px-3 py-1.5 hover:bg-slate-700" onClick={() => runMenu(copySelection)}>Copiar <span className="ml-auto text-slate-500">Ctrl+C</span></button>
                <button type="button" className="flex w-full items-center px-3 py-1.5 hover:bg-slate-700" onClick={() => runMenu(paste)}>Colar <span className="ml-auto text-slate-500">Ctrl+V</span></button>
                <button type="button" className="flex w-full items-center px-3 py-1.5 hover:bg-slate-700" onClick={() => runMenu(() => { copySelection(); paste(); })}>Duplicar</button>
                <div className="my-1 h-px bg-slate-700" />
                <button type="button" className="flex w-full items-center px-3 py-1.5 hover:bg-slate-700" onClick={() => runMenu(bringToFront)}>Trazer para frente</button>
                <button type="button" className="flex w-full items-center px-3 py-1.5 hover:bg-slate-700" onClick={() => runMenu(sendToBack)}>Enviar para trás</button>
                <div className="my-1 h-px bg-slate-700" />
                <button type="button" className="flex w-full items-center px-3 py-1.5 text-red-400 hover:bg-slate-700" onClick={() => runMenu(deleteSelected)}>Excluir <span className="ml-auto text-slate-500">Del</span></button>
              </>
            ) : (
              <button type="button" disabled={clipboard.length === 0} className="flex w-full items-center px-3 py-1.5 hover:bg-slate-700 disabled:opacity-40 disabled:hover:bg-transparent" onClick={() => runMenu(paste)}>Colar <span className="ml-auto text-slate-500">Ctrl+V</span></button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
