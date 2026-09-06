// ─── Visibilidade condicional ─────────────────────────────────────────────────

export type VisibilityOperator = 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte';
export type VisibilityBehavior = 'hide' | 'opaque';

export interface VisibilityCondition {
  mode: 'always' | 'conditional';
  deviceId?: string;
  tag?: string;
  operator?: VisibilityOperator;
  value?: number;
  behavior?: VisibilityBehavior;
}

/** Normaliza um valor de ponto para número (binário/booleano/texto → 0/1/num). */
export function toScadaNumber(raw: number | boolean | string | null | undefined): number {
  if (raw === null || raw === undefined) return NaN;
  if (typeof raw === 'boolean') return raw ? 1 : 0;
  if (typeof raw === 'number') return raw;
  const s = raw.trim().toLowerCase();
  if (['true', 'active', 'on', 'yes', '1'].includes(s)) return 1;
  if (['false', 'inactive', 'off', 'no', '0'].includes(s)) return 0;
  return Number(s);
}

// ─── Ponto único vinculado (binding unificado) ────────────────────────────────
// Um único ponto (controladora + tag) por componente serve de fonte para
// status/cor/animação e visibilidade condicional. Onde já existe binding primário
// por tipo (valor→deviceId/tag; equipamento/forma/linha→deviceId/tagStatus) esse
// mesmo ponto é reaproveitado; os demais componentes (texto, título, imagem,
// separador, área com título, navegação, hotspot) usam os campos base
// bindingDeviceId/bindingTag. Telas antigas (ponto só em status/visibility) são
// resolvidas por fallback, sem perder o vínculo salvo.

const UNIFIED_TAG_TYPES = new Set<WidgetType>([
  'value-dynamic', 'label-value-block', 'led-status', 'gauge', 'thermometer',
  'progress-bar', 'traffic-light', 'numeric-display', 'trend-arrow', 'alarm-indicator',
  'command-button', 'command-slider', 'toggle-switch', 'icon',
  'kpi-card', 'sensor-card', 'segmented-control',
  'value-stepper', 'setpoint-ring',
]);
const UNIFIED_TAGSTATUS_TYPES = new Set<WidgetType>([
  'chiller', 'pump', 'ahu', 'fan', 'valve', 'generator', 'meter', 'controller',
  'compressor', 'cooling-tower', 'fan-coil', 'electrical-panel', 'tank', 'sensor',
  'smoke-detector', 'manual-call-point', 'zone-module', 'monitor-module', 'command-module',
  'flow-switch', 'fire-panel', 'fire-siren', 'heat-detector', 'sprinkler', 'fire-hydrant',
  'fire-extinguisher', 'fire-pump', 'fire-damper', 'fire-door',
  'camera', 'lighting', 'line', 'pipe', 'rectangle', 'square', 'circle', 'ellipse', 'triangle', 'polygon',
]);

/** Lê o ponto único vinculado a um widget (com fallback para bindings legados). */
export function readWidgetBinding(w: Widget): { deviceId: string; tag: string } {
  const rec = w as unknown as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  // Retorna o deviceId do campo primário assim que ele existe, mesmo sem tag
  // (estado intermediário logo após selecionar a controladora). O fallback
  // legado só ocorre quando não há deviceId algum no campo primário.
  if (UNIFIED_TAGSTATUS_TYPES.has(w.type)) {
    const d = str(rec.deviceId);
    if (d) return { deviceId: d, tag: str(rec.tagStatus) };
  } else if (UNIFIED_TAG_TYPES.has(w.type)) {
    const d = str(rec.deviceId);
    if (d) return { deviceId: d, tag: str(rec.tag) };
  } else {
    const d = str(rec.bindingDeviceId);
    if (d) return { deviceId: d, tag: str(rec.bindingTag) };
  }
  // Fallback (telas salvas): ponto configurado apenas em status ou visibilidade.
  if (w.status?.deviceId && w.status?.tag) return { deviceId: w.status.deviceId, tag: w.status.tag };
  if (w.visibility?.deviceId && w.visibility?.tag) return { deviceId: w.visibility.deviceId, tag: w.visibility.tag };
  return { deviceId: '', tag: '' };
}

/** Grava o ponto único no campo correto do tipo (primário quando existe, senão base). */
export function writeWidgetBinding(w: Widget, deviceId: string, tag: string): Partial<Widget> {
  if (UNIFIED_TAGSTATUS_TYPES.has(w.type)) return { deviceId, tagStatus: tag } as unknown as Partial<Widget>;
  if (UNIFIED_TAG_TYPES.has(w.type)) return { deviceId, tag } as unknown as Partial<Widget>;
  return { bindingDeviceId: deviceId, bindingTag: tag } as Partial<Widget>;
}

export function evaluateVisibility(
  widget: Widget,
  getValue: (deviceId: string, tag: string) => number | boolean | string | null,
): { visible: boolean; behavior: VisibilityBehavior } {
  const cond = widget.visibility;
  if (!cond || cond.mode === 'always') return { visible: true, behavior: 'hide' };

  const behavior = cond.behavior ?? 'hide';
  const { deviceId, tag } = readWidgetBinding(widget);
  if (!deviceId || !tag) return { visible: true, behavior };

  const raw = getValue(deviceId, tag);
  const tagVal = toScadaNumber(raw);
  // Sem leitura ao vivo / valor não numérico: não dá pra avaliar — mantém visível.
  if (Number.isNaN(tagVal)) return { visible: true, behavior };

  const condVal = cond.value ?? 0;
  let met = false;

  switch (cond.operator ?? 'eq') {
    case 'eq': met = tagVal === condVal; break;
    case 'neq': met = tagVal !== condVal; break;
    case 'gt': met = tagVal > condVal; break;
    case 'lt': met = tagVal < condVal; break;
    case 'gte': met = tagVal >= condVal; break;
    case 'lte': met = tagVal <= condVal; break;
  }

  // Condição ATENDIDA → aplica a ação (ocultar/opaco); senão, visível.
  return met ? { visible: false, behavior } : { visible: true, behavior };
}

// ─── Tipos base ──────────────────────────────────────────────────────────────

export type WidgetType =
  | 'label-static'
  | 'section-title'
  | 'value-dynamic'
  | 'label-value-block'
  | 'led-status'
  | 'gauge'
  | 'progress-bar'
  | 'thermometer'
  | 'traffic-light'
  | 'numeric-display'
  | 'trend-arrow'
  | 'alarm-indicator'
  | 'alarm-counter'
  | 'alarm-group-badge'
  | 'device-counter'
  | 'chiller'
  | 'pump'
  | 'ahu'
  | 'fan'
  | 'valve'
  | 'generator'
  | 'meter'
  | 'controller'
  | 'compressor'
  | 'cooling-tower'
  | 'fan-coil'
  | 'electrical-panel'
  | 'tank'
  | 'sensor'
  | 'smoke-detector'
  | 'manual-call-point'
  | 'zone-module'
  | 'monitor-module'
  | 'command-module'
  | 'flow-switch'
  | 'fire-panel'
  | 'fire-siren'
  | 'heat-detector'
  | 'sprinkler'
  | 'fire-hydrant'
  | 'fire-extinguisher'
  | 'fire-pump'
  | 'fire-damper'
  | 'fire-door'
  | 'camera'
  | 'lighting'
  | 'line'
  | 'pipe'
  | 'rectangle'
  | 'square'
  | 'circle'
  | 'ellipse'
  | 'triangle'
  | 'polygon'
  | 'titled-area'
  | 'separator'
  | 'image'
  | 'hotspot'
  | 'nav-sidebar'
  | 'nav-toolbar'
  | 'nav-button'
  | 'command-button'
  | 'command-slider'
  | 'toggle-switch'
  | 'icon'
  | 'kpi-card'
  | 'sensor-card'
  | 'dash-chart'
  | 'bar-list'
  | 'event-feed'
  | 'point-table'
  | 'segmented-control'
  | 'value-stepper'
  | 'setpoint-ring'
  | 'equipment-card'
  | 'climate-card'
  | 'component-instance';

// ─── Popups associados a widgets ──────────────────────────────────────────────

export type ScadaPopupTrigger = 'hover' | 'click' | 'hover-click';
export type ScadaPopupPlacement = 'auto' | 'top' | 'right' | 'bottom' | 'left';

/**
 * Composição local de um widget. O popup vive dentro do JSON da tela e não é
 * uma nova tela/rota. `widgets` usa exatamente o mesmo contrato dos widgets
 * da tela hospedeira para que bindings, estados e comandos continuem sendo
 * resolvidos pelo mesmo contexto.
 */
export interface ScadaPopupConfig {
  enabled: boolean;
  trigger: ScadaPopupTrigger;
  title: string;
  width: number;
  height: number;
  backgroundColor: string;
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
  shadow: boolean;
  closeOnOutside: boolean;
  closeOnEscape: boolean;
  placement: ScadaPopupPlacement;
  offset: number;
  widgets: Widget[];
}

export const SCADA_POPUP_DEFAULTS: Omit<ScadaPopupConfig, 'widgets'> = {
  enabled: false,
  trigger: 'click',
  title: 'Detalhes',
  width: 360,
  height: 240,
  backgroundColor: '#0F172A',
  borderColor: '#334155',
  borderWidth: 1,
  borderRadius: 12,
  shadow: true,
  closeOnOutside: true,
  closeOnEscape: true,
  placement: 'auto',
  offset: 12,
};

export const SCADA_POPUP_MIN_WIDTH = 180;
export const SCADA_POPUP_MAX_WIDTH = 900;
export const SCADA_POPUP_MIN_HEIGHT = 120;
export const SCADA_POPUP_MAX_HEIGHT = 700;

function normalizeScadaPopupDimension(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
}

/** Normaliza a largura configurável, mantendo um tamanho útil para o editor. */
export function normalizeScadaPopupWidth(value: unknown): number {
  return normalizeScadaPopupDimension(value, SCADA_POPUP_DEFAULTS.width, SCADA_POPUP_MIN_WIDTH, SCADA_POPUP_MAX_WIDTH);
}

/** Normaliza a altura configurável, mantendo um tamanho útil para o editor. */
export function normalizeScadaPopupHeight(value: unknown): number {
  return normalizeScadaPopupDimension(value, SCADA_POPUP_DEFAULTS.height, SCADA_POPUP_MIN_HEIGHT, SCADA_POPUP_MAX_HEIGHT);
}

export function createScadaPopupDefaults(): ScadaPopupConfig {
  return { ...SCADA_POPUP_DEFAULTS, widgets: [] };
}

