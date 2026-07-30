'use client';

import { useState } from 'react';
import { Bell, Boxes, ChevronDown, ChevronRight, Compass, Cpu, LayoutDashboard, Lightbulb, Radio, Shapes, SlidersHorizontal, Square, Trash2, Type } from 'lucide-react';
import type { Widget, WidgetType, SavedComponent } from '../../types/scada.types';
import { useEditorStore } from '../../store/editor.store';
import { SCADA_ICONS } from '../widgets/scadaIcons';
import { EQUIPMENT_IMAGES, CAMERA_DOME_IMAGE } from '../widgets/EquipmentWidget';

interface PaletteItem {
  type: WidgetType;
  label: string;
  id?: string;
  overrides?: Partial<Widget>;
  size?: { w: number; h: number };
}
interface PaletteCategory { id: string; label: string; icon: React.ReactNode; items: PaletteItem[] }

const CATEGORIES: PaletteCategory[] = [
  {
    id: 'text', label: 'Texto', icon: <Type className="h-3.5 w-3.5" strokeWidth={1.5} />,
    items: [
      { type: 'label-static', label: 'Label Estático' },
      { type: 'section-title', label: 'Título de Seção' },
      { type: 'value-dynamic', label: 'Valor Dinâmico' },
      { type: 'label-value-block', label: 'Bloco Label + Valor' },
    ],
  },
  {
    id: 'equipment', label: 'Equipamentos', icon: <Cpu className="h-3.5 w-3.5" strokeWidth={1.5} />,
    items: [
      { type: 'chiller', label: 'Chiller' },
      { type: 'pump', label: 'Bomba' },
      { type: 'ahu', label: 'UTA / AHU' },
      { type: 'fan', label: 'Ventilador' },
      { type: 'valve', label: 'Válvula' },
      { type: 'generator', label: 'Gerador' },
      { type: 'meter', label: 'Medidor' },
      { type: 'controller', label: 'Controladora' },
      { type: 'compressor', label: 'Compressor' },
      { type: 'cooling-tower', label: 'Torre de Resfriamento' },
      { type: 'fan-coil', label: 'Fan Coil' },
      { type: 'electrical-panel', label: 'Quadro Elétrico' },
      { type: 'tank', label: 'Reservatório' },
      { type: 'sensor', label: 'Sensor' },
      { type: 'smoke-detector', label: 'Detector de Incêndio' },
      { type: 'lighting', label: 'Iluminação' },
      { type: 'camera', label: 'Câmera CFTV (bullet)' },
      { id: 'camera-dome', type: 'camera', label: 'Câmera CFTV (dome)', overrides: { cameraModel: 'dome' } },
    ],
  },
  {
    id: 'indicators', label: 'Indicadores', icon: <Radio className="h-3.5 w-3.5" strokeWidth={1.5} />,
    items: [
      { type: 'led-status', label: 'LED Status' },
      { type: 'gauge', label: 'Gauge' },
      { type: 'progress-bar', label: 'Barra de Progresso' },
      { type: 'thermometer', label: 'Termômetro' },
      { type: 'numeric-display', label: 'Display Numérico' },
      { type: 'trend-arrow', label: 'Seta de Tendência' },
    ],
  },
  {
    id: 'dashboard', label: 'Dashboard / Cards', icon: <LayoutDashboard className="h-3.5 w-3.5" strokeWidth={1.5} />,
    items: [
      { type: 'kpi-card', label: 'Card KPI' },
      { type: 'sensor-card', label: 'Card Sensor (sparkline)' },
      { type: 'dash-chart', label: 'Gráfico de Tendência' },
      { type: 'event-feed', label: 'Eventos Recentes' },
      { type: 'bar-list', label: 'Barras Percentuais' },
      { type: 'point-table', label: 'Tabela de Pontos' },
      { type: 'segmented-control', label: 'Controle Segmentado' },
      { id: 'cmd-slider-card', type: 'command-slider', label: 'Slider com Rótulo (card)', overrides: { variant: 'card', label: 'Intensidade' }, size: { w: 260, h: 84 } },
    ],
  },
  {
    id: 'alarm', label: 'Alarme', icon: <Bell className="h-3.5 w-3.5" strokeWidth={1.5} />,
    items: [
      { type: 'alarm-indicator', label: 'Indicador de Alarme' },
      { type: 'alarm-counter', label: 'Contador de Alarmes' },
      { type: 'alarm-group-badge', label: 'Soma de Alarmes' },
      { type: 'device-counter', label: 'Contador de Dispositivos' },
    ],
  },
  {
    id: 'nav', label: 'Navegação', icon: <Compass className="h-3.5 w-3.5" strokeWidth={1.5} />,
    items: [
      { type: 'hotspot', label: 'Hotspot' },
      { type: 'nav-button', label: 'Botão de Navegação' },
      { type: 'nav-sidebar', label: 'Sidebar de Navegação' },
      { type: 'nav-toolbar', label: 'Toolbar de Navegação' },
    ],
  },
  {
    id: 'commands', label: 'Comandos', icon: <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={1.5} />,
    items: [
      { id: 'cmd-solid', type: 'command-button', label: 'Botão Sólido (DO)' },
      { id: 'cmd-outline', type: 'command-button', label: 'Botão Contorno', overrides: { variant: 'outline' } },
      { id: 'cmd-soft', type: 'command-button', label: 'Botão Suave', overrides: { variant: 'soft' } },
      { id: 'cmd-pill', type: 'command-button', label: 'Botão Pílula', overrides: { variant: 'pill' } },
      { id: 'cmd-ghost', type: 'command-button', label: 'Botão Ghost', overrides: { variant: 'ghost' } },
      { id: 'cmd-icon', type: 'command-button', label: 'Botão Ícone', overrides: { variant: 'soft', iconOnly: true, showState: false }, size: { w: 56, h: 56 } },
      { type: 'toggle-switch', label: 'Interruptor (toggle)' },
      { type: 'command-slider', label: 'Slider de Comando (AO)' },
    ],
  },
  {
    id: 'icons', label: 'Ícones', icon: <Lightbulb className="h-3.5 w-3.5" strokeWidth={1.5} />,
    // Grade de miniaturas — itens gerados do registro central (ver render abaixo).
    items: Object.entries(SCADA_ICONS).map(([name, def]) => ({
      id: `icon-${name}`, type: 'icon' as WidgetType, label: def.label, overrides: { iconName: name, colorOn: def.onColor ?? '#22C55E' } as Partial<Widget>,
    })),
  },
  {
    id: 'shapes', label: 'Formas', icon: <Shapes className="h-3.5 w-3.5" strokeWidth={1.5} />,
    items: [
      { type: 'rectangle', label: 'Retângulo' },
      { type: 'square', label: 'Quadrado' },
      { type: 'circle', label: 'Círculo' },
      { type: 'ellipse', label: 'Elipse' },
      { type: 'triangle', label: 'Triângulo' },
      { type: 'line', label: 'Linha' },
      { type: 'pipe', label: 'Tubulação (fluxo)' },
      { id: 'pipe-draw', type: 'pipe', label: 'Tubulação — desenhar no canvas' },
    ],
  },
  {
    id: 'layout', label: 'Layout', icon: <Square className="h-3.5 w-3.5" strokeWidth={1.5} />,
    items: [
      { type: 'image', label: 'Imagem' },
      { type: 'titled-area', label: 'Área com Título' },
      { type: 'separator', label: 'Separador' },
    ],
  },
];

