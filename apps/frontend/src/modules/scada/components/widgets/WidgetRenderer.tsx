'use client';

import { useState } from 'react';
import { EyeOff, Loader2, WifiOff } from 'lucide-react';
import type { Widget, ResolvedStatus } from '../../types/scada.types';
import { evaluateVisibility, resolveStatus, readWidgetBinding, scadaAnimationCss, hasClickAction, toScadaNumber, isTransparentColor, scadaColorWithAlpha } from '../../types/scada.types';
import { useEditorStore } from '../../store/editor.store';
import type { PointStatus, PointReading } from '../../hooks/useScreenTelemetry';
import type { ScreenDevice } from '../../types/virtual.types';
import type { SendCommand } from '../../hooks/useScreenCommand';
import type { AlarmGroupAggregate } from '../../services/alarm-groups.service';
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

export function WidgetRenderer({
  widget,
  getTagValue,
  getTagStatus,
  getTagReading,
  devices,
  getGroupAggregate,
  onNavigate,
  currentScreenId,
  isSelected,
  onClick,
  onMouseDown,
  onContextMenu,
  isEditor = false,
  onCommand,
  staticRender = false,
  screenScope,
}: WidgetRendererProps) {
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
}

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

function RendererInner({
  widget, getValue, getTagStatus, getTagReading, devices, getGroupAggregate, onNavigate, currentScreenId,
  isSelected, onClick, onMouseDown, onContextMenu, isEditor, onCommand, EQUIPMENT_TYPES, hiddenHint, staticRender, screenScope,
}: InnerProps) {
  // ── Ação genérica ao clicar (somente viewer/Preview; nunca no editor) ───────
  const [actionSending, setActionSending] = useState(false);
  const clickActionable = !isEditor && hasClickAction(widget);

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
    const addToast = useEditorStore.getState().addToast;
    setActionSending(true);
    try {
      const res = await onCommand(a.deviceId, a.tag, value, a.priority ?? 8);
      if (res.ok && res.warning) addToast('success', res.warning);
      else if (res.ok) addToast('success', `Comando enviado: ${a.tag} = ${value}`);
      else addToast('error', res.error ?? 'Falha ao enviar comando');
    } finally {
      setActionSending(false);
    }
  }

  function handleClick(e: React.MouseEvent) {
    if (onClick) { e.stopPropagation(); onClick(widget.id, e.ctrlKey || e.metaKey); return; }
    if (clickActionable) { e.stopPropagation(); void runClickAction(); }
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
    cursor: isEditor ? (widget.locked ? 'not-allowed' : 'move') : clickActionable ? 'pointer' : 'default',
    outline: isSelected ? '2px solid #06B6D4' : undefined,
    outlineOffset: isSelected ? '2px' : undefined,
    boxSizing: 'border-box',
  };

  // Rotação base do widget (graus, em torno do centro) — vale em editor,
  // preview e viewer. Ausente/0 = sem transform (legado intacto).
  const rotation = ((widget.rotation ?? 0) % 360 + 360) % 360;
  if (rotation !== 0) style.transform = `rotate(${rotation}deg)`;

  // Cor transparente na regra de status = "sem cor": borda/brilho desativados.
  if (!isSelected && statusBorder && !isTransparentColor(statusBorder.color)) {
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
      content = <NavSidebarWidgetView widget={widget} currentScreenId={currentScreenId} onNavigate={onNavigate} isEditor={isEditor} />; break;
    case 'nav-toolbar':
      content = <NavToolbarWidgetView widget={widget} currentScreenId={currentScreenId} onNavigate={onNavigate} isEditor={isEditor} />; break;
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
    default:
      if (EQUIPMENT_TYPES.has(widget.type)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        content = <EquipmentWidgetView widget={widget as any} getValue={getValue} staticRender={staticRender} />;
      }
  }

  return (
    <div style={style} onClick={handleClick} onMouseDown={onMouseDown} onContextMenu={onContextMenu}>
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