/**
 * Sanitiza configurações vindas do JSON opaco da API. Popups ausentes seguem
 * ausentes (compatibilidade visual); popups presentes, mas incompletos, viram
 * uma configuração segura desabilitada. Filhos nunca carregam outro popup.
 */
export function normalizeScadaPopup(value: unknown): ScadaPopupConfig | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {};
  const number = (candidate: unknown, fallback: number, min: number, max: number) => {
    const n = typeof candidate === 'number' ? candidate : Number(candidate);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };
  const string = (candidate: unknown, fallback: string) =>
    typeof candidate === 'string' && candidate.trim() ? candidate : fallback;
  const trigger: ScadaPopupTrigger =
    raw.trigger === 'hover' || raw.trigger === 'click' || raw.trigger === 'hover-click'
      ? raw.trigger : SCADA_POPUP_DEFAULTS.trigger;
  const placement: ScadaPopupPlacement =
    raw.placement === 'top' || raw.placement === 'right' ||
    raw.placement === 'bottom' || raw.placement === 'left' || raw.placement === 'auto'
      ? raw.placement : SCADA_POPUP_DEFAULTS.placement;
  const rawWidgets = Array.isArray(raw.widgets)
    ? raw.widgets
    : Array.isArray(raw.children) ? raw.children : [];
  const widgets = rawWidgets
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => {
      const child = stripNestedScadaPopups(item) as Record<string, unknown>;
      if (child.type === 'polygon') {
        child.points = normalizeScadaPolygonPoints(child.points, child.width, child.height);
      }
      return child as unknown as Widget;
    });
  return {
    enabled: raw.enabled === true,
    trigger,
    title: string(raw.title, SCADA_POPUP_DEFAULTS.title),
    width: normalizeScadaPopupWidth(raw.width),
    height: normalizeScadaPopupHeight(raw.height),
    backgroundColor: string(raw.backgroundColor, SCADA_POPUP_DEFAULTS.backgroundColor),
    borderColor: string(raw.borderColor, SCADA_POPUP_DEFAULTS.borderColor),
    borderWidth: number(raw.borderWidth, SCADA_POPUP_DEFAULTS.borderWidth, 0, 8),
    borderRadius: number(raw.borderRadius, SCADA_POPUP_DEFAULTS.borderRadius, 0, 32),
    shadow: raw.shadow !== false,
    closeOnOutside: raw.closeOnOutside !== false,
    closeOnEscape: raw.closeOnEscape !== false,
    placement,
    offset: number(raw.offset, SCADA_POPUP_DEFAULTS.offset, 0, 48),
    widgets,
  };
}

/** Widgets que podem hospedar um popup genérico; instâncias já são composições. */
export function canConfigureScadaPopup(widget: Widget | unknown): boolean {
  return Boolean(widget && typeof widget === 'object' &&
    (widget as { type?: unknown }).type !== 'component-instance');
}

export function scadaPopupOpensOnHover(trigger: ScadaPopupTrigger): boolean {
  return trigger === 'hover' || trigger === 'hover-click';
}

export function scadaPopupOpensOnClick(trigger: ScadaPopupTrigger): boolean {
  return trigger === 'click' || trigger === 'hover-click';
}

export interface ScadaPopupRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/** Posicionamento puro, usado pelo runtime e coberto sem depender do DOM. */
export function resolveScadaPopupPosition(
  anchor: ScadaPopupRect,
  popupSize: { width: number; height: number },
  placement: ScadaPopupPlacement,
  offset: number,
  bounds: ScadaPopupRect,
): { left: number; top: number; placement: Exclude<ScadaPopupPlacement, 'auto'> } {
  const marginX = Math.min(8, Math.max(0, bounds.width / 2));
  const marginY = Math.min(8, Math.max(0, bounds.height / 2));
  // A very narrow viewport can be smaller than the configured minimum. Use the
  // actual available size for both placement and clamping so the panel never
  // escapes the viewport (the renderer clips its composition in that case).
  const width = Math.min(popupSize.width, Math.max(0, bounds.width - marginX * 2));
  const height = Math.min(popupSize.height, Math.max(0, bounds.height - marginY * 2));
  const candidates: Exclude<ScadaPopupPlacement, 'auto'>[] = placement === 'auto'
    ? ['bottom', 'right', 'top', 'left']
    : [placement, placement === 'top' ? 'bottom' : placement === 'bottom' ? 'top' : placement === 'left' ? 'right' : 'left'];
  const raw = (side: Exclude<ScadaPopupPlacement, 'auto'>) => {
    switch (side) {
      case 'top': return { left: anchor.left + (anchor.width - width) / 2, top: anchor.top - height - offset };
      case 'left': return { left: anchor.left - width - offset, top: anchor.top + (anchor.height - height) / 2 };
      case 'right': return { left: anchor.right + offset, top: anchor.top + (anchor.height - height) / 2 };
      default: return { left: anchor.left + (anchor.width - width) / 2, top: anchor.bottom + offset };
    }
  };
  // Decide o lado pelo eixo principal; o eixo transversal pode ser clampado
  // sem trocar uma posição semanticamente boa (ex.: "acima", mas perto do canto).
  const fitsSide = (side: Exclude<ScadaPopupPlacement, 'auto'>) => {
    const point = raw(side);
    if (side === 'top') return point.top >= bounds.top + marginY;
    if (side === 'bottom') return point.top + height <= bounds.bottom - marginY;
    if (side === 'left') return point.left >= bounds.left + marginX;
    return point.left + width <= bounds.right - marginX;
  };
  const chosen = candidates.find(fitsSide) ?? candidates[0];
  const point = raw(chosen);
  return {
    left: Math.max(bounds.left + marginX, Math.min(bounds.right - width - marginX, point.left)),
    top: Math.max(bounds.top + marginY, Math.min(bounds.bottom - height - marginY, point.top)),
    placement: chosen,
  };
}

function stripNestedScadaPopups(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripNestedScadaPopups);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = { ...record };
  delete result.popup;
  for (const [key, child] of Object.entries(result)) {
    if (child && typeof child === 'object') result[key] = stripNestedScadaPopups(child);
  }
  return result;
}

export interface PolygonPoint { x: number; y: number }

const DEFAULT_POLYGON_POINTS: PolygonPoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 0.82, y: 1 },
  { x: 0.18, y: 1 },
];

function finiteDimension(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Keeps polygon geometry safe at the persistence boundary. Points are stored
 * relative to the widget box, with their own bounding box normalized to the
 * current width/height so old or hand-edited JSON cannot render outside it.
 */
export function normalizeScadaPolygonPoints(value: unknown, width?: unknown, height?: unknown): PolygonPoint[] {
  const w = finiteDimension(width, 120);
  const h = finiteDimension(height, 100);
  const source = Array.isArray(value)
    ? value
      .map((point) => {
        if (!point || typeof point !== 'object') return null;
        const record = point as Record<string, unknown>;
        const x = Number(record.x);
        const y = Number(record.y);
        return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
      })
      .filter((point): point is PolygonPoint => point !== null)
    : [];
  if (source.length < 3) {
    return DEFAULT_POLYGON_POINTS.map((point) => ({ x: point.x * w, y: point.y * h }));
  }
  const minX = Math.min(...source.map((point) => point.x));
  const maxX = Math.max(...source.map((point) => point.x));
  const minY = Math.min(...source.map((point) => point.y));
  const maxY = Math.max(...source.map((point) => point.y));
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  return source.map((point) => ({
    x: spanX > 0 ? ((point.x - minX) / spanX) * w : w / 2,
    y: spanY > 0 ? ((point.y - minY) / spanY) * h : h / 2,
  }));
}

/** Scales an already-normalized polygon when its widget box changes size. */
export function scaleScadaPolygonPoints(
  value: unknown,
  oldWidth: number,
  oldHeight: number,
  newWidth: number,
  newHeight: number,
): PolygonPoint[] {
  const oldW = finiteDimension(oldWidth, 120);
  const oldH = finiteDimension(oldHeight, 100);
  const nextW = finiteDimension(newWidth, oldW);
  const nextH = finiteDimension(newHeight, oldH);
  const points = normalizeScadaPolygonPoints(value, oldW, oldH);
  return points.map((point) => ({
    x: (point.x / oldW) * nextW,
    y: (point.y / oldH) * nextH,
  }));
}

/** Normaliza popups dos widgets da tela sem alterar campos desconhecidos. */
export function normalizeScadaWidgets(widgets: unknown[]): Widget[] {
  return widgets
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((raw) => {
      const next = { ...raw } as Record<string, unknown>;
      if ('popup' in next) next.popup = normalizeScadaPopup(next.popup);
      if (next.type === 'polygon') {
        next.points = normalizeScadaPolygonPoints(next.points, next.width, next.height);
      }
      if (next.type === 'component-instance' && Array.isArray(next.children)) {
        next.children = normalizeScadaWidgets(next.children).map((child) => {
          const copy = { ...child } as Record<string, unknown>;
          delete copy.popup;
          return copy as unknown as Widget;
        });
      }
      return next as unknown as Widget;
    });
}

// ─── Ação ao clicar (qualquer widget visual) ─────────────────────────────────

export type ClickActionType = 'none' | 'command' | 'navigate';
export type ClickActionCommandMode = 'set' | 'toggle';

/**
 * Ação genérica de clique configurável em qualquer widget visual (ícone, forma,
 * equipamento, texto etc.). Opcional — telas antigas seguem inertes. Widgets que
 * já têm interação própria (comando, navegação, hotspot, câmera) não a usam.
 * Só executa no viewer/Preview (isEditor=false); no editor o clique só seleciona.
 */
export interface ClickAction {
  type: ClickActionType;
  // type='command' — escrever valor em um ponto comandável (BACnet AO/AV/BO/BV/MSO
  // ou MQTT com tópico de comando), mesma validação dos widgets de comando.
  deviceId?: string;
  tag?: string;
  /** 'set' envia `value`; 'toggle' alterna entre onValue/offValue pelo valor atual. */
  commandMode?: ClickActionCommandMode;
  value?: number;
  onValue?: number;   // padrão 1
  offValue?: number;  // padrão 0
  priority?: number;  // BACnet 1–16, padrão 8
  confirm?: boolean;  // pedir confirmação antes de enviar
  // type='navigate'
  targetScreenId?: string;
}

/** Tipos com interação de clique própria — nunca recebem a ação genérica. */
export const CLICK_ACTION_EXCLUDED_TYPES = new Set<WidgetType>([
  'command-button', 'command-slider', 'toggle-switch', 'hotspot',
  'nav-sidebar', 'nav-toolbar', 'nav-button', 'camera', 'segmented-control',
  'value-stepper', 'equipment-card', 'climate-card',
]);

/** true quando a ação de clique do widget está configurada e completa. */
export function hasClickAction(w: Widget): boolean {
  const a = w.clickAction;
  if (!a || a.type === 'none' || CLICK_ACTION_EXCLUDED_TYPES.has(w.type)) return false;
  if (a.type === 'navigate') return Boolean(a.targetScreenId);
  return Boolean(a.deviceId && a.tag);
}

/**
 * Retorna true quando a composição possui pelo menos um vínculo de telemetria.
 * O JSON é recursivo porque cards, tabelas e séries guardam referências dentro
 * de listas próprias. IDs vazios são considerados placeholders, não vínculos.
 */
export function hasScreenTelemetryBindings(widgets: unknown[]): boolean {
  const bindingKeys = new Set([
    'deviceId',
    'deviceIds',
    'tag',
    'tagStatus',
    'bindingDeviceId',
    'bindingTag',
    'flowDeviceId',
    'flowTag',
    'statusDeviceId',
    'statusTag',
  ]);

  function visit(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(visit);
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
      if (bindingKeys.has(key)) {
        if (Array.isArray(child)) {
          if (child.some((item) => typeof item === 'string' && item.trim())) return true;
        } else if (typeof child === 'string' ? child.trim() : child !== null && child !== undefined) {
          return true;
        }
      }
      return visit(child);
    });
  }

  return visit(widgets);
}