const DEFAULT_SIZES: Partial<Record<WidgetType, { w: number; h: number }>> = {
  'label-static': { w: 200, h: 40 },
  'section-title': { w: 300, h: 44 },
  'value-dynamic': { w: 160, h: 60 },
  'label-value-block': { w: 200, h: 90 },
  'led-status': { w: 60, h: 60 },
  gauge: { w: 180, h: 180 },
  'progress-bar': { w: 200, h: 40 },
  thermometer: { w: 60, h: 140 },
  'traffic-light': { w: 60, h: 140 },
  'numeric-display': { w: 180, h: 80 },
  'trend-arrow': { w: 80, h: 80 },
  'alarm-indicator': { w: 60, h: 60 },
  'alarm-counter': { w: 80, h: 60 },
  'alarm-group-badge': { w: 150, h: 64 },
  'device-counter': { w: 170, h: 64 },
  chiller: { w: 160, h: 140 },
  pump: { w: 120, h: 100 },
  ahu: { w: 140, h: 120 },
  fan: { w: 120, h: 120 },
  valve: { w: 100, h: 80 },
  generator: { w: 140, h: 120 },
  meter: { w: 140, h: 120 },
  controller: { w: 140, h: 120 },
  compressor: { w: 140, h: 120 },
  'cooling-tower': { w: 120, h: 140 },
  'fan-coil': { w: 140, h: 100 },
  'electrical-panel': { w: 120, h: 140 },
  tank: { w: 100, h: 140 },
  sensor: { w: 80, h: 80 },
  'smoke-detector': { w: 100, h: 100 },
  camera: { w: 100, h: 100 },
  lighting: { w: 110, h: 100 },
  hotspot: { w: 120, h: 50 },
  'nav-button': { w: 140, h: 44 },
  'nav-sidebar': { w: 180, h: 400 },
  'nav-toolbar': { w: 600, h: 48 },
  line: { w: 200, h: 20 },
  pipe: { w: 220, h: 140 },
  rectangle: { w: 200, h: 120 },
  square: { w: 120, h: 120 },
  circle: { w: 120, h: 120 },
  ellipse: { w: 160, h: 100 },
  triangle: { w: 120, h: 110 },
  image: { w: 220, h: 160 },
  'titled-area': { w: 300, h: 200 },
  separator: { w: 300, h: 20 },
  'command-button': { w: 140, h: 64 },
  'command-slider': { w: 220, h: 56 },
  'toggle-switch': { w: 96, h: 72 },
  icon: { w: 64, h: 64 },
  'kpi-card': { w: 220, h: 120 },
  'sensor-card': { w: 220, h: 140 },
  'dash-chart': { w: 460, h: 260 },
  'bar-list': { w: 320, h: 240 },
  'event-feed': { w: 340, h: 260 },
  'point-table': { w: 360, h: 220 },
  'segmented-control': { w: 260, h: 88 },
};

