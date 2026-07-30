'use client';

import { useState, type ComponentType } from 'react';
import {
  Activity, AirVent, AlarmClock, AlertTriangle, Archive, ArrowDown, ArrowLeft, ArrowRight, ArrowUp,
  BarChart3, Battery, BatteryCharging, BatteryFull, BatteryLow, Bell, Building2, Calendar, Camera,
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircuitBoard, ClipboardList, Clock, Cloud,
  CloudRain, Cog, Cpu, Database, DoorClosed, DoorOpen, Droplet, Droplets, ExternalLink, Eye, Factory,
  Fan, FileText, Flame, Folder, Gauge, Globe, Grid3x3, HardDrive, Heater, History, Home, Info,
  Layers, LayoutDashboard, LayoutGrid, Lightbulb, LightbulbOff, LineChart, List, Lock, LockOpen,
  Map, MapPin, Menu, MessageSquare, Monitor, Moon, Network, Pause, PieChart, Play, Plug, PlugZap,
  Power, Radio, RefreshCw, Search, Server, Settings, Shield, ShieldAlert, Signal, SlidersHorizontal,
  Snowflake, Star, Sun, Thermometer, Timer, TrendingUp, User, Users, Video, Waves, Wifi, WifiOff,
  Wind, Wrench, Zap, ImageOff,
} from 'lucide-react';
import { resolveAssetUrl } from '../../services/scada.service';

// Registro central da biblioteca de ícones do SCADA (SVG inline via lucide +
// customizados). No JSON da tela é gravado APENAS o nome do ícone (chave deste
// registro) — nunca base64 nem asset externo. Ícones com dois estados definem
// IconOn/IconOff (ex.: lâmpada acesa/apagada); os demais mudam só de cor.

type SvgIcon = ComponentType<{ size?: string | number; color?: string; strokeWidth?: string | number; style?: React.CSSProperties }>;

/** Válvula (não existe no lucide) — SVG custom com a mesma assinatura. */
function ValveIcon({ size = 24, color = 'currentColor', strokeWidth = 2, style }: { size?: string | number; color?: string; strokeWidth?: string | number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M3 8 L12 13 L21 8" />
      <path d="M3 18 L12 13 L21 18" />
      <path d="M3 8 v10 M21 8 v10" />
      <path d="M12 13 V6" />
      <path d="M8 6 h8" />
    </svg>
  );
}

/** Janela (moldura com cruzeta) — SVG custom. */
function WindowIcon({ size = 24, color = 'currentColor', strokeWidth = 2, style }: { size?: string | number; color?: string; strokeWidth?: string | number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={style}>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M12 3 v18 M4 12 h16" />
    </svg>
  );
}

/** Motor elétrico (carcaça com aletas + eixo) — SVG custom. */
function MotorIcon({ size = 24, color = 'currentColor', strokeWidth = 2, style }: { size?: string | number; color?: string; strokeWidth?: string | number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={style}>
      <rect x="3" y="8" width="14" height="10" rx="2" />
      <path d="M17 11 h3 v4 h-3" />
      <path d="M6 8 V5.5 M10 8 V5.5 M14 8 V5.5" />
      <path d="M3 18 v2 M17 18 v2" />
    </svg>
  );
}

/** Painel solar — SVG custom. */
function SolarPanelIcon({ size = 24, color = 'currentColor', strokeWidth = 2, style }: { size?: string | number; color?: string; strokeWidth?: string | number; style?: React.CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={style}>
      <path d="M4 4 L20 4 L22 14 L2 14 Z" />
      <path d="M8 4 L7 14 M16 4 L17 14 M3 9 h18" />
      <path d="M12 14 v6 M8 20 h8" />
    </svg>
  );
}

type SvgProps = { size?: string | number; color?: string; strokeWidth?: string | number; style?: React.CSSProperties };

/** Wrapper padrão dos SVGs custom (mesma assinatura dos ícones lucide). */
function svgIcon(children: React.ReactNode): SvgIcon {
  return function CustomScadaIcon({ size = 24, color = 'currentColor', strokeWidth = 2, style }: SvgProps) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={style}>
        {children}
      </svg>
    );
  };
}

// ─── Pacote BMS: Elétrica ────────────────────────────────────────────────────