export interface WidgetBase {
  id: string;
  type: WidgetType;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  visible: boolean;
  /** Travado no editor: não pode ser selecionado/movido/redimensionado na tela. */
  locked?: boolean;
  /**
   * Identificação exclusiva do editor. Não é conteúdo visual e não deve ser
   * renderizada no Preview/viewer. Ausente = telas antigas usam o fallback.
   */
  editorLabel?: string;
  zIndex: number;
  visibility?: VisibilityCondition;
  /** Status genérico por ponto (recolore/anima/relabela qualquer widget). */
  status?: StatusBinding;
  /**
   * Ponto único vinculado no nível base — fonte para status/animação/visibilidade
   * nos componentes que não têm binding primário próprio (texto, título, imagem,
   * formas de layout sem cor por estado, separador, área com título, navegação).
   */
  bindingDeviceId?: string;
  bindingTag?: string;
  /** Ação genérica ao clicar (viewer): enviar comando ou navegar. Opcional. */
  clickAction?: ClickAction;
  /**
   * Realce visual ao passar o mouse. Ausente em telas antigas = desabilitado e
   * mantém qualquer hover legado do widget (hotspot/navegação).
   */
  hover?: ScadaHoverConfig;
  /**
   * Espaçamento interno uniforme (px por lado) dos widgets visuais aplicáveis
   * (equipamento, imagem, formas, bloco rótulo/valor). AUSENTE = comportamento
   * legado (equipamento reserva ~22% p/ glow/LED; demais sem margem), preservando
   * telas salvas. 0 = conteúdo preenche praticamente todo o widget.
   */
  padding?: number;
  /**
   * Rotação visual em graus (sentido horário, em torno do centro). AUSENTE ou 0
   * = sem rotação (comportamento legado). Aplicada no wrapper compartilhado do
   * WidgetRenderer, valendo igual em editor, preview e viewer.
   */
  rotation?: number;
  /** Composição opcional exibida ancorada a este widget no runtime. */
  popup?: ScadaPopupConfig;
}

// ─── Hover configurável ───────────────────────────────────────────────────────

export type ScadaHoverTarget = 'border' | 'content' | 'text';
export type ScadaHoverEasing = 'ease' | 'ease-in-out' | 'ease-out' | 'linear';

export interface ScadaHoverCapabilities {
  /** Superfícies que o widget consegue colorir sem criar uma superfície nova. */
  targets: ScadaHoverTarget[];
}

const HOVER_BORDER_TYPES = new Set<WidgetType>([
  'section-title', 'icon', 'led-status', 'gauge', 'progress-bar', 'thermometer', 'traffic-light',
  'alarm-indicator', 'line', 'pipe',
  'rectangle', 'square', 'circle', 'ellipse', 'triangle', 'polygon', 'titled-area',
  'hotspot', 'command-button', 'command-slider', 'toggle-switch',
  'alarm-group-badge', 'device-counter', 'kpi-card', 'sensor-card', 'dash-chart',
  'bar-list', 'event-feed', 'point-table', 'segmented-control', 'value-stepper',
  'setpoint-ring', 'equipment-card', 'climate-card',
]);

const HOVER_CONTENT_TYPES = new Set<WidgetType>([
  'led-status', 'gauge', 'progress-bar', 'thermometer', 'traffic-light',
  'label-static', 'label-value-block', 'rectangle', 'square', 'circle', 'ellipse',
  'triangle', 'polygon', 'titled-area', 'hotspot', 'nav-sidebar', 'nav-toolbar', 'nav-button',
  'command-button', 'command-slider', 'toggle-switch', 'alarm-group-badge',
  'device-counter', 'kpi-card', 'sensor-card', 'dash-chart', 'bar-list',
  'event-feed', 'point-table', 'segmented-control', 'value-stepper', 'setpoint-ring',
  'equipment-card', 'climate-card',
]);

const HOVER_TEXT_TYPES = new Set<WidgetType>([
  'label-static', 'section-title', 'value-dynamic', 'label-value-block',
  'gauge', 'progress-bar', 'thermometer', 'numeric-display', 'command-button', 'command-slider', 'toggle-switch',
  'alarm-group-badge', 'device-counter', 'kpi-card', 'sensor-card', 'dash-chart',
  'bar-list', 'event-feed', 'point-table', 'segmented-control', 'value-stepper',
  'setpoint-ring', 'equipment-card', 'climate-card', 'nav-sidebar', 'nav-toolbar',
  'nav-button', 'hotspot', 'camera',
]);

const SCADA_EQUIPMENT_TYPES = new Set<string>([
  'chiller', 'pump', 'ahu', 'fan', 'valve', 'generator', 'meter', 'controller',
  'compressor', 'cooling-tower', 'fan-coil', 'electrical-panel', 'tank', 'sensor',
  'smoke-detector', 'manual-call-point', 'zone-module', 'monitor-module',
  'command-module', 'flow-switch', 'fire-panel', 'fire-siren', 'heat-detector',
  'sprinkler', 'fire-hydrant', 'fire-extinguisher', 'fire-pump', 'fire-damper',
  'fire-door', 'camera', 'lighting',
]);

/**
 * Declara as superfícies que existem de verdade no renderer de cada widget.
 * A lista é deliberadamente conservadora: PNGs e renders de equipamento não
 * ganham uma moldura artificial só porque o painel oferece um alvo de borda.
 *
 * A função recebe `unknown` para também ser segura ao abrir JSON de telas
 * antigas ou parcialmente migradas.
 */
export function getScadaHoverCapabilities(widget: Widget | unknown): ScadaHoverCapabilities {
  if (!widget || typeof widget !== 'object') return { targets: [] };
  const w = widget as Widget;
  const targets: ScadaHoverTarget[] = [];
  const add = (target: ScadaHoverTarget, enabled: boolean) => {
    if (enabled && !targets.includes(target)) targets.push(target);
  };
  const remove = (target: ScadaHoverTarget) => {
    const index = targets.indexOf(target);
    if (index >= 0) targets.splice(index, 1);
  };

  add('border', HOVER_BORDER_TYPES.has(w.type));
  add('content', HOVER_CONTENT_TYPES.has(w.type));
  add('text', HOVER_TEXT_TYPES.has(w.type));

  const rec = widget as Record<string, unknown>;
  const hasText = (value: unknown) => typeof value === 'string' && value.trim().length > 0;
  if (w.type === 'label-static') {
    if (!(hasText(rec.backgroundColor) && rec.backgroundColor !== 'transparent')) remove('content');
    if (!hasText(rec.text)) remove('text');
  }
  if (w.type === 'section-title' && !hasText(rec.text)) remove('text');
  if (w.type === 'label-value-block' && !(hasText(rec.label) || hasText(rec.unit))) remove('text');
  if (w.type === 'icon') {
    // An uploaded icon is an image and must not be recolored or outlined.
    if (hasText(rec.iconAssetUrl)) {
      return { targets: rec.tileEnabled === true ? ['content'] : [] };
    }
    return { targets: ['border', ...(rec.tileEnabled === true ? ['content' as const] : [])] };
  }
  if (w.type === 'rectangle' || w.type === 'square' || w.type === 'circle' ||
      w.type === 'ellipse' || w.type === 'triangle' || w.type === 'polygon') {
    add('content', rec.fillEnabled !== false);
  }
  if (w.type === 'image') return { targets: [] };
  if (w.type === 'hotspot' && rec.shape === 'invisible') {
    remove('border');
    remove('content');
  }
  if (w.type === 'camera' || SCADA_EQUIPMENT_TYPES.has(w.type)) {
    const hasVisibleLabel = rec.showLabel !== false && (
      w.type === 'camera' || hasText(rec.labelText)
    );
    if (!hasVisibleLabel) {
      remove('text');
    }
  }
  if (w.type === 'component-instance') {
    const childTargets = new Set<ScadaHoverTarget>();
    for (const child of Array.isArray(rec.children) ? rec.children : []) {
      for (const target of getScadaHoverCapabilities(child).targets) childTargets.add(target);
    }
    return { targets: [...childTargets] };
  }
  return { targets };
}

/** Alias legível para consumers que tratam capacidades como uma consulta. */
export const scadaHoverCapabilities = getScadaHoverCapabilities;

export interface ScadaHoverConfig {
  enabled: boolean;
  /** Alvos independentes: border = borda, content = preenchimento, text = texto. */
  targets: ScadaHoverTarget[];
  borderColor: string;
  contentColor: string;
  textColor: string;
  /** Duração da transição em milissegundos (0–1000). */
  transitionMs: number;
  easing: ScadaHoverEasing;
}

export const SCADA_HOVER_DEFAULT_TRANSITION_MS = 180;
export const SCADA_HOVER_MAX_TRANSITION_MS = 1000;
export const SCADA_HOVER_DEFAULTS: Omit<ScadaHoverConfig, 'targets'> = {
  enabled: false,
  borderColor: '#22D3EE',
  contentColor: 'rgba(34,211,238,0.12)',
  textColor: '#67E8F9',
  transitionMs: SCADA_HOVER_DEFAULT_TRANSITION_MS,
  easing: 'ease-out',
};

/** Cria defaults novos sem compartilhar arrays/objetos entre widgets. */
export function createScadaHoverDefaults(): ScadaHoverConfig {
  return { ...SCADA_HOVER_DEFAULTS, targets: [] };
}

