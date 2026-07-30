import { nanoid } from 'nanoid';
import type { Widget, WidgetType, ScadaAnimation, EquipmentStateRule } from '../../types/scada.types';

const defaultVisibility = { mode: 'always' as const };

/** Animação padrão do estado "ligado" conforme o tipo de equipamento. */
function onAnimFor(t: WidgetType): ScadaAnimation {
  if (t === 'fan' || t === 'cooling-tower' || t === 'fan-coil') return 'spin';
  if (t === 'pump' || t === 'compressor') return 'pulse';
  return 'none';
}
/** Regras iniciais: ligado (1) = verde + animação do tipo; desligado (0) = cinza. */
function eqRules(t: WidgetType): EquipmentStateRule[] {
  return [
    { id: nanoid(6), operator: 'eq', value: 1, color: '#22C55E', animation: onAnimFor(t) },
    { id: nanoid(6), operator: 'eq', value: 0, color: '#64748B', animation: 'none' },
  ];
}

/** Estilo padrão dos cartões de dashboard — tema claro do PDF de referência. */
const dashCardDefaults = {
  backgroundColor: '#FFFFFF',
  textColor: '#0F172A',
  mutedColor: '#64748B',
  borderColor: '#E2E8F0',
  borderRadius: 12,
} as const;

