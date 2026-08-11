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

export function evaluateVisibility(
  cond: VisibilityCondition | undefined,
  getValue: (deviceId: string, tag: string) => number | boolean | string | null,
): { visible: boolean; behavior: VisibilityBehavior } {
  if (!cond || cond.mode === 'always') return { visible: true, behavior: 'hide' };
  if (!cond.deviceId || !cond.tag || !cond.operator) return { visible: true, behavior: 'hide' };

  const raw = getValue(cond.deviceId, cond.tag);
  if (raw === null) return { visible: false, behavior: cond.behavior ?? 'hide' };

  const tagVal = Number(raw);
  const condVal = cond.value ?? 0;
  let met = false;

  switch (cond.operator) {
    case 'eq': met = tagVal === condVal; break;
    case 'neq': met = tagVal !== condVal; break;
    case 'gt': met = tagVal > condVal; break;
    case 'lt': met = tagVal < condVal; break;
    case 'gte': met = tagVal >= condVal; break;
    case 'lte': met = tagVal <= condVal; break;
  }

  return { visible: met, behavior: cond.behavior ?? 'hide' };
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
  | 'line'
  | 'rectangle'
  | 'titled-area'
  | 'separator'
  | 'image'
  | 'hotspot'
  | 'nav-sidebar'
  | 'nav-toolbar'
  | 'nav-button';

export interface WidgetBase {
  id: string;
  type: WidgetType;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  visible: boolean;
  zIndex: number;
  visibility?: VisibilityCondition;
  /** Espaçamento interno uniforme (px). Ausente = comportamento legado. */
  padding?: number;
  /** Rotação visual em graus (horário, centro). Ausente/0 = sem rotação. */
  rotation?: number;
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

export type EquipmentType =
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
  | 'sensor';

export interface EquipmentWidget extends WidgetBase {
  type: EquipmentType;
  deviceId: string;
  tagStatus: string;
  tagAlarm?: string;
  onValue: number;
  alarmValue: number;
  showLabel: boolean;
  labelText: string;
  colorNormal: string;
  animateNormal: boolean;
  colorOff: string;
  colorAlarm: string;
  blinkAlarm: boolean;
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
}

export interface RectangleWidget extends WidgetBase {
  type: 'rectangle';
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
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

export interface NavMenuItem {
  id: string;
  iconName: string;
  text: string;
  targetScreenId: string;
  /** URL de imagem enviada que substitui o ícone da biblioteca. */
  iconAssetUrl?: string;
  /** Modo "tile": ícone em quadrado arredondado com fundo derivado de tileColor. */
  tileEnabled?: boolean;
  tileColor?: string;
}

export interface NavSidebarWidget extends WidgetBase {
  type: 'nav-sidebar';
  position: 'left' | 'right';
  backgroundColor: string;
  textColor: string;
  activeColor: string;
  items: NavMenuItem[];
  /** Layout do projeto: barra fixa em todas as telas do projeto no viewer. */
  pinnedToProject?: boolean;
}

export interface NavToolbarWidget extends WidgetBase {
  type: 'nav-toolbar';
  position: 'top' | 'bottom';
  backgroundColor: string;
  textColor: string;
  activeColor: string;
  items: NavMenuItem[];
  /** Layout do projeto: barra fixa em todas as telas do projeto no viewer. */
  pinnedToProject?: boolean;
}

export interface NavButtonWidget extends WidgetBase {
  type: 'nav-button';
  targetScreenId: string;
  label: string;
  iconName?: string;
  iconAssetUrl?: string;
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
  | TrafficLightWidget
  | NumericDisplayWidget
  | TrendArrowWidget
  | EquipmentWidget
  | AlarmIndicatorWidget
  | AlarmCounterWidget
  | LineWidget
  | RectangleWidget
  | TitledAreaWidget
  | SeparatorWidget
  | HotspotWidget
  | NavSidebarWidget
  | NavToolbarWidget
  | NavButtonWidget;

export type ScadaScreenStatus = 'active' | 'maintenance';

export interface ScreenSettings {
  backgroundColor: string;
  backgroundImage?: string;
  gridOpacity: number;
}

export interface ScadaScreen {
  id: string;
  name: string;
  tenantId: string;
  siteId?: string;
  projectId?: string;
  site?: string;
  width: number;
  height: number;
  status: ScadaScreenStatus;
  widgets: Widget[];
  settings: ScreenSettings;
  updatedAt: string;
  description?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

const DEFAULT_SETTINGS: ScreenSettings = {
  backgroundColor: '#1a1a2e',
  gridOpacity: 1,
};

// ─── Tela 1 — Sistema HVAC Bloco A ──────────────────────────────────────────

const hvacScreen: ScadaScreen = {
  id: 'screen-hvac-bloco-a',
  name: 'Sistema HVAC — Bloco A',
  tenantId: 'tenant-autobras',
  site: 'Bloco A — Pavimento 3',
  width: 1920,
  height: 1080,
  status: 'active',
  settings: DEFAULT_SETTINGS,
  updatedAt: daysAgo(1),
  description: 'Monitoramento do sistema de climatização do Bloco A — Pavimento 3',
  widgets: [
    {
      id: 'w-hvac-title',
      type: 'label-static',
      x: 60, y: 40, width: 600, height: 50,
      opacity: 1, visible: true, zIndex: 1,
      text: 'SISTEMA DE CLIMATIZAÇÃO',
      fontFamily: 'Inter', fontSize: 32, fontWeight: 'bold', fontStyle: 'normal',
      color: '#FFFFFF', align: 'left',
    } as LabelStaticWidget,
    {
      id: 'w-hvac-subtitle',
      type: 'label-static',
      x: 60, y: 96, width: 400, height: 30,
      opacity: 1, visible: true, zIndex: 1,
      text: 'Bloco A — Pavimento 3',
      fontFamily: 'Inter', fontSize: 16, fontWeight: 'normal', fontStyle: 'normal',
      color: '#94A3B8', align: 'left',
    } as LabelStaticWidget,
    {
      id: 'w-chiller-01',
      type: 'chiller',
      x: 100, y: 200, width: 160, height: 140,
      opacity: 1, visible: true, zIndex: 2,
      deviceId: 'dev-001',
      tagStatus: 'status_compressor_1',
      tagAlarm: 'alarme_geral',
      onValue: 1,
      alarmValue: 1,
      showLabel: true,
      labelText: 'Chiller 01',
      colorNormal: '#22C55E',
      animateNormal: false,
      colorOff: '#475569',
      colorAlarm: '#EF4444',
      blinkAlarm: true,
    } as EquipmentWidget,
    {
      id: 'w-bomba-primaria',
      type: 'pump',
      x: 380, y: 220, width: 120, height: 100,
      opacity: 1, visible: true, zIndex: 2,
      deviceId: 'dev-001',
      tagStatus: 'status_compressor_1',
      tagAlarm: 'alarme_geral',
      onValue: 1,
      alarmValue: 1,
      showLabel: true,
      labelText: 'Bomba Primária',
      colorNormal: '#22C55E',
      animateNormal: true,
      colorOff: '#475569',
      colorAlarm: '#EF4444',
      blinkAlarm: true,
    } as EquipmentWidget,
    {
      id: 'w-pipe-01',
      type: 'line',
      x: 260, y: 290, width: 120, height: 4,
      opacity: 1, visible: true, zIndex: 1,
      color: '#06B6D4', thickness: 4, style: 'solid',
      flowAnimation: true, direction: 'right',
      flowDeviceId: 'dev-001', flowTag: 'status_compressor_1',
    } as LineWidget,
    {
      id: 'w-gauge-pressao',
      type: 'gauge',
      x: 560, y: 180, width: 180, height: 180,
      opacity: 1, visible: true, zIndex: 2,
      deviceId: 'dev-001', tag: 'valvula_expansao_1',
      minValue: 0, maxValue: 100, unit: '%',
      colorNormal: '#22C55E', colorAlarm: '#EF4444', showValue: true,
    } as GaugeWidget,
    {
      id: 'w-temp-saida',
      type: 'label-value-block',
      x: 800, y: 180, width: 200, height: 90,
      opacity: 1, visible: true, zIndex: 2,
      label: 'Temp. Saída',
      deviceId: 'dev-001', tag: 'temp_insuflamento',
      unit: '°C', decimals: 1,
      fontFamily: 'Roboto Mono', fontSize: 28,
      colorNormal: '#22C55E', colorAlarm: '#EF4444', colorOffline: '#64748B',
      backgroundColor: 'rgba(15,23,42,0.7)', borderRadius: 8,
    } as LabelValueBlockWidget,
    {
      id: 'w-temp-retorno',
      type: 'label-value-block',
      x: 800, y: 290, width: 200, height: 90,
      opacity: 1, visible: true, zIndex: 2,
      label: 'Temp. Retorno',
      deviceId: 'dev-001', tag: 'temp_retorno',
      unit: '°C', decimals: 1,
      fontFamily: 'Roboto Mono', fontSize: 28,
      colorNormal: '#60A5FA', colorAlarm: '#EF4444', colorOffline: '#64748B',
      backgroundColor: 'rgba(15,23,42,0.7)', borderRadius: 8,
    } as LabelValueBlockWidget,
    {
      id: 'w-led-valvula',
      type: 'led-status',
      x: 1060, y: 230, width: 60, height: 60,
      opacity: 1, visible: true, zIndex: 2,
      deviceId: 'dev-001', tag: 'alarme_geral',
      colorOn: '#22C55E', colorOff: '#EF4444', colorOffline: '#64748B',
      size: 32, pulseOnAlarm: true,
    } as LedStatusWidget,
    {
      id: 'w-label-valvula',
      type: 'label-static',
      x: 1060, y: 298, width: 100, height: 24,
      opacity: 1, visible: true, zIndex: 1,
      text: 'Válvula Bypass',
      fontFamily: 'Inter', fontSize: 12, fontWeight: 'normal', fontStyle: 'normal',
      color: '#94A3B8', align: 'center',
    } as LabelStaticWidget,
    {
      id: 'w-hotspot-chiller',
      type: 'hotspot',
      x: 100, y: 200, width: 160, height: 140,
      opacity: 1, visible: true, zIndex: 10,
      targetScreenId: 'screen-eletrico-bloco-a',
      transition: 'fade',
      shape: 'invisible',
      fillColor: 'transparent', fillOpacity: 0,
      borderColor: '#06B6D4', borderWidth: 1, borderStyle: 'dashed', borderRadius: 0,
      showIcon: true, iconName: 'external-link',
      iconPosition: 'center', iconSize: 20, iconColor: '#06B6D4',
      showLabel: false, labelText: '',
      labelFont: 'Inter', labelSize: 12, labelWeight: 'normal', labelColor: '#FFFFFF',
      hoverFillColor: 'rgba(6,182,212,0.1)', hoverBorderColor: '#06B6D4',
      hoverScale: 1.02,
      tooltip: 'Ver Sistema Elétrico',
      cursor: 'pointer',
    } as HotspotWidget,
  ],
};

// ─── Tela 2 — Sistema Elétrico Bloco A ──────────────────────────────────────

const eletricoScreen: ScadaScreen = {
  id: 'screen-eletrico-bloco-a',
  name: 'Sistema Elétrico — Bloco A',
  tenantId: 'tenant-autobras',
  site: 'Bloco A — Quadro Elétrico',
  width: 1920,
  height: 1080,
  status: 'active',
  settings: DEFAULT_SETTINGS,
  updatedAt: daysAgo(3),
  description: 'Monitoramento do sistema elétrico do Bloco A',
  widgets: [
    {
      id: 'w-el-title',
      type: 'label-static',
      x: 60, y: 40, width: 500, height: 50,
      opacity: 1, visible: true, zIndex: 1,
      text: 'SISTEMA ELÉTRICO',
      fontFamily: 'Inter', fontSize: 32, fontWeight: 'bold', fontStyle: 'normal',
      color: '#FFFFFF', align: 'left',
    } as LabelStaticWidget,
    {
      id: 'w-medidor',
      type: 'meter',
      x: 100, y: 200, width: 140, height: 120,
      opacity: 1, visible: true, zIndex: 2,
      deviceId: 'dev-003', tagStatus: 'tensao_fase_a',
      onValue: 1, alarmValue: 1,
      showLabel: true, labelText: 'Medidor PowerLogic',
      colorNormal: '#06B6D4', animateNormal: false,
      colorOff: '#475569', colorAlarm: '#EF4444', blinkAlarm: true,
    } as EquipmentWidget,
    {
      id: 'w-gauge-potencia',
      type: 'gauge',
      x: 320, y: 180, width: 180, height: 180,
      opacity: 1, visible: true, zIndex: 2,
      deviceId: 'dev-003', tag: 'potencia_ativa',
      minValue: 0, maxValue: 500, unit: 'kW',
      colorNormal: '#06B6D4', colorAlarm: '#EF4444', showValue: true,
    } as GaugeWidget,
    {
      id: 'w-tensao-a',
      type: 'label-value-block',
      x: 560, y: 180, width: 200, height: 90,
      opacity: 1, visible: true, zIndex: 2,
      label: 'Tensão Fase A', deviceId: 'dev-003', tag: 'tensao_fase_a',
      unit: 'V', decimals: 1, fontFamily: 'Roboto Mono', fontSize: 28,
      colorNormal: '#FFFFFF', colorAlarm: '#EF4444', colorOffline: '#64748B',
      backgroundColor: 'rgba(15,23,42,0.7)', borderRadius: 8,
    } as LabelValueBlockWidget,
    {
      id: 'w-corrente-a',
      type: 'label-value-block',
      x: 560, y: 290, width: 200, height: 90,
      opacity: 1, visible: true, zIndex: 2,
      label: 'Corrente Fase A', deviceId: 'dev-003', tag: 'corrente_fase_a',
      unit: 'A', decimals: 1, fontFamily: 'Roboto Mono', fontSize: 28,
      colorNormal: '#FFFFFF', colorAlarm: '#EF4444', colorOffline: '#64748B',
      backgroundColor: 'rgba(15,23,42,0.7)', borderRadius: 8,
    } as LabelValueBlockWidget,
    {
      id: 'w-pot-ativa',
      type: 'label-value-block',
      x: 560, y: 400, width: 200, height: 90,
      opacity: 1, visible: true, zIndex: 2,
      label: 'Potência Ativa', deviceId: 'dev-003', tag: 'potencia_ativa',
      unit: 'kW', decimals: 1, fontFamily: 'Roboto Mono', fontSize: 28,
      colorNormal: '#FFFFFF', colorAlarm: '#EF4444', colorOffline: '#64748B',
      backgroundColor: 'rgba(15,23,42,0.7)', borderRadius: 8,
    } as LabelValueBlockWidget,
    {
      id: 'w-gerador',
      type: 'generator',
      x: 830, y: 200, width: 140, height: 120,
      opacity: 1, visible: true, zIndex: 2,
      deviceId: 'dev-004', tagStatus: 'status_gerador', tagAlarm: 'status_gerador',
      onValue: 1, alarmValue: 0,
      showLabel: true, labelText: 'Gerador Cummins',
      colorNormal: '#22C55E', animateNormal: false,
      colorOff: '#475569', colorAlarm: '#EF4444', blinkAlarm: true,
    } as EquipmentWidget,
    {
      id: 'w-alarm-gerador',
      type: 'alarm-indicator',
      x: 870, y: 340, width: 60, height: 60,
      opacity: 1, visible: true, zIndex: 2,
      deviceId: 'dev-004', tag: 'status_gerador',
      visibility: {
        mode: 'conditional',
        deviceId: 'dev-004', tag: 'status_gerador',
        operator: 'eq', value: 0, behavior: 'hide',
      },
    } as AlarmIndicatorWidget,
    {
      id: 'w-hotspot-hvac',
      type: 'hotspot',
      x: 1100, y: 600, width: 160, height: 50,
      opacity: 1, visible: true, zIndex: 10,
      targetScreenId: 'screen-hvac-bloco-a',
      transition: 'fade',
      shape: 'rectangle',
      fillColor: '#0E7490', fillOpacity: 0.15,
      borderColor: '#06B6D4', borderWidth: 1, borderStyle: 'solid', borderRadius: 8,
      showIcon: true, iconName: 'thermometer',
      iconPosition: 'left', iconSize: 16, iconColor: '#06B6D4',
      showLabel: true, labelText: 'Ver HVAC',
      labelFont: 'Inter', labelSize: 12, labelWeight: 'medium', labelColor: '#FFFFFF',
      hoverFillColor: 'rgba(6,182,212,0.25)', hoverBorderColor: '#06B6D4',
      hoverScale: 1.03, tooltip: 'Ver Sistema HVAC',
      cursor: 'pointer',
    } as HotspotWidget,
  ],
};

// ─── Export ───────────────────────────────────────────────────────────────────

export const mockScadaScreens: ScadaScreen[] = [hvacScreen, eletricoScreen];

// ─── Telemetria mock ──────────────────────────────────────────────────────────

export interface MockTelemetryMap {
  [deviceId: string]: { [tag: string]: number | boolean | string };
}

export const mockTelemetry: MockTelemetryMap = {
  'dev-001': {
    temp_retorno: 22.4, temp_insuflamento: 14.2, setpoint_temp: 22.0,
    modo_operacao: 'Resfriamento', status_compressor_1: 1, status_compressor_2: 0,
    valvula_expansao_1: 75.5, alarme_geral: 0,
  },
  'dev-002': {
    temp_ambiente: 23.1, setpoint_conforto: 22.5, status_ventilador: 1,
    velocidade_ventilador: 60.0, modo_ocupacao: 'Ocupado', alarme_temperatura: 0,
  },
  'dev-003': {
    tensao_fase_a: 220.3, corrente_fase_a: 42.7, potencia_ativa: 28.4,
    fator_potencia: 0.92, frequencia: 60.0, energia_acumulada: 12450.8,
  },
  'dev-004': {
    status_gerador: 0, tensao_saida: 0, corrente: 0, rpm: 0, temp_motor: 0,
  },
};

export function simulateRealtimeTelemetry(current: MockTelemetryMap): MockTelemetryMap {
  const next = JSON.parse(JSON.stringify(current)) as MockTelemetryMap;
  const jitter = (base: number, pct = 0.02) =>
    parseFloat((base * (1 + (Math.random() - 0.5) * pct)).toFixed(2));

  if (next['dev-001']) {
    next['dev-001'].temp_retorno = jitter(22.4, 0.05);
    next['dev-001'].temp_insuflamento = jitter(14.2, 0.05);
    next['dev-001'].valvula_expansao_1 = jitter(75.5, 0.03);
  }
  if (next['dev-003']) {
    next['dev-003'].tensao_fase_a = jitter(220.3, 0.02);
    next['dev-003'].corrente_fase_a = jitter(42.7, 0.04);
    next['dev-003'].potencia_ativa = jitter(28.4, 0.05);
  }
  return next;
}

// ─── localStorage helpers ─────────────────────────────────────────────────────

const LS_KEY = (id: string) => `scada_screen_${id}`;

export function saveScreenToStorage(screen: ScadaScreen): boolean {
  try {
    const key = LS_KEY(screen.id);
    localStorage.setItem(key, JSON.stringify({ ...screen, updatedAt: new Date().toISOString() }));
    return true;
  } catch {
    return false;
  }
}

export function loadScreenFromStorage(screenId: string): ScadaScreen | null {
  try {
    const raw = localStorage.getItem(LS_KEY(screenId));
    if (!raw) return null;
    return JSON.parse(raw) as ScadaScreen;
  } catch {
    return null;
  }
}