/** Circuito elétrico (reproduz o símbolo da imagem enviada): nós circulares interligados sobre a linha. */
const CircuitNodeIcon = svgIcon(
  <>
    <path d="M2 12 h4.6" />
    <path d="M11.4 12 H22" />
    <circle cx="14" cy="5" r="2.2" />
    <circle cx="9" cy="12" r="2.2" />
    <circle cx="14" cy="19" r="2.2" />
    <path d="M12.8 6.8 L10.2 10.2" />
    <path d="M10.2 13.8 L12.8 17.2" />
  </>,
);

/** Chave seccionadora fechada (lâmina reta entre os contatos). */
const DisconnectClosedIcon = svgIcon(
  <>
    <path d="M2 12 h3.4" />
    <circle cx="7" cy="12" r="1.6" />
    <path d="M8.6 12 H15.4" />
    <circle cx="17" cy="12" r="1.6" />
    <path d="M18.6 12 H22" />
  </>,
);

/** Chave seccionadora aberta (lâmina levantada). */
const DisconnectOpenIcon = svgIcon(
  <>
    <path d="M2 12 h3.4" />
    <circle cx="7" cy="12" r="1.6" />
    <path d="M8.2 10.9 L15.2 4.8" />
    <circle cx="17" cy="12" r="1.6" />
    <path d="M18.6 12 H22" />
  </>,
);

/** Disjuntor fechado (símbolo IEC: contatos em X, lâmina reta). */
const BreakerClosedIcon = svgIcon(
  <>
    <path d="M2 12 h2.6" />
    <path d="M4.6 10.6 L7.4 13.4 M7.4 10.6 L4.6 13.4" />
    <path d="M7.4 12 H16.6" />
    <path d="M16.6 10.6 L19.4 13.4 M19.4 10.6 L16.6 13.4" />
    <path d="M19.4 12 H22" />
  </>,
);

/** Disjuntor aberto (lâmina levantada). */
const BreakerOpenIcon = svgIcon(
  <>
    <path d="M2 12 h2.6" />
    <path d="M4.6 10.6 L7.4 13.4 M7.4 10.6 L4.6 13.4" />
    <path d="M7.6 11.2 L15.8 5.2" />
    <path d="M16.6 10.6 L19.4 13.4 M19.4 10.6 L16.6 13.4" />
    <path d="M19.4 12 H22" />
  </>,
);

/** Transformador (dois enrolamentos circulares + terminais). */
const TransformerIcon = svgIcon(
  <>
    <circle cx="12" cy="8.2" r="4.6" />
    <circle cx="12" cy="15.8" r="4.6" />
    <path d="M12 1.5 v2.1 M12 20.4 v2.1" />
  </>,
);

/** Gerador (círculo com senoide + terminais). */
const GeneratorIcon = svgIcon(
  <>
    <circle cx="12" cy="12" r="7" />
    <path d="M8.5 12 q1.75 -3.4 3.5 0 t3.5 0" />
    <path d="M12 5 V2 M12 19 V22" />
  </>,
);

/** UPS / nobreak (gabinete com raio e barras de bateria). */
const UpsIcon = svgIcon(
  <>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M9.5 8.5 L7 12 h2.4 L7.9 15.5" />
    <path d="M13.5 10.5 h4.5 M13.5 13.5 h4.5" />
  </>,
);

/** Quadro / painel elétrico (gabinete com réguas de disjuntores). */
const ElectricalPanelIcon = svgIcon(
  <>
    <rect x="5" y="3" width="14" height="18" rx="1.5" />
    <path d="M8 7 h8 M8 10.5 h8 M8 14 h8" />
    <path d="M10 17.8 h4" />
  </>,
);

/** Medidor de energia (mostrador circular em caixa com terminais). */
const EnergyMeterIcon = svgIcon(
  <>
    <rect x="4" y="3" width="16" height="15" rx="1.5" />
    <circle cx="12" cy="9.5" r="3.6" />
    <path d="M12 9.5 L14.2 7.2" />
    <path d="M8 21 v-3 M16 21 v-3" />
  </>,
);

/** Aterramento (símbolo de terra). */
const GroundIcon = svgIcon(
  <>
    <path d="M12 3 v8" />
    <path d="M5 11 h14" />
    <path d="M7.5 15 h9" />
    <path d="M10 19 h4" />
  </>,
);

/** Barramento com derivações. */
const BusbarIcon = svgIcon(
  <>
    <path d="M3 8 h18" />
    <path d="M6 8 v6 M12 8 v6 M18 8 v6" />
    <circle cx="6" cy="15.8" r="1.5" />
    <circle cx="12" cy="15.8" r="1.5" />
    <circle cx="18" cy="15.8" r="1.5" />
  </>,
);