interface Props {
  onDropWidget: (type: WidgetType, defaultSize: { w: number; h: number }, overrides?: Partial<Widget>) => void;
  components: SavedComponent[];
  onInsertComponent: (id: string) => void;
  onDeleteComponent: (id: string) => void;
}

export function WidgetPalette({ onDropWidget, components, onInsertComponent, onDeleteComponent }: Props) {
  const [open, setOpen] = useState<Record<string, boolean>>({
    components: false, text: false, equipment: false, indicators: false, dashboard: false, alarm: false, nav: false, commands: false, icons: false, shapes: false, layout: false,
  });

  function handleComponentDragStart(e: React.DragEvent, id: string) {
    e.dataTransfer.setData('application/scada-component', JSON.stringify({ componentId: id }));
    e.dataTransfer.effectAllowed = 'copy';
  }

  function toggle(id: string) { setOpen((p) => ({ ...p, [id]: !p[id] })); }

  function handleDragStart(e: React.DragEvent, item: PaletteItem) {
    const size = item.size ?? DEFAULT_SIZES[item.type] ?? { w: 120, h: 80 };
    e.dataTransfer.setData('application/scada-widget', JSON.stringify({ type: item.type, defaultSize: size, overrides: item.overrides }));
    e.dataTransfer.effectAllowed = 'copy';
  }

  return (
    <aside className="flex min-h-0 flex-[3] flex-col bg-slate-800 overflow-hidden">
      <div className="shrink-0 border-b border-slate-700 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">Componentes</p>
      </div>
      <div className="flex-1 overflow-y-auto py-2">
        {components.length > 0 && (
          <div className="mb-1">
            <button type="button" onClick={() => toggle('components')} className="flex w-full items-center gap-2 px-4 py-1.5 text-xs font-medium text-slate-300 hover:text-white transition-colors">
              {open.components ? <ChevronDown className="h-3 w-3 shrink-0 text-slate-500" /> : <ChevronRight className="h-3 w-3 shrink-0 text-slate-500" />}
              <Boxes className="h-3.5 w-3.5" strokeWidth={1.5} />
              <span>Meus Componentes</span>
            </button>
            {open.components && (
              <ul className="mt-1 px-3 pb-1 space-y-0.5">
                {components.map((c) => (
                  <li key={c.id}>
                    <div
                      draggable
                      onDragStart={(e) => handleComponentDragStart(e, c.id)}
                      onDoubleClick={() => onInsertComponent(c.id)}
                      className="group flex cursor-grab items-center gap-2 rounded px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-700 hover:text-white active:cursor-grabbing transition-colors select-none"
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400/70" />
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      <button
                        type="button"
                        title="Excluir componente"
                        onClick={(e) => { e.stopPropagation(); onDeleteComponent(c.id); }}
                        className="shrink-0 rounded p-0.5 text-slate-500 opacity-0 hover:bg-slate-600 hover:text-red-400 group-hover:opacity-100"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {CATEGORIES.map((cat) => (
          <div key={cat.id} className="mb-1">
            <button type="button" onClick={() => toggle(cat.id)} className="flex w-full items-center gap-2 px-4 py-1.5 text-xs font-medium text-slate-300 hover:text-white transition-colors">
              {open[cat.id] ? <ChevronDown className="h-3 w-3 shrink-0 text-slate-500" /> : <ChevronRight className="h-3 w-3 shrink-0 text-slate-500" />}
              {cat.icon}
              <span>{cat.label}</span>
            </button>
            {open[cat.id] && cat.id === 'icons' && (
              <div className="mt-1 grid grid-cols-4 gap-1 px-3 pb-1">
                {cat.items.map((item) => {
                  const name = (item.overrides as { iconName?: string } | undefined)?.iconName ?? '';
                  const def = SCADA_ICONS[name];
                  const Icon = def?.Icon;
                  return (
                    <div
                      key={item.id ?? item.type}
                      title={item.label}
                      draggable
                      onDragStart={(e) => handleDragStart(e, item)}
                      onDoubleClick={() => onDropWidget(item.type, item.size ?? DEFAULT_SIZES[item.type] ?? { w: 64, h: 64 }, item.overrides)}
                      className="flex cursor-grab flex-col items-center gap-0.5 rounded px-1 py-1.5 text-slate-300 hover:bg-slate-700 hover:text-white active:cursor-grabbing transition-colors select-none"
                    >
                      {Icon && <Icon size={20} strokeWidth={1.5} />}
                      <span className="w-full truncate text-center text-[9px] leading-tight text-slate-400">{item.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
            {open[cat.id] && cat.id !== 'icons' && (
              <ul className="mt-1 px-3 pb-1 space-y-0.5">
                {cat.items.map((item) => item.id === 'pipe-draw' ? (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => useEditorStore.getState().setPipeDraw(true)}
                      className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-xs text-cyan-300 hover:bg-slate-700 hover:text-cyan-200 transition-colors select-none"
                      title="Clique e depois clique no canvas para adicionar os vértices (duplo clique/Enter finaliza, Esc cancela)"
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
                      {item.label}
                    </button>
                  </li>
                ) : (
                  <li key={item.id ?? item.type}>
                    <div
                      draggable
                      onDragStart={(e) => handleDragStart(e, item)}
                      onDoubleClick={() => onDropWidget(item.type, item.size ?? DEFAULT_SIZES[item.type] ?? { w: 120, h: 80 }, item.overrides)}
                      className="flex cursor-grab items-center gap-2 rounded px-2 py-1.5 text-xs text-slate-300 hover:bg-slate-700 hover:text-white active:cursor-grabbing transition-colors select-none"
                    >
                      {cat.id === 'equipment' && EQUIPMENT_IMAGES[item.type] ? (
                        // PNG dinâmico do SCADA (asset próprio) — next/image não se aplica
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.id === 'camera-dome' ? CAMERA_DOME_IMAGE : EQUIPMENT_IMAGES[item.type]}
                          alt=""
                          draggable={false}
                          className="h-7 w-7 shrink-0 object-contain pointer-events-none select-none"
                        />
                      ) : (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-500/60" />
                      )}
                      {item.label}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
      <div className="shrink-0 border-t border-slate-700 px-4 py-2">
        <p className="text-[10px] text-slate-500">Arraste para o canvas ou dê duplo clique</p>
      </div>
    </aside>
  );
}