/**
 * Normaliza configurações lidas do JSON da tela. A propriedade ausente é
 * deliberadamente preservada como `undefined`, para que telas antigas não
 * ganhem o hover novo nem percam o hover legado.
 */
export function normalizeScadaHover(value: unknown): ScadaHoverConfig | undefined {
  if (value === undefined || value === null) return undefined;
  const raw = typeof value === 'object' && value !== null
    ? value as Record<string, unknown>
    : {};
  const targets = Array.isArray(raw.targets)
    ? [...new Set(raw.targets.filter((target): target is ScadaHoverTarget =>
      target === 'border' || target === 'content' || target === 'text',
    ))]
    : [];
  const color = (candidate: unknown, fallback: string): string =>
    typeof candidate === 'string' && candidate.trim() ? candidate : fallback;
  const duration = typeof raw.transitionMs === 'number'
    ? raw.transitionMs
    : typeof raw.transitionMs === 'string'
      ? Number(raw.transitionMs)
      : NaN;
  const easing = raw.easing === 'ease' || raw.easing === 'ease-in-out' ||
    raw.easing === 'ease-out' || raw.easing === 'linear'
    ? raw.easing
    : SCADA_HOVER_DEFAULTS.easing;
  return {
    enabled: raw.enabled === true,
    targets,
    borderColor: color(raw.borderColor, SCADA_HOVER_DEFAULTS.borderColor),
    contentColor: color(raw.contentColor, SCADA_HOVER_DEFAULTS.contentColor),
    textColor: color(raw.textColor, SCADA_HOVER_DEFAULTS.textColor),
    transitionMs: Number.isFinite(duration)
      ? Math.min(Math.max(Math.round(duration), 0), SCADA_HOVER_MAX_TRANSITION_MS)
      : SCADA_HOVER_DEFAULT_TRANSITION_MS,
    easing,
  };
}

// ─── Texto ───────────────────────────────────────────────────────────────────

export interface LabelStaticWidget extends WidgetBase {
  type: 'label-static';
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: 'normal' | 'medium' | 'semibold' | 'bold';
  fontStyle: 'normal' | 'italic';
  color: string;
  align: 'left' | 'center' | 'right';
  backgroundColor?: string;
  borderRadius?: number;
}

export interface SectionTitleWidget extends WidgetBase {
  type: 'section-title';
  text: string;
  fontSize: number;
  color: string;
  lineColor: string;
  fontWeight: 'normal' | 'medium' | 'semibold' | 'bold';
}

// ─── Dinâmicos ────────────────────────────────────────────────────────────────

export interface ValueDynamicWidget extends WidgetBase {
  type: 'value-dynamic';
  deviceId: string;
  tag: string;
  unit: string;
  decimals: number;
  fontFamily: string;
  fontSize: number;
  /** Cor base do texto (telas antigas gravaram aqui a "cor normal"). */
  colorNormal: string;
  /** Legado: mantido só para leitura de telas antigas; ignorado no render. */
  colorAlarm?: string;
  colorOffline: string;
}

export interface LabelValueBlockWidget extends WidgetBase {
  type: 'label-value-block';
  label: string;
  deviceId: string;
  tag: string;
  unit: string;
  decimals: number;
  fontFamily: string;
  fontSize: number;
  colorNormal: string;
  colorAlarm: string;
  colorOffline: string;
  backgroundColor: string;
  borderRadius: number;
}

// ─── Indicadores ─────────────────────────────────────────────────────────────

export interface LedStatusWidget extends WidgetBase {
  type: 'led-status';
  deviceId: string;
  tag: string;
  colorOn: string;
  colorOff: string;
  colorOffline: string;
  size: number;
  pulseOnAlarm: boolean;
}

export interface GaugeWidget extends WidgetBase {
  type: 'gauge';
  deviceId: string;
  tag: string;
  minValue: number;
  maxValue: number;
  unit: string;
  colorNormal: string;
  colorAlarm: string;
  showValue: boolean;
}

export interface ThermometerWidget extends WidgetBase {
  type: 'thermometer';
  deviceId: string;
  tag: string;
  minValue: number;
  maxValue: number;
  unit: string;
  colorNormal: string;
  colorAlarm: string;
  showValue: boolean;
}

export interface ProgressBarWidget extends WidgetBase {
  type: 'progress-bar';
  deviceId: string;
  tag: string;
  minValue: number;
  maxValue: number;
  unit: string;
  colorNormal: string;
  colorAlarm: string;
  showValue: boolean;
}

export interface TrafficLightWidget extends WidgetBase {
  type: 'traffic-light';
  deviceId: string;
  tag: string;
  valueGreen: number;
  valueYellow: number;
  valueRed: number;
}

export interface NumericDisplayWidget extends WidgetBase {
  type: 'numeric-display';
  deviceId: string;
  tag: string;
  unit: string;
  decimals: number;
  color: string;
}

export interface TrendArrowWidget extends WidgetBase {
  type: 'trend-arrow';
  deviceId: string;
  tag: string;
  threshold: number;
  colorUp: string;
  colorDown: string;
}

// ─── Equipamentos ─────────────────────────────────────────────────────────────

export type ScadaEquipmentType =
  | 'chiller'
  | 'pump'
  | 'ahu'
  | 'fan'
  | 'valve'
  | 'generator'
  | 'meter'
  | 'controller'
  | 'compressor'
  | 'cooling-tower'
  | 'fan-coil'
  | 'electrical-panel'
  | 'tank'
  | 'sensor'
  | 'smoke-detector'
  | 'manual-call-point'
  | 'zone-module'
  | 'monitor-module'
  | 'command-module'
  | 'flow-switch'
  | 'fire-panel'
  | 'fire-siren'
  | 'heat-detector'
  | 'sprinkler'
  | 'fire-hydrant'
  | 'fire-extinguisher'
  | 'fire-pump'
  | 'fire-damper'
  | 'fire-door'
  | 'camera'
  | 'lighting';

export type ScadaAnimation =
  | 'none' | 'pulse' | 'spin' | 'blink' | 'fade'
  | 'sway' | 'wave' | 'glow' | 'slide' | 'shake';

/**
 * Mapa único (fonte da verdade) das animações de estado → shorthand CSS.
 * Reutilizado pelo widget de equipamento e pelo status genérico por ponto, para
 * que qualquer animação nova apareça igual em todos os widgets. As animações só
 * rodam no Preview/viewer ao vivo; no modo de edição estático não há estado.
 */
export const SCADA_ANIMATION_CSS: Record<Exclude<ScadaAnimation, 'none'>, string> = {
  pulse: 'scada-pulse 1.6s ease-in-out infinite',
  blink: 'scada-blink 1s step-start infinite',
  spin: 'scada-spin 2.4s linear infinite',
  fade: 'scada-fade 1.8s ease-in-out infinite',
  sway: 'scada-sway 1.8s ease-in-out infinite',
  wave: 'scada-wave 2s ease-in-out infinite',
  glow: 'scada-glow 1.5s ease-in-out infinite',
  slide: 'scada-slide 1.8s ease-in-out infinite',
  shake: 'scada-shake 0.5s ease-in-out infinite',
};

/** Retorna o shorthand CSS de uma animação de estado (ou undefined p/ 'none'). */
export function scadaAnimationCss(anim: ScadaAnimation): string | undefined {
  return anim === 'none' ? undefined : SCADA_ANIMATION_CSS[anim];
}

/**
 * Cor "sem cor" (transparente) escolhida no editor. Valor armazenado como
 * string CSS 'transparent' no JSON do widget — hex existentes seguem válidos.
 */
export const SCADA_TRANSPARENT = 'transparent';

/** True quando a cor representa "sem cor" (transparente total). */
export function isTransparentColor(color: string | undefined | null): boolean {
  return !color || color.trim().toLowerCase() === SCADA_TRANSPARENT;
}

/**
 * Concatena sufixo de opacidade hex (ex.: '66') a uma cor #rrggbb.
 * Para 'transparent' (ou cores não-hex) devolve 'transparent' — assim efeitos
 * de brilho/boxShadow que dependem de `${color}66` ficam invisíveis em vez de
 * gerar uma string CSS inválida (ex.: 'transparent66').
 */
export function scadaColorWithAlpha(color: string, alphaHex: string): string {
  if (isTransparentColor(color)) return SCADA_TRANSPARENT;
  if (isGradientColor(color)) return scadaGradientStop(color, 'from');
  if (!color.startsWith('#')) return color;
  return `${color}${alphaHex}`;
}

// ─── Cor gradiente ───────────────────────────────────────────────────────────
//
// Campos de cor de preenchimento/fundo aceitam, além de cor sólida/'transparent',
// um gradiente linear armazenado como string CSS pronta:
//   linear-gradient(<ângulo>deg, <cor1>, <cor2>)
// Assim o valor é retrocompatível (string), usável direto como `background` CSS
// e parseável para o editor. Cores de texto/traço/estado seguem só sólidas.

/** Partes de um gradiente SCADA (duas cores + ângulo em graus, padrão CSS). */
export interface ScadaGradientParts {
  angle: number;
  from: string;
  to: string;
}

const SCADA_GRADIENT_RE =
  /^linear-gradient\(\s*(-?\d+(?:\.\d+)?)deg\s*,\s*([^,]+?)\s*,\s*([^,]+?)\s*\)$/i;

/** True quando o valor de cor é um gradiente SCADA. */
export function isGradientColor(color: string | undefined | null): boolean {
  return Boolean(color && color.trim().toLowerCase().startsWith('linear-gradient('));
}

/** Monta a string de gradiente SCADA a partir das partes. */
export function makeScadaGradient(angle: number, from: string, to: string): string {
  return `linear-gradient(${Math.round(angle)}deg, ${from}, ${to})`;
}

/** Decompõe um gradiente SCADA; null para cor sólida/valor não reconhecido. */
export function parseScadaGradient(color: string | undefined | null): ScadaGradientParts | null {
  if (!color) return null;
  const m = SCADA_GRADIENT_RE.exec(color.trim());
  if (!m) return null;
  return { angle: Number(m[1]), from: m[2], to: m[3] };
}

/** Uma das cores do gradiente (fallback p/ efeitos que exigem cor sólida). */
export function scadaGradientStop(color: string, stop: 'from' | 'to'): string {
  const g = parseScadaGradient(color);
  if (!g) return color;
  return stop === 'from' ? g.from : g.to;
}

/**
 * Resolve um valor de cor de preenchimento/fundo para estilo CSS do widget.
 * Devolve `{ background }` p/ gradiente e `{ backgroundColor }` p/ sólida —
 * espalhe no style: `...scadaBackgroundStyle(cor)`. 'transparent' segue válido.
 */