// ─── Pacote BMS: CAG / HVAC ──────────────────────────────────────────────────

/** Chiller (gabinete com cristal de refrigeração e conexões). */
const ChillerIcon = svgIcon(
  <>
    <rect x="3" y="7" width="18" height="12" rx="2" />
    <path d="M6.5 7 V4 M17.5 7 V4" />
    <path d="M12 9.5 v7 M9.2 11.2 l5.6 3.6 M14.8 11.2 l-5.6 3.6" />
  </>,
);

/** Torre de resfriamento (corpo trapezoidal, ventilador no topo, água). */
const CoolingTowerIcon = svgIcon(
  <>
    <path d="M7 9 L5 20 H19 L17 9 Z" />
    <path d="M7 9 h10" />
    <circle cx="12" cy="5.4" r="2.4" />
    <path d="M12 7.8 V9" />
    <path d="M8.3 16 q1.25 -1.4 2.5 0 t2.5 0 t2.5 0" />
  </>,
);

/** Bomba centrífuga (voluta circular com saída tangencial e base). */
const CentrifugalPumpIcon = svgIcon(
  <>
    <circle cx="11" cy="11" r="6" />
    <path d="M11 5 H20 v4" />
    <path d="M5 20 h12" />
    <path d="M7.8 16.4 L6.6 20 M14.2 16.4 L15.4 20" />
  </>,
);

/** Fancoil / AHU (gabinete com ventilador e serpentina). */
const AhuIcon = svgIcon(
  <>
    <rect x="2.5" y="6" width="19" height="12" rx="1.5" />
    <circle cx="8.5" cy="12" r="3" />
    <circle cx="8.5" cy="12" r="0.6" />
    <path d="M14.5 8.5 L19 15.5 M19 8.5 L14.5 15.5" />
  </>,
);

/** Damper (duto com aletas inclinadas). */
const DamperIcon = svgIcon(
  <>
    <rect x="4" y="4" width="16" height="16" rx="1" />
    <path d="M7.5 8.8 L16.5 6.4" />
    <path d="M7.5 13.2 L16.5 10.8" />
    <path d="M7.5 17.6 L16.5 15.2" />
  </>,
);

/** Compressor (símbolo P&ID: círculo com linhas em V e pés). */
const CompressorIcon = svgIcon(
  <>
    <circle cx="12" cy="11" r="7" />
    <path d="M7.8 6.4 L12 11 L16.2 6.4" />
    <path d="M7 20.5 l2.2 -3.2 M17 20.5 l-2.2 -3.2" />
  </>,
);

/** Trocador de calor (círculo com zigue-zague e conexões). */
const HeatExchangerIcon = svgIcon(
  <>
    <circle cx="12" cy="12" r="7" />
    <path d="M2 12 h3 M19 12 h3" />
    <path d="M6 12 l1.9 -3.4 2.9 6.8 2.9 -6.8 1.9 3.4" />
  </>,
);

// ─── Pacote BMS: Hidráulica ──────────────────────────────────────────────────

/** Reservatório / caixa d'água (tanque com linha d'água). */
const WaterTankIcon = svgIcon(
  <>
    <path d="M4 4.5 h16 v13.5 a2.5 2.5 0 0 1 -2.5 2.5 h-11 A2.5 2.5 0 0 1 4 18 Z" />
    <path d="M4 10.5 q2 -1.6 4 0 t4 0 t4 0 t4 0" />
  </>,
);

/** Medidor de vazão / hidrômetro (tubo com mostrador circular). */
const FlowMeterIcon = svgIcon(
  <>
    <path d="M2 12 h4 M18 12 h4" />
    <circle cx="12" cy="12" r="6" />
    <path d="M12 12 L14.6 9.4" />
    <path d="M9.4 15.4 h5.2" />
  </>,
);

/** Filtro (funil com elemento filtrante). */
const WaterFilterIcon = svgIcon(
  <>
    <path d="M4 4 h16 l-6.5 8 v7.5 l-3 -2.2 V12 Z" />
    <path d="M7.3 8 h9.4" />
  </>,
);

