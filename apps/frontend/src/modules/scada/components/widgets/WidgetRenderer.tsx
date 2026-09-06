'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { EyeOff, Loader2, WifiOff, X } from 'lucide-react';
import type { ScadaPopupConfig, Widget, ResolvedStatus } from '../../types/scada.types';
import { evaluateVisibility, resolveStatus, readWidgetBinding, scadaAnimationCss, hasClickAction, toScadaNumber, isTransparentColor, scadaColorWithAlpha, normalizeScadaHover, getScadaHoverCapabilities, normalizeScadaPopup, resolveScadaPopupPosition, scadaPopupOpensOnClick, scadaPopupOpensOnHover } from '../../types/scada.types';
import { useEditorStore } from '../../store/editor.store';
import type { PointStatus, PointReading } from '../../hooks/useScreenTelemetry';
import type { ScreenDevice } from '../../types/virtual.types';
import type { SendCommand } from '../../hooks/useScreenCommand';
import type { AlarmGroupAggregate } from '../../services/alarm-groups.service';
import { usePortalContainer } from '../../hooks/usePortalContainer';
import { CommandButtonWidgetView } from './CommandButtonWidget';
import { CommandSliderWidgetView } from './CommandSliderWidget';
import { ToggleSwitchWidgetView } from './ToggleSwitchWidget';
import { LabelStaticWidgetView } from './LabelStaticWidget';
import { SectionTitleWidgetView } from './SectionTitleWidget';
import { ValueDynamicWidgetView } from './ValueDynamicWidget';
import { LabelValueBlockWidgetView } from './LabelValueBlockWidget';
import { LedStatusWidgetView } from './LedStatusWidget';
import { GaugeWidgetView } from './GaugeWidget';
import { ThermometerWidgetView } from './ThermometerWidget';
import { ProgressBarWidgetView } from './ProgressBarWidget';
import { TrafficLightWidgetView } from './TrafficLightWidget';
import { NumericDisplayWidgetView } from './NumericDisplayWidget';
import { TrendArrowWidgetView } from './TrendArrowWidget';
import { EquipmentWidgetView } from './EquipmentWidget';
import { CameraWidgetView } from './CameraWidget';
import { LineWidgetView } from './LineWidget';
import { PipeWidgetView } from './PipeWidget';
import { ShapeWidgetView } from './ShapeWidget';
import { ImageWidgetView } from './ImageWidget';
import { IconWidgetView } from './IconWidget';
import { TitledAreaWidgetView } from './TitledAreaWidget';
import { SeparatorWidgetView } from './SeparatorWidget';
import { HotspotWidgetView } from './HotspotWidget';
import { AlarmIndicatorWidgetView } from './AlarmIndicatorWidget';
import { AlarmGroupBadgeWidgetView } from './AlarmGroupBadgeWidget';
import { DeviceCounterWidgetView } from './DeviceCounterWidget';
import { NavSidebarWidgetView } from './NavSidebarWidget';
import { NavToolbarWidgetView } from './NavToolbarWidget';
import { NavButtonWidgetView } from './NavButtonWidget';
import { KpiCardWidgetView } from './KpiCardWidget';
import { SensorCardWidgetView } from './SensorCardWidget';
import { DashChartWidgetView } from './DashChartWidget';
import { BarListWidgetView } from './BarListWidget';
import { EventFeedWidgetView } from './EventFeedWidget';
import { PointTableWidgetView } from './PointTableWidget';
import { SegmentedControlWidgetView } from './SegmentedControlWidget';
import { ValueStepperWidgetView } from './ValueStepperWidget';
import { SetpointRingWidgetView } from './SetpointRingWidget';
import { EquipmentCardWidgetView } from './EquipmentCardWidget';
import { ClimateCardWidgetView } from './ClimateCardWidget';
import {
  pendingCommandKey,
  pendingCommandsVersionForKeys,
  subscribePendingCommandsForKeys,
} from '../../store/pending-commands.store';

interface WidgetRendererProps {
  widget: Widget;
  getTagValue?: (deviceId: string, tag: string) => number | boolean | string | null;
  /**
   * Status de comunicação de um ponto. Quando fornecido (apenas no viewer),
   * widgets vinculados sem leitura recente são atenuados + sinalizados offline.
   */
  getTagStatus?: (deviceId: string, tag: string) => PointStatus;
  /** Leitura completa (valor + horário) de um ponto — popup de telemetria da câmera. */
  getTagReading?: (deviceId: string, tag: string) => PointReading | null;
  /** Dispositivos da tela — o widget de câmera resolve a câmera vinculada e seus pontos. */
  devices?: ScreenDevice[];
  /** Resolve o agregado ao vivo de uma soma de alarmes (alarm group) por id. */
  getGroupAggregate?: (groupId: string) => AlarmGroupAggregate | null;
  onNavigate?: (targetScreenId: string) => void;
  currentScreenId?: string;
  /** Nome da tela atual para o fallback visual das barras de navegação. */
  currentScreenName?: string;
  isSelected?: boolean;
  onClick?: (id: string, multi: boolean) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  isEditor?: boolean;
  onCommand?: SendCommand;
  /**
   * Renderização estática/neutra (modo de edição fora do Preview): widgets
   * vinculados NÃO usam telemetria ao vivo — mostram a aparência de projeto
   * (cor base, valor placeholder, sem animações/estados derivados de status).
   */
  staticRender?: boolean;
  /** Escopo da tela (cliente/site) — usado pelo feed de eventos. */
  screenScope?: { tenantId?: string | null; siteId?: string | null };
}