export function scadaBackgroundStyle(
  color: string | undefined | null,
): { background?: string; backgroundColor?: string } {
  if (!color) return {};
  if (isGradientColor(color)) return { background: color };
  return { backgroundColor: color };
}

/**
 * Regra de estado dirigida pelo valor do ÚNICO ponto vinculado ao equipamento.
 * A primeira regra cujo valor casa define cor + animação; sem match usa baseColor.
 */
export interface EquipmentStateRule {
  id: string;
  operator: VisibilityOperator;
  value: number;
  color: string;
  animation: ScadaAnimation;
  /** Texto opcional a exibir quando a regra casa (usado pelo status por ponto). */
  text?: string;
}

export interface EquipmentWidget extends WidgetBase {
  type: ScadaEquipmentType;
  deviceId: string;
  /** O ÚNICO ponto vinculado — todas as regras (cor/animação/visibilidade) o usam. */
  tagStatus: string;
  showLabel: boolean;
  labelText: string;
  /** Tamanho da fonte do label (px). Ausente em telas antigas → 11. */
  labelFontSize?: number;
  /** Exibe o círculo/LED de status sobreposto ao render. Ausente → true (compatibilidade). */
  showStatusLed?: boolean;
  /** Modelo visual da câmera CFTV. Ausente → 'bullet' (compatibilidade). */
  cameraModel?: 'bullet' | 'dome';
  /** Cor padrão quando nenhuma regra casa (ou sem leitura). */
  baseColor: string;
  stateRules: EquipmentStateRule[];
  /** URL de imagem que substitui o ícone SVG embutido (mantém a borda/glow de estado). */
  iconAssetUrl?: string;
  /** Tamanho do popup de telemetria (câmera): escala uniforme do conteúdo. */
  popupSize?: 'small' | 'medium' | 'large';
  // Nível analógico (usado pelo tanque/reservatório): ponto + escala + estilo do líquido.
  tagLevel?: string;
  levelMin?: number;
  levelMax?: number;
  levelUnit?: string;
  levelColor?: string;
  /** Tamanho da fonte do rótulo de nível (px). Ausente → 13 (compatibilidade). */
  levelFontSize?: number;
  /** Cor do rótulo de nível. Ausente → cor do líquido (compatibilidade). */
  levelLabelColor?: string;
  /**
   * Regras condicionais do RÓTULO de nível (cor + animação pelo valor do ponto
   * de nível). Primeira regra que casa vence; sem match usa levelLabelColor.
   */
  levelLabelRules?: EquipmentStateRule[];
}

// ─── Ícone ────────────────────────────────────────────────────────────────────

/**
 * Widget de ícone da biblioteca embutida (SVG inline — só o NOME do ícone vai
 * para o JSON da tela, nunca base64/asset). Sem ponto vinculado usa `color`.
 * Com ponto vinculado (binding unificado): valor 1 → variante "ligado" (colorOn,
 * com brilho); valor 0 → variante "desligado" (colorOff); sem leitura → cinza
 * offline padrão. No modo de edição estático mostra a aparência de projeto (color).
 */
export interface IconWidget extends WidgetBase {
  type: 'icon';
  /** Nome do ícone no registro central (scadaIcons). */
  iconName: string;
  /** Cor de projeto (sem binding / render estático). */
  color: string;
  /** Cor do estado ligado (valor 1). */
  colorOn: string;
  /** Cor do estado desligado (valor 0). */
  colorOff: string;
  /** URL de imagem enviada que substitui o ícone da biblioteca (mostrada como está). */
  iconAssetUrl?: string;
  /** Modo "tile": quadrado arredondado com fundo derivado da cor atual do ícone. */
  tileEnabled?: boolean;
  deviceId: string;
  tag: string;
}

// ─── Alarme ───────────────────────────────────────────────────────────────────

export interface AlarmIndicatorWidget extends WidgetBase {
  type: 'alarm-indicator';
  deviceId: string;
  tag: string;
}

export interface AlarmCounterWidget extends WidgetBase {
  type: 'alarm-counter';
  deviceId: string;
}

// ─── Layout ───────────────────────────────────────────────────────────────────

export interface LineWidget extends WidgetBase {
  type: 'line';
  color: string;
  thickness: number;
  style: 'solid' | 'dashed' | 'dotted';
  flowAnimation: boolean;
  direction: 'right' | 'left' | 'down' | 'up';
  flowTag?: string;
  flowDeviceId?: string;
  // Cor por estado do ponto vinculado (opcional) — sobrepõe `color`.
  deviceId?: string;
  tagStatus?: string;
  stateRules?: EquipmentStateRule[];
}

// ─── Tubulação (pipe) ─────────────────────────────────────────────────────────

/** Vértice da polilinha da tubulação, relativo ao canto superior-esquerdo do widget. */
export interface PipePoint { x: number; y: number }

/**
 * Estilo visual exclusivo do fluxo. `dash` e `water` são os valores usados por
 * telas antigas; `arrow` adiciona a alternativa direcional sem combinar
 * camadas. Tubulações novas devem sempre gravar um destes valores explícitos.
 */
export type PipeStyle = 'dash' | 'arrow' | 'water';

/**
 * Regra de estado do fluxo dirigida pelo valor do ponto vinculado (binding
 * unificado deviceId/tagStatus). Primeira regra que casa vence:
 * - flowing=true → animação rodando (com cor alternativa opcional, ex.: enchimento verde);
 * - flowing=false → tubo parado (estático).
 * Sem match (ou sem leitura) → parado. SEM ponto vinculado o fluxo fica sempre
 * ligado (modo decorativo).
 */
export interface PipeStateRule {
  id: string;
  operator: VisibilityOperator;
  value: number;
  flowing: boolean;
  /** Cor alternativa do fluxo quando a regra casa (vazio = cor de fluxo padrão). */
  flowColor?: string;
}

/**
 * Tubulação com múltiplos segmentos (curvas em 90°, derivações via várias
 * tubulações) e animação de fluxo contínua ao longo do caminho. Os vértices são
 * NORMALIZADOS ao bounding box do widget (min = 0); redimensionar via painel
 * escala o traçado proporcionalmente. Cores aceitam 'transparent'.
 */
export interface PipeWidget extends WidgetBase {
  type: 'pipe';
  /** Vértices da polilinha (≥ 2), relativos à origem do widget. */
  points: PipePoint[];
  /** Cor do tubo (parede). */
  pipeColor: string;
  /** Cor do fluxo animado. */
  flowColor: string;
  /** Cor do conteúdo quando parado. */
  stoppedColor: string;
  /** Espessura externa do tubo (px). */
  thickness: number;
  /** Raio dos cantos nos joelhos (px). */
  cornerRadius: number;
  pipeStyle: PipeStyle;
  /** Multiplicador de velocidade da animação (0.25–4, padrão 1). */
  speed: number;
  /** Direção invertida do fluxo (do último vértice para o primeiro). */
  reverse: boolean;
  /**
   * Campo legado. A seta agora é selecionada por `pipeStyle: 'arrow'` e este
   * valor não altera mais a renderização; mantido para ler telas antigas sem
   * exigir migração manual.
   */
  /** @deprecated use pipeStyle: 'arrow'. */
  showDirectionArrow?: boolean;
  /** Permite deixar uma tubulação decorativa sem movimento. Ausente = ligado. */
  animateFlow?: boolean;
  // Binding unificado (mesmos campos dos equipamentos/formas).
  deviceId?: string;
  tagStatus?: string;
  flowRules?: PipeStateRule[];
}

/**
 * Formas básicas (retângulo, quadrado, círculo, elipse, triângulo).
 * Suportam preenchimento OU apenas contorno, e cor por estado do ponto vinculado
 * (mesma mecânica de regras dos equipamentos). A visibilidade condicional vem da base.
 */
export interface ShapeWidgetBase extends WidgetBase {
  /** false = apenas contorno (sem cor de fundo). Ausente = preenchido (compat. legado). */
  fillEnabled?: boolean;
  /** Cor de fundo estática (usada quando não há ponto vinculado). */
  fillColor: string;
  /** Cor da borda no modo preenchido. */
  strokeColor: string;
  strokeWidth: number;
  /** Borda arredondada — usada por retângulo/quadrado. */
  borderRadius: number;
  // Binding opcional para cor por estado. Quando nenhuma regra casa, usa a cor
  // estática principal (fillColor no modo preenchido, strokeColor no modo contorno).
  deviceId?: string;
  tagStatus?: string;
  stateRules?: EquipmentStateRule[];
}

export interface RectangleWidget extends ShapeWidgetBase { type: 'rectangle'; }
export interface SquareWidget extends ShapeWidgetBase { type: 'square'; }
export interface CircleWidget extends ShapeWidgetBase { type: 'circle'; }
export interface EllipseWidget extends ShapeWidgetBase { type: 'ellipse'; }
export interface TriangleWidget extends ShapeWidgetBase { type: 'triangle'; }
export interface PolygonWidget extends ShapeWidgetBase {
  type: 'polygon';
  /** Vértices relativos à caixa do widget; telas válidas têm pelo menos três. */
  points: PolygonPoint[];
}

export interface ImageWidget extends WidgetBase {
  type: 'image';
  /** Data URL (base64) da imagem enviada, ou uma URL externa. */
  src: string;
  objectFit: 'cover' | 'contain' | 'fill';
  borderRadius: number;
}

export interface TitledAreaWidget extends WidgetBase {
  type: 'titled-area';
  title: string;
  fillColor: string;
  borderColor: string;
  titleColor: string;
  borderRadius: number;
  /** Tamanho da fonte do título (px). Ausente em telas antigas → 11. */
  titleFontSize?: number;
  /** Peso da fonte do título. Ausente → 'semibold' (comportamento antigo). */
  titleFontWeight?: 'normal' | 'medium' | 'semibold' | 'bold';
  /** Posição do rótulo: sobre a borda (recorte) ou dentro da área. Ausente → 'border'. */
  titlePosition?: 'border' | 'inside';
  /** Alinhamento horizontal do rótulo. Ausente → 'left'. */
  titleAlign?: 'left' | 'center' | 'right';
}

export interface SeparatorWidget extends WidgetBase {
  type: 'separator';
  orientation: 'horizontal' | 'vertical';
  color: string;
  thickness: number;
  lineStyle: 'solid' | 'dashed' | 'dotted';
}

// ─── Navegação ────────────────────────────────────────────────────────────────

export type NavHorizontalAlign = 'left' | 'center' | 'right';
export type NavSidebarVerticalAlign = 'top' | 'center' | 'bottom';
export type NavToolbarVerticalAlign = 'top' | 'center' | 'bottom';