/** Manômetro / pressostato (mostrador sobre haste). */
const PressureGaugeIcon = svgIcon(
  <>
    <circle cx="12" cy="9" r="6.5" />
    <path d="M12 9 L15.2 5.8" />
    <path d="M7.6 5.6 l-0.9 -0.9 M16.4 5.6 l0.9 0.9" />
    <path d="M12 15.5 V19 M8.5 19 h7 M12 19 v2.5" />
  </>,
);

/** Boia de nível (reservatório com boia suspensa). */
const FloatSwitchIcon = svgIcon(
  <>
    <path d="M4 4.5 V19.5 M20 4.5 V19.5" />
    <path d="M4 15 q2 -1.5 4 0 t4 0 t4 0 t4 0" />
    <path d="M14.5 3.5 V8" />
    <circle cx="14.5" cy="10.3" r="2.3" />
  </>,
);

export interface ScadaIconDef {
  /** Rótulo exibido na paleta e no painel de propriedades. */
  label: string;
  /** Ícone padrão (projeto / sem binding). */
  Icon: SvgIcon;
  /** Variante "ligado" (valor 1). Ausente = mesmo desenho, só muda a cor. */
  IconOn?: SvgIcon;
  /** Variante "desligado" (valor 0). Ausente = mesmo desenho, só muda a cor. */
  IconOff?: SvgIcon;
  /** Cor sugerida para o estado ligado (padrão do widget ao criar). */
  onColor?: string;
  /** Termos extras de busca (pt/en), além do label e da chave. */
  keywords?: string;
}