const EQUIPMENT_TYPES = new Set([
  'chiller', 'pump', 'ahu', 'fan', 'valve', 'generator', 'meter', 'controller',
  'compressor', 'cooling-tower', 'fan-coil', 'electrical-panel', 'tank', 'sensor',
  'smoke-detector', 'manual-call-point', 'zone-module', 'monitor-module', 'command-module',
  'flow-switch', 'fire-panel', 'fire-siren', 'heat-detector', 'sprinkler', 'fire-hydrant',
  'fire-extinguisher', 'fire-pump', 'fire-damper', 'fire-door', 'lighting',
]);

function collectWidgetPointBindings(value: unknown, result: Set<string>, seen: Set<object>): void {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  const record = value as Record<string, unknown>;
  const addPair = (deviceKey: string, tagKey: string) => {
    const deviceId = record[deviceKey];
    const tag = record[tagKey];
    if (typeof deviceId === 'string' && deviceId && typeof tag === 'string' && tag) {
      result.add(pendingCommandKey(deviceId, tag));
    }
  };

  addPair('deviceId', 'tag');
  addPair('deviceId', 'tagStatus');
  addPair('bindingDeviceId', 'bindingTag');
  for (const [key, deviceId] of Object.entries(record)) {
    if (!key.endsWith('DeviceId') || key === 'deviceId' || typeof deviceId !== 'string' || !deviceId) continue;
    addPair(key, key.slice(0, -'DeviceId'.length) + 'Tag');
  }
  for (const child of Object.values(record)) collectWidgetPointBindings(child, result, seen);
}

function widgetPendingKeys(widget: Widget): string[] {
  const keys = new Set<string>();
  collectWidgetPointBindings(widget, keys, new Set());
  const action = widget.clickAction;
  if (action?.type === 'command' && action.deviceId && action.tag) {
    keys.add(pendingCommandKey(action.deviceId, action.tag));
  }
  if (widget.type === 'device-counter') {
    for (const deviceId of widget.deviceIds) {
      if (deviceId && widget.pointTag) keys.add(pendingCommandKey(deviceId, widget.pointTag));
    }
    for (const point of widget.points ?? []) {
      if (point.deviceId && point.tag) keys.add(pendingCommandKey(point.deviceId, point.tag));
    }
  }
  return [...keys].sort();
}