/** Normaliza propriedades de layout de navegação, preservando o layout legado. */
export function normalizeNavHorizontalAlign(value: unknown): NavHorizontalAlign {
  return value === 'center' || value === 'right' ? value : 'left';
}

export function normalizeNavSidebarVerticalAlign(value: unknown): NavSidebarVerticalAlign {
  return value === 'center' || value === 'bottom' ? value : 'top';
}

export function normalizeNavToolbarVerticalAlign(value: unknown): NavToolbarVerticalAlign {
  return value === 'center' || value === 'bottom' ? value : 'top';
}

/** Defaults e limites do espaçamento global dos itens da toolbar. */
export const NAV_TOOLBAR_DEFAULT_GAP = 4;
export const NAV_TOOLBAR_DEFAULT_PADDING_X = 12;
export const NAV_TOOLBAR_DEFAULT_PADDING_Y = 6;
/** Tamanho legado do texto dos itens da toolbar. */
export const NAV_TOOLBAR_DEFAULT_FONT_SIZE = 12;
export const NAV_TOOLBAR_MIN_FONT_SIZE = 8;
export const NAV_TOOLBAR_MAX_FONT_SIZE = 32;
export const NAV_TOOLBAR_MAX_GAP = 48;
export const NAV_TOOLBAR_MAX_PADDING_X = 48;
export const NAV_TOOLBAR_MAX_PADDING_Y = 24;
export const NAV_TOOLBAR_DEFAULT_LOGO_WIDTH = 120;
export const NAV_TOOLBAR_DEFAULT_LOGO_HEIGHT = 32;
export const NAV_TOOLBAR_MIN_LOGO_WIDTH = 24;
/** Limite do tamanho real no canvas (não é o tamanho da prévia do painel). */
export const NAV_TOOLBAR_MAX_LOGO_WIDTH = 640;
export const NAV_TOOLBAR_MIN_LOGO_HEIGHT = 16;
/** Mantém a logo dentro de uma altura segura mesmo em barras fixas. */
export const NAV_TOOLBAR_MAX_LOGO_HEIGHT = 120;

export type NavToolbarLogoPosition = 'left' | 'right';
export type NavToolbarLogoFit = 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';

export interface NavToolbarLogoConfig {
  /** URL relativa retornada pelo pipeline de assets SCADA (nunca base64 novo). */
  url: string;
  position: NavToolbarLogoPosition;
  width: number;
  height: number;
  fit: NavToolbarLogoFit;
}

function normalizeNavToolbarNumber(value: unknown, fallback: number, max: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 0), max);
}

export function normalizeNavToolbarGap(value: unknown): number {
  return normalizeNavToolbarNumber(value, NAV_TOOLBAR_DEFAULT_GAP, NAV_TOOLBAR_MAX_GAP);
}

export function normalizeNavToolbarPaddingX(value: unknown): number {
  return normalizeNavToolbarNumber(value, NAV_TOOLBAR_DEFAULT_PADDING_X, NAV_TOOLBAR_MAX_PADDING_X);
}

export function normalizeNavToolbarPaddingY(value: unknown): number {
  return normalizeNavToolbarNumber(value, NAV_TOOLBAR_DEFAULT_PADDING_Y, NAV_TOOLBAR_MAX_PADDING_Y);
}

function normalizeNavToolbarBoundedNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export function normalizeNavToolbarFontSize(value: unknown): number {
  return normalizeNavToolbarBoundedNumber(
    value,
    NAV_TOOLBAR_DEFAULT_FONT_SIZE,
    NAV_TOOLBAR_MIN_FONT_SIZE,
    NAV_TOOLBAR_MAX_FONT_SIZE,
  );
}

export function normalizeNavToolbarLogoPosition(value: unknown): NavToolbarLogoPosition {
  return value === 'right' ? 'right' : 'left';
}

export function normalizeNavToolbarLogoFit(value: unknown): NavToolbarLogoFit {
  return value === 'cover' || value === 'fill' || value === 'none' || value === 'scale-down'
    ? value
    : 'contain';
}

export function normalizeNavToolbarLogoWidth(value: unknown): number {
  return normalizeNavToolbarBoundedNumber(
    value,
    NAV_TOOLBAR_DEFAULT_LOGO_WIDTH,
    NAV_TOOLBAR_MIN_LOGO_WIDTH,
    NAV_TOOLBAR_MAX_LOGO_WIDTH,
  );
}

export function normalizeNavToolbarLogoHeight(value: unknown): number {
  return normalizeNavToolbarBoundedNumber(
    value,
    NAV_TOOLBAR_DEFAULT_LOGO_HEIGHT,
    NAV_TOOLBAR_MIN_LOGO_HEIGHT,
    NAV_TOOLBAR_MAX_LOGO_HEIGHT,
  );
}

/**
 * Normaliza a configuração opcional da logo. A ausência de URL significa que
 * não há logo configurada, preservando exatamente o layout das telas antigas.
 */
export function normalizeNavToolbarLogo(value: unknown): NavToolbarLogoConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  if (!url) return undefined;
  return {
    url,
    position: normalizeNavToolbarLogoPosition(raw.position),
    width: normalizeNavToolbarLogoWidth(raw.width),
    height: normalizeNavToolbarLogoHeight(raw.height),
    fit: normalizeNavToolbarLogoFit(raw.fit),
  };
}

/**
 * Reordena itens sem mutar a lista recebida. Índices inválidos são ignorados
 * para que um drop fora da lista nunca descarte um item.
 */
export function reorderNavMenuItems<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= items.length ||
    toIndex >= items.length
  ) return items;
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

export interface NavMenuItem {
  id: string;
  iconName: string;
  text: string;
  targetScreenId: string;
  /** URL de imagem enviada que substitui o ícone da biblioteca (pipeline de assets SCADA). */
  iconAssetUrl?: string;
  /** Modo "tile": ícone dentro de quadrado arredondado com fundo derivado de tileColor. */
  tileEnabled?: boolean;
  /** Cor única do tile (ícone + fundo derivado na mesma matiz). */
  tileColor?: string;
}

export interface NavSidebarWidget extends WidgetBase {
  type: 'nav-sidebar';
  position: 'left' | 'right';
  backgroundColor: string;
  textColor: string;
  activeColor: string;
  items: NavMenuItem[];
  /** Alinhamento vertical do conjunto de itens; ausente = topo (legado). */
  verticalAlign?: NavSidebarVerticalAlign;
  /** Alinhamento horizontal do conteúdo dos itens; ausente = esquerda (legado). */
  contentAlign?: NavHorizontalAlign;
  /**
   * Layout do projeto: quando true, esta barra aparece FIXA em todas as telas
   * do projeto no viewer (encaixada à esquerda), permanecendo montada durante a
   * navegação. Só uma sidebar fixa por projeto — o backend desfixa as demais no save.
   */
  pinnedToProject?: boolean;
}

export interface NavToolbarWidget extends WidgetBase {
  type: 'nav-toolbar';
  position: 'top' | 'bottom';
  backgroundColor: string;
  textColor: string;
  activeColor: string;
  items: NavMenuItem[];
  /** Alinhamento horizontal do conjunto de itens; ausente = esquerda (legado). */
  contentAlign?: NavHorizontalAlign;
  /** Alinhamento vertical do conjunto de itens; ausente = topo (legado). */
  verticalAlign?: NavToolbarVerticalAlign;
  /** Distância entre os itens em px; ausente = 4px (legado). */
  itemGap?: number;
  /** Padding horizontal de cada item em px; ausente = 12px (legado). */
  itemPaddingX?: number;
  /** Padding vertical de cada item em px; ausente = 6px (legado). */
  itemPaddingY?: number;
  /** Tamanho global do texto dos itens; ausente = 12px (legado). */
  fontSize?: number;
  /** Área institucional opcional, mantida fora do conjunto navegável de itens. */
  logo?: NavToolbarLogoConfig;
  /**
   * Layout do projeto: quando true, esta barra aparece FIXA em todas as telas
   * do projeto no viewer (encaixada no topo), permanecendo montada durante a
   * navegação. Só uma toolbar fixa por projeto — o backend desfixa as demais no save.
   */
  pinnedToProject?: boolean;
}

/** True para nav-toolbar/nav-sidebar marcada como layout fixo do projeto. */
// Limites do espaço reservado pelas barras fixas do projeto (toolbar/sidebar).
// Editor e viewer DEVEM usar os mesmos clamps para a área útil coincidir (WYSIWYG).
export const PINNED_TOOLBAR_MIN_H = 32;
export const PINNED_TOOLBAR_MAX_H = 120;
export const PINNED_SIDEBAR_MIN_W = 48;
export const PINNED_SIDEBAR_MAX_W = 360;

export function clampPinnedToolbarH(h: number): number {
  return Math.min(Math.max(h, PINNED_TOOLBAR_MIN_H), PINNED_TOOLBAR_MAX_H);
}

export function clampPinnedSidebarW(w: number): number {
  return Math.min(Math.max(w, PINNED_SIDEBAR_MIN_W), PINNED_SIDEBAR_MAX_W);
}

export function isPinnedNavWidget(w: Widget): w is NavToolbarWidget | NavSidebarWidget {
  return (
    (w.type === 'nav-toolbar' || w.type === 'nav-sidebar') &&
    Boolean((w as NavToolbarWidget | NavSidebarWidget).pinnedToProject)
  );
}

export interface NavButtonWidget extends WidgetBase {
  type: 'nav-button';
  targetScreenId: string;
  label: string;
  iconName?: string;
  /** URL de imagem enviada que substitui o ícone da biblioteca. */
  iconAssetUrl?: string;
  /** Modo "tile" do ícone (quadrado arredondado com fundo derivado de tileColor). */
  tileEnabled?: boolean;
  tileColor?: string;
  backgroundColor: string;
  textColor: string;
  borderRadius: number;
  fontSize: number;
}

// ─── Hotspot ──────────────────────────────────────────────────────────────────