export const SCADA_ICONS: Record<string, ScadaIconDef> = {
  lightbulb: { label: 'Lâmpada', Icon: Lightbulb, IconOn: Lightbulb, IconOff: LightbulbOff, onColor: '#FACC15' },
  motor: { label: 'Motor', Icon: MotorIcon, onColor: '#22C55E' },
  gear: { label: 'Engrenagem', Icon: Cog, onColor: '#22C55E' },
  pump: { label: 'Bomba', Icon: Droplets, onColor: '#38BDF8' },
  fan: { label: 'Ventilador', Icon: Fan, onColor: '#22C55E' },
  valve: { label: 'Válvula', Icon: ValveIcon, onColor: '#22C55E' },
  plug: { label: 'Tomada', Icon: Plug, IconOn: PlugZap, IconOff: Plug, onColor: '#FACC15' },
  door: { label: 'Porta', Icon: DoorClosed, IconOn: DoorOpen, IconOff: DoorClosed, onColor: '#F97316' },
  window: { label: 'Janela', Icon: WindowIcon, onColor: '#38BDF8' },
  ac: { label: 'Ar-condicionado', Icon: AirVent, onColor: '#38BDF8' },
  sensor: { label: 'Sensor', Icon: Gauge, onColor: '#22C55E' },
  thermometer: { label: 'Termômetro', Icon: Thermometer, onColor: '#F97316' },
  heater: { label: 'Aquecedor', Icon: Heater, onColor: '#F97316' },
  boiler: { label: 'Caldeira / Chama', Icon: Flame, onColor: '#F97316' },
  solar: { label: 'Painel Solar', Icon: SolarPanelIcon, onColor: '#FACC15' },
  battery: { label: 'Bateria', Icon: Battery, IconOn: BatteryFull, IconOff: BatteryLow, onColor: '#22C55E' },
  alert: { label: 'Alerta', Icon: AlertTriangle, onColor: '#EF4444' },
  bell: { label: 'Sino', Icon: Bell, onColor: '#F59E0B' },
  power: { label: 'Power', Icon: Power, onColor: '#22C55E' },
  zap: { label: 'Energia (Raio)', Icon: Zap, onColor: '#FACC15' },
  lock: { label: 'Cadeado', Icon: Lock, IconOn: LockOpen, IconOff: Lock, onColor: '#22C55E' },
  snowflake: { label: 'Refrigeração', Icon: Snowflake, onColor: '#38BDF8' },
  sun: { label: 'Sol', Icon: Sun, onColor: '#FACC15' },
  wind: { label: 'Vento', Icon: Wind, onColor: '#38BDF8' },
  waves: { label: 'Água / Fluxo', Icon: Waves, onColor: '#38BDF8' },
  camera: { label: 'Câmera', Icon: Camera, onColor: '#22C55E' },
  // ── Pacote BMS: Elétrica ──
  circuit: { label: 'Circuito Elétrico', Icon: CircuitNodeIcon, onColor: '#22C55E', keywords: 'circuito elétrico nó conexão energia circuit node' },
  'disconnect-switch': { label: 'Chave Seccionadora', Icon: DisconnectClosedIcon, IconOn: DisconnectClosedIcon, IconOff: DisconnectOpenIcon, onColor: '#22C55E', keywords: 'seccionadora chave faca isolador elétrica disconnect switch isolator' },
  breaker: { label: 'Disjuntor', Icon: BreakerClosedIcon, IconOn: BreakerClosedIcon, IconOff: BreakerOpenIcon, onColor: '#22C55E', keywords: 'disjuntor proteção elétrica circuit breaker' },
  transformer: { label: 'Transformador', Icon: TransformerIcon, onColor: '#FACC15', keywords: 'trafo transformador subestação elétrica transformer' },
  generator: { label: 'Gerador', Icon: GeneratorIcon, onColor: '#22C55E', keywords: 'gerador grupo gerador diesel gmg energia generator' },
  ups: { label: 'UPS / Nobreak', Icon: UpsIcon, onColor: '#22C55E', keywords: 'nobreak ups bateria energia estabilizador' },
  'electrical-panel': { label: 'Quadro Elétrico', Icon: ElectricalPanelIcon, onColor: '#FACC15', keywords: 'quadro painel elétrico qgbt qdc distribuição switchboard' },
  'energy-meter': { label: 'Medidor de Energia', Icon: EnergyMeterIcon, onColor: '#22C55E', keywords: 'medidor energia kwh multimedidor consumo meter' },
  ground: { label: 'Aterramento', Icon: GroundIcon, onColor: '#22C55E', keywords: 'terra aterramento malha gnd elétrica ground earth' },
  busbar: { label: 'Barramento', Icon: BusbarIcon, onColor: '#FACC15', keywords: 'barramento busbar distribuição elétrica' },
  // ── Pacote BMS: CAG / HVAC ──
  chiller: { label: 'Chiller', Icon: ChillerIcon, onColor: '#38BDF8', keywords: 'chiller cag água gelada central refrigeração hvac' },
  'cooling-tower': { label: 'Torre de Resfriamento', Icon: CoolingTowerIcon, onColor: '#38BDF8', keywords: 'torre resfriamento arrefecimento condensação cag cooling tower' },
  'centrifugal-pump': { label: 'Bomba Centrífuga', Icon: CentrifugalPumpIcon, onColor: '#38BDF8', keywords: 'bomba centrífuga recalque cag hidráulica pump' },
  ahu: { label: 'Fancoil / AHU', Icon: AhuIcon, onColor: '#38BDF8', keywords: 'fancoil ahu ar condicionado climatizador hvac unidade de tratamento de ar' },
  damper: { label: 'Damper', Icon: DamperIcon, onColor: '#22C55E', keywords: 'damper registro de ar veneziana duto hvac' },
  compressor: { label: 'Compressor', Icon: CompressorIcon, onColor: '#22C55E', keywords: 'compressor refrigeração ar comprimido cag' },
  'heat-exchanger': { label: 'Trocador de Calor', Icon: HeatExchangerIcon, onColor: '#F97316', keywords: 'trocador de calor permutador placas casco cag heat exchanger' },
  // ── Pacote BMS: Hidráulica ──
  'water-tank': { label: 'Reservatório', Icon: WaterTankIcon, onColor: '#38BDF8', keywords: "reservatório caixa d'água tanque cisterna hidráulica tank" },
  'flow-meter': { label: 'Medidor de Vazão', Icon: FlowMeterIcon, onColor: '#38BDF8', keywords: 'hidrômetro vazão medidor água hidráulica flow meter' },
  filter: { label: 'Filtro', Icon: WaterFilterIcon, onColor: '#38BDF8', keywords: 'filtro água hidráulica strainer' },
  'pressure-gauge': { label: 'Manômetro', Icon: PressureGaugeIcon, onColor: '#F97316', keywords: 'manômetro pressostato pressão hidráulica gauge' },
  'float-switch': { label: 'Boia de Nível', Icon: FloatSwitchIcon, onColor: '#38BDF8', keywords: 'boia nível chave de nível reservatório hidráulica float switch' },
};

/** Fallback seguro para telas salvas com nome de ícone desconhecido. */
export function getScadaIcon(name: string): ScadaIconDef {
  return SCADA_ICONS[name] ?? NAV_ICON_AS_SCADA(name) ?? SCADA_ICONS.alert;
}