export function buildDefaultWidget(type: WidgetType, x: number, y: number, width: number, height: number): Widget {
  const base = { id: `w-${nanoid(8)}`, x, y, width, height, opacity: 1, visible: true, zIndex: 2, visibility: defaultVisibility };
  const eqBase = { ...base, deviceId: '', tagStatus: '', showLabel: true, labelText: '', baseColor: '#64748B' };

  switch (type) {
    case 'label-static':
      return { ...base, type, text: 'Texto', fontFamily: 'Inter', fontSize: 18, fontWeight: 'normal', fontStyle: 'normal', color: '#FFFFFF', align: 'left', backgroundColor: 'transparent', borderRadius: 0 };
    case 'section-title':
      return { ...base, type, text: 'Seção', fontSize: 20, fontWeight: 'semibold', color: '#FFFFFF', lineColor: '#334155' };
    case 'value-dynamic':
      return { ...base, type, deviceId: '', tag: '', unit: '', decimals: 1, fontFamily: 'Roboto Mono', fontSize: 28, colorNormal: '#FFFFFF', colorOffline: '#64748B' };
    case 'label-value-block':
      return { ...base, type, label: 'Label', deviceId: '', tag: '', unit: '', decimals: 1, fontFamily: 'Roboto Mono', fontSize: 24, colorNormal: '#FFFFFF', colorAlarm: '#EF4444', colorOffline: '#64748B', backgroundColor: 'rgba(15,23,42,0.7)', borderRadius: 8 };
    case 'led-status':
      return { ...base, type, deviceId: '', tag: '', colorOn: '#22C55E', colorOff: '#EF4444', colorOffline: '#64748B', size: 28, pulseOnAlarm: true };
    case 'gauge':
      return { ...base, type, deviceId: '', tag: '', minValue: 0, maxValue: 100, unit: '', colorNormal: '#22C55E', colorAlarm: '#EF4444', showValue: true };
    case 'thermometer':
      return { ...base, type, deviceId: '', tag: '', minValue: 0, maxValue: 100, unit: '°C', colorNormal: '#22C55E', colorAlarm: '#EF4444', showValue: true };
    case 'progress-bar':
      return { ...base, type, deviceId: '', tag: '', minValue: 0, maxValue: 100, unit: '%', colorNormal: '#06B6D4', colorAlarm: '#EF4444', showValue: true };
    case 'traffic-light':
      return { ...base, type, deviceId: '', tag: '', valueGreen: 1, valueYellow: 2, valueRed: 3 };
    case 'numeric-display':
      return { ...base, type, deviceId: '', tag: '', unit: '', decimals: 1, color: '#06B6D4' };
    case 'trend-arrow':
      return { ...base, type, deviceId: '', tag: '', threshold: 0, colorUp: '#22C55E', colorDown: '#EF4444' };
    case 'chiller':      return { ...eqBase, type, labelText: 'Chiller', stateRules: eqRules('chiller') };
    case 'pump':         return { ...eqBase, type, labelText: 'Bomba', stateRules: eqRules('pump') };
    case 'ahu':          return { ...eqBase, type, labelText: 'UTA', stateRules: eqRules('ahu') };
    case 'fan':          return { ...eqBase, type, labelText: 'Ventilador', stateRules: eqRules('fan') };
    case 'valve':        return { ...eqBase, type, labelText: 'Válvula', stateRules: eqRules('valve') };
    case 'generator':    return { ...eqBase, type, labelText: 'Gerador', stateRules: eqRules('generator') };
    case 'meter':        return { ...eqBase, type, labelText: 'Medidor', stateRules: eqRules('meter') };
    case 'controller':   return { ...eqBase, type, labelText: 'Controladora', stateRules: eqRules('controller') };
    case 'compressor':   return { ...eqBase, type, labelText: 'Compressor', stateRules: eqRules('compressor') };
    case 'cooling-tower':return { ...eqBase, type, labelText: 'Torre Resfr.', stateRules: eqRules('cooling-tower') };
    case 'fan-coil':     return { ...eqBase, type, labelText: 'Fan Coil', stateRules: eqRules('fan-coil') };
    case 'electrical-panel': return { ...eqBase, type, labelText: 'Quadro Elétrico', stateRules: eqRules('electrical-panel') };
    case 'tank':         return { ...eqBase, type, labelText: 'Reservatório', stateRules: eqRules('tank'), tagLevel: '', levelMin: 0, levelMax: 100, levelUnit: '%', levelColor: '#38BDF8' };
    case 'sensor':       return { ...eqBase, type, labelText: 'Sensor', stateRules: eqRules('sensor') };
    case 'smoke-detector': return { ...eqBase, type, labelText: 'Detector de Incêndio', stateRules: eqRules('smoke-detector') };
    // Iluminação: ligado (1) = amarelo com pulse sutil; desligado (0) = cinza.
    case 'lighting':     return { ...eqBase, type, labelText: 'Iluminação', stateRules: [
      { id: nanoid(6), operator: 'eq', value: 1, color: '#FACC15', animation: 'pulse' },
      { id: nanoid(6), operator: 'eq', value: 0, color: '#64748B', animation: 'none' },
    ] };
    // Câmera CFTV: verde quando STATUS=1, vermelho quando STATUS=0, cinza sem dados.
    case 'camera':       return { ...eqBase, type, labelText: 'Câmera', popupSize: 'small', stateRules: [
      { id: nanoid(6), operator: 'eq', value: 1, color: '#22C55E', animation: 'none' },
      { id: nanoid(6), operator: 'eq', value: 0, color: '#EF4444', animation: 'pulse' },
    ] };
    case 'alarm-indicator':
      return { ...base, type, deviceId: '', tag: '' };
    case 'alarm-counter':
      return { ...base, type, deviceId: '' };
    case 'alarm-group-badge':
      return { ...base, type, groupId: '', label: 'Soma de Alarmes', showLabel: true, format: 'fraction', colorOk: '#22C55E', colorAlarm: '#EF4444', useSeverityColor: true, textColor: '#FFFFFF', backgroundColor: 'rgba(15,23,42,0.7)', fontSize: 22, borderRadius: 8 };
    case 'device-counter':
      return { ...base, type, mode: 'connectivity', deviceFilter: 'all', scope: 'site', deviceIds: [], pointTag: '', points: [], operator: 'eq', value: 1, format: 'fraction', label: 'Dispositivos online', showLabel: true, colorOn: '#22C55E', textColor: '#FFFFFF', backgroundColor: 'rgba(15,23,42,0.7)', fontSize: 22, borderRadius: 8 };
    case 'line':
      return { ...base, type, color: '#06B6D4', thickness: 3, style: 'solid', flowAnimation: false, direction: 'right', deviceId: '', tagStatus: '', stateRules: [] };
    case 'pipe':
      // Traçado inicial em "L" (normalizado ao tamanho do widget). Regras padrão:
      // ponto=1 → fluindo; ponto=0 → parado (só valem quando um ponto é vinculado).
      return {
        ...base, type,
        points: [
          { x: 0, y: height },
          { x: Math.round(width / 2), y: height },
          { x: Math.round(width / 2), y: 0 },
          { x: width, y: 0 },
        ],
        pipeColor: '#475569', flowColor: '#38BDF8', stoppedColor: '#94A3B8',
        thickness: 12, cornerRadius: 14, pipeStyle: 'dash', speed: 1, reverse: false,
        deviceId: '', tagStatus: '',
        flowRules: [
          { id: nanoid(6), operator: 'eq', value: 1, flowing: true },
          { id: nanoid(6), operator: 'eq', value: 0, flowing: false },
        ],
      };
    case 'rectangle':
    case 'square':
      return { ...base, type, fillEnabled: true, fillColor: 'rgba(6,182,212,0.12)', strokeColor: '#06B6D4', strokeWidth: 2, borderRadius: 4, deviceId: '', tagStatus: '', stateRules: [] };
    case 'circle':
    case 'ellipse':
    case 'triangle':
      return { ...base, type, fillEnabled: true, fillColor: 'rgba(6,182,212,0.12)', strokeColor: '#06B6D4', strokeWidth: 2, borderRadius: 0, deviceId: '', tagStatus: '', stateRules: [] };
    case 'image':
      return { ...base, type, src: '', objectFit: 'contain', borderRadius: 0 };
    case 'titled-area':
      return { ...base, type, zIndex: 1, title: 'Sistema', fillColor: 'rgba(6,182,212,0.05)', borderColor: 'rgba(6,182,212,0.3)', titleColor: '#06B6D4', borderRadius: 8, titleFontSize: 12, titleFontWeight: 'semibold', titlePosition: 'border', titleAlign: 'left' };
    case 'separator':
      return { ...base, type, orientation: 'horizontal', color: '#334155', thickness: 1, lineStyle: 'solid' };
    case 'hotspot':
      return { ...base, type, targetScreenId: '', transition: 'fade', shape: 'rectangle', fillColor: '#0E7490', fillOpacity: 0.15, borderColor: '#06B6D4', borderWidth: 1, borderStyle: 'solid', borderRadius: 8, showIcon: true, iconName: 'arrow-right', iconPosition: 'left', iconSize: 16, iconColor: '#FFFFFF', showLabel: true, labelText: 'Navegar', labelFont: 'Inter', labelSize: 12, labelWeight: 'medium', labelColor: '#FFFFFF', hoverFillColor: 'rgba(6,182,212,0.25)', hoverBorderColor: '#06B6D4', hoverScale: 1.03, tooltip: '', cursor: 'pointer' };
    case 'nav-button':
      return { ...base, type, targetScreenId: '', label: 'Navegar', iconName: 'arrow-right', backgroundColor: '#0E7490', textColor: '#FFFFFF', borderRadius: 8, fontSize: 13 };
    case 'nav-sidebar':
      return { ...base, type, position: 'left', backgroundColor: 'rgba(15,23,42,0.95)', textColor: '#CBD5E1', activeColor: '#06B6D4', items: [] };
    case 'nav-toolbar':
      return { ...base, type, position: 'top', backgroundColor: 'rgba(15,23,42,0.95)', textColor: '#CBD5E1', activeColor: '#06B6D4', items: [] };
    case 'command-button':
      return { ...base, type, deviceId: '', tag: '', mode: 'toggle', label: 'Comando', onValue: 1, offValue: 0, priority: 8, confirm: false, showState: true, variant: 'solid', iconName: 'power', iconOnly: false, colorOn: '#22C55E', colorOff: '#475569', textColor: '#FFFFFF', borderRadius: 8, fontSize: 13 };
    case 'icon':
      return { ...base, type, iconName: 'lightbulb', color: '#E2E8F0', colorOn: '#FACC15', colorOff: '#64748B', deviceId: '', tag: '' };
    case 'toggle-switch':
      // Azul como na referência (interruptor estilo iOS); desligado cinza.
      return { ...base, type, deviceId: '', tag: '', label: 'Interruptor', showLabel: true, onValue: 1, offValue: 0, priority: 8, confirm: false, colorOn: '#3B82F6', colorOff: '#475569', textColor: '#FFFFFF', fontSize: 12 };
    case 'command-slider':
      return { ...base, type, deviceId: '', tag: '', label: 'Setpoint', minValue: 0, maxValue: 100, step: 1, unit: '%', decimals: 0, priority: 8, color: '#06B6D4', showValue: true, variant: 'default', cardBackgroundColor: '#FFFFFF', cardTextColor: '#0F172A', cardMutedColor: '#64748B' };
    // ── Dashboard / Cards (referência: telas do PDF BlueBee) ──
    case 'kpi-card':
      return { ...base, type, ...dashCardDefaults, deviceId: '', tag: '', title: 'INDICADOR', unit: '', decimals: 1, subtext: '', valueFontSize: 30, showBadge: true, badgeRules: [
        { id: nanoid(6), operator: 'gte', value: 0, color: '#22C55E', animation: 'none', text: 'Normal' },
      ] };
    case 'sensor-card':
      return { ...base, type, ...dashCardDefaults, deviceId: '', tag: '', title: 'SENSOR', unit: '', decimals: 1, valueFontSize: 26, sparkColor: '#3B82F6', periodHours: 6, showBadge: true, badgeRules: [
        { id: nanoid(6), operator: 'gte', value: 0, color: '#22C55E', animation: 'none', text: 'OK' },
      ] };
    case 'dash-chart':
      return { ...base, type, ...dashCardDefaults, title: 'Tendência', series: [], periodHours: 24, showLegend: true, limitEnabled: false, limitValue: 0, limitLabel: 'Limite', limitColor: '#EF4444' };
    case 'bar-list':
      return { ...base, type, ...dashCardDefaults, title: 'Consumo por circuito', rows: [] };
    case 'event-feed':
      return { ...base, type, ...dashCardDefaults, title: 'Eventos recentes', limit: 6, severity: '', onlyActive: false };
    case 'point-table':
      return { ...base, type, ...dashCardDefaults, title: 'Pontos', rows: [], showState: true };
    case 'segmented-control':
      return { ...base, type, ...dashCardDefaults, deviceId: '', tag: '', label: 'Modo', showLabel: true, priority: 8, confirm: false, activeColor: '#3B82F6', activeTextColor: '#FFFFFF', fontSize: 13, options: [
        { id: nanoid(6), label: 'Automático', value: 1 },
        { id: nanoid(6), label: 'Manual', value: 0 },
      ] };
    default:
      return { ...base, type: 'rectangle', fillColor: 'rgba(6,182,212,0.1)', strokeColor: '#06B6D4', strokeWidth: 1, borderRadius: 4 };
  }
}