export interface HotspotWidget extends WidgetBase {
  type: 'hotspot';
  targetScreenId: string;
  transition: 'instant' | 'fade' | 'slide-left' | 'slide-right';
  shape: 'rectangle' | 'circle' | 'ellipse' | 'invisible';
  fillColor: string;
  fillOpacity: number;
  borderColor: string;
  borderWidth: number;
  borderStyle: 'solid' | 'dashed';
  borderRadius: number;
  showIcon: boolean;
  iconName: string;
  /** URL de imagem enviada que substitui o ícone da biblioteca (pipeline de assets SCADA). */
  iconAssetUrl?: string;
  /** Modo "tile": ícone dentro de quadrado arredondado com fundo derivado de tileColor. */
  tileEnabled?: boolean;
  /** Cor única do tile (ícone + fundo derivado na mesma matiz). */
  tileColor?: string;
  iconPosition: 'left' | 'center' | 'right' | 'above' | 'below';
  iconSize: number;
  iconColor: string;
  showLabel: boolean;
  labelText: string;
  labelFont: string;
  labelSize: number;
  labelWeight: 'normal' | 'medium' | 'semibold' | 'bold';
  labelColor: string;
  hoverFillColor: string;
  hoverBorderColor: string;
  hoverScale: number;
  tooltip: string;
  cursor: 'pointer' | 'grab' | 'crosshair';
}

// ─── Union ────────────────────────────────────────────────────────────────────

export type Widget =
  | LabelStaticWidget
  | SectionTitleWidget
  | ValueDynamicWidget
  | LabelValueBlockWidget
  | LedStatusWidget
  | GaugeWidget
  | ThermometerWidget
  | ProgressBarWidget
  | TrafficLightWidget
  | NumericDisplayWidget
  | TrendArrowWidget
  | EquipmentWidget
  | AlarmIndicatorWidget
  | AlarmCounterWidget
  | LineWidget
  | PipeWidget
  | RectangleWidget
  | SquareWidget
  | CircleWidget
  | EllipseWidget
  | TriangleWidget
  | PolygonWidget
  | ImageWidget
  | TitledAreaWidget
  | SeparatorWidget
  | HotspotWidget
  | NavSidebarWidget
  | NavToolbarWidget
  | NavButtonWidget
  | CommandButtonWidget
  | CommandSliderWidget
  | ToggleSwitchWidget
  | AlarmGroupBadgeWidget
  | DeviceCounterWidget
  | IconWidget
  | KpiCardWidget
  | SensorCardWidget
  | DashChartWidget
  | BarListWidget
  | EventFeedWidget
  | PointTableWidget
  | SegmentedControlWidget
  | ValueStepperWidget
  | SetpointRingWidget
  | EquipmentCardWidget
  | ClimateCardWidget
  | ComponentInstanceWidget;

/**
 * Instância independente de uma composição salva na biblioteca.
 *
 * A caixa externa participa da tela e pode ser movida, enquanto os filhos
 * continuam em coordenadas relativas e não podem ser redimensionados pela
 * interação do canvas. O snapshot é deliberadamente independente da definição
 * original para que editar uma instância não altere a biblioteca.
 */
export interface ComponentInstanceWidget extends WidgetBase {
  type: 'component-instance';
  componentId: string;
  componentName: string;
  children: Widget[];
}

// ─── Status genérico por ponto ───────────────────────────────────────────────

export type StatusEffect = 'border' | 'content' | 'text';

export interface StatusBinding {
  /** Legado: ponto próprio do status. Novo modelo reusa o ponto único do widget. */
  deviceId?: string;
  tag?: string;
  rules: EquipmentStateRule[];   // reusa as regras de valor→cor/animação
  effects: StatusEffect[];       // onde a cor é aplicada
}

export interface ResolvedStatus {
  color: string;
  animation: ScadaAnimation;
  effects: StatusEffect[];
  text?: string;
}

export function matchOperator(v: number, op: VisibilityOperator, target: number): boolean {
  switch (op) {
    case 'eq': return v === target;
    case 'neq': return v !== target;
    case 'gt': return v > target;
    case 'lt': return v < target;
    case 'gte': return v >= target;
    case 'lte': return v <= target;
    default: return false;
  }
}

export function resolveStatus(
  widget: Widget,
  getValue: (deviceId: string, tag: string) => number | boolean | string | null,
): ResolvedStatus | null {
  const status = widget.status;
  if (!status?.rules?.length) return null;
  const { deviceId, tag } = readWidgetBinding(widget);
  if (!deviceId || !tag) return null;
  const raw = getValue(deviceId, tag);
  if (raw === null || raw === undefined) return null;
  const v = toScadaNumber(raw);
  if (Number.isNaN(v)) return null;
  for (const rule of status.rules) {
    if (matchOperator(v, rule.operator, rule.value)) {
      return {
        color: rule.color,
        animation: rule.animation,
        effects: status.effects?.length ? status.effects : ['border'],
        text: rule.text,
      };
    }
  }
  return null;
}

// ─── Comandos (escrita em pontos) ─────────────────────────────────────────────

export type CommandButtonMode = 'toggle' | 'set-on' | 'set-off' | 'momentary';
export type CommandButtonVariant = 'solid' | 'outline' | 'soft' | 'ghost' | 'pill';

export interface CommandButtonWidget extends WidgetBase {
  type: 'command-button';
  deviceId: string;
  tag: string;
  mode: CommandButtonMode;
  label: string;
  onValue: number;
  offValue: number;
  priority: number;       // 1–16, padrão 8
  confirm: boolean;
  showState: boolean;
  variant: CommandButtonVariant;
  iconName: string;
  iconOnly: boolean;
  colorOn: string;
  colorOff: string;
  textColor: string;
  borderRadius: number;
  fontSize: number;
}

/**
 * Interruptor deslizante (toggle switch, estilo iOS) — comando liga/desliga em
 * ponto comandável. Reflete o estado real do ponto (telemetria + otimista via
 * pending-commands, igual ao botão de comando). Cores do trilho personalizáveis
 * (ligado/desligado), com suporte a 'transparent'.
 */
export interface ToggleSwitchWidget extends WidgetBase {
  type: 'toggle-switch';
  deviceId: string;
  tag: string;
  label: string;
  showLabel: boolean;
  onValue: number;
  offValue: number;
  priority: number;       // 1–16, padrão 8
  confirm: boolean;
  /** Cor do trilho quando ligado (azul por padrão, como iOS). */
  colorOn: string;
  /** Cor do trilho quando desligado. */
  colorOff: string;
  textColor: string;
  fontSize: number;
}

export interface CommandSliderWidget extends WidgetBase {
  type: 'command-slider';
  deviceId: string;
  tag: string;
  label: string;
  minValue: number;
  maxValue: number;
  step: number;
  unit: string;
  decimals: number;
  priority: number;       // 1–16, padrão 8
  color: string;
  showValue: boolean;
  /**
   * Variante visual. Ausente/'default' = compacto escuro legado.
   * 'card' = cartão estilo dashboard com rótulo e PERCENTUAL da faixa embutidos
   * (ex.: "Intensidade — 85%"), cores de cartão personalizáveis.
   */
  variant?: 'default' | 'card';
  /** Cores do cartão (variante 'card'). Ausente = tema claro padrão. */
  cardBackgroundColor?: string;
  cardTextColor?: string;
  cardMutedColor?: string;
}

// ─── Widgets estilo dashboard (cards, gráficos, eventos) ─────────────────────
// Família de widgets de "dashboard de cards" (referência: telas do PDF BlueBee).
// Todos com estado neutro "sem dados" (nunca 0 fake), render estático no editor
// e cores de cartão explícitas — funcionam sobre fundos claros e escuros.

/** Janela de histórico dos widgets com sparkline/gráfico (horas). */
export type DashPeriodHours = 1 | 6 | 24 | 72 | 168;

/** Campos de estilo compartilhados dos cartões de dashboard. */
export interface DashCardBase extends WidgetBase {
  backgroundColor: string;
  textColor: string;
  /** Cor de textos secundários (título pequeno, subtexto, unidades). */
  mutedColor: string;
  borderColor: string;
  borderRadius: number;
}

/**
 * Card KPI — título + valor grande + unidade + badge de estado + subtexto.
 * Badge dirigido por regras valor→cor/texto (mesmo padrão de state rules).
 */
export interface KpiCardWidget extends DashCardBase {
  type: 'kpi-card';
  deviceId: string;
  tag: string;
  title: string;
  unit: string;
  decimals: number;
  subtext: string;
  valueFontSize: number;
  showBadge: boolean;
  /** rule.text = rótulo do badge; rule.color = cor do badge. */
  badgeRules: EquipmentStateRule[];
}

/** Card de sensor — valor + sparkline das leituras recentes (via trends). */
export interface SensorCardWidget extends DashCardBase {
  type: 'sensor-card';
  deviceId: string;
  tag: string;
  title: string;
  unit: string;
  decimals: number;
  valueFontSize: number;
  sparkColor: string;
  periodHours: DashPeriodHours;
  showBadge: boolean;
  badgeRules: EquipmentStateRule[];
}

export interface DashChartSeries {
  id: string;
  deviceId: string;
  tag: string;
  label: string;
  color: string;
}

/** Gráfico de tendência multi-série (até 4 pontos) com linha de limite opcional. */
export interface DashChartWidget extends DashCardBase {
  type: 'dash-chart';
  title: string;
  series: DashChartSeries[];
  periodHours: DashPeriodHours;
  showLegend: boolean;
  limitEnabled: boolean;
  limitValue: number;
  limitLabel: string;
  limitColor: string;
}

export interface BarListRow {
  id: string;
  deviceId: string;
  tag: string;
  label: string;
  color: string;
  minValue: number;
  maxValue: number;
  unit: string;
  decimals: number;
}

/** Lista de barras percentuais — rótulo + barra + valor por linha. */
export interface BarListWidget extends DashCardBase {
  type: 'bar-list';
  title: string;
  rows: BarListRow[];
}

/** Feed de eventos/alarmes recentes do site da tela (severidade colorida). */
export interface EventFeedWidget extends DashCardBase {
  type: 'event-feed';
  title: string;
  limit: number;
  /** '' = todas as severidades. */
  severity: '' | 'LOW' | 'MEDIUM' | 'HIGH';
  onlyActive: boolean;
}

export interface PointTableRow {
  id: string;
  deviceId: string;
  tag: string;
  label: string;
  unit: string;
  decimals: number;
  /** Estado por linha: rule.text = rótulo do chip; rule.color = cor. */
  stateRules: EquipmentStateRule[];
}

/** Tabela de pontos — linhas ponto/valor/unidade/estado. */
export interface PointTableWidget extends DashCardBase {
  type: 'point-table';
  title: string;
  rows: PointTableRow[];
  showState: boolean;
}

export interface SegmentedOption {
  id: string;
  label: string;
  value: number;
}

/**
 * Controle segmentado de escrita (ex.: Automático/Manual) — 2–3 opções mapeadas
 * a valores, mesmo fluxo de comando otimista dos demais widgets de comando.
 */