function NAV_ICON_AS_SCADA(name: string): ScadaIconDef | undefined {
  const def = NAV_ICONS[name];
  return def ? { label: def.label, Icon: def.Icon } : undefined;
}

// ─── Biblioteca de ícones de navegação/UI ────────────────────────────────────
// Registro ÚNICO usado por sidebar, toolbar, botão de navegação, hotspot e
// picker. Os nomes LEGADOS (arrow-right, home, dashboard, monitor, bell etc.)
// continuam resolvendo para o mesmo desenho — nunca renomear chaves existentes.

export interface NavIconDef {
  label: string;
  Icon: SvgIcon;
  /** Termos extras de busca (pt/en), além do label e da chave. */
  keywords?: string;
}

export const NAV_ICONS: Record<string, NavIconDef> = {
  // Legados (mapa antigo dos widgets de nav) — manter sempre.
  'arrow-right': { label: 'Seta direita', Icon: ArrowRight, keywords: 'navegar avançar' },
  'arrow-left': { label: 'Seta esquerda', Icon: ArrowLeft, keywords: 'voltar' },
  'arrow-up': { label: 'Seta cima', Icon: ArrowUp },
  'arrow-down': { label: 'Seta baixo', Icon: ArrowDown },
  'chevron-right': { label: 'Chevron direita', Icon: ChevronRight },
  'chevron-left': { label: 'Chevron esquerda', Icon: ChevronLeft },
  'chevron-up': { label: 'Chevron cima', Icon: ChevronUp },
  'chevron-down': { label: 'Chevron baixo', Icon: ChevronDown },
  home: { label: 'Início', Icon: Home, keywords: 'casa home principal' },
  dashboard: { label: 'Dashboard', Icon: LayoutDashboard, keywords: 'painel' },
  monitor: { label: 'Monitor', Icon: Monitor, keywords: 'tela supervisório' },
  layers: { label: 'Camadas', Icon: Layers, keywords: 'andares pavimentos' },
  settings: { label: 'Configurações', Icon: Settings, keywords: 'ajustes engrenagem' },
  'external-link': { label: 'Link externo', Icon: ExternalLink },
  bell: { label: 'Sino', Icon: Bell, keywords: 'alarme notificação' },
  thermometer: { label: 'Termômetro', Icon: Thermometer, keywords: 'temperatura clima' },
  zap: { label: 'Raio', Icon: Zap, keywords: 'energia elétrica' },
  // Navegação / layout
  menu: { label: 'Menu', Icon: Menu, keywords: 'hambúrguer' },
  grid: { label: 'Grade', Icon: Grid3x3, keywords: 'grid mosaico' },
  'layout-grid': { label: 'Painéis', Icon: LayoutGrid, keywords: 'grid blocos' },
  list: { label: 'Lista', Icon: List },
  folder: { label: 'Pasta', Icon: Folder },
  search: { label: 'Busca', Icon: Search, keywords: 'lupa procurar' },
  map: { label: 'Mapa', Icon: Map, keywords: 'planta' },
  'map-pin': { label: 'Localização', Icon: MapPin, keywords: 'pino site local' },
  globe: { label: 'Globo', Icon: Globe, keywords: 'mundo site' },
  building: { label: 'Prédio', Icon: Building2, keywords: 'edifício site' },
  factory: { label: 'Fábrica', Icon: Factory, keywords: 'indústria planta' },
  // Dashboards / gráficos
  activity: { label: 'Atividade', Icon: Activity, keywords: 'pulso telemetria' },
  'bar-chart': { label: 'Gráfico de barras', Icon: BarChart3, keywords: 'gráfico relatório' },
  'line-chart': { label: 'Gráfico de linha', Icon: LineChart, keywords: 'tendência trend' },
  'pie-chart': { label: 'Gráfico de pizza', Icon: PieChart },
  'trending-up': { label: 'Tendência', Icon: TrendingUp, keywords: 'subindo' },
  gauge: { label: 'Medidor', Icon: Gauge, keywords: 'gauge velocímetro' },
  history: { label: 'Histórico', Icon: History },
  clock: { label: 'Relógio', Icon: Clock, keywords: 'hora tempo' },
  timer: { label: 'Cronômetro', Icon: Timer },
  'alarm-clock': { label: 'Despertador', Icon: AlarmClock, keywords: 'agenda' },
  calendar: { label: 'Calendário', Icon: Calendar, keywords: 'agenda data' },
  clipboard: { label: 'Prancheta', Icon: ClipboardList, keywords: 'checklist tarefas' },
  'file-text': { label: 'Documento', Icon: FileText, keywords: 'relatório arquivo' },
  archive: { label: 'Arquivo', Icon: Archive, keywords: 'caixa histórico' },
  // Alarmes / segurança
  alert: { label: 'Alerta', Icon: AlertTriangle, keywords: 'alarme atenção' },
  shield: { label: 'Escudo', Icon: Shield, keywords: 'segurança proteção' },
  'shield-alert': { label: 'Escudo alerta', Icon: ShieldAlert, keywords: 'segurança alarme' },
  lock: { label: 'Cadeado', Icon: Lock, keywords: 'acesso segurança' },
  'lock-open': { label: 'Cadeado aberto', Icon: LockOpen, keywords: 'acesso liberado' },
  eye: { label: 'Olho', Icon: Eye, keywords: 'monitorar visualizar' },
  info: { label: 'Informação', Icon: Info },
  // Equipamentos / infraestrutura
  fan: { label: 'Ventilador', Icon: Fan, keywords: 'hvac exaustor' },
  'air-vent': { label: 'Ar-condicionado', Icon: AirVent, keywords: 'hvac clima' },
  snowflake: { label: 'Refrigeração', Icon: Snowflake, keywords: 'frio gelo' },
  flame: { label: 'Chama', Icon: Flame, keywords: 'caldeira fogo incêndio' },
  heater: { label: 'Aquecedor', Icon: Heater },
  droplet: { label: 'Gota', Icon: Droplet, keywords: 'água hidráulica' },
  droplets: { label: 'Gotas', Icon: Droplets, keywords: 'água bomba' },
  waves: { label: 'Água / Fluxo', Icon: Waves, keywords: 'reservatório' },
  wind: { label: 'Vento', Icon: Wind, keywords: 'ar exaustão' },
  sun: { label: 'Sol', Icon: Sun, keywords: 'clima solar dia' },
  moon: { label: 'Lua', Icon: Moon, keywords: 'noite tema escuro' },
  cloud: { label: 'Nuvem', Icon: Cloud, keywords: 'clima tempo' },
  'cloud-rain': { label: 'Chuva', Icon: CloudRain, keywords: 'clima tempo' },
  lightbulb: { label: 'Lâmpada', Icon: Lightbulb, keywords: 'iluminação luz' },
  plug: { label: 'Tomada', Icon: Plug, keywords: 'energia elétrica' },
  'plug-zap': { label: 'Tomada energizada', Icon: PlugZap, keywords: 'energia' },
  power: { label: 'Power', Icon: Power, keywords: 'ligar desligar' },
  battery: { label: 'Bateria', Icon: Battery, keywords: 'energia nobreak' },
  'battery-charging': { label: 'Bateria carregando', Icon: BatteryCharging, keywords: 'energia' },
  gear: { label: 'Engrenagem', Icon: Cog, keywords: 'motor mecânico' },
  wrench: { label: 'Chave inglesa', Icon: Wrench, keywords: 'manutenção' },
  sliders: { label: 'Ajustes', Icon: SlidersHorizontal, keywords: 'controles setpoint' },
  'door-closed': { label: 'Porta fechada', Icon: DoorClosed, keywords: 'acesso' },
  'door-open': { label: 'Porta aberta', Icon: DoorOpen, keywords: 'acesso' },
  // TI / rede / CFTV
  camera: { label: 'Câmera', Icon: Camera, keywords: 'cftv vigilância' },
  video: { label: 'Vídeo', Icon: Video, keywords: 'cftv câmera' },
  server: { label: 'Servidor', Icon: Server, keywords: 'datacenter rack' },
  database: { label: 'Banco de dados', Icon: Database },
  'hard-drive': { label: 'Disco', Icon: HardDrive, keywords: 'armazenamento nvr' },
  cpu: { label: 'CPU', Icon: Cpu, keywords: 'processador controladora' },
  'circuit-board': { label: 'Placa', Icon: CircuitBoard, keywords: 'controladora eletrônica' },
  network: { label: 'Rede', Icon: Network, keywords: 'topologia' },
  wifi: { label: 'Wi-Fi', Icon: Wifi, keywords: 'rede sem fio online' },
  'wifi-off': { label: 'Wi-Fi off', Icon: WifiOff, keywords: 'offline sem rede' },
  signal: { label: 'Sinal', Icon: Signal, keywords: 'rede antena' },
  radio: { label: 'Rádio', Icon: Radio, keywords: 'antena transmissão' },
  // Pessoas / diversos
  user: { label: 'Usuário', Icon: User, keywords: 'pessoa perfil' },
  users: { label: 'Usuários', Icon: Users, keywords: 'pessoas equipe' },
  'message-square': { label: 'Mensagem', Icon: MessageSquare, keywords: 'chat comentário' },
  star: { label: 'Estrela', Icon: Star, keywords: 'favorito' },
  play: { label: 'Play', Icon: Play, keywords: 'iniciar' },
  pause: { label: 'Pause', Icon: Pause, keywords: 'pausar' },
  refresh: { label: 'Atualizar', Icon: RefreshCw, keywords: 'refresh recarregar' },
};