function useWidgetPendingCommands(widget: Widget): void {
  const keys = useMemo(() => widgetPendingKeys(widget), [widget]);
  const subscribe = useCallback(
    (listener: () => void) => subscribePendingCommandsForKeys(keys, listener),
    [keys],
  );
  const getSnapshot = useCallback(
    () => pendingCommandsVersionForKeys(keys),
    [keys],
  );
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function sameReading(
  a: PointReading | null | undefined,
  b: PointReading | null | undefined,
): boolean {
  return a?.value === b?.value && a?.timestamp === b?.timestamp;
}

function areWidgetRendererPropsEqual(
  previous: WidgetRendererProps,
  next: WidgetRendererProps,
): boolean {
  if (
    previous.widget !== next.widget ||
    previous.isSelected !== next.isSelected ||
    previous.isEditor !== next.isEditor ||
    previous.staticRender !== next.staticRender ||
    previous.currentScreenId !== next.currentScreenId ||
    previous.currentScreenName !== next.currentScreenName ||
    previous.devices !== next.devices ||
    previous.onCommand !== next.onCommand ||
    previous.screenScope?.tenantId !== next.screenScope?.tenantId ||
    previous.screenScope?.siteId !== next.screenScope?.siteId
  ) return false;

  // These callbacks are intentionally ignored for static editor widgets:
  // EditorCanvas creates drag/context handlers inline on every canvas render.
  // Viewer navigation handlers are stable, and the current screen is compared
  // above so an actual navigation still updates the navigation widgets.
  if (!previous.isEditor && previous.onNavigate !== next.onNavigate) return false;

  const bindings = widgetPendingKeys(previous.widget);
  for (const binding of bindings) {
    const separator = binding.indexOf('|');
    const deviceId = binding.slice(0, separator);
    const tag = binding.slice(separator + 1);
    if (!Object.is(
      previous.getTagValue?.(deviceId, tag),
      next.getTagValue?.(deviceId, tag),
    )) return false;
    if (previous.getTagStatus?.(deviceId, tag) !== next.getTagStatus?.(deviceId, tag)) return false;
    if (!sameReading(
      previous.getTagReading?.(deviceId, tag),
      next.getTagReading?.(deviceId, tag),
    )) return false;
  }

  if (previous.widget.type === 'alarm-group-badge') {
    const groupId = previous.widget.groupId;
    const previousAggregate = previous.getGroupAggregate?.(groupId);
    const nextAggregate = next.getGroupAggregate?.(groupId);
    if (
      previousAggregate?.active !== nextAggregate?.active ||
      previousAggregate?.total !== nextAggregate?.total ||
      previousAggregate?.severity !== nextAggregate?.severity
    ) return false;
  }

  return true;
}

export const WidgetRenderer = memo(function WidgetRenderer({
  widget,
  getTagValue,
  getTagStatus,
  getTagReading,
  devices,
  getGroupAggregate,
  onNavigate,
  currentScreenId,
  currentScreenName,
  isSelected,
  onClick,
  onMouseDown,
  onContextMenu,
  isEditor = false,
  onCommand,
  staticRender = false,
  screenScope,
}: WidgetRendererProps) {
  useWidgetPendingCommands(widget);
  const getValue = getTagValue ?? (() => null);

  // ── Conditional visibility ──────────────────────────────────────────────────
  if (!isEditor) {
    const { visible, behavior } = evaluateVisibility(widget, getValue);
    if (!visible) {
      if (behavior === 'hide') return null;
      // opaque: render with opacity 20%
    }
    // If not visible and behavior = opaque, we render below with reduced opacity
    const effectiveOpacity = !visible && behavior === 'opaque' ? 0.2 : widget.opacity;

    return (
      <RendererInner
        widget={{ ...widget, opacity: effectiveOpacity }}
        getValue={getValue}
        getTagStatus={getTagStatus}
        getTagReading={getTagReading}
        devices={devices}
        getGroupAggregate={getGroupAggregate}
        onNavigate={onNavigate}
        currentScreenId={currentScreenId}
        currentScreenName={currentScreenName}
        isSelected={isSelected}
        onClick={onClick}
        onMouseDown={onMouseDown}
        onContextMenu={onContextMenu}
        isEditor={isEditor}
        onCommand={onCommand}
        EQUIPMENT_TYPES={EQUIPMENT_TYPES}
        screenScope={screenScope}
      />
    );
  }

  // Editor mode: sempre renderiza (para poder editar). Na renderização estática
  // (edição fora do Preview) NÃO avaliamos visibilidade condicional ao vivo —
  // apenas o flag de projeto `visible` atenua o widget. Só no Preview (staticRender
  // falso) o dim/hint condicional derivado de telemetria volta a aparecer.
  const condHidden =
    !staticRender &&
    widget.visibility?.mode === 'conditional' &&
    !evaluateVisibility(widget, getValue).visible;
  const dimmed = !widget.visible || condHidden;

  return (
    <RendererInner
      widget={{ ...widget, opacity: dimmed ? widget.opacity * 0.4 : widget.opacity }}
      getValue={getValue}
      getTagStatus={undefined}
      getTagReading={getTagReading}
      devices={devices}
      getGroupAggregate={getGroupAggregate}
      onNavigate={onNavigate}
      currentScreenId={currentScreenId}
      isSelected={isSelected}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
      isEditor={isEditor}
      onCommand={onCommand}
      EQUIPMENT_TYPES={EQUIPMENT_TYPES}
      hiddenHint={condHidden}
      staticRender={staticRender}
      screenScope={screenScope}
    />
  );
}, areWidgetRendererPropsEqual);

// ─── Inner renderer ───────────────────────────────────────────────────────────

interface InnerProps {
  widget: Widget;
  getValue: (d: string, t: string) => number | boolean | string | null;
  getTagStatus?: (deviceId: string, tag: string) => PointStatus;
  getTagReading?: (deviceId: string, tag: string) => PointReading | null;
  devices?: ScreenDevice[];
  getGroupAggregate?: (groupId: string) => AlarmGroupAggregate | null;
  onNavigate?: (s: string) => void;
  currentScreenId?: string;
  currentScreenName?: string;
  isSelected?: boolean;
  onClick?: (id: string, multi: boolean) => void;
  onMouseDown?: (e: React.MouseEvent) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  isEditor: boolean;
  onCommand?: SendCommand;
  EQUIPMENT_TYPES: Set<string>;
  hiddenHint?: boolean;
  staticRender?: boolean;
  screenScope?: { tenantId?: string | null; siteId?: string | null };
}

/**
 * Extrai o vínculo (deviceId + tag) de um widget, se existir. Apenas widgets
 * com ambos preenchidos são considerados "data-bound" para o sinal de offline.
 */
function widgetBinding(widget: Widget): { deviceId: string; tag: string } | null {
  const { deviceId, tag } = readWidgetBinding(widget);
  return deviceId && tag ? { deviceId, tag } : null;
}

interface ScadaWidgetPopupProps {
  popup: ScadaPopupConfig;
  anchorRef: React.RefObject<HTMLDivElement | null>;
  panelRef: React.RefObject<HTMLDivElement | null>;
  pinned: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onClose: () => void;
  getTagValue: (deviceId: string, tag: string) => number | boolean | string | null;
  getTagStatus?: (deviceId: string, tag: string) => PointStatus;
  getTagReading?: (deviceId: string, tag: string) => PointReading | null;
  devices?: ScreenDevice[];
  getGroupAggregate?: (groupId: string) => AlarmGroupAggregate | null;
  onNavigate?: (screenId: string) => void;
  currentScreenId?: string;
  currentScreenName?: string;
  onCommand?: SendCommand;
  screenScope?: { tenantId?: string | null; siteId?: string | null };
}

function ScadaWidgetPopup({
  popup, anchorRef, panelRef, pinned, onEnter, onLeave, onClose,
  getTagValue, getTagStatus, getTagReading, devices, getGroupAggregate,
  onNavigate, currentScreenId, currentScreenName, onCommand, screenScope,
}: ScadaWidgetPopupProps) {
  const portalContainer = usePortalContainer();
  const headerHeight = popup.title ? 38 : 0;
  const [position, setPosition] = useState({ left: 8, top: 8 });
  const [available, setAvailable] = useState({ width: popup.width, height: popup.height + headerHeight });

  const reposition = useCallback(() => {
    const anchor = anchorRef.current?.getBoundingClientRect();
    if (!anchor) return;
    const fullscreen = document.fullscreenElement;
    const viewport = fullscreen instanceof HTMLElement
      ? fullscreen.getBoundingClientRect()
      : { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight, width: window.innerWidth, height: window.innerHeight };
    const width = Math.min(popup.width, Math.max(1, viewport.width - 16));
    const height = Math.min(popup.height + headerHeight, Math.max(1, viewport.height - 16));
    setAvailable({ width, height });
    setPosition(resolveScadaPopupPosition(anchor, { width, height }, popup.placement, popup.offset, viewport));
  }, [anchorRef, headerHeight, popup.height, popup.offset, popup.placement, popup.width]);

  useEffect(() => {
    reposition();
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [reposition]);

  if (!portalContainer) return null;
  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={popup.title || 'Popup SCADA'}
      data-testid="scada-widget-popup"
      className="scada-dark-chrome"
      style={{
        position: 'fixed',
        left: position.left,
        top: position.top,
        width: available.width,
        height: available.height,
        boxSizing: 'border-box',
        zIndex: 100000,
        overflow: 'hidden',
        color: '#E2E8F0',
        background: popup.backgroundColor,
        border: `${popup.borderWidth}px solid ${popup.borderColor}`,
        borderRadius: popup.borderRadius,
        boxShadow: popup.shadow ? '0 20px 50px rgba(0,0,0,.45)' : undefined,
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {popup.title && (
        <div style={{ height: 38, display: 'flex', alignItems: 'center', gap: 8, padding: '0 10px 0 12px', borderBottom: `1px solid ${popup.borderColor}` }}>
          <strong style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13 }}>{popup.title}</strong>
          {(pinned || popup.trigger !== 'hover') && (
            <button type="button" onClick={onClose} aria-label="Fechar popup" style={{ display: 'grid', placeItems: 'center', width: 26, height: 26, border: 0, borderRadius: 6, color: '#94A3B8', background: 'transparent', cursor: 'pointer' }}>
              <X style={{ width: 15, height: 15 }} />
            </button>
          )}
        </div>
      )}
      <div style={{ width: '100%', height: Math.max(0, available.height - headerHeight), overflow: 'hidden' }}>
        <div style={{ position: 'relative', width: popup.width, height: popup.height, overflow: 'hidden' }}>
          {popup.widgets.map((source) => {
            const child = { ...source } as Widget;
            delete child.popup;
            return (
              <WidgetRenderer
                key={child.id}
                widget={child}
                getTagValue={getTagValue}
                getTagStatus={getTagStatus}
                getTagReading={getTagReading}
                devices={devices}
                getGroupAggregate={getGroupAggregate}
                onNavigate={onNavigate}
                currentScreenId={currentScreenId}
                currentScreenName={currentScreenName}
                onCommand={onCommand}
                screenScope={screenScope}
              />
            );
          })}
        </div>
      </div>
    </div>,
    portalContainer,
  );
}

function RendererInner({
  widget, getValue, getTagStatus, getTagReading, devices, getGroupAggregate, onNavigate, currentScreenId,
  currentScreenName, isSelected, onClick, onMouseDown, onContextMenu, isEditor, onCommand, EQUIPMENT_TYPES, hiddenHint, staticRender, screenScope,
}: InnerProps) {
  const [hovered, setHovered] = useState(false);
  const popup = normalizeScadaPopup(widget.popup);
  const popupEnabled = !isEditor && Boolean(popup?.enabled);
  const popupHover = Boolean(popupEnabled && popup && scadaPopupOpensOnHover(popup.trigger));
  const popupClick = Boolean(popupEnabled && popup && scadaPopupOpensOnClick(popup.trigger));
  const [popupOpen, setPopupOpen] = useState(false);
  const [popupPinned, setPopupPinned] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const popupPanelRef = useRef<HTMLDivElement>(null);
  const popupCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hover = normalizeScadaHover(widget.hover);
  const hoverCapabilities = getScadaHoverCapabilities(widget).targets;
  // Configurações antigas podem conter alvos que este renderer nunca teve.
  // Eles permanecem no JSON para compatibilidade, mas não ativam efeitos fantasmas.
  const hoverTargets = hover?.targets.filter((target) => hoverCapabilities.includes(target)) ?? [];
  const hoverEnabled = !isEditor && Boolean(hover?.enabled && hoverTargets.length > 0);
  const hoverActive = hoverEnabled && hovered;
  // ── Ação genérica ao clicar (somente viewer/Preview; nunca no editor) ───────
  const [actionSending, setActionSending] = useState(false);
  const clickActionable = !isEditor && hasClickAction(widget);

  const clearPopupClose = useCallback(() => {
    if (popupCloseTimer.current) clearTimeout(popupCloseTimer.current);
    popupCloseTimer.current = null;
  }, []);
  const closePopup = useCallback((restoreFocus = false) => {
    clearPopupClose();
    setPopupOpen(false);
    setPopupPinned(false);
    if (restoreFocus) requestAnimationFrame(() => anchorRef.current?.focus());
  }, [clearPopupClose]);
  const schedulePopupClose = useCallback(() => {
    clearPopupClose();
    popupCloseTimer.current = setTimeout(() => {
      if (!popupPinned) setPopupOpen(false);
    }, 180);
  }, [clearPopupClose, popupPinned]);

  useEffect(() => () => clearPopupClose(), [clearPopupClose]);
  useEffect(() => {
    if (!popupOpen || !popup) return;
    const config = popup;
    function onPointerDown(event: PointerEvent) {
      if (!config.closeOnOutside) return;
      const node = event.target as Node;
      if (!anchorRef.current?.contains(node) && !popupPanelRef.current?.contains(node)) closePopup(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && config.closeOnEscape) {
        event.preventDefault();
        closePopup(true);
      }
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [popupOpen, popup, closePopup]);

  async function runClickAction(): Promise<void> {
    const a = widget.clickAction;
    if (!a || actionSending) return;
    if (a.type === 'navigate') {
      if (a.targetScreenId && onNavigate) onNavigate(a.targetScreenId);
      return;
    }
    if (a.type !== 'command' || !onCommand || !a.deviceId || !a.tag) return;
    // Ponto sem comunicação: NÃO envia comando silenciosamente — o operador
    // estaria comandando em cima de um estado visual possivelmente defasado.
    if (getTagStatus && getTagStatus(a.deviceId, a.tag) !== 'live') {
      useEditorStore.getState().addToast('error', 'Ponto sem comunicação — comando bloqueado');
      return;
    }
    // Toggle (binários): alterna a partir do valor atual do ponto.
    let value: number;
    if ((a.commandMode ?? 'set') === 'toggle') {
      const on = a.onValue ?? 1;
      const off = a.offValue ?? 0;
      const cur = toScadaNumber(getValue(a.deviceId, a.tag));
      const isOn = !Number.isNaN(cur) && cur !== off;
      value = isOn ? off : on;
    } else {
      value = a.value ?? 1;
    }
    if (a.confirm) {
      if (!window.confirm(`Confirmar comando: enviar ${value} para "${a.tag}"?`)) return;
    }
    setActionSending(true);
    try {
      const res = await onCommand(a.deviceId, a.tag, value, a.priority ?? 8);
      if (!res.ok) {
        useEditorStore.getState().addToast('error', res.error ?? 'Falha ao enviar comando');
      }
    } finally {
      setActionSending(false);
    }
  }

  function handleClick(e: React.MouseEvent) {
    if (onClick) { e.stopPropagation(); onClick(widget.id, e.ctrlKey || e.metaKey); return; }
    if (popupClick) {
      const target = e.target as Element;
      const nearestControl = target.closest('button,input,select,textarea,a,[role="button"],[data-scada-own-interaction]');
      // O próprio wrapper recebe role=button para acessibilidade. Ele não é uma
      // "interação própria" do widget; só controles realmente internos têm
      // precedência sobre o popup genérico.
      const ownControl = Boolean(nearestControl && nearestControl !== e.currentTarget);
      if (!ownControl) {
        e.stopPropagation();
        const next = !popupOpen || !popupPinned;
        setPopupOpen(next);
        setPopupPinned(next);
        return;
      }
    }
    if (clickActionable) { e.stopPropagation(); void runClickAction(); }
  }

  function handleAnchorKeyDown(e: React.KeyboardEvent) {
    if (!popupEnabled || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    e.stopPropagation();
    const next = !popupOpen || !popupPinned;
    setPopupOpen(next);
    setPopupPinned(next);
  }

  // ── Sinal de offline (apenas no viewer, somente para widgets vinculados) ─────
  // Câmeras CFTV: a saúde é o VALOR do ponto STATUS (não a recência da leitura),
  // então o widget de câmera pinta o próprio estado e NÃO recebe o overlay cinza.
  const binding =
    !isEditor && getTagStatus && widget.type !== 'camera' ? widgetBinding(widget) : null;
  // Nota: o status ignora o valor otimista pendente de propósito — um comando
  // recém-enviado NÃO remove o overlay/badge de offline (não mascara o estado).
  const offline = binding ? getTagStatus!(binding.deviceId, binding.tag) !== 'live' : false;
  // Widgets de comando: bloqueiam interação quando o ponto está sem comunicação.
  const commOffline = offline;

  // ── Status genérico por ponto (recolore/anima/relabela qualquer widget) ──────
  // Na renderização estática, o status por ponto é ignorado (sem recolor/anim/texto).
  const status: ResolvedStatus | null = staticRender ? null : resolveStatus(widget, getValue);
  const statusBorder = status?.effects.includes('border') ? status : null;
  const contentColor = status?.effects.includes('content') ? status.color : undefined;
  const contentText =
    status?.effects.includes('text') && status.text !== undefined ? status.text : undefined;

  const style: React.CSSProperties = {
    position: 'absolute',
    left: widget.x,
    top: widget.y,
    width: widget.width,
    height: widget.height,
    opacity: widget.opacity,
    zIndex: widget.zIndex,
    cursor: isEditor ? (widget.locked ? 'not-allowed' : 'move') : clickActionable || popupClick ? 'pointer' : 'default',
    outline: isSelected ? '2px solid #06B6D4' : undefined,
    outlineOffset: isSelected ? '2px' : undefined,
    boxSizing: 'border-box',
  };
  // Borda por status: mesma técnica do hover de borda — recolore a superfície
  // nativa do widget (data-scada-hover-border-surface/shape/pipe/linha/separador)
  // via CSS, nunca um retângulo genérico. Widgets sem essa superfície nativa
  // (fora de HOVER_BORDER_TYPES, ex.: imagem, câmera, valor dinâmico) não têm
  // onde herdar a cor, então mantêm o fallback de outline/boxShadow no wrapper
  // logo abaixo — nunca perdiam essa borda antes desta mudança e continuam sem perdê-la.
  // led-status está em HOVER_BORDER_TYPES (o painel oferece a opção), mas o LED
  // em si não desenha nenhum traço/borda real para herdar a cor — nesse único
  // caso o fallback abaixo é o único jeito de mostrar a borda, então não se
  // trata da superfície nativa.
  const statusBorderNative =
    Boolean(statusBorder) && hoverCapabilities.includes('border') && widget.type !== 'led-status';
  // isSelected também suprime a versão nativa: seleção no editor (fora de
  // escopo aqui) sempre deve mostrar só o contorno ciano, como já acontecia
  // com o fallback antigo.
  const statusBorderColor =
    !isSelected && statusBorderNative && !isTransparentColor(statusBorder!.color)
      ? statusBorder!.color
      : undefined;

  const hoverVars = {
    '--scada-hover-border': hover?.borderColor ?? 'transparent',
    '--scada-hover-content': hover?.contentColor ?? 'transparent',
    '--scada-hover-text': hover?.textColor ?? 'inherit',
    '--scada-hover-duration': `${hover?.transitionMs ?? 0}ms`,
    '--scada-hover-easing': hover?.easing ?? 'ease-out',
    '--scada-status-border': statusBorderColor ?? 'transparent',
  } as React.CSSProperties;

  // Rotação base do widget (graus, em torno do centro) — vale em editor,
  // preview e viewer. Ausente/0 = sem transform (legado intacto).
  const rotation = ((widget.rotation ?? 0) % 360 + 360) % 360;
  if (rotation !== 0) style.transform = `rotate(${rotation}deg)`;

  // Cor transparente na regra de status = "sem cor": borda/brilho desativados.
  // Fallback de outline SÓ para widgets sem superfície nativa própria (ver acima) —
  // caso contrário duplicaria com a borda desenhada via CSS na superfície real.
  if (!isSelected && statusBorder && !isTransparentColor(statusBorder.color) && !statusBorderNative) {
    style.outline = `2px solid ${statusBorder.color}`;
    style.outlineOffset = '1px';
    style.boxShadow = `0 0 8px ${scadaColorWithAlpha(statusBorder.color, '66')}`;
  }
  // Animação da regra de status casa independe do efeito escolhido (border/content/text).
  if (!isSelected && status) {
    style.animation = scadaAnimationCss(status.animation);
  }

  let content: React.ReactNode = null;

  switch (widget.type) {
    case 'label-static':
      content = <LabelStaticWidgetView widget={widget} colorOverride={contentColor} textOverride={contentText} />; break;
    case 'section-title':
      content = <SectionTitleWidgetView widget={widget} colorOverride={contentColor} textOverride={contentText} />; break;
    case 'value-dynamic':
      content = <ValueDynamicWidgetView widget={widget} getValue={getValue} colorOverride={contentColor} textOverride={contentText} staticRender={staticRender} />; break;
    case 'label-value-block':
      content = <LabelValueBlockWidgetView widget={widget} getValue={getValue} colorOverride={contentColor} textOverride={contentText} staticRender={staticRender} />; break;
    case 'led-status':
      content = <LedStatusWidgetView widget={widget} getValue={getValue} staticRender={staticRender} />; break;
    case 'gauge':
      content = <GaugeWidgetView widget={widget} getValue={getValue} staticRender={staticRender} />; break;
    case 'thermometer':
      content = <ThermometerWidgetView widget={widget} getValue={getValue} staticRender={staticRender} />; break;
    case 'progress-bar':
      content = <ProgressBarWidgetView widget={widget} getValue={getValue} staticRender={staticRender} />; break;
    case 'traffic-light':
      content = <TrafficLightWidgetView widget={widget} getValue={getValue} staticRender={staticRender} />; break;
    case 'numeric-display':
      content = <NumericDisplayWidgetView widget={widget} getValue={getValue} colorOverride={contentColor} textOverride={contentText} staticRender={staticRender} />; break;
    case 'command-button':
      content = <CommandButtonWidgetView widget={widget} getValue={getValue} onCommand={onCommand} isEditor={isEditor} staticRender={staticRender} commOffline={commOffline} />; break;
    case 'command-slider':
      content = <CommandSliderWidgetView widget={widget} getValue={getValue} onCommand={onCommand} isEditor={isEditor} staticRender={staticRender} commOffline={commOffline} />; break;
    case 'toggle-switch':
      content = <ToggleSwitchWidgetView widget={widget} getValue={getValue} onCommand={onCommand} isEditor={isEditor} staticRender={staticRender} commOffline={commOffline} />; break;
    case 'trend-arrow':
      content = <TrendArrowWidgetView widget={widget} getValue={getValue} staticRender={staticRender} />; break;
    case 'alarm-indicator':
      content = <AlarmIndicatorWidgetView widget={widget} getValue={getValue} staticRender={staticRender} />; break;
    case 'alarm-group-badge':
      content = <AlarmGroupBadgeWidgetView widget={widget} aggregate={staticRender ? null : (getGroupAggregate?.(widget.groupId) ?? null)} />; break;
    case 'device-counter':
      // Popup "quais pontos" só quando não há ação de clique configurada nem
      // seleção do editor — mesma precedência do handleClick genérico.
      content = <DeviceCounterWidgetView widget={widget} devices={devices ?? []} getValue={getValue} getTagStatus={getTagStatus} getTagReading={getTagReading} staticRender={staticRender} interactive={!isEditor && !onClick && !clickActionable} />; break;
    case 'line':
      content = <LineWidgetView widget={widget} getValue={getValue} staticRender={staticRender} />; break;
    case 'pipe':
      content = <PipeWidgetView widget={widget} getValue={getValue} staticRender={staticRender} />; break;
    case 'rectangle':
    case 'square':
    case 'circle':
    case 'ellipse':
    case 'triangle':
    case 'polygon':
      content = <ShapeWidgetView widget={widget} getValue={getValue} staticRender={staticRender} />; break;
    case 'image':
      content = <ImageWidgetView widget={widget} />; break;
    case 'titled-area':
      content = <TitledAreaWidgetView widget={widget} />; break;
    case 'separator':
      content = <SeparatorWidgetView widget={widget} />; break;
    case 'hotspot':
      content = <HotspotWidgetView widget={widget} onNavigate={onNavigate} isEditor={isEditor} />; break;
    case 'nav-sidebar':
      content = <NavSidebarWidgetView widget={widget} currentScreenId={currentScreenId} currentScreenName={currentScreenName} onNavigate={onNavigate} isEditor={isEditor} />; break;
    case 'nav-toolbar':
      content = <NavToolbarWidgetView widget={widget} currentScreenId={currentScreenId} currentScreenName={currentScreenName} onNavigate={onNavigate} isEditor={isEditor} />; break;
    case 'nav-button':
      content = <NavButtonWidgetView widget={widget} onNavigate={onNavigate} isEditor={isEditor} />; break;
    case 'icon':
      content = <IconWidgetView widget={widget} getValue={getValue} staticRender={staticRender} />; break;
    case 'camera':
      content = <CameraWidgetView widget={widget} getValue={getValue} getReading={getTagReading} devices={devices} isEditor={isEditor} staticRender={staticRender} />; break;
    case 'kpi-card':
      content = <KpiCardWidgetView widget={widget} getValue={getValue} staticRender={staticRender} />; break;
    case 'sensor-card':
      content = <SensorCardWidgetView widget={widget} getValue={getValue} staticRender={staticRender} />; break;
    case 'dash-chart':
      content = <DashChartWidgetView widget={widget} staticRender={staticRender} />; break;
    case 'bar-list':
      content = <BarListWidgetView widget={widget} getValue={getValue} staticRender={staticRender} />; break;
    case 'event-feed':
      content = <EventFeedWidgetView widget={widget} staticRender={staticRender} screenScope={screenScope} />; break;
    case 'point-table':
      content = <PointTableWidgetView widget={widget} getValue={getValue} staticRender={staticRender} />; break;
    case 'segmented-control':
      content = <SegmentedControlWidgetView widget={widget} getValue={getValue} onCommand={onCommand} isEditor={isEditor} staticRender={staticRender} commOffline={commOffline} />; break;
    case 'value-stepper':
      content = <ValueStepperWidgetView widget={widget} getValue={getValue} onCommand={onCommand} isEditor={isEditor} staticRender={staticRender} commOffline={commOffline} />; break;
    case 'setpoint-ring':
      content = <SetpointRingWidgetView widget={widget} getValue={getValue} staticRender={staticRender} />; break;
    case 'equipment-card':
      // Multi-ponto: cada linha resolve o próprio ponto (offline por linha).
      content = <EquipmentCardWidgetView widget={widget} getValue={getValue} getTagStatus={getTagStatus} onCommand={onCommand} isEditor={isEditor} staticRender={staticRender} />; break;
    case 'climate-card':
      content = <ClimateCardWidgetView widget={widget} getValue={getValue} getTagStatus={getTagStatus} getReading={getTagReading} onCommand={onCommand} isEditor={isEditor} staticRender={staticRender} />; break;
    case 'component-instance':
      content = (
        <ComponentInstanceView
          widget={widget}
          getTagValue={getValue}
          getTagStatus={getTagStatus}
          getTagReading={getTagReading}
          devices={devices}
          getGroupAggregate={getGroupAggregate}
          onNavigate={onNavigate}
          currentScreenId={currentScreenId}
          currentScreenName={currentScreenName}
          isEditor={isEditor}
          onCommand={onCommand}
          staticRender={staticRender}
          screenScope={screenScope}
        />
      ); break;
    default:
      if (EQUIPMENT_TYPES.has(widget.type)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        content = <EquipmentWidgetView widget={widget as any} getValue={getValue} staticRender={staticRender} />;
      }
  }

  return (
    <div
      ref={anchorRef}
      className={hoverEnabled ? 'scada-hover-target' : undefined}
      data-scada-hovered={hoverActive ? 'true' : 'false'}
      data-scada-hover-border={hoverActive && hoverTargets.includes('border') ? 'true' : undefined}
      data-scada-hover-content={hoverActive && hoverTargets.includes('content') ? 'true' : undefined}
      data-scada-hover-text={hoverActive && hoverTargets.includes('text') ? 'true' : undefined}
      data-scada-status-border={statusBorderColor ? 'true' : undefined}
      style={{ ...style, ...hoverVars }}
      onMouseEnter={() => {
        if (hoverEnabled) setHovered(true);
        if (popupHover) { clearPopupClose(); setPopupOpen(true); }
      }}
      onMouseLeave={() => {
        if (hoverEnabled) setHovered(false);
        if (popupHover) schedulePopupClose();
      }}
      onClick={handleClick}
      onKeyDown={handleAnchorKeyDown}
      tabIndex={popupEnabled ? 0 : undefined}
      role={popupClick ? 'button' : undefined}
      aria-haspopup={popupEnabled ? 'dialog' : undefined}
      aria-expanded={popupEnabled ? popupOpen : undefined}
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
    >
      {offline ? (
        <div style={{ width: '100%', height: '100%', filter: 'grayscale(1)', opacity: 0.4 }}>
          {content}
        </div>
      ) : content}
      {offline && (
        <div
          title="Sem comunicação — último valor pode estar desatualizado"
          style={{ position: 'absolute', top: 2, right: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: 4, background: 'rgba(127,29,29,0.9)', pointerEvents: 'none', animation: 'scada-blink 1.4s step-start infinite' }}
        >
          <WifiOff style={{ width: 11, height: 11, color: '#FCA5A5' }} strokeWidth={2} />
        </div>
      )}
      {actionSending && (
        <div
          title="Enviando comando…"
          style={{ position: 'absolute', top: 2, left: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: 4, background: 'rgba(8,51,68,0.9)', pointerEvents: 'none' }}
        >
          <Loader2 className="animate-spin" style={{ width: 11, height: 11, color: '#67E8F9' }} strokeWidth={2} />
        </div>
      )}
      {popupEnabled && popup && popupOpen && (
        <ScadaWidgetPopup
          popup={popup}
          anchorRef={anchorRef}
          panelRef={popupPanelRef}
          pinned={popupPinned}
          onEnter={clearPopupClose}
          onLeave={schedulePopupClose}
          onClose={() => closePopup(true)}
          getTagValue={getValue}
          getTagStatus={getTagStatus}
          getTagReading={getTagReading}
          devices={devices}
          getGroupAggregate={getGroupAggregate}
          onNavigate={onNavigate}
          currentScreenId={currentScreenId}
          currentScreenName={currentScreenName}
          onCommand={onCommand}
          screenScope={screenScope}
        />
      )}
      {hiddenHint && (
        <div
          title="Oculto por condição de visibilidade (no runtime)"
          style={{ position: 'absolute', top: 2, right: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: 4, background: 'rgba(15,23,42,0.85)', pointerEvents: 'none' }}
        >
          <EyeOff style={{ width: 11, height: 11, color: '#94A3B8' }} strokeWidth={2} />
        </div>
      )}
    </div>
  );
}

/**
 * Renderiza o snapshot de uma composição dentro da caixa externa. Os filhos
 * continuam sendo widgets normais (incluindo telemetria, comandos e navegação),
 * mas não recebem handlers do canvas: a instância é a unidade de interação do
 * editor e os filhos nunca viram alças/seleções independentes.
 */
function ComponentInstanceView({
  widget,
  getTagValue,
  getTagStatus,
  getTagReading,
  devices,
  getGroupAggregate,
  onNavigate,
  currentScreenId,
  currentScreenName,
  isEditor,
  onCommand,
  staticRender,
  screenScope,
}: {
  widget: Extract<Widget, { type: 'component-instance' }>;
  getTagValue: (deviceId: string, tag: string) => number | boolean | string | null;
  getTagStatus?: (deviceId: string, tag: string) => PointStatus;
  getTagReading?: (deviceId: string, tag: string) => PointReading | null;
  devices?: ScreenDevice[];
  getGroupAggregate?: (groupId: string) => AlarmGroupAggregate | null;
  onNavigate?: (targetScreenId: string) => void;
  currentScreenId?: string;
  currentScreenName?: string;
  isEditor: boolean;
  onCommand?: SendCommand;
  staticRender?: boolean;
  screenScope?: { tenantId?: string | null; siteId?: string | null };
}) {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'visible' }}>
      {widget.children.map((child) => (
        <WidgetRenderer
          key={child.id}
          widget={child}
          getTagValue={getTagValue}
          getTagStatus={getTagStatus}
          getTagReading={getTagReading}
          devices={devices}
          getGroupAggregate={getGroupAggregate}
          onNavigate={onNavigate}
          currentScreenId={currentScreenId}
          currentScreenName={currentScreenName}
          isEditor={isEditor}
          onCommand={onCommand}
          staticRender={staticRender}
          screenScope={screenScope}
        />
      ))}
    </div>
  );
}