export interface SegmentedControlWidget extends DashCardBase {
  type: 'segmented-control';
  deviceId: string;
  tag: string;
  label: string;
  showLabel: boolean;
  options: SegmentedOption[];
  priority: number;       // 1–16, padrão 8
  confirm: boolean;
  activeColor: string;
  activeTextColor: string;
  fontSize: number;
}

// ─── Widgets de controle de clima (referência: painel dark/neon BlueBee) ─────
// Família com visual escuro/neon (fundo quase-preto + acento ciano/verde),
// cores explícitas no JSON (canvas ≠ tema) e os mesmos contratos dos demais
// widgets: pending otimista via getValue, offline cinza e render estático.

/**
 * Stepper de valor — botões − / + com o valor e a unidade no meio. Escreve no
 * ponto analógico comandável vinculado respeitando min/max/step (mesmo fluxo
 * otimista do slider de comando).
 */
export interface ValueStepperWidget extends WidgetBase {
  type: 'value-stepper';
  deviceId: string;
  tag: string;
  minValue: number;
  maxValue: number;
  step: number;
  unit: string;
  decimals: number;
  priority: number;       // 1–16, padrão 8
  backgroundColor: string;
  buttonColor: string;
  textColor: string;
  mutedColor: string;
  borderColor: string;
  accentColor: string;
  borderRadius: number;
  valueFontSize: number;
}

/**
 * Anel de setpoint — arco circular de progresso com valor grande central,
 * unidade e rótulo abaixo (ex.: "AMBIENTE"). Somente leitura.
 */
export interface SetpointRingWidget extends WidgetBase {
  type: 'setpoint-ring';
  deviceId: string;
  tag: string;
  minValue: number;
  maxValue: number;
  unit: string;
  decimals: number;
  label: string;
  showLabel: boolean;
  ringColor: string;
  trackColor: string;
  textColor: string;
  mutedColor: string;
  /** Fundo do widget ('transparent' = flutua sobre o canvas). */
  backgroundColor: string;
  borderRadius: number;
}

/** Como o valor de uma linha do card compacto é exibido/controlado. */
export type EquipmentCardRowDisplay = 'value' | 'toggle' | 'slider';

export interface EquipmentCardRow {
  id: string;
  deviceId: string;
  tag: string;
  iconName: string;
  label: string;
  subtitle: string;
  display: EquipmentCardRowDisplay;
  unit: string;
  decimals: number;
  /** Cor do valor/ícone da linha ('' = acento do card). */
  valueColor: string;
  // toggle (pontos digitais comandáveis)
  onValue: number;
  offValue: number;
  // slider (pontos analógicos comandáveis)
  minValue: number;
  maxValue: number;
  step: number;
}

/**
 * Card compacto de equipamento — cabeçalho com nome/status pill/indicador e
 * linhas de pontos (ícone, nome, subtítulo, valor ao vivo | toggle | slider).
 * Multi-ponto: fora do binding unificado (como os dash-widgets multi-ponto).
 */
export interface EquipmentCardWidget extends DashCardBase {
  type: 'equipment-card';
  title: string;
  subtitle: string;
  /** Ponto do status do cabeçalho (pill + indicador). */
  statusDeviceId: string;
  statusTag: string;
  /** rule.text = rótulo da pill; rule.color = cor. Primeira que casa vence. */
  statusRules: EquipmentStateRule[];
  /** Cor de acento (valores/ícones) quando a linha não define a própria. */
  accentColor: string;
  priority: number;       // 1–16, padrão 8
  rows: EquipmentCardRow[];
}

/**
 * Card de controle de clima — painel composto: leitura principal (valor grande
 * + sparkline opcional), linha de setpoint com slider, stepper − valor + e
 * botão liga/desliga, rodapé com última leitura/origem. Bindings separados
 * para leitura, setpoint e liga/desliga.
 */
export interface ClimateCardWidget extends DashCardBase {
  type: 'climate-card';
  title: string;
  subtitle: string;
  /** Ponto do status do cabeçalho (pill). */
  statusDeviceId: string;
  statusTag: string;
  statusRules: EquipmentStateRule[];
  accentColor: string;
  // Leitura principal (somente leitura)
  readingDeviceId: string;
  readingTag: string;
  readingLabel: string;
  readingUnit: string;
  readingDecimals: number;
  showSparkline: boolean;
  sparkColor: string;
  periodHours: DashPeriodHours;
  // Setpoint (analógico comandável) — slider + stepper compartilham o ponto
  setpointDeviceId: string;
  setpointTag: string;
  setpointLabel: string;
  setpointUnit: string;
  setpointDecimals: number;
  minValue: number;
  maxValue: number;
  step: number;
  // Liga/desliga (digital comandável)
  powerDeviceId: string;
  powerTag: string;
  onValue: number;
  offValue: number;
  powerConfirm: boolean;
  priority: number;       // 1–16, padrão 8
  /** Texto da origem no rodapé (ex.: "MQTT · aeris/008065"). '' = oculto. */
  footerText: string;
}

/** Como o agregado "ativos/total" da soma de alarmes é apresentado no badge. */
export type AlarmGroupBadgeFormat = 'fraction' | 'active-only' | 'total-only';

/**
 * Badge de "Soma de Alarmes" — vincula a um grupo (alarm group) e mostra o
 * agregado ao vivo (ativos/total) + realce pela maior severidade ativa.
 * O valor é resolvido fora do widget (ver getGroupAggregate em WidgetRenderer).
 */
export interface AlarmGroupBadgeWidget extends WidgetBase {
  type: 'alarm-group-badge';
  groupId: string;
  label: string;
  showLabel: boolean;
  format: AlarmGroupBadgeFormat;
  colorOk: string;
  colorAlarm: string;
  /** Quando true, em alarme usa a cor da severidade (HIGH/MEDIUM/LOW) no lugar de colorAlarm. */
  useSeverityColor: boolean;
  textColor: string;
  backgroundColor: string;
  fontSize: number;
  borderRadius: number;
}

// ─── Contador de dispositivos ─────────────────────────────────────────────────

/** Modo de contagem: conectividade, valor de um ponto por dispositivo ou lista explícita de pontos. */
export type DeviceCounterMode = 'connectivity' | 'point-value' | 'point-list';

/** Referência de um ponto selecionado no modo point-list (dispositivo + tag). */
export interface DeviceCounterPointRef {
  deviceId: string;
  tag: string;
}
/** Filtro por tipo de dispositivo: todos, só câmeras CFTV ou só não-câmeras. */
export type DeviceCounterFilter = 'all' | 'camera' | 'other';
/** Escopo: todos os dispositivos do projeto ou uma seleção explícita. */
export type DeviceCounterScope = 'site' | 'selected';
/** Como exibir a contagem: "3/5", só ligados, só desligados ou só o total. */
export type DeviceCounterFormat = 'fraction' | 'on-only' | 'off-only' | 'total-only';

/** Ícone inicial do contador — também é o fallback de telas antigas. */
export const DEVICE_COUNTER_DEFAULT_ICON = 'devices';

/**
 * Contador de dispositivos — agrega em tempo real quantos dispositivos estão
 * "ligados" segundo o modo escolhido:
 * - `connectivity`: online/offline (câmeras seguem a semântica CFTV — valor do
 *   ponto STATUS; demais dispositivos usam frescor da telemetria).
 * - `point-value`: valor de um ponto (tag) comparado a uma condição (ex.: relé=1).
 * - `point-list`: lista explícita de pontos (dispositivo + tag, podendo misturar
 *   dispositivos) contados individualmente contra a mesma condição (ex.: 5/10 lâmpadas).
 * Dispositivos virtuais (Bancada) são SEMPRE excluídos. Sem informação →
 * estado neutro "sem dados" (nunca 0 falso).
 */
export interface DeviceCounterWidget extends WidgetBase {
  type: 'device-counter';
  mode: DeviceCounterMode;
  deviceFilter: DeviceCounterFilter;
  scope: DeviceCounterScope;
  /** Dispositivos escolhidos quando scope='selected'. */
  deviceIds: string[];
  /** Tag do ponto avaliado no modo point-value (mesma tag em todos os devices). */
  pointTag: string;
  /**
   * Pontos escolhidos no modo point-list (dispositivo + tag). Opcional para
   * retrocompatibilidade: telas antigas não têm o campo.
   */
  points?: DeviceCounterPointRef[];
  /** Condição de "ligado" nos modos point-value e point-list: valor <operator> <value>. */
  operator: VisibilityOperator;
  value: number;
  format: DeviceCounterFormat;
  label: string;
  showLabel: boolean;
  /** Cor de destaque do número (e do ícone). */
  colorOn: string;
  /** Nome do ícone no registro central; ausente em telas antigas usa o padrão. */
  iconName?: string;
  textColor: string;
  backgroundColor: string;
  fontSize: number;
  borderRadius: number;
}

/** Cores por severidade do agregado de soma de alarmes (alinha ao módulo de alarmes). */
export const ALARM_GROUP_SEVERITY_COLOR: Record<'LOW' | 'MEDIUM' | 'HIGH', string> = {
  LOW: '#06B6D4',
  MEDIUM: '#F59E0B',
  HIGH: '#EF4444',
};

export type ScadaScreenStatus = 'active' | 'maintenance';

/**
 * Composição reutilizável ("Meus Componentes") da biblioteca global do tenant.
 * Guarda cópias dos widgets com posições relativas ao canto superior-esquerdo
 * do grupo; ao inserir, gera novos ids (cópias independentes).
 */
export interface SavedComponent {
  id: string;
  name: string;
  width: number;
  height: number;
  widgets: Widget[];
}

export interface ScreenSettings {
  backgroundColor: string;
  backgroundImage?: string;
  gridOpacity: number;
  /**
   * LEGADO: componentes embutidos na tela (antes da biblioteca global por
   * tenant). Mantido só como fallback de leitura até a migração rodar; novas
   * gravações vão para a biblioteca global (`/scada/components`).
   */
  components?: SavedComponent[];
}

export interface ScadaScreen {
  id: string;
  name: string;
  tenantId: string;
  /** Site (localidade física) a que a tela pertence. */
  siteId?: string;
  /** Projeto (sistema/gateway) dentro do site — a tela "vive dentro do projeto". */
  projectId?: string;
  /** Rótulo de site legado, mantido só para exibição em telas antigas. */
  site?: string;
  width: number;
  height: number;
  status: ScadaScreenStatus;
  /** Tela inicial do projeto: a primeira aberta quando o cliente acessa. Só uma por projeto. */
  isHome: boolean;
  widgets: Widget[];
  settings: ScreenSettings;
  updatedAt: string;
  description?: string;
}

/** Mapa de telemetria em tempo real: deviceId → tag → valor */
export type TelemetryMap = Record<string, Record<string, number | boolean | string>>;