/** Resolve nome → desenho para widgets de navegação (fallback = chevron). */
export function getNavIcon(name: string): SvgIcon {
  return NAV_ICONS[name]?.Icon ?? SCADA_ICONS[name]?.Icon ?? ChevronRight;
}

/** Biblioteca unificada exibida no picker (nav + equipamentos, sem duplicar chaves). */
export interface IconLibraryEntry { name: string; label: string; Icon: SvgIcon; keywords?: string }
export const ICON_LIBRARY: IconLibraryEntry[] = [
  ...Object.entries(NAV_ICONS).map(([name, d]) => ({ name, label: d.label, Icon: d.Icon, keywords: d.keywords })),
  ...Object.entries(SCADA_ICONS)
    .filter(([name]) => !NAV_ICONS[name])
    .map(([name, d]) => ({ name, label: d.label, Icon: d.Icon, keywords: d.keywords })),
];

// ─── Estilo "tile" (quadrado arredondado com fundo derivado da cor) ──────────

function parseHex(color: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * Deriva da MESMA cor um fundo translúcido (matiz igual, tonalidade diferente)
 * — ícone vivo sobre quadrado suave. Alpha funciona nos temas claro e escuro
 * porque mistura a matiz com o fundo real da tela.
 */
export function deriveTileStyle(color: string): React.CSSProperties {
  const rgb = parseHex(color);
  const at = (a: number) =>
    rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})` : `color-mix(in srgb, ${color} ${Math.round(a * 100)}%, transparent)`;
  return { backgroundColor: at(0.16), border: `1px solid ${at(0.32)}` };
}

/** Imagem enviada como ícone — fallback cinza quando a URL não carrega. */
export function AssetIconImage({ url, size, radius = 4 }: { url: string; size: number; radius?: number }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span style={{ width: size, height: size, borderRadius: radius, backgroundColor: 'rgba(100,116,139,0.25)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <ImageOff size={Math.max(8, size * 0.6)} color="#64748B" strokeWidth={1.5} />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={resolveAssetUrl(url)} alt="" onError={() => setFailed(true)} style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0, borderRadius: radius }} draggable={false} />
  );
}

/**
 * Glyph compartilhado dos widgets de navegação (sidebar/toolbar/botão/hotspot):
 * ícone da biblioteca OU imagem enviada, com modo "tile" opt-in (quadrado
 * arredondado cujo fundo é derivado automaticamente da cor única escolhida).
 * Sem tile, o ícone herda a cor do texto (currentColor) — comportamento legado.
 */
export function ScadaNavGlyph({
  name, assetUrl, size, tileEnabled, tileColor, color, strokeWidth = 1.5,
}: {
  name?: string; assetUrl?: string; size: number;
  tileEnabled?: boolean; tileColor?: string;
  /** Cor do ícone sem tile (default: currentColor). */
  color?: string; strokeWidth?: number;
}) {
  const inner = assetUrl
    ? <AssetIconImage url={assetUrl} size={size} />
    : (() => {
        const Icon = getNavIcon(name ?? '');
        return <Icon size={size} color={tileEnabled ? (tileColor || '#38BDF8') : (color ?? 'currentColor')} strokeWidth={strokeWidth} />;
      })();
  if (!tileEnabled) {
    return <span style={{ width: size, height: size, display: 'inline-flex', flexShrink: 0 }}>{inner}</span>;
  }
  const box = Math.round(size * 1.75);
  return (
    <span
      style={{
        width: box, height: box, borderRadius: Math.max(4, Math.round(box * 0.28)),
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        ...deriveTileStyle(tileColor || '#38BDF8'),
      }}
    >
      {inner}
    </span>
  );
}
