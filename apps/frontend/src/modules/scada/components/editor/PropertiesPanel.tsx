'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, GripVertical, Search, Trash2, Upload, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useEditorStore } from '../../store/editor.store';
import { useScreenDevices } from '../../hooks/useScreenDevices';
import { getScreens, resolveAssetUrl, uploadScadaAsset } from '../../services/scada.service';
import {
  readWidgetBinding, writeWidgetBinding, CLICK_ACTION_EXCLUDED_TYPES, isTransparentColor, matchOperator, toScadaNumber,
  isGradientColor, parseScadaGradient, makeScadaGradient,
  DEVICE_COUNTER_DEFAULT_ICON,
  normalizeScadaHover, SCADA_HOVER_DEFAULTS, SCADA_HOVER_MAX_TRANSITION_MS,
  getScadaHoverCapabilities,
  canConfigureScadaPopup, createScadaPopupDefaults, normalizeScadaPopup,
  normalizeScadaPopupWidth, normalizeScadaPopupHeight,
  SCADA_POPUP_MIN_WIDTH, SCADA_POPUP_MAX_WIDTH, SCADA_POPUP_MIN_HEIGHT, SCADA_POPUP_MAX_HEIGHT,
} from '../../types/scada.types';
import { reorderNavMenuItems } from '../../types/scada.types';
import { useScreenTelemetry, formatTelemetryValue } from '../../hooks/useScreenTelemetry';
import {
  writableDeviceOptions, writableTagOptions, isBacnetDevice,
  sanitizeCommandTag, hasHiddenReadOnlyPoints,
} from './commandPointOptions';
import { isCameraDevice, type ScreenDevice } from '../../types/virtual.types';
import { BindingSelector } from './BindingSelector';
import { VisibilitySection } from './VisibilitySection';
import {
  normalizeNavToolbarGap, normalizeNavToolbarPaddingX, normalizeNavToolbarPaddingY,
  normalizeNavToolbarFontSize, normalizeNavToolbarLogo, normalizeNavToolbarLogoFit,
  normalizeNavToolbarLogoPosition, normalizeNavToolbarLogoWidth, normalizeNavToolbarLogoHeight,
  NAV_TOOLBAR_DEFAULT_LOGO_HEIGHT, NAV_TOOLBAR_DEFAULT_LOGO_WIDTH,
  NAV_TOOLBAR_MAX_GAP, NAV_TOOLBAR_MAX_PADDING_X, NAV_TOOLBAR_MAX_PADDING_Y,
  NAV_TOOLBAR_MAX_FONT_SIZE, NAV_TOOLBAR_MIN_FONT_SIZE,
  NAV_TOOLBAR_MAX_LOGO_WIDTH, NAV_TOOLBAR_MIN_LOGO_WIDTH,
  NAV_TOOLBAR_MAX_LOGO_HEIGHT, NAV_TOOLBAR_MIN_LOGO_HEIGHT,
} from '../../types/scada.types';
import type {
  LabelStaticWidget, SectionTitleWidget, ValueDynamicWidget, LabelValueBlockWidget,
  LedStatusWidget, GaugeWidget, EquipmentWidget, LineWidget, PipeWidget, PipeStateRule, ShapeWidgetBase,
  HotspotWidget, NavSidebarWidget, NavToolbarWidget, NavButtonWidget,
  TrafficLightWidget, NumericDisplayWidget, TrendArrowWidget, ThermometerWidget, ProgressBarWidget,
  TitledAreaWidget, SeparatorWidget, ImageWidget, NavMenuItem, Widget,
  EquipmentStateRule, ScadaAnimation, VisibilityOperator,
  CommandButtonWidget, CommandSliderWidget, ToggleSwitchWidget, StatusBinding, StatusEffect,
  AlarmGroupBadgeWidget, AlarmGroupBadgeFormat, IconWidget,
  DeviceCounterWidget, DeviceCounterMode, DeviceCounterFilter, DeviceCounterScope, DeviceCounterFormat,
  ClickAction, ClickActionType, ClickActionCommandMode, NavHorizontalAlign, NavSidebarVerticalAlign,
  NavToolbarVerticalAlign,
  NavToolbarLogoConfig,
  ScadaHoverConfig, ScadaHoverTarget, ScadaHoverEasing,
  ScadaPopupConfig, ScadaPopupPlacement, ScadaPopupTrigger,
  KpiCardWidget, SensorCardWidget, DashChartWidget, BarListWidget, EventFeedWidget,
  PointTableWidget, SegmentedControlWidget, DashCardBase, DashPeriodHours,
  ValueStepperWidget, SetpointRingWidget, EquipmentCardWidget, EquipmentCardRow,
  EquipmentCardRowDisplay, ClimateCardWidget, SavedComponent,
} from '../../types/scada.types';
import { SCADA_ICONS } from '../widgets/scadaIcons';
import { IconPicker } from './IconPicker';
import { listAlarmGroups } from '../../services/alarm-groups.service';
import { nanoid } from 'nanoid';
import { PopupEditorDialog } from './PopupEditorDialog';
import {
  buildRestoredWidget,
  inspectorBadgeCounts,
  resolveInspectorSearchTab,
  type InspectorTabId,
} from './inspectorLayout';

const OPERATOR_OPTS: Opt[] = [
  { value: 'eq', label: '= igual a' }, { value: 'neq', label: '≠ diferente' },
  { value: 'gt', label: '> maior' }, { value: 'lt', label: '< menor' },
  { value: 'gte', label: '≥ maior/igual' }, { value: 'lte', label: '≤ menor/igual' },
];
const ANIM_OPTS: Opt[] = [
  { value: 'none', label: 'Nenhuma' }, { value: 'pulse', label: 'Pulsar' },
  { value: 'spin', label: 'Girar' }, { value: 'blink', label: 'Piscar' },
  { value: 'fade', label: 'Esmaecer' }, { value: 'sway', label: 'Balançar' },
  { value: 'wave', label: 'Ondular' }, { value: 'glow', label: 'Brilhar' },
  { value: 'slide', label: 'Deslizar' }, { value: 'shake', label: 'Tremer' },
];

/** Tipos com binding próprio dedicado (comando/soma de alarme) — sem ponto único. */
const NO_UNIFIED_BINDING = new Set<Widget['type']>([
  'command-button', 'command-slider', 'toggle-switch', 'alarm-group-badge', 'alarm-counter', 'device-counter',
  // Dashboard: multi-ponto (linhas/séries próprias) ou comando com seletor próprio.
  'dash-chart', 'bar-list', 'event-feed', 'point-table', 'segmented-control',
  // Clima: stepper tem seletor comandável próprio; cards são multi-ponto.
  'value-stepper', 'equipment-card', 'climate-card',
]);
const NO_TYPE_SPECIFIC_PROPS = new Set<Widget['type']>([
  'alarm-indicator', 'alarm-counter', 'component-instance',
]);

/** Ao definir o ponto único, limpa qualquer ponto legado gravado em status/visibility. */
function clearLegacyPoint(w: Widget): Partial<Widget> {
  const patch: Record<string, unknown> = {};
  if (w.status && (w.status.deviceId || w.status.tag)) {
    patch.status = { ...w.status, deviceId: undefined, tag: undefined };
  }
  if (w.visibility && (w.visibility.deviceId || w.visibility.tag)) {
    patch.visibility = { ...w.visibility, deviceId: undefined, tag: undefined };
  }
  return patch as Partial<Widget>;
}

/**
 * Área ÚNICA de "Binding de Ponto" no topo das propriedades — vale para todo
 * componente. Grava no campo primário do tipo (valor→tag; equipamento/forma/linha
 * →tagStatus) ou nos campos base (bindingDeviceId/bindingTag) para os estáticos.
 * Status/animação e visibilidade condicional reaproveitam esse mesmo ponto.
 */
function UnifiedBindingSection({ widget, upd }: { widget: Widget; upd: (p: Partial<Widget>) => void }) {
  const { deviceId, tag } = readWidgetBinding(widget);
  return (
    <BindingSelector
      deviceId={deviceId}
      tag={tag}
      onBind={(d, t) => upd({ ...writeWidgetBinding(widget, d, t), ...clearLegacyPoint(widget) } as Partial<Widget>)}
      onUnbind={() => upd({ ...writeWidgetBinding(widget, '', ''), ...clearLegacyPoint(widget) } as Partial<Widget>)}
      cameraMode={widget.type === 'camera'}
    />
  );
}

// ─── Option builders (dados reais) ───────────────────────────────────────────

interface Opt { value: string; label: string }

function deviceOptions(devices: ScreenDevice[]): Opt[] {
  return [{ value: '', label: '— selecionar —' }, ...devices.map((d) => ({ value: d.id, label: d.name }))];
}
function tagOptions(devices: ScreenDevice[], deviceId: string): Opt[] {
  const dev = devices.find((d) => d.id === deviceId);
  return [{ value: '', label: '— selecionar —' }, ...(dev?.points.map((p) => ({ value: p.tag, label: p.tag })) ?? [])];
}
/**
 * Nota + saneamento compartilhados pelos seletores de ponto de comando (botão,
 * toggle, slider e ação de clique):
 * - explica que pontos somente leitura não aparecem (senão o usuário acha que sumiram);
 * - alerta quando a tag salva não pertence ao equipamento selecionado (tela
 *   salva por versão antiga) — o valor exibido no <select> volta a "— selecionar —".
 */
function CommandPointNotes({
  devices, deviceId, savedTag, analogOnly = false,
}: { devices: ScreenDevice[]; deviceId: string; savedTag: string; analogOnly?: boolean }) {
  const stale = Boolean(savedTag) && sanitizeCommandTag(devices, deviceId, savedTag, analogOnly) === '';
  return (
    <>
      {stale && (
        <p className="text-[10px] text-amber-400">
          O ponto salvo (&quot;{savedTag}&quot;) não é um ponto comandável deste equipamento — selecione o ponto novamente.
        </p>
      )}
      {deviceId && hasHiddenReadOnlyPoints(devices, deviceId, analogOnly) && (
        <p className="text-[10px] text-slate-500">
          {analogOnly
            ? 'Somente pontos analógicos de escrita aparecem aqui (Modbus holding, BACnet AO/AV, MQTT numérico com comando, bancada).'
            : 'Somente pontos de escrita aparecem aqui (Modbus holding/coil, saídas BACnet AO/AV/BO/BV/MSO, MQTT com comando, bancada). Pontos somente leitura ficam de fora.'}
        </p>
      )}
    </>
  );
}
const CMD_MODE_OPTS: Opt[] = [
  { value: 'toggle', label: 'Alternar (toggle)' }, { value: 'set-on', label: 'Ligar (set-on)' },
  { value: 'set-off', label: 'Desligar (set-off)' }, { value: 'momentary', label: 'Momentâneo (pulso)' },
];
const CMD_VARIANT_OPTS: Opt[] = [
  { value: 'solid', label: 'Sólido' }, { value: 'outline', label: 'Contorno' }, { value: 'soft', label: 'Suave' },
  { value: 'ghost', label: 'Ghost' }, { value: 'pill', label: 'Pílula' },
];
const ICON_OPTS: Opt[] = [
  { value: 'none', label: '— sem ícone —' }, { value: 'power', label: 'Power' }, { value: 'play', label: 'Play' },
  { value: 'pause', label: 'Pause' }, { value: 'refresh', label: 'Refresh' }, { value: 'zap', label: 'Raio' },
  { value: 'lightbulb', label: 'Lâmpada' }, { value: 'fan', label: 'Ventilador' }, { value: 'droplet', label: 'Gota' },
  { value: 'lock', label: 'Cadeado' }, { value: 'unlock', label: 'Cadeado aberto' }, { value: 'bell', label: 'Sino' },
  { value: 'snowflake', label: 'Floco' }, { value: 'flame', label: 'Chama' },
  { value: 'chevron-up', label: 'Seta cima' }, { value: 'chevron-down', label: 'Seta baixo' },
];
const STATUS_EFFECT_OPTS: { value: StatusEffect; label: string }[] = [
  { value: 'border', label: 'Borda' }, { value: 'content', label: 'Preenchimento' }, { value: 'text', label: 'Texto' },
];

// ─── Field helpers ─────────────────────────────────────────────────────────

function Section({ title, children, hideTitle = false }: { title: string; children: React.ReactNode; hideTitle?: boolean }) {
  const [open, setOpen] = useState(true);
  const sectionUid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const sectionId = `scada-section-${title.toLowerCase().replace(/[^a-z0-9]+/gi, '-')}-${sectionUid}`;
  if (hideTitle) {
    return (
      <div className="flex flex-col gap-2 px-4 pb-4 pt-3" data-inspector-section={title}>
        {children}
      </div>
    );
  }
  return (
    <div className="border-b border-slate-700/60 last:border-b-0" data-inspector-section={title}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={sectionId}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-9 w-full items-center gap-2 px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-widest text-slate-400 transition-colors hover:bg-slate-800/70 focus-visible:bg-slate-800/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-cyan-500"
      >
        {open
          ? <ChevronDown className="h-3 w-3 shrink-0 text-cyan-400" strokeWidth={1.75} aria-hidden="true" />
          : <ChevronRight className="h-3 w-3 shrink-0 text-slate-500" strokeWidth={1.75} aria-hidden="true" />}
        <span>{title}</span>
        <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" aria-hidden="true" />
      </button>
      <div id={sectionId} hidden={!open} className="flex flex-col gap-2 px-4 pb-4 pt-1">
        {children}
      </div>
    </div>
  );
}

/**
 * Categoria recolhível do painel de propriedades.
 *
 * O resetKey representa o contexto do painel (widget selecionado ou composição
 * interna). Ele é deliberadamente separado dos dados do widget: abrir uma
 * categoria é estado apenas da sessão de edição e nunca vai para a tela salva.
 */
export function PropertyCategory({
  id, title, resetKey, children,
}: {
  id: string;
  title: string;
  resetKey?: string;
  children: React.ReactNode;
}) {
  return (
    <PropertyCategoryContent key={`${id}:${resetKey ?? ''}`} id={id} title={title}>
      {children}
    </PropertyCategoryContent>
  );
}

function PropertyCategoryContent({
  id, title, children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const reactId = useId();
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '-');
  const headerId = `scada-property-header-${safeId}-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const contentId = `${headerId}-content`;

  return (
    <section className="border-b border-slate-700/70" data-testid={`scada-property-category-${id}`}>
      <button
        id={headerId}
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-11 w-full items-center gap-2 px-4 py-3 text-left text-xs font-semibold text-slate-200 transition-colors hover:bg-slate-700/60 focus-visible:bg-slate-700/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-cyan-500"
      >
        {open
          ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-cyan-400" aria-hidden="true" strokeWidth={1.75} />
          : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-500" aria-hidden="true" strokeWidth={1.75} />}
        <span className="uppercase tracking-widest">{title}</span>
        <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" aria-hidden="true" />
      </button>
      <div
        id={contentId}
        role="region"
        aria-labelledby={headerId}
        hidden={!open}
        className="bg-slate-800/40"
      >
        {children}
      </div>
    </section>
  );
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5" data-inspector-row={label}>
      <span className="text-[10px] uppercase tracking-wider text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function NumInput({ value, onChange, min, max }: { value: number; onChange: (v: number) => void; min?: number; max?: number }) {
  return <input type="number" value={value} min={min} max={max} onChange={(e) => onChange(Number(e.target.value))} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500" />;
}
function TextInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500" />;
}
/** Fundo quadriculado (padrão universal de "transparente") p/ swatches. */
const CHECKER_BG: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(45deg, #475569 25%, transparent 25%, transparent 75%, #475569 75%), linear-gradient(45deg, #475569 25%, #1e293b 25%, #1e293b 75%, #475569 75%)',
  backgroundSize: '8px 8px',
  backgroundPosition: '0 0, 4px 4px',
};

/**
 * Botão "Transparente/Sem cor" — swatch quadriculado ao lado do seletor.
 * Ativo = grava 'transparent'; clicar de novo (ou escolher cor) volta ao sólido.
 */
function TransparentSwatch({ active, onClick, title }: { active: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      type="button"
      title={title ?? 'Transparente (sem cor)'}
      onClick={onClick}
      className={`h-6 w-6 shrink-0 cursor-pointer rounded border transition-colors ${active ? 'border-cyan-400 ring-1 ring-cyan-400' : 'border-slate-600 hover:border-cyan-500'}`}
      style={CHECKER_BG}
    />
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const transparent = isTransparentColor(value);
  return (
    <div className="flex items-center gap-2">
      {transparent ? (
        <label
          title="Escolher cor sólida"
          className="relative h-6 w-6 shrink-0 cursor-pointer overflow-hidden rounded border border-slate-600"
          style={CHECKER_BG}
        >
          <input
            type="color"
            value="#06B6D4"
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </label>
      ) : (
        <input type="color" value={value.startsWith('#') ? value : '#06B6D4'} onChange={(e) => onChange(e.target.value)} className="h-6 w-6 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" />
      )}
      <input
        type="text"
        value={transparent ? 'transparente' : value}
        readOnly={transparent}
        onChange={(e) => onChange(e.target.value)}
        className={`min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs outline-none focus:border-cyan-500 ${transparent ? 'italic text-slate-500' : 'text-slate-200'}`}
      />
      <TransparentSwatch active={transparent} onClick={() => onChange(transparent ? '#06B6D4' : 'transparent')} />
    </div>
  );
}
/**
 * Seletor de cor de preenchimento/fundo com modo "Sólida | Gradiente".
 * Sólida: comporta-se exatamente como o ColorInput (incl. 'transparent').
 * Gradiente: duas cores + ângulo, gravado como string CSS
 * `linear-gradient(<ângulo>deg, c1, c2)` — retrocompatível com telas antigas.
 * Usado SÓ em campos de preenchimento/fundo; texto/traço/estado seguem sólidos.
 */
function FillColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const grad = parseScadaGradient(value);
  const isGrad = isGradientColor(value);
  const tabBtn = (active: boolean) =>
    `flex-1 rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors ${
      active ? 'bg-cyan-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
    }`;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-1 rounded border border-slate-700 bg-slate-900 p-0.5">
        <button
          type="button"
          className={tabBtn(!isGrad)}
          onClick={() => {
            if (isGrad) onChange(grad?.from ?? '#06B6D4');
          }}
        >
          Sólida
        </button>
        <button
          type="button"
          className={tabBtn(isGrad)}
          onClick={() => {
            if (!isGrad) {
              const from = isTransparentColor(value) || !value.startsWith('#') ? '#06B6D4' : value;
              onChange(makeScadaGradient(90, from, '#3B82F6'));
            }
          }}
        >
          Gradiente
        </button>
      </div>
      {!isGrad && <ColorInput value={value} onChange={onChange} />}
      {isGrad && grad && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">Cor 1</span>
              <input
                type="color"
                value={grad.from.startsWith('#') ? grad.from : '#06B6D4'}
                onChange={(e) => onChange(makeScadaGradient(grad.angle, e.target.value, grad.to))}
                className="h-6 w-full cursor-pointer rounded border-0 bg-transparent p-0"
              />
            </label>
            <label className="flex flex-col gap-0.5">
              <span className="text-[10px] uppercase tracking-wider text-slate-500">Cor 2</span>
              <input
                type="color"
                value={grad.to.startsWith('#') ? grad.to : '#3B82F6'}
                onChange={(e) => onChange(makeScadaGradient(grad.angle, grad.from, e.target.value))}
                className="h-6 w-full cursor-pointer rounded border-0 bg-transparent p-0"
              />
            </label>
          </div>
          <label className="flex flex-col gap-0.5">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">Ângulo ({Math.round(grad.angle)}°)</span>
            <div className="flex items-center gap-2">
              <input
                type="range" min={0} max={360} step={15} value={((grad.angle % 360) + 360) % 360}
                onChange={(e) => onChange(makeScadaGradient(Number(e.target.value), grad.from, grad.to))}
                className="flex-1 accent-cyan-500"
              />
              <input
                type="number" min={0} max={360} value={Math.round(grad.angle)}
                onChange={(e) => onChange(makeScadaGradient(Math.max(0, Math.min(360, Number(e.target.value))), grad.from, grad.to))}
                className="w-14 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500"
              />
            </div>
          </label>
          {/* Pré-visualização do gradiente no próprio seletor */}
          <div className="h-6 w-full rounded border border-slate-600" style={{ background: value }} />
        </>
      )}
    </div>
  );
}

/**
 * Rotação base do widget (graus) — seção comum de Aparência, vale para todo
 * tipo de widget. Atalhos rápidos 0/90/180/270 + entrada numérica livre.
 */
function SelectInput({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500">
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
function ToggleInput({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      aria-pressed={value}
      aria-label={label}
      style={{ width: 36, height: 20 }}
      className={`relative shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80 focus-visible:ring-offset-1 focus-visible:ring-offset-[#101a2c] ${value ? 'bg-cyan-600' : 'bg-slate-700'}`}
    >
      <span
        style={{ width: 16, height: 16, top: 2, left: value ? 18 : 2 }}
        className="absolute rounded-full bg-white shadow transition-all"
      />
    </button>
  );
}

function ToggleRow({ label, value, onChange }: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3" data-inspector-row={label}>
      <span className="min-w-0 flex-1 break-words text-[11px] text-slate-400">{label}</span>
      <ToggleInput value={value} onChange={onChange} label={label} />
    </div>
  );
}

/**
 * Controle de padding interno (px por lado) dos widgets visuais aplicáveis.
 * `legacyDefault` = valor efetivo exibido quando o campo ainda não foi definido
 * (telas antigas), de modo que editar a partir dele preserva a aparência atual.
 */
function PaddingRow({ w, upd, legacyDefault = 0 }: { w: Widget; upd: (p: Partial<Widget>) => void; legacyDefault?: number }) {
  const effective = w.padding ?? legacyDefault;
  const max = Math.max(0, Math.floor(Math.min(w.width, w.height) / 2) - 4);
  return (
    <Row label="Padding interno (px)">
      <div className="flex items-center gap-2">
        <input
          type="range" min={0} max={max} step={1} value={Math.min(effective, max)}
          onChange={(e) => upd({ padding: Number(e.target.value) })}
          className="flex-1 accent-cyan-500"
        />
        <input
          type="number" min={0} max={max} value={Math.round(effective)}
          onChange={(e) => upd({ padding: Math.max(0, Math.min(max, Number(e.target.value))) })}
          className="w-14 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500"
        />
      </div>
    </Row>
  );
}

const FONT_OPTIONS = [{ value: 'Inter', label: 'Inter' }, { value: 'Roboto', label: 'Roboto' }, { value: 'Roboto Mono', label: 'Roboto Mono' }, { value: 'Oswald', label: 'Oswald' }];
const WEIGHT_OPTIONS = [{ value: 'normal', label: 'Regular' }, { value: 'medium', label: 'Medium' }, { value: 'semibold', label: 'SemiBold' }, { value: 'bold', label: 'Bold' }];

// ─── Per-type panels ────────────────────────────────────────────────────────

function LabelStaticProps({ w, upd }: { w: LabelStaticWidget; upd: (p: Partial<Widget>) => void }) {
  return (
    <Section title="Conteúdo">
      <Row label="Texto"><textarea value={w.text} onChange={(e) => upd({ text: e.target.value })} rows={2} className="w-full resize-none rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500" /></Row>
      <Row label="Fonte"><SelectInput value={w.fontFamily} onChange={(v) => upd({ fontFamily: v })} options={FONT_OPTIONS} /></Row>
      <Row label="Tamanho"><NumInput value={w.fontSize} onChange={(v) => upd({ fontSize: v })} min={8} max={96} /></Row>
      <Row label="Peso"><SelectInput value={w.fontWeight} onChange={(v) => upd({ fontWeight: v as LabelStaticWidget['fontWeight'] })} options={WEIGHT_OPTIONS} /></Row>
      <Row label="Cor"><ColorInput value={w.color} onChange={(v) => upd({ color: v })} /></Row>
      <Row label="Alinhamento"><SelectInput value={w.align} onChange={(v) => upd({ align: v as LabelStaticWidget['align'] })} options={[{ value: 'left', label: 'Esquerda' }, { value: 'center', label: 'Centro' }, { value: 'right', label: 'Direita' }]} /></Row>
      <Row label="Cor de fundo"><FillColorInput value={w.backgroundColor ?? 'transparent'} onChange={(v) => upd({ backgroundColor: v })} /></Row>
      <Row label="Raio da borda"><NumInput value={w.borderRadius ?? 0} onChange={(v) => upd({ borderRadius: v })} min={0} max={999} /></Row>
    </Section>
  );
}

function SectionTitleProps({ w, upd }: { w: SectionTitleWidget; upd: (p: Partial<Widget>) => void }) {
  return (
    <Section title="Conteúdo">
      <Row label="Texto"><TextInput value={w.text} onChange={(v) => upd({ text: v })} /></Row>
      <Row label="Tamanho"><NumInput value={w.fontSize} onChange={(v) => upd({ fontSize: v })} min={10} max={64} /></Row>
      <Row label="Peso"><SelectInput value={w.fontWeight} onChange={(v) => upd({ fontWeight: v as SectionTitleWidget['fontWeight'] })} options={WEIGHT_OPTIONS} /></Row>
      <Row label="Cor do texto"><ColorInput value={w.color} onChange={(v) => upd({ color: v })} /></Row>
      <Row label="Cor da linha"><ColorInput value={w.lineColor} onChange={(v) => upd({ lineColor: v })} /></Row>
    </Section>
  );
}

function ValueDynamicProps({ w, upd }: { w: ValueDynamicWidget; upd: (p: Partial<Widget>) => void }) {
  return (
    <>
      <Section title="Exibição">
        <Row label="Unidade"><TextInput value={w.unit} onChange={(v) => upd({ unit: v })} /></Row>
        <Row label="Casas decimais"><NumInput value={w.decimals} onChange={(v) => upd({ decimals: v })} min={0} max={4} /></Row>
        <Row label="Fonte"><SelectInput value={w.fontFamily} onChange={(v) => upd({ fontFamily: v })} options={FONT_OPTIONS} /></Row>
        <Row label="Tamanho"><NumInput value={w.fontSize} onChange={(v) => upd({ fontSize: v })} min={12} max={96} /></Row>
        <Row label="Cor do texto"><ColorInput value={w.colorNormal} onChange={(v) => upd({ colorNormal: v })} /></Row>
      </Section>
    </>
  );
}

function LabelValueBlockProps({ w, upd }: { w: LabelValueBlockWidget; upd: (p: Partial<Widget>) => void }) {
  return (
    <>
      <Section title="Conteúdo">
        <Row label="Label"><TextInput value={w.label} onChange={(v) => upd({ label: v })} /></Row>
        <Row label="Unidade"><TextInput value={w.unit} onChange={(v) => upd({ unit: v })} /></Row>
        <Row label="Casas decimais"><NumInput value={w.decimals} onChange={(v) => upd({ decimals: v })} min={0} max={4} /></Row>
        <Row label="Tamanho"><NumInput value={w.fontSize} onChange={(v) => upd({ fontSize: v })} min={12} max={96} /></Row>
        <Row label="Cor normal"><ColorInput value={w.colorNormal} onChange={(v) => upd({ colorNormal: v })} /></Row>
        <Row label="Cor fundo"><FillColorInput value={w.backgroundColor} onChange={(v) => upd({ backgroundColor: v })} /></Row>
        <Row label="Borda arred."><NumInput value={w.borderRadius} onChange={(v) => upd({ borderRadius: v })} min={0} max={32} /></Row>
        {/* Legado (sem campo): padding fixo 8px vertical / 12px horizontal. */}
        <PaddingRow w={w} upd={upd} legacyDefault={10} />
      </Section>
    </>
  );
}

function LedStatusProps({ w, upd }: { w: LedStatusWidget; upd: (p: Partial<Widget>) => void }) {
  return (
    <>
      <Section title="Aparência">
        <Row label="Cor ON"><ColorInput value={w.colorOn} onChange={(v) => upd({ colorOn: v })} /></Row>
        <Row label="Cor OFF"><ColorInput value={w.colorOff} onChange={(v) => upd({ colorOff: v })} /></Row>
        <Row label="Tamanho"><NumInput value={w.size} onChange={(v) => upd({ size: v })} min={8} max={48} /></Row>
        <ToggleRow label="Pulso em alarme" value={w.pulseOnAlarm} onChange={(v) => upd({ pulseOnAlarm: v })} />
      </Section>
    </>
  );
}

function GaugeProps({ w, upd }: { w: GaugeWidget; upd: (p: Partial<Widget>) => void }) {
  return (
    <>
      <Section title="Escala">
        <Row label="Mínimo"><NumInput value={w.minValue} onChange={(v) => upd({ minValue: v })} /></Row>
        <Row label="Máximo"><NumInput value={w.maxValue} onChange={(v) => upd({ maxValue: v })} /></Row>
        <Row label="Unidade"><TextInput value={w.unit} onChange={(v) => upd({ unit: v })} /></Row>
        <ToggleRow label="Mostrar valor" value={w.showValue} onChange={(v) => upd({ showValue: v })} />
        <Row label="Cor normal"><ColorInput value={w.colorNormal} onChange={(v) => upd({ colorNormal: v })} /></Row>
        <Row label="Cor alarme"><ColorInput value={w.colorAlarm} onChange={(v) => upd({ colorAlarm: v })} /></Row>
      </Section>
    </>
  );
}

function ThermometerProps({ w, upd }: { w: ThermometerWidget; upd: (p: Partial<Widget>) => void }) {
  return (
    <>
      <Section title="Escala">
        <Row label="Mínimo"><NumInput value={w.minValue} onChange={(v) => upd({ minValue: v })} /></Row>
        <Row label="Máximo"><NumInput value={w.maxValue} onChange={(v) => upd({ maxValue: v })} /></Row>
        <Row label="Unidade"><TextInput value={w.unit} onChange={(v) => upd({ unit: v })} /></Row>
        <ToggleRow label="Mostrar valor" value={w.showValue} onChange={(v) => upd({ showValue: v })} />
        <Row label="Cor normal"><ColorInput value={w.colorNormal} onChange={(v) => upd({ colorNormal: v })} /></Row>
        <Row label="Cor alarme"><ColorInput value={w.colorAlarm} onChange={(v) => upd({ colorAlarm: v })} /></Row>
      </Section>
    </>
  );
}

function ProgressBarProps({ w, upd }: { w: ProgressBarWidget; upd: (p: Partial<Widget>) => void }) {
  return (
    <>
      <Section title="Escala">
        <Row label="Mínimo"><NumInput value={w.minValue} onChange={(v) => upd({ minValue: v })} /></Row>
        <Row label="Máximo"><NumInput value={w.maxValue} onChange={(v) => upd({ maxValue: v })} /></Row>
        <Row label="Unidade"><TextInput value={w.unit} onChange={(v) => upd({ unit: v })} /></Row>
        <ToggleRow label="Mostrar valor" value={w.showValue} onChange={(v) => upd({ showValue: v })} />
        <Row label="Cor normal"><ColorInput value={w.colorNormal} onChange={(v) => upd({ colorNormal: v })} /></Row>
        <Row label="Cor alarme"><ColorInput value={w.colorAlarm} onChange={(v) => upd({ colorAlarm: v })} /></Row>
      </Section>
    </>
  );
}

function TrafficLightProps({ w, upd }: { w: TrafficLightWidget; upd: (p: Partial<Widget>) => void }) {
  return (
    <>
      <Section title="Valores">
        <Row label="Valor → Verde"><NumInput value={w.valueGreen} onChange={(v) => upd({ valueGreen: v })} /></Row>
        <Row label="Valor → Amarelo"><NumInput value={w.valueYellow} onChange={(v) => upd({ valueYellow: v })} /></Row>
        <Row label="Valor → Vermelho"><NumInput value={w.valueRed} onChange={(v) => upd({ valueRed: v })} /></Row>
      </Section>
    </>
  );
}

function NumericDisplayProps({ w, upd }: { w: NumericDisplayWidget; upd: (p: Partial<Widget>) => void }) {
  return (
    <>
      <Section title="Exibição">
        <Row label="Unidade"><TextInput value={w.unit} onChange={(v) => upd({ unit: v })} /></Row>
        <Row label="Casas decimais"><NumInput value={w.decimals} onChange={(v) => upd({ decimals: v })} min={0} max={4} /></Row>
        <Row label="Cor"><ColorInput value={w.color} onChange={(v) => upd({ color: v })} /></Row>
      </Section>
    </>
  );
}

function TrendArrowProps({ w, upd }: { w: TrendArrowWidget; upd: (p: Partial<Widget>) => void }) {
  return (
    <>
      <Section title="Limiar">
        <Row label="Limiar (acima = subindo)"><NumInput value={w.threshold} onChange={(v) => upd({ threshold: v })} /></Row>
        <Row label="Cor subindo"><ColorInput value={w.colorUp} onChange={(v) => upd({ colorUp: v })} /></Row>
        <Row label="Cor descendo"><ColorInput value={w.colorDown} onChange={(v) => upd({ colorDown: v })} /></Row>
      </Section>
    </>
  );
}

function StateRulesEditor({ rules, onChange, showText }: { rules: EquipmentStateRule[]; onChange: (r: EquipmentStateRule[]) => void; showText?: boolean }) {
  function add() {
    onChange([...rules, { id: nanoid(6), operator: 'eq', value: 0, color: '#F59E0B', animation: 'none' }]);
  }
  function remove(id: string) { onChange(rules.filter((r) => r.id !== id)); }
  function update(id: string, patch: Partial<EquipmentStateRule>) {
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  return (
    <div className="flex flex-col gap-2">
      {rules.map((r) => (
        <div key={r.id} className="rounded border border-slate-700 bg-slate-900 p-2 flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">Quando valor…</span>
            <button type="button" onClick={() => remove(r.id)} className="text-slate-500 hover:text-red-400 transition-colors"><X className="h-3 w-3" /></button>
          </div>
          <div className="flex gap-1.5">
            <select value={r.operator} onChange={(e) => update(r.id, { operator: e.target.value as VisibilityOperator })} className="flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500">
              {OPERATOR_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input type="number" value={r.value} onChange={(e) => update(r.id, { value: Number(e.target.value) })} className="w-16 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-slate-500">→</span>
            {isTransparentColor(r.color) ? (
              <label title="Escolher cor sólida" className="relative h-6 w-7 shrink-0 cursor-pointer overflow-hidden rounded border border-slate-600" style={CHECKER_BG}>
                <input type="color" value="#22C55E" onChange={(e) => update(r.id, { color: e.target.value })} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
              </label>
            ) : (
              <input type="color" value={r.color.startsWith('#') ? r.color : '#22C55E'} onChange={(e) => update(r.id, { color: e.target.value })} className="h-6 w-7 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0" />
            )}
            <TransparentSwatch active={isTransparentColor(r.color)} onClick={() => update(r.id, { color: isTransparentColor(r.color) ? '#22C55E' : 'transparent' })} title="Sem cor (desativa brilho/efeito)" />
            <select value={r.animation} onChange={(e) => update(r.id, { animation: e.target.value as ScadaAnimation })} className="flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500">
              {ANIM_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {showText && (
            <input type="text" value={r.text ?? ''} placeholder="Texto (opcional, ex.: LIGADO)" onChange={(e) => update(r.id, { text: e.target.value })} className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500" />
          )}
        </div>
      ))}
      <button type="button" onClick={add} className="rounded border border-dashed border-slate-600 py-1.5 text-xs text-slate-400 hover:border-cyan-500 hover:text-cyan-400 transition-colors">
        + Adicionar regra
      </button>
    </div>
  );
}

function EquipmentIconUpload({ w, upd }: { w: EquipmentWidget; upd: (p: Partial<Widget>) => void }) {
  const tenantId = useEditorStore((s) => s.screen?.tenantId);
  const addToast = useEditorStore((s) => s.addToast);
  const [uploading, setUploading] = useState(false);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite reenviar o mesmo arquivo
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      // Sobe a imagem ao backend e guarda só a URL — nunca o base64 na tela.
      setUploading(true);
      try {
        const url = await uploadScadaAsset(dataUrl, tenantId);
        upd({ iconAssetUrl: url });
      } catch (err) {
        addToast('error', err instanceof Error ? err.message : 'Falha ao enviar imagem');
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  }
  return (
    <Section title="Imagem do ícone">
      <p className="text-[11px] text-slate-500">Substitui o ícone embutido por uma imagem. A borda/glow de estado continua ao redor.</p>
      <label className={`flex items-center justify-center gap-2 rounded border border-dashed border-slate-600 py-2 text-xs text-slate-300 transition-colors ${uploading ? 'pointer-events-none opacity-60' : 'cursor-pointer hover:border-cyan-500 hover:text-cyan-400'}`}>
        <Upload className="h-3.5 w-3.5" strokeWidth={1.5} />
        {uploading ? 'Enviando…' : w.iconAssetUrl ? 'Trocar imagem' : 'Enviar imagem (PNG/JPG)'}
        <input type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" onChange={onFile} disabled={uploading} className="hidden" />
      </label>
      {w.iconAssetUrl && (
        <button type="button" onClick={() => upd({ iconAssetUrl: '' })} className="rounded border border-slate-700 py-1.5 text-xs text-slate-400 hover:border-red-500 hover:text-red-400 transition-colors">
          Remover imagem (voltar ao ícone)
        </button>
      )}
    </Section>
  );
}

function EquipmentProps({ w, upd, devices, mode = 'all' }: { w: EquipmentWidget; upd: (p: Partial<Widget>) => void; devices: ScreenDevice[]; mode?: 'all' | 'style' | 'rules' }) {
  const bound = Boolean(w.deviceId && w.tagStatus);
  return (
    <>
      {mode !== 'rules' && <Section title="Ícone e rótulo">
        <Row label="Cor base"><ColorInput value={w.baseColor ?? '#64748B'} onChange={(v) => upd({ baseColor: v })} /></Row>
        <ToggleRow label="Mostrar indicador de status" value={w.showStatusLed !== false} onChange={(v) => upd({ showStatusLed: v })} />
        {/* Legado (sem campo): margem pequena de ~5% do menor lado (glow/LED);
            câmera já ocupava a área toda (padding 0). */}
        <PaddingRow w={w} upd={upd} legacyDefault={w.type === 'camera' ? 0 : Math.max(2, Math.round(Math.min(w.width, w.height) * 0.05))} />
        <ToggleRow label="Mostrar label" value={w.showLabel} onChange={(v) => upd({ showLabel: v })} />
        {w.showLabel && <Row label="Texto"><TextInput value={w.labelText} onChange={(v) => upd({ labelText: v })} /></Row>}
        {w.showLabel && <Row label="Tamanho da fonte"><NumInput value={w.labelFontSize ?? 11} onChange={(v) => upd({ labelFontSize: v })} min={8} max={48} /></Row>}
        {w.type === 'camera' && (
          <Row label="Modelo da câmera">
            <SelectInput
              value={w.cameraModel ?? 'bullet'}
              onChange={(v) => upd({ cameraModel: v as EquipmentWidget['cameraModel'] })}
              options={[
                { value: 'bullet', label: 'Bullet (parede)' },
                { value: 'dome', label: 'Dome (teto)' },
              ]}
            />
          </Row>
        )}
        {w.type === 'camera' && (
          <Row label="Tamanho do popup">
            <SelectInput
              value={w.popupSize ?? 'small'}
              onChange={(v) => upd({ popupSize: v as EquipmentWidget['popupSize'] })}
              options={[
                { value: 'small', label: 'Pequeno (padrão)' },
                { value: 'medium', label: 'Médio' },
                { value: 'large', label: 'Grande' },
              ]}
            />
          </Row>
        )}
      </Section>}
      {mode !== 'rules' && <EquipmentIconUpload w={w} upd={upd} />}
      {mode !== 'style' && w.type === 'tank' && (
        <Section title="Nível do líquido">
          <Row label="Ponto de nível"><SelectInput value={w.tagLevel ?? ''} onChange={(v) => upd({ tagLevel: v })} options={tagOptions(devices, w.deviceId)} /></Row>
          <div className="grid grid-cols-2 gap-2">
            <Row label="Mínimo"><NumInput value={w.levelMin ?? 0} onChange={(v) => upd({ levelMin: v })} /></Row>
            <Row label="Máximo"><NumInput value={w.levelMax ?? 100} onChange={(v) => upd({ levelMax: v })} /></Row>
          </div>
          <Row label="Unidade"><TextInput value={w.levelUnit ?? '%'} onChange={(v) => upd({ levelUnit: v })} /></Row>
          <Row label="Cor do líquido"><ColorInput value={w.levelColor ?? '#38BDF8'} onChange={(v) => upd({ levelColor: v })} /></Row>
          <Row label="Tamanho do valor (px)"><NumInput value={w.levelFontSize ?? 13} onChange={(v) => upd({ levelFontSize: v })} min={8} max={64} /></Row>
          {/* Ausente = cor do líquido (comportamento legado das telas salvas). */}
          <Row label="Cor do valor"><ColorInput value={w.levelLabelColor ?? w.levelColor ?? '#38BDF8'} onChange={(v) => upd({ levelLabelColor: v })} /></Row>
          <div className="mt-1 flex flex-col gap-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Cor e animação do valor</p>
            <p className="text-[11px] text-slate-500">Regras pelo valor do ponto de nível (ex.: ≥ 90 → vermelho piscando).</p>
            <StateRulesEditor rules={w.levelLabelRules ?? []} onChange={(levelLabelRules) => upd({ levelLabelRules })} />
          </div>
        </Section>
      )}
      {mode !== 'style' && <Section title="Cor e animação por valor">
        {!bound && <p className="text-[11px] text-slate-500">Vincule um ponto acima para as regras reagirem ao valor.</p>}
        <StateRulesEditor rules={w.stateRules ?? []} onChange={(stateRules) => upd({ stateRules })} />
      </Section>}
    </>
  );
}

function LineProps({ w, upd, devices, mode = 'all' }: { w: LineWidget; upd: (p: Partial<Widget>) => void; devices: ScreenDevice[]; mode?: 'all' | 'style' | 'rules' }) {
  const bound = Boolean(w.deviceId && w.tagStatus);
  return (
    <>
      {mode !== 'rules' && <Section title="Linha">
        <Row label="Cor"><ColorInput value={w.color} onChange={(v) => upd({ color: v })} /></Row>
        <Row label="Espessura"><NumInput value={w.thickness} onChange={(v) => upd({ thickness: v })} min={1} max={16} /></Row>
        <Row label="Estilo"><SelectInput value={w.style} onChange={(v) => upd({ style: v as LineWidget['style'] })} options={[{ value: 'solid', label: 'Sólida' }, { value: 'dashed', label: 'Tracejada' }, { value: 'dotted', label: 'Pontilhada' }]} /></Row>
        <ToggleRow label="Fluxo animado" value={w.flowAnimation} onChange={(v) => upd({ flowAnimation: v })} />
        {w.flowAnimation && <>
          <Row label="Direção"><SelectInput value={w.direction} onChange={(v) => upd({ direction: v as LineWidget['direction'] })} options={[{ value: 'right', label: '→ Direita' }, { value: 'left', label: '← Esquerda' }, { value: 'down', label: '↓ Baixo' }, { value: 'up', label: '↑ Cima' }]} /></Row>
          <Row label="Dispositivo fluxo"><SelectInput value={w.flowDeviceId ?? ''} onChange={(v) => upd({ flowDeviceId: v })} options={deviceOptions(devices)} /></Row>
          <Row label="Tag fluxo"><SelectInput value={w.flowTag ?? ''} onChange={(v) => upd({ flowTag: v })} options={tagOptions(devices, w.flowDeviceId ?? '')} /></Row>
        </>}
      </Section>}
      {mode !== 'style' && <Section title="Cor e animação por valor">
        {!bound && <p className="text-[11px] text-slate-500">Vincule um ponto acima para a linha mudar de cor conforme o valor.</p>}
        <StateRulesEditor rules={w.stateRules ?? []} onChange={(stateRules) => upd({ stateRules })} />
      </Section>}
    </>
  );
}

/** Regras de fluxo da tubulação: valor do ponto → fluindo/parado (+ cor alternativa). */
function PipeFlowRulesEditor({ rules, onChange }: { rules: PipeStateRule[]; onChange: (r: PipeStateRule[]) => void }) {
  function add() {
    onChange([...rules, { id: nanoid(6), operator: 'eq', value: 1, flowing: true }]);
  }
  function remove(id: string) { onChange(rules.filter((r) => r.id !== id)); }
  function update(id: string, patch: Partial<PipeStateRule>) {
    onChange(rules.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  return (
    <div className="flex flex-col gap-2">
      {rules.map((r) => (
        <div key={r.id} className="rounded border border-slate-700 bg-slate-900 p-2 flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500">Quando valor…</span>
            <button type="button" onClick={() => remove(r.id)} className="text-slate-500 hover:text-red-400 transition-colors"><X className="h-3 w-3" /></button>
          </div>
          <div className="flex gap-1.5">
            <select value={r.operator} onChange={(e) => update(r.id, { operator: e.target.value as VisibilityOperator })} className="flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500">
              {OPERATOR_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <input type="number" value={r.value} onChange={(e) => update(r.id, { value: Number(e.target.value) })} className="w-16 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500" />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-slate-500">→</span>
            <select value={r.flowing ? 'flow' : 'stop'} onChange={(e) => update(r.id, { flowing: e.target.value === 'flow' })} className="flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500">
              <option value="flow">Fluindo (animação)</option>
              <option value="stop">Parado (estático)</option>
            </select>
            {r.flowing && (
              <>
                <input
                  type="color"
                  title="Cor alternativa do fluxo (ex.: enchimento verde)"
                  value={r.flowColor?.startsWith('#') ? r.flowColor : '#38BDF8'}
                  onChange={(e) => update(r.id, { flowColor: e.target.value })}
                  className="h-6 w-7 shrink-0 cursor-pointer rounded border-0 bg-transparent p-0"
                />
                {r.flowColor && (
                  <button type="button" title="Usar cor de fluxo padrão" onClick={() => update(r.id, { flowColor: undefined })} className="text-slate-500 hover:text-slate-300 transition-colors"><X className="h-3 w-3" /></button>
                )}
              </>
            )}
          </div>
        </div>
      ))}
      <button type="button" onClick={add} className="rounded border border-dashed border-slate-600 py-1.5 text-xs text-slate-400 hover:border-cyan-500 hover:text-cyan-400 transition-colors">
        + Adicionar regra
      </button>
    </div>
  );
}

/**
 * Aviso ao editor: ponto vinculado porém NENHUMA regra de fluxo casa com o
 * valor atual → no viewer o fluxo fica parado (comportamento padrão). Só
 * feedback — não muda a semântica do widget.
 */
function PipeFlowMatchHint({ w }: { w: PipeWidget }) {
  const screen = useEditorStore((s) => s.screen);
  const { devices } = useScreenDevices(screen?.projectId, screen?.tenantId);
  const { getValue } = useScreenTelemetry(devices, devices.length > 0);

  const raw = getValue(w.deviceId as string, w.tagStatus as string);
  if (raw === null || raw === undefined) {
    return (
      <p className="rounded border border-slate-700 bg-slate-800/40 px-3 py-2 text-[11px] text-slate-400">
        Sem leitura do ponto ainda — com binding e sem leitura, o fluxo fica parado no viewer.
      </p>
    );
  }
  const v = toScadaNumber(raw);
  const matched = Number.isNaN(v)
    ? null
    : (w.flowRules ?? []).find((r) => matchOperator(v, r.operator, r.value)) ?? null;
  if (matched) return null;
  return (
    <p className="rounded border border-amber-800/40 bg-amber-900/20 px-3 py-2 text-[11px] text-amber-300">
      Nenhuma regra casa com o valor atual do ponto ({formatTelemetryValue(raw)}) — o fluxo fica parado no viewer. Ajuste as regras abaixo se o fluxo deveria estar ligado.
    </p>
  );
}

function PipeProps({ w, upd, mode = 'all' }: { w: PipeWidget; upd: (p: Partial<Widget>) => void; mode?: 'all' | 'style' | 'rules' }) {
  const bound = Boolean(w.deviceId && w.tagStatus);
  return (
    <>
      {mode !== 'rules' && <Section title="Tubulação">
        <Row label="Cor do tubo"><ColorInput value={w.pipeColor} onChange={(v) => upd({ pipeColor: v })} /></Row>
        <Row label="Cor do fluxo"><ColorInput value={w.flowColor} onChange={(v) => upd({ flowColor: v })} /></Row>
        <Row label="Cor parado (água)"><ColorInput value={w.stoppedColor ?? '#94A3B8'} onChange={(v) => upd({ stoppedColor: v })} /></Row>
        <Row label="Espessura"><NumInput value={w.thickness} onChange={(v) => upd({ thickness: Math.max(2, Math.min(40, v)) })} min={2} max={40} /></Row>
        <Row label="Raio dos joelhos"><NumInput value={w.cornerRadius ?? 14} onChange={(v) => upd({ cornerRadius: Math.max(0, Math.min(60, v)) })} min={0} max={60} /></Row>
        <Row label="Estilo">
          <SelectInput value={w.pipeStyle ?? 'dash'} onChange={(v) => upd({ pipeStyle: v as PipeWidget['pipeStyle'] })} options={[{ value: 'dash', label: 'Tracejado (energia/dados)' }, { value: 'arrow', label: 'Seta (direção do fluxo)' }, { value: 'water', label: 'Água (líquido contínuo)' }]} />
        </Row>
        <Row label="Velocidade">
          <div className="flex items-center gap-2">
            <input type="range" min={0.25} max={4} step={0.25} value={w.speed ?? 1} onChange={(e) => upd({ speed: Number(e.target.value) })} className="flex-1 accent-cyan-500" />
            <span className="w-9 text-right text-xs text-slate-300 tabular-nums">{(w.speed ?? 1).toFixed(2)}×</span>
          </div>
        </Row>
        <ToggleRow label="Direção invertida" value={Boolean(w.reverse)} onChange={(v) => upd({ reverse: v })} />
        <p className="text-[11px] text-slate-500">
          Tracejado indica energia/dados, Seta indica a direção do fluxo e Água mostra líquido contínuo. No estilo Seta, as setas são distribuídas automaticamente pelo comprimento do percurso. Selecione a tubulação no canvas para arrastar os vértices; clique no ponto médio de um trecho para adicionar um vértice, duplo clique num vértice para removê-lo.
        </p>
      </Section>}
      {mode !== 'style' && <Section title="Fluxo por valor do ponto">
        {!bound && <p className="text-[11px] text-slate-500">Sem ponto vinculado o fluxo fica sempre ligado (modo decorativo). Vincule um ponto acima para o fluxo seguir o estado (ex.: bomba ligada → fluindo).</p>}
        {bound && <PipeFlowMatchHint w={w} />}
        <PipeFlowRulesEditor rules={w.flowRules ?? []} onChange={(flowRules) => upd({ flowRules })} />
      </Section>}
    </>
  );
}

function ShapeProps({ w, upd, mode = 'all' }: { w: ShapeWidgetBase & { type: Widget['type'] }; upd: (p: Partial<Widget>) => void; mode?: 'all' | 'style' | 'rules' }) {
  const filled = w.fillEnabled !== false;
  const bound = Boolean(w.deviceId && w.tagStatus);
  const isRectLike = w.type === 'rectangle' || w.type === 'square';
  return (
    <>
      {mode !== 'rules' && <Section title="Forma">
        {w.type === 'polygon' && <p className="rounded border border-cyan-800/40 bg-cyan-950/20 px-2.5 py-2 text-[11px] leading-relaxed text-cyan-200">Desenhe 3 ou mais vértices no canvas. Depois, arraste os pontos para editar; os pontos médios inserem novos vértices e o duplo clique remove um (mantendo o mínimo de três).</p>}
        <ToggleRow label="Preenchimento (cor de fundo)" value={filled} onChange={(v) => upd({ fillEnabled: v })} />
        {filled && <Row label="Cor de fundo"><FillColorInput value={w.fillColor} onChange={(v) => upd({ fillColor: v })} /></Row>}
        <Row label={filled ? 'Cor da borda' : 'Cor da linha'}><ColorInput value={w.strokeColor} onChange={(v) => upd({ strokeColor: v })} /></Row>
        <Row label="Espessura"><NumInput value={w.strokeWidth} onChange={(v) => upd({ strokeWidth: v })} min={0} max={20} /></Row>
        {isRectLike && <Row label="Borda arred."><NumInput value={w.borderRadius} onChange={(v) => upd({ borderRadius: v })} min={0} max={64} /></Row>}
        <PaddingRow w={w as unknown as Widget} upd={upd} />
      </Section>}
      {mode !== 'style' && <Section title="Cor e animação por valor">
        {!bound && <p className="text-[11px] text-slate-500">Vincule um ponto acima para a cor reagir ao valor (pinta o fundo quando preenchido, ou a linha quando só contorno).</p>}
        <StateRulesEditor rules={w.stateRules ?? []} onChange={(stateRules) => upd({ stateRules })} />
      </Section>}
    </>
  );
}

function ImageProps({ w, upd }: { w: ImageWidget; upd: (p: Partial<Widget>) => void }) {
  const tenantId = useEditorStore((s) => s.screen?.tenantId);
  const addToast = useEditorStore((s) => s.addToast);
  const [uploading, setUploading] = useState(false);

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite reenviar o mesmo arquivo
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      // Sobe a imagem ao backend e guarda só a URL — nunca o base64 na tela.
      setUploading(true);
      try {
        const url = await uploadScadaAsset(dataUrl, tenantId);
        upd({ src: url });
      } catch (err) {
        addToast('error', err instanceof Error ? err.message : 'Falha ao enviar imagem');
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  }
  return (
    <Section title="Imagem">
      <label className={`flex items-center justify-center gap-2 rounded border border-dashed border-slate-600 py-2 text-xs text-slate-300 transition-colors ${uploading ? 'pointer-events-none opacity-60' : 'cursor-pointer hover:border-cyan-500 hover:text-cyan-400'}`}>
        <Upload className="h-3.5 w-3.5" strokeWidth={1.5} />
        {uploading ? 'Enviando…' : w.src ? 'Trocar imagem' : 'Enviar imagem (PNG/JPG)'}
        <input type="file" accept=".png,.jpg,.jpeg,image/png,image/jpeg" onChange={onFile} disabled={uploading} className="hidden" />
      </label>
      {w.src && (
        <button type="button" onClick={() => upd({ src: '' })} className="rounded border border-slate-700 py-1.5 text-xs text-slate-400 hover:border-red-500 hover:text-red-400 transition-colors">
          Remover imagem
        </button>
      )}
      <Row label="Ajuste">
        <SelectInput value={w.objectFit} onChange={(v) => upd({ objectFit: v as ImageWidget['objectFit'] })} options={[{ value: 'contain', label: 'Conter (sem cortar)' }, { value: 'cover', label: 'Cobrir (preenche)' }, { value: 'fill', label: 'Esticar' }]} />
      </Row>
      <Row label="Borda arred."><NumInput value={w.borderRadius} onChange={(v) => upd({ borderRadius: v })} min={0} max={64} /></Row>
      <PaddingRow w={w} upd={upd} />
    </Section>
  );
}

function TitledAreaProps({ w, upd }: { w: TitledAreaWidget; upd: (p: Partial<Widget>) => void }) {
  return (
    <Section title="Área com Título">
      <Row label="Título"><TextInput value={w.title} onChange={(v) => upd({ title: v })} /></Row>
      <Row label="Cor de fundo"><FillColorInput value={w.fillColor} onChange={(v) => upd({ fillColor: v })} /></Row>
      <Row label="Cor da borda"><ColorInput value={w.borderColor} onChange={(v) => upd({ borderColor: v })} /></Row>
      <Row label="Cor do título"><ColorInput value={w.titleColor} onChange={(v) => upd({ titleColor: v })} /></Row>
      <Row label="Tam. fonte"><NumInput value={w.titleFontSize ?? 11} onChange={(v) => upd({ titleFontSize: v })} min={8} max={48} /></Row>
      <Row label="Peso"><SelectInput value={w.titleFontWeight ?? 'semibold'} onChange={(v) => upd({ titleFontWeight: v as TitledAreaWidget['titleFontWeight'] })} options={[{ value: 'normal', label: 'Normal' }, { value: 'medium', label: 'Médio' }, { value: 'semibold', label: 'Semi-negrito' }, { value: 'bold', label: 'Negrito' }]} /></Row>
      <Row label="Posição"><SelectInput value={w.titlePosition ?? 'border'} onChange={(v) => upd({ titlePosition: v as TitledAreaWidget['titlePosition'] })} options={[{ value: 'border', label: 'Sobre a borda' }, { value: 'inside', label: 'Dentro da área' }]} /></Row>
      <Row label="Alinhamento"><SelectInput value={w.titleAlign ?? 'left'} onChange={(v) => upd({ titleAlign: v as TitledAreaWidget['titleAlign'] })} options={[{ value: 'left', label: 'Esquerda' }, { value: 'center', label: 'Centro' }, { value: 'right', label: 'Direita' }]} /></Row>
      <Row label="Borda arred."><NumInput value={w.borderRadius} onChange={(v) => upd({ borderRadius: v })} min={0} max={32} /></Row>
    </Section>
  );
}

function SeparatorProps({ w, upd }: { w: SeparatorWidget; upd: (p: Partial<Widget>) => void }) {
  return (
    <Section title="Separador">
      <Row label="Orientação"><SelectInput value={w.orientation} onChange={(v) => upd({ orientation: v as SeparatorWidget['orientation'] })} options={[{ value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }]} /></Row>
      <Row label="Cor"><ColorInput value={w.color} onChange={(v) => upd({ color: v })} /></Row>
      <Row label="Espessura"><NumInput value={w.thickness} onChange={(v) => upd({ thickness: v })} min={1} max={8} /></Row>
      <Row label="Estilo"><SelectInput value={w.lineStyle} onChange={(v) => upd({ lineStyle: v as SeparatorWidget['lineStyle'] })} options={[{ value: 'solid', label: 'Sólida' }, { value: 'dashed', label: 'Tracejada' }, { value: 'dotted', label: 'Pontilhada' }]} /></Row>
    </Section>
  );
}

/**
 * Toggle do modo "tile" + cor única: o fundo do quadrado é derivado
 * automaticamente da mesma cor (tonalidade translúcida) — claro e escuro.
 */
function TileRows({ enabled, color, onChange }: {
  enabled: boolean; color: string;
  onChange: (patch: { tileEnabled?: boolean; tileColor?: string }) => void;
}) {
  return (
    <>
      <ToggleRow label="Estilo tile (quadrado arredondado)" value={enabled} onChange={(v) => onChange({ tileEnabled: v })} />
      {enabled && (
        <>
          <Row label="Cor do tile">
            <ColorInput value={color} onChange={(v) => onChange({ tileColor: v })} />
          </Row>
          <p className="text-[10px] text-slate-500">
            O fundo do quadrado é derivado automaticamente da mesma cor, em tonalidade suave (funciona nos temas claro e escuro).
          </p>
        </>
      )}
    </>
  );
}

function HotspotProps({ w, upd, screenOpts }: { w: HotspotWidget; upd: (p: Partial<Widget>) => void; screenOpts: Opt[] }) {
  return (
    <>
      <Section title="Navegação">
        <Row label="Tela de destino"><SelectInput value={w.targetScreenId} onChange={(v) => upd({ targetScreenId: v })} options={screenOpts} /></Row>
        <Row label="Transição"><SelectInput value={w.transition} onChange={(v) => upd({ transition: v as HotspotWidget['transition'] })} options={[{ value: 'instant', label: 'Instantânea' }, { value: 'fade', label: 'Fade' }, { value: 'slide-left', label: 'Slide Esquerda' }, { value: 'slide-right', label: 'Slide Direita' }]} /></Row>
      </Section>
      <Section title="Forma">
        <Row label="Tipo"><SelectInput value={w.shape} onChange={(v) => upd({ shape: v as HotspotWidget['shape'] })} options={[{ value: 'rectangle', label: 'Retângulo' }, { value: 'circle', label: 'Círculo' }, { value: 'ellipse', label: 'Elipse' }, { value: 'invisible', label: 'Invisível' }]} /></Row>
        {w.shape !== 'invisible' && <>
          <Row label="Cor de fundo"><FillColorInput value={w.fillColor} onChange={(v) => upd({ fillColor: v })} /></Row>
          <Row label="Opacidade fundo"><div className="flex items-center gap-2"><input type="range" min={0} max={1} step={0.05} value={w.fillOpacity} onChange={(e) => upd({ fillOpacity: parseFloat(e.target.value) })} className="flex-1 accent-cyan-500" /><span className="text-xs text-slate-400 tabular-nums w-8">{Math.round(w.fillOpacity * 100)}%</span></div></Row>
          <Row label="Cor da borda"><ColorInput value={w.borderColor} onChange={(v) => upd({ borderColor: v })} /></Row>
          <Row label="Espessura borda"><NumInput value={w.borderWidth} onChange={(v) => upd({ borderWidth: v })} min={0} max={8} /></Row>
          {w.shape === 'rectangle' && <Row label="Borda arred."><NumInput value={w.borderRadius} onChange={(v) => upd({ borderRadius: v })} min={0} max={50} /></Row>}
        </>}
      </Section>
      <Section title="Ícone">
        <ToggleRow label="Mostrar ícone" value={w.showIcon} onChange={(v) => upd({ showIcon: v })} />
        {w.showIcon && <>
          <Row label="Ícone"><IconPicker value={w.iconName} assetUrl={w.iconAssetUrl} onChange={(p) => upd(p as Partial<Widget>)} allowUpload /></Row>
          <TileRows
            enabled={Boolean(w.tileEnabled)}
            color={w.tileColor ?? '#38BDF8'}
            onChange={(p) => upd(p as Partial<Widget>)}
          />
          <Row label="Posição"><SelectInput value={w.iconPosition} onChange={(v) => upd({ iconPosition: v as HotspotWidget['iconPosition'] })} options={[{ value: 'left', label: 'Esquerda' }, { value: 'center', label: 'Centro' }, { value: 'right', label: 'Direita' }, { value: 'above', label: 'Acima' }, { value: 'below', label: 'Abaixo' }]} /></Row>
          <Row label="Tamanho"><NumInput value={w.iconSize} onChange={(v) => upd({ iconSize: v })} min={12} max={64} /></Row>
          <Row label="Cor"><ColorInput value={w.iconColor} onChange={(v) => upd({ iconColor: v })} /></Row>
        </>}
      </Section>
      <Section title="Texto">
        <ToggleRow label="Mostrar texto" value={w.showLabel} onChange={(v) => upd({ showLabel: v })} />
        {w.showLabel && <>
          <Row label="Texto"><TextInput value={w.labelText} onChange={(v) => upd({ labelText: v })} placeholder="Ver detalhes..." /></Row>
          <Row label="Fonte"><SelectInput value={w.labelFont} onChange={(v) => upd({ labelFont: v })} options={FONT_OPTIONS} /></Row>
          <Row label="Tamanho"><NumInput value={w.labelSize} onChange={(v) => upd({ labelSize: v })} min={8} max={32} /></Row>
          <Row label="Peso"><SelectInput value={w.labelWeight} onChange={(v) => upd({ labelWeight: v as HotspotWidget['labelWeight'] })} options={WEIGHT_OPTIONS} /></Row>
          <Row label="Cor"><ColorInput value={w.labelColor} onChange={(v) => upd({ labelColor: v })} /></Row>
        </>}
      </Section>
      <Section title="Hover e Interação">
        <Row label="Cor fundo hover"><ColorInput value={w.hoverFillColor} onChange={(v) => upd({ hoverFillColor: v })} /></Row>
        <Row label="Cor borda hover"><ColorInput value={w.hoverBorderColor} onChange={(v) => upd({ hoverBorderColor: v })} /></Row>
        <Row label="Escala hover"><div className="flex items-center gap-2"><input type="range" min={1} max={1.2} step={0.01} value={w.hoverScale} onChange={(e) => upd({ hoverScale: parseFloat(e.target.value) })} className="flex-1 accent-cyan-500" /><span className="text-xs text-slate-400 w-10 tabular-nums">{Math.round(w.hoverScale * 100)}%</span></div></Row>
        <Row label="Tooltip"><TextInput value={w.tooltip} onChange={(v) => upd({ tooltip: v })} placeholder="Texto ao passar o mouse..." /></Row>
        <Row label="Cursor"><SelectInput value={w.cursor} onChange={(v) => upd({ cursor: v as HotspotWidget['cursor'] })} options={[{ value: 'pointer', label: 'Ponteiro' }, { value: 'grab', label: 'Mão' }, { value: 'crosshair', label: 'Cruz' }]} /></Row>
      </Section>
    </>
  );
}

function NavMenuEditor({ items, onChange, screenOpts }: { items: NavMenuItem[]; onChange: (items: NavMenuItem[]) => void; screenOpts: Opt[] }) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  function addItem() {
    onChange([...items, { id: nanoid(6), iconName: 'arrow-right', text: 'Menu', targetScreenId: '' }]);
  }
  function removeItem(id: string) { onChange(items.filter((i) => i.id !== id)); }
  function updateItem(id: string, patch: Partial<NavMenuItem>) {
    onChange(items.map((i) => i.id === id ? { ...i, ...patch } : i));
  }
  function moveItem(index: number, offset: -1 | 1) {
    const next = reorderNavMenuItems(items, index, index + offset);
    if (next !== items) onChange(next);
  }
  function dropItem(index: number, event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const from = Number(event.dataTransfer.getData('text/scada-menu-index'));
    setDragIndex(null);
    if (Number.isInteger(from)) {
      const next = reorderNavMenuItems(items, from, index);
      if (next !== items) onChange(next);
    }
  }
  return (
    <div className="flex flex-col gap-2">
      {items.map((item, idx) => (
        <div
          key={item.id}
          className={`rounded border bg-slate-900 p-2 flex flex-col gap-1.5 transition-colors ${
            dragIndex === idx ? 'border-cyan-500/70 opacity-60' : 'border-slate-700'
          }`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => dropItem(idx, event)}
        >
          <div className="flex items-center justify-between">
            <button
              type="button"
              draggable
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData('text/scada-menu-index', String(idx));
                setDragIndex(idx);
              }}
              onDragEnd={() => setDragIndex(null)}
              className="flex cursor-grab items-center gap-1 text-[10px] text-slate-500 active:cursor-grabbing"
              aria-label={`Arrastar item ${idx + 1} para reordenar`}
              title="Arrastar para reordenar"
            >
              <GripVertical className="h-3 w-3" aria-hidden="true" />
              Item {idx + 1}
            </button>
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => moveItem(idx, -1)}
                disabled={idx === 0}
                className="rounded p-0.5 text-slate-500 transition-colors hover:text-cyan-400 disabled:cursor-not-allowed disabled:opacity-30"
                aria-label={`Mover item ${idx + 1} para cima`}
                title="Mover para cima"
              >
                <ArrowUp className="h-3 w-3" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => moveItem(idx, 1)}
                disabled={idx === items.length - 1}
                className="rounded p-0.5 text-slate-500 transition-colors hover:text-cyan-400 disabled:cursor-not-allowed disabled:opacity-30"
                aria-label={`Mover item ${idx + 1} para baixo`}
                title="Mover para baixo"
              >
                <ArrowDown className="h-3 w-3" aria-hidden="true" />
              </button>
              <button type="button" onClick={() => removeItem(item.id)} className="rounded p-0.5 text-slate-500 hover:text-red-400 transition-colors" aria-label={`Remover item ${idx + 1}`} title="Remover item"><X className="h-3 w-3" /></button>
            </div>
          </div>
          <input type="text" value={item.text} onChange={(e) => updateItem(item.id, { text: e.target.value })} placeholder="Texto" className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500" />
          <IconPicker
            value={item.iconName}
            assetUrl={item.iconAssetUrl}
            onChange={(p) => updateItem(item.id, p)}
            allowUpload
          />
          <TileRows
            enabled={Boolean(item.tileEnabled)}
            color={item.tileColor ?? '#38BDF8'}
            onChange={(p) => updateItem(item.id, p)}
          />
          <select value={item.targetScreenId} onChange={(e) => updateItem(item.id, { targetScreenId: e.target.value })} className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500">
            {screenOpts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      ))}
      <button type="button" onClick={addItem} className="rounded border border-dashed border-slate-600 py-1.5 text-xs text-slate-400 hover:border-cyan-500 hover:text-cyan-400 transition-colors">
        + Adicionar item
      </button>
    </div>
  );
}

/**
 * Toggle "Fixar em todas as telas do projeto" (layout do projeto). Ao ativar,
 * desfixa outras barras do mesmo tipo NESTA tela; nas demais telas o backend
 * desfixa no save (só uma por projeto).
 */
function PinToProjectRow({ w, upd, canPin, unpinSiblings }: {
  w: NavSidebarWidget | NavToolbarWidget;
  upd: (p: Partial<Widget>) => void;
  canPin: boolean;
  unpinSiblings: () => void;
}) {
  if (!canPin) return null;
  const kind = w.type === 'nav-toolbar' ? 'toolbar' : 'sidebar';
  const dock = w.type === 'nav-toolbar' ? 'no topo' : 'à esquerda';
  return (
    <>
      <ToggleRow
        label="Fixar em todas as telas do gateway"
        value={Boolean(w.pinnedToProject)}
        onChange={(v) => {
          if (v) unpinSiblings();
          upd({ pinnedToProject: v });
        }}
      />
      {w.pinnedToProject && (
        <p className="text-[10px] text-slate-500">
          Esta barra vira o layout do gateway: no modo de visualização ela aparece encaixada {dock} em todas
          as telas do gateway, sem piscar ao navegar. Só pode haver uma {kind} fixa por gateway — ao salvar,
          outras fixas são desfixadas automaticamente.
        </p>
      )}
    </>
  );
}

function NavSidebarProps({ w, upd, screenOpts, canPin, unpinSiblings }: { w: NavSidebarWidget; upd: (p: Partial<Widget>) => void; screenOpts: Opt[]; canPin: boolean; unpinSiblings: () => void }) {
  return (
    <Section title="Sidebar de Navegação">
      <Row label="Posição"><SelectInput value={w.position} onChange={(v) => upd({ position: v as NavSidebarWidget['position'] })} options={[{ value: 'left', label: 'Esquerda' }, { value: 'right', label: 'Direita' }]} /></Row>
      <Row label="Posição dos itens"><SelectInput value={w.verticalAlign ?? 'top'} onChange={(v) => upd({ verticalAlign: v as NavSidebarVerticalAlign })} options={[{ value: 'top', label: 'Topo' }, { value: 'center', label: 'Centro' }, { value: 'bottom', label: 'Base' }]} /></Row>
      <Row label="Alinhamento do conteúdo"><SelectInput value={w.contentAlign ?? 'left'} onChange={(v) => upd({ contentAlign: v as NavHorizontalAlign })} options={[{ value: 'left', label: 'Esquerda' }, { value: 'center', label: 'Centro' }, { value: 'right', label: 'Direita' }]} /></Row>
      <Row label="Cor de fundo"><FillColorInput value={w.backgroundColor} onChange={(v) => upd({ backgroundColor: v })} /></Row>
      <Row label="Cor do texto"><ColorInput value={w.textColor} onChange={(v) => upd({ textColor: v })} /></Row>
      <Row label="Cor ativo"><ColorInput value={w.activeColor} onChange={(v) => upd({ activeColor: v })} /></Row>
      <PinToProjectRow w={w} upd={upd} canPin={canPin} unpinSiblings={unpinSiblings} />
      <Row label="Itens do menu">
        <NavMenuEditor items={w.items} onChange={(items) => upd({ items })} screenOpts={screenOpts} />
      </Row>
    </Section>
  );
}

function NavToolbarLogoProps({ w, upd }: { w: NavToolbarWidget; upd: (p: Partial<Widget>) => void }) {
  const tenantId = useEditorStore((s) => s.screen?.tenantId);
  const addToast = useEditorStore((s) => s.addToast);
  const [uploading, setUploading] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const logo = normalizeNavToolbarLogo(w.logo);
  const previewUrl = resolveAssetUrl(logo?.url);

  function updateLogo(patch: Partial<NavToolbarLogoConfig>) {
    if (!logo) return;
    upd({ logo: { ...logo, ...patch } });
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      addToast('error', 'Selecione um arquivo de imagem');
      return;
    }
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result;
      if (typeof dataUrl !== 'string') {
        addToast('error', 'Não foi possível ler a imagem');
        return;
      }
      setUploading(true);
      try {
        const url = await uploadScadaAsset(dataUrl, tenantId);
        setPreviewFailed(false);
        upd({
          logo: {
            url,
            position: logo?.position ?? 'left',
            width: logo?.width ?? NAV_TOOLBAR_DEFAULT_LOGO_WIDTH,
            height: logo?.height ?? NAV_TOOLBAR_DEFAULT_LOGO_HEIGHT,
            fit: logo?.fit ?? 'contain',
          },
        });
      } catch (err) {
        addToast('error', err instanceof Error ? err.message : 'Falha ao enviar imagem');
      } finally {
        setUploading(false);
      }
    };
    reader.onerror = () => addToast('error', 'Não foi possível ler a imagem');
    reader.readAsDataURL(file);
  }

  return (
    <Section title="Imagem institucional">
      <p className="text-[11px] text-slate-500">
        A imagem fica reservada na barra e não vira um widget navegável. O arquivo é armazenado pelo pipeline de assets SCADA.
      </p>
      <label className={`flex items-center justify-center gap-2 rounded border border-dashed border-slate-600 py-2 text-xs text-slate-300 transition-colors ${uploading ? 'pointer-events-none opacity-60' : 'cursor-pointer hover:border-cyan-500 hover:text-cyan-400'}`}>
        <Upload className="h-3.5 w-3.5" strokeWidth={1.5} />
        {uploading ? 'Enviando…' : logo ? 'Trocar imagem' : 'Enviar imagem'}
        <input type="file" accept="image/*" onChange={onFile} disabled={uploading} className="hidden" />
      </label>
      {logo && previewUrl && (
        <div className="flex h-16 w-full max-w-full items-center justify-center overflow-hidden rounded border border-slate-700 bg-slate-950 p-2">
          {previewFailed ? (
            <div className="flex h-full items-center gap-1.5 text-[10px] text-slate-500">
              <X className="h-3.5 w-3.5" strokeWidth={1.5} />
              Imagem indisponível
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewUrl}
              alt="Prévia da imagem institucional"
              onError={() => setPreviewFailed(true)}
              className="h-full w-full object-contain"
              style={{ objectFit: logo.fit }}
            />
          )}
        </div>
      )}
      {logo && !previewUrl && (
        <div className="flex h-16 w-full items-center justify-center rounded border border-slate-700 bg-slate-950 text-[10px] text-slate-500">
          Prévia indisponível
        </div>
      )}
      {logo && (
        <>
          <Row label="Lado da barra">
            <SelectInput
              value={logo.position}
              onChange={(v) => updateLogo({ position: normalizeNavToolbarLogoPosition(v) })}
              options={[{ value: 'left', label: 'Esquerda' }, { value: 'right', label: 'Direita' }]}
            />
          </Row>
          <div className="grid grid-cols-2 gap-2">
            <Row label="Largura (px)">
              <NumInput value={logo.width} min={NAV_TOOLBAR_MIN_LOGO_WIDTH} max={NAV_TOOLBAR_MAX_LOGO_WIDTH} onChange={(v) => updateLogo({ width: normalizeNavToolbarLogoWidth(v) })} />
            </Row>
            <Row label="Altura (px)">
              <NumInput value={logo.height} min={NAV_TOOLBAR_MIN_LOGO_HEIGHT} max={NAV_TOOLBAR_MAX_LOGO_HEIGHT} onChange={(v) => updateLogo({ height: normalizeNavToolbarLogoHeight(v) })} />
            </Row>
          </div>
          <p className="text-[10px] text-slate-500">A prévia acima é compacta. O tamanho real é aplicado na barra; use as alças da logo no canvas ou estes campos para ajuste fino.</p>
          <Row label="Ajuste da imagem">
            <SelectInput
              value={logo.fit}
              onChange={(v) => updateLogo({ fit: normalizeNavToolbarLogoFit(v) })}
              options={[
                { value: 'contain', label: 'Conter (sem cortar)' },
                { value: 'cover', label: 'Preencher (pode cortar)' },
                { value: 'fill', label: 'Esticar' },
                { value: 'scale-down', label: 'Reduzir se necessário' },
                { value: 'none', label: 'Tamanho original' },
              ]}
            />
          </Row>
          <button type="button" onClick={() => upd({ logo: undefined })} className="rounded border border-slate-700 py-1.5 text-xs text-slate-400 hover:border-red-500 hover:text-red-400 transition-colors">
            Remover imagem
          </button>
        </>
      )}
    </Section>
  );
}

function NavToolbarProps({ w, upd, screenOpts, canPin, unpinSiblings }: { w: NavToolbarWidget; upd: (p: Partial<Widget>) => void; screenOpts: Opt[]; canPin: boolean; unpinSiblings: () => void }) {
  const itemGap = normalizeNavToolbarGap(w.itemGap);
  const itemPaddingX = normalizeNavToolbarPaddingX(w.itemPaddingX);
  const itemPaddingY = normalizeNavToolbarPaddingY(w.itemPaddingY);
  return (
    <Section title="Toolbar de Navegação">
      <Row label="Posição"><SelectInput value={w.position} onChange={(v) => upd({ position: v as NavToolbarWidget['position'] })} options={[{ value: 'top', label: 'Topo' }, { value: 'bottom', label: 'Rodapé' }]} /></Row>
      <Row label="Alinhamento dos itens"><SelectInput value={w.contentAlign ?? 'left'} onChange={(v) => upd({ contentAlign: v as NavHorizontalAlign })} options={[{ value: 'left', label: 'Esquerda' }, { value: 'center', label: 'Centro' }, { value: 'right', label: 'Direita' }]} /></Row>
      <Row label="Alinhamento vertical dos itens">
        <SelectInput
          value={w.verticalAlign ?? 'top'}
          onChange={(v) => upd({ verticalAlign: v as NavToolbarVerticalAlign })}
          options={[{ value: 'top', label: 'Topo' }, { value: 'center', label: 'Centro' }, { value: 'bottom', label: 'Base' }]}
        />
      </Row>
      <Row label="Espaçamento entre itens (px)">
        <NumInput value={itemGap} min={0} max={NAV_TOOLBAR_MAX_GAP} onChange={(v) => upd({ itemGap: normalizeNavToolbarGap(v) })} />
        <p className="text-[10px] text-slate-500">Distância entre os botões. Valores maiores podem exigir rolagem horizontal.</p>
      </Row>
      <Row label="Padding horizontal dos itens (px)">
        <NumInput value={itemPaddingX} min={0} max={NAV_TOOLBAR_MAX_PADDING_X} onChange={(v) => upd({ itemPaddingX: normalizeNavToolbarPaddingX(v) })} />
        <p className="text-[10px] text-slate-500">Espaço nas laterais de cada botão.</p>
      </Row>
      <Row label="Padding vertical dos itens (px)">
        <NumInput value={itemPaddingY} min={0} max={NAV_TOOLBAR_MAX_PADDING_Y} onChange={(v) => upd({ itemPaddingY: normalizeNavToolbarPaddingY(v) })} />
        <p className="text-[10px] text-slate-500">Espaço acima e abaixo; em barras altas, define a altura visual dos botões.</p>
      </Row>
      <Row label="Tamanho da fonte dos itens (px)">
        <NumInput
          value={normalizeNavToolbarFontSize(w.fontSize)}
          min={NAV_TOOLBAR_MIN_FONT_SIZE}
          max={NAV_TOOLBAR_MAX_FONT_SIZE}
          onChange={(v) => upd({ fontSize: normalizeNavToolbarFontSize(v) })}
        />
        <p className="text-[10px] text-slate-500">Entre {NAV_TOOLBAR_MIN_FONT_SIZE}px e {NAV_TOOLBAR_MAX_FONT_SIZE}px; telas antigas usam 12px.</p>
      </Row>
      <Row label="Cor de fundo"><FillColorInput value={w.backgroundColor} onChange={(v) => upd({ backgroundColor: v })} /></Row>
      <Row label="Cor do texto"><ColorInput value={w.textColor} onChange={(v) => upd({ textColor: v })} /></Row>
      <Row label="Cor ativo"><ColorInput value={w.activeColor} onChange={(v) => upd({ activeColor: v })} /></Row>
      <NavToolbarLogoProps w={w} upd={upd} />
      <PinToProjectRow w={w} upd={upd} canPin={canPin} unpinSiblings={unpinSiblings} />
      <Row label="Itens do menu">
        <NavMenuEditor items={w.items} onChange={(items) => upd({ items })} screenOpts={screenOpts} />
      </Row>
    </Section>
  );
}

function NavButtonProps({ w, upd, screenOpts }: { w: NavButtonWidget; upd: (p: Partial<Widget>) => void; screenOpts: Opt[] }) {
  return (
    <Section title="Botão de Navegação">
      <Row label="Tela de destino"><SelectInput value={w.targetScreenId} onChange={(v) => upd({ targetScreenId: v })} options={screenOpts} /></Row>
      <Row label="Texto"><TextInput value={w.label} onChange={(v) => upd({ label: v })} /></Row>
      <Row label="Ícone"><IconPicker value={w.iconName ?? ''} assetUrl={w.iconAssetUrl} onChange={(p) => upd(p)} allowNone allowUpload /></Row>
      <TileRows enabled={Boolean(w.tileEnabled)} color={w.tileColor ?? '#38BDF8'} onChange={(p) => upd(p)} />
      <Row label="Cor de fundo"><FillColorInput value={w.backgroundColor} onChange={(v) => upd({ backgroundColor: v })} /></Row>
      <Row label="Cor do texto"><ColorInput value={w.textColor} onChange={(v) => upd({ textColor: v })} /></Row>
      <Row label="Borda arred."><NumInput value={w.borderRadius} onChange={(v) => upd({ borderRadius: v })} min={0} max={32} /></Row>
      <Row label="Tamanho fonte"><NumInput value={w.fontSize} onChange={(v) => upd({ fontSize: v })} min={10} max={32} /></Row>
    </Section>
  );
}

const EQUIPMENT_TYPES = new Set(['chiller', 'pump', 'ahu', 'fan', 'valve', 'generator', 'meter', 'controller', 'compressor', 'cooling-tower', 'fan-coil', 'electrical-panel', 'tank', 'sensor', 'smoke-detector', 'manual-call-point', 'zone-module', 'monitor-module', 'command-module', 'flow-switch', 'fire-panel', 'fire-siren', 'heat-detector', 'sprinkler', 'fire-hydrant', 'fire-extinguisher', 'fire-pump', 'fire-damper', 'fire-door', 'camera', 'lighting']);
const SHAPE_TYPES = new Set(['rectangle', 'square', 'circle', 'ellipse', 'triangle', 'polygon']);

// ─── Main panel ────────────────────────────────────────────────────────────

type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

function AlignmentSection({ widgets, moveWidgets }: { widgets: Widget[]; moveWidgets: (p: { id: string; x: number; y: number }[]) => void }) {
  function align(mode: AlignMode) {
    const minX = Math.min(...widgets.map((w) => w.x));
    const maxX = Math.max(...widgets.map((w) => w.x + w.width));
    const minY = Math.min(...widgets.map((w) => w.y));
    const maxY = Math.max(...widgets.map((w) => w.y + w.height));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const pos = widgets.map((w) => {
      let x = w.x, y = w.y;
      if (mode === 'left') x = minX;
      else if (mode === 'right') x = maxX - w.width;
      else if (mode === 'hcenter') x = Math.round(cx - w.width / 2);
      else if (mode === 'top') y = minY;
      else if (mode === 'bottom') y = maxY - w.height;
      else if (mode === 'vcenter') y = Math.round(cy - w.height / 2);
      return { id: w.id, x, y };
    });
    moveWidgets(pos);
  }
  function distribute(axis: 'h' | 'v') {
    if (widgets.length < 3) return;
    const sorted = [...widgets].sort((a, b) => (axis === 'h' ? a.x - b.x : a.y - b.y));
    const start = axis === 'h' ? sorted[0].x : sorted[0].y;
    const end = axis === 'h' ? sorted[sorted.length - 1].x : sorted[sorted.length - 1].y;
    const step = (end - start) / (sorted.length - 1);
    const pos = sorted.map((w, i) => ({
      id: w.id,
      x: axis === 'h' ? Math.round(start + step * i) : w.x,
      y: axis === 'v' ? Math.round(start + step * i) : w.y,
    }));
    moveWidgets(pos);
  }
  const btn = 'flex h-7 items-center justify-center rounded border border-slate-700 bg-slate-900 text-xs text-slate-300 hover:border-cyan-500 hover:text-cyan-400 transition-colors';
  return (
    <Section title="Alinhar">
      <div className="grid grid-cols-3 gap-1">
        <button type="button" className={btn} title="Alinhar à esquerda" onClick={() => align('left')}>⬅</button>
        <button type="button" className={btn} title="Centralizar horizontal" onClick={() => align('hcenter')}>↔</button>
        <button type="button" className={btn} title="Alinhar à direita" onClick={() => align('right')}>➡</button>
        <button type="button" className={btn} title="Alinhar ao topo" onClick={() => align('top')}>⬆</button>
        <button type="button" className={btn} title="Centralizar vertical" onClick={() => align('vcenter')}>↕</button>
        <button type="button" className={btn} title="Alinhar à base" onClick={() => align('bottom')}>⬇</button>
      </div>
      <div className="grid grid-cols-2 gap-1">
        <button type="button" className={btn} title="Distribuir horizontalmente" onClick={() => distribute('h')}>⇿ Distribuir H</button>
        <button type="button" className={btn} title="Distribuir verticalmente" onClick={() => distribute('v')}>⇳ Distribuir V</button>
      </div>
    </Section>
  );
}

function CommandButtonProps({ w, upd, devices }: { w: CommandButtonWidget; upd: (p: Partial<Widget>) => void; devices: ScreenDevice[] }) {
  return (
    <>
      <Section title="Ponto comandável">
        <Row label="Equipamento"><SelectInput value={w.deviceId} onChange={(v) => upd({ deviceId: v, tag: '' })} options={writableDeviceOptions(devices)} /></Row>
        <Row label="Ponto (saída)"><SelectInput value={sanitizeCommandTag(devices, w.deviceId, w.tag)} onChange={(v) => upd({ tag: v })} options={writableTagOptions(devices, w.deviceId)} /></Row>
        <CommandPointNotes devices={devices} deviceId={w.deviceId} savedTag={w.tag} />
      </Section>
      <Section title="Comando">
        <Row label="Modo"><SelectInput value={w.mode} onChange={(v) => upd({ mode: v as CommandButtonWidget['mode'] })} options={CMD_MODE_OPTS} /></Row>
        <div className="grid grid-cols-2 gap-2">
          <Row label="Valor ON"><NumInput value={w.onValue} onChange={(v) => upd({ onValue: v })} /></Row>
          <Row label="Valor OFF"><NumInput value={w.offValue} onChange={(v) => upd({ offValue: v })} /></Row>
        </div>
        {isBacnetDevice(devices, w.deviceId) && (
          <Row label="Prioridade (1–16)"><NumInput value={w.priority} onChange={(v) => upd({ priority: Math.min(16, Math.max(1, v)) })} min={1} max={16} /></Row>
        )}
        <ToggleRow label="Confirmar antes de enviar" value={w.confirm} onChange={(v) => upd({ confirm: v })} />
      </Section>
      <Section title="Aparência">
        <Row label="Rótulo"><TextInput value={w.label} onChange={(v) => upd({ label: v })} /></Row>
        <Row label="Variante"><SelectInput value={w.variant} onChange={(v) => upd({ variant: v as CommandButtonWidget['variant'] })} options={CMD_VARIANT_OPTS} /></Row>
        <Row label="Ícone"><SelectInput value={w.iconName} onChange={(v) => upd({ iconName: v })} options={ICON_OPTS} /></Row>
        <ToggleRow label="Apenas ícone" value={w.iconOnly} onChange={(v) => upd({ iconOnly: v })} />
        <ToggleRow label="Mostrar estado (ON/OFF)" value={w.showState} onChange={(v) => upd({ showState: v })} />
        <Row label="Cor ON"><ColorInput value={w.colorOn} onChange={(v) => upd({ colorOn: v })} /></Row>
        <Row label="Cor OFF"><ColorInput value={w.colorOff} onChange={(v) => upd({ colorOff: v })} /></Row>
        <Row label="Cor do texto"><ColorInput value={w.textColor} onChange={(v) => upd({ textColor: v })} /></Row>
        <Row label="Raio da borda"><NumInput value={w.borderRadius} onChange={(v) => upd({ borderRadius: v })} min={0} max={999} /></Row>
        <Row label="Tamanho da fonte"><NumInput value={w.fontSize} onChange={(v) => upd({ fontSize: v })} min={8} max={48} /></Row>
      </Section>
    </>
  );
}

function ToggleSwitchProps({ w, upd, devices }: { w: ToggleSwitchWidget; upd: (p: Partial<Widget>) => void; devices: ScreenDevice[] }) {
  return (
    <>
      <Section title="Ponto comandável">
        <Row label="Equipamento"><SelectInput value={w.deviceId} onChange={(v) => upd({ deviceId: v, tag: '' })} options={writableDeviceOptions(devices)} /></Row>
        <Row label="Ponto (saída)"><SelectInput value={sanitizeCommandTag(devices, w.deviceId, w.tag)} onChange={(v) => upd({ tag: v })} options={writableTagOptions(devices, w.deviceId)} /></Row>
        <CommandPointNotes devices={devices} deviceId={w.deviceId} savedTag={w.tag} />
      </Section>
      <Section title="Comando">
        <div className="grid grid-cols-2 gap-2">
          <Row label="Valor ON"><NumInput value={w.onValue} onChange={(v) => upd({ onValue: v })} /></Row>
          <Row label="Valor OFF"><NumInput value={w.offValue} onChange={(v) => upd({ offValue: v })} /></Row>
        </div>
        {isBacnetDevice(devices, w.deviceId) && (
          <Row label="Prioridade (1–16)"><NumInput value={w.priority} onChange={(v) => upd({ priority: Math.min(16, Math.max(1, v)) })} min={1} max={16} /></Row>
        )}
        <ToggleRow label="Confirmar antes de enviar" value={w.confirm} onChange={(v) => upd({ confirm: v })} />
      </Section>
      <Section title="Aparência">
        <Row label="Rótulo"><TextInput value={w.label} onChange={(v) => upd({ label: v })} /></Row>
        <ToggleRow label="Mostrar rótulo" value={w.showLabel} onChange={(v) => upd({ showLabel: v })} />
        <Row label="Cor ligado"><ColorInput value={w.colorOn} onChange={(v) => upd({ colorOn: v })} /></Row>
        <Row label="Cor desligado"><ColorInput value={w.colorOff} onChange={(v) => upd({ colorOff: v })} /></Row>
        <Row label="Cor do rótulo"><ColorInput value={w.textColor} onChange={(v) => upd({ textColor: v })} /></Row>
        <Row label="Tamanho da fonte"><NumInput value={w.fontSize} onChange={(v) => upd({ fontSize: v })} min={8} max={48} /></Row>
      </Section>
    </>
  );
}

function CommandSliderProps({ w, upd, devices }: { w: CommandSliderWidget; upd: (p: Partial<Widget>) => void; devices: ScreenDevice[] }) {
  return (
    <>
      <Section title="Ponto comandável (analógico)">
        <Row label="Equipamento"><SelectInput value={w.deviceId} onChange={(v) => upd({ deviceId: v, tag: '' })} options={writableDeviceOptions(devices, true)} /></Row>
        <Row label="Ponto (analógico)"><SelectInput value={sanitizeCommandTag(devices, w.deviceId, w.tag, true)} onChange={(v) => upd({ tag: v })} options={writableTagOptions(devices, w.deviceId, true)} /></Row>
        <CommandPointNotes devices={devices} deviceId={w.deviceId} savedTag={w.tag} analogOnly />
      </Section>
      <Section title="Comando">
        <Row label="Rótulo"><TextInput value={w.label} onChange={(v) => upd({ label: v })} /></Row>
        <div className="grid grid-cols-3 gap-2">
          <Row label="Mín"><NumInput value={w.minValue} onChange={(v) => upd({ minValue: v })} /></Row>
          <Row label="Máx"><NumInput value={w.maxValue} onChange={(v) => upd({ maxValue: v })} /></Row>
          <Row label="Passo"><NumInput value={w.step} onChange={(v) => upd({ step: Math.max(0, v) })} min={0} /></Row>
        </div>
        {isBacnetDevice(devices, w.deviceId) && (
          <Row label="Prioridade (1–16)"><NumInput value={w.priority} onChange={(v) => upd({ priority: Math.min(16, Math.max(1, v)) })} min={1} max={16} /></Row>
        )}
      </Section>
      <Section title="Aparência">
        <Row label="Variante">
          <SelectInput
            value={w.variant ?? 'default'}
            onChange={(v) => upd({ variant: v as CommandSliderWidget['variant'] })}
            options={[{ value: 'default', label: 'Compacto (escuro)' }, { value: 'card', label: 'Card com rótulo e % (claro)' }]}
          />
        </Row>
        <Row label="Unidade"><TextInput value={w.unit} onChange={(v) => upd({ unit: v })} /></Row>
        <Row label="Casas decimais"><NumInput value={w.decimals} onChange={(v) => upd({ decimals: v })} min={0} max={4} /></Row>
        <Row label="Cor"><ColorInput value={w.color} onChange={(v) => upd({ color: v })} /></Row>
        <ToggleRow label="Mostrar valor" value={w.showValue} onChange={(v) => upd({ showValue: v })} />
        {(w.variant ?? 'default') === 'card' && (
          <>
            <Row label="Fundo do card"><ColorInput value={w.cardBackgroundColor ?? '#FFFFFF'} onChange={(v) => upd({ cardBackgroundColor: v })} /></Row>
            <Row label="Texto do card"><ColorInput value={w.cardTextColor ?? '#0F172A'} onChange={(v) => upd({ cardTextColor: v })} /></Row>
            <Row label="Texto secundário"><ColorInput value={w.cardMutedColor ?? '#64748B'} onChange={(v) => upd({ cardMutedColor: v })} /></Row>
          </>
        )}
      </Section>
    </>
  );
}

const ALARM_GROUP_FORMAT_OPTS: Opt[] = [
  { value: 'fraction', label: 'Ativos / Total' },
  { value: 'active-only', label: 'Somente ativos' },
  { value: 'total-only', label: 'Somente total' },
];

function AlarmGroupBadgeProps({
  w, upd, tenantId, projectId,
}: { w: AlarmGroupBadgeWidget; upd: (p: Partial<Widget>) => void; tenantId: string; projectId?: string }) {
  const { data: groups = [], isLoading } = useQuery({
    queryKey: ['alarm-groups', 'binding', tenantId, projectId ?? null],
    queryFn: () => listAlarmGroups({ tenantId, projectId }),
    enabled: Boolean(tenantId),
  });
  const groupOpts: Opt[] = [
    { value: '', label: '— selecionar —' },
    ...groups.map((g) => ({ value: g.id, label: g.siteName ? `${g.name} · ${g.siteName}` : g.name })),
  ];
  return (
    <>
      <Section title="Binding de Soma de Alarmes">
        <Row label="Grupo">
          <SelectInput value={w.groupId} onChange={(v) => upd({ groupId: v })} options={groupOpts} />
        </Row>
        {isLoading && <p className="px-1 text-[10px] text-slate-500">Carregando grupos…</p>}
        {!isLoading && groups.length === 0 && (
          <p className="px-1 text-[10px] text-slate-500">Nenhuma soma de alarme neste gateway. Crie uma na página de Alarmes.</p>
        )}
        <Row label="Formato"><SelectInput value={w.format} onChange={(v) => upd({ format: v as AlarmGroupBadgeFormat })} options={ALARM_GROUP_FORMAT_OPTS} /></Row>
      </Section>
      <Section title="Aparência">
        <Row label="Rótulo"><TextInput value={w.label} onChange={(v) => upd({ label: v })} /></Row>
        <ToggleRow label="Mostrar rótulo" value={w.showLabel} onChange={(v) => upd({ showLabel: v })} />
        <ToggleRow label="Cor por severidade" value={w.useSeverityColor} onChange={(v) => upd({ useSeverityColor: v })} />
        <Row label="Cor normal (sem alarme)"><ColorInput value={w.colorOk} onChange={(v) => upd({ colorOk: v })} /></Row>
        {!w.useSeverityColor && (
          <Row label="Cor em alarme"><ColorInput value={w.colorAlarm} onChange={(v) => upd({ colorAlarm: v })} /></Row>
        )}
        <Row label="Cor do texto"><ColorInput value={w.textColor} onChange={(v) => upd({ textColor: v })} /></Row>
        <Row label="Cor de fundo"><FillColorInput value={w.backgroundColor} onChange={(v) => upd({ backgroundColor: v })} /></Row>
        <Row label="Tamanho da fonte"><NumInput value={w.fontSize} onChange={(v) => upd({ fontSize: v })} min={8} max={64} /></Row>
        <Row label="Raio da borda"><NumInput value={w.borderRadius} onChange={(v) => upd({ borderRadius: v })} min={0} max={999} /></Row>
      </Section>
    </>
  );
}

const DEVICE_COUNTER_MODE_OPTS: Opt[] = [
  { value: 'connectivity', label: 'Conectividade (online/offline)' },
  { value: 'point-value', label: 'Valor de ponto (ligado/desligado)' },
  { value: 'point-list', label: 'Contagem de pontos (ex.: 5/10 lâmpadas)' },
];
const DEVICE_COUNTER_FILTER_OPTS: Opt[] = [
  { value: 'all', label: 'Todos' },
  { value: 'camera', label: 'Câmeras CFTV' },
  { value: 'other', label: 'Equipamentos (não-câmeras)' },
];
const DEVICE_COUNTER_SCOPE_OPTS: Opt[] = [
  { value: 'site', label: 'Site inteiro (todos do gateway)' },
  { value: 'selected', label: 'Dispositivos selecionados' },
];
const DEVICE_COUNTER_FORMAT_OPTS: Opt[] = [
  { value: 'fraction', label: 'Ligados / Total (ex.: 3/5)' },
  { value: 'on-only', label: 'Somente ligados' },
  { value: 'off-only', label: 'Somente desligados' },
  { value: 'total-only', label: 'Somente total' },
];

/** Dispositivos elegíveis ao filtro do contador (sem virtuais/Bancada). */
function counterFilteredDevices(devices: ScreenDevice[], filter: DeviceCounterFilter): ScreenDevice[] {
  return devices.filter((d) => {
    if (d.protocol === 'virtual') return false;
    if (filter === 'camera') return isCameraDevice(d);
    if (filter === 'other') return !isCameraDevice(d);
    return true;
  });
}

function DeviceCounterProps({ w, upd, devices }: { w: DeviceCounterWidget; upd: (p: Partial<Widget>) => void; devices: ScreenDevice[] }) {
  const [pointSearch, setPointSearch] = useState('');
  const filtered = counterFilteredDevices(devices, w.deviceFilter);
  const scoped = w.scope === 'selected' ? filtered.filter((d) => w.deviceIds.includes(d.id)) : filtered;

  // Tags distintas entre os dispositivos do escopo (modo valor de ponto).
  const tagSet = new Map<string, number>();
  for (const d of scoped) for (const p of d.points) tagSet.set(p.tag, (tagSet.get(p.tag) ?? 0) + 1);
  const tagOpts: Opt[] = [
    { value: '', label: '— selecionar —' },
    ...[...tagSet.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([tag, n]) => ({ value: tag, label: `${tag} (${n} disp.)` })),
  ];

  function toggleDevice(id: string) {
    const next = w.deviceIds.includes(id) ? w.deviceIds.filter((x) => x !== id) : [...w.deviceIds, id];
    upd({ deviceIds: next });
  }

  // Modo point-list: dispositivos não-virtuais com pontos (mistura câmeras e equipamentos).
  const pointListDevices = devices.filter((d) => d.protocol !== 'virtual' && d.points.length > 0);
  const selectedPoints = w.points ?? [];

  // Busca: dispositivo casa por nome (mostra todos os pontos); senão filtra pontos por tag/nome.
  const q = pointSearch.trim().toLowerCase();
  const visibleDevices = pointListDevices
    .map((d) => {
      if (!q || d.name.toLowerCase().includes(q)) return { device: d, points: d.points };
      const pts = d.points.filter((p) => {
        const label = 'objectName' in p ? p.objectName : 'displayName' in p ? p.displayName : '';
        return p.tag.toLowerCase().includes(q) || (label ?? '').toLowerCase().includes(q);
      });
      return { device: d, points: pts };
    })
    .filter((e) => e.points.length > 0);

  function isPointSelected(deviceId: string, tag: string) {
    return selectedPoints.some((p) => p.deviceId === deviceId && p.tag === tag);
  }
  function togglePoint(deviceId: string, tag: string) {
    const next = isPointSelected(deviceId, tag)
      ? selectedPoints.filter((p) => !(p.deviceId === deviceId && p.tag === tag))
      : [...selectedPoints, { deviceId, tag }];
    upd({ points: next });
  }

  const conditionRow = (
    <Row label="Condição de ligado">
      <div className="flex gap-1.5">
        <select value={w.operator} onChange={(e) => upd({ operator: e.target.value as VisibilityOperator })} className="flex-1 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500">
          {OPERATOR_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input type="number" value={w.value} onChange={(e) => upd({ value: Number(e.target.value) })} className="w-16 rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500" />
      </div>
    </Row>
  );

  return (
    <>
      <Section title={w.mode === 'point-list' ? 'Contagem de pontos' : 'Contagem de dispositivos'}>
        <Row label="Modo"><SelectInput value={w.mode} onChange={(v) => upd({ mode: v as DeviceCounterMode })} options={DEVICE_COUNTER_MODE_OPTS} /></Row>
        {w.mode !== 'point-list' && (
          <>
            <Row label="Tipo de dispositivo"><SelectInput value={w.deviceFilter} onChange={(v) => upd({ deviceFilter: v as DeviceCounterFilter })} options={DEVICE_COUNTER_FILTER_OPTS} /></Row>
            <Row label="Escopo"><SelectInput value={w.scope} onChange={(v) => upd({ scope: v as DeviceCounterScope })} options={DEVICE_COUNTER_SCOPE_OPTS} /></Row>
            {w.scope === 'selected' && (
              <div className="max-h-40 overflow-y-auto rounded border border-slate-700 bg-slate-900 p-1">
                {filtered.length === 0 && <p className="px-2 py-1.5 text-[11px] text-slate-500">Nenhum dispositivo neste filtro.</p>}
                {filtered.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 rounded px-2 py-1 text-xs text-slate-300 hover:bg-slate-800 cursor-pointer">
                    <input type="checkbox" checked={w.deviceIds.includes(d.id)} onChange={() => toggleDevice(d.id)} className="accent-cyan-500" />
                    <span className="flex-1 truncate">{d.name}</span>
                    <span className="shrink-0 text-[9px] text-slate-500">{d.protocol.toUpperCase()}</span>
                  </label>
                ))}
              </div>
            )}
          </>
        )}
        {w.mode === 'connectivity' && (
          <p className="text-[10px] text-slate-500">
            Câmeras contam como online pelo ponto STATUS (semântica CFTV); os demais dispositivos pela telemetria recente. Sem informação → &quot;sem dados&quot;.
          </p>
        )}
        {w.mode === 'point-value' && (
          <>
            <Row label="Ponto (tag)"><SelectInput value={w.pointTag} onChange={(v) => upd({ pointTag: v })} options={tagOpts} /></Row>
            {conditionRow}
            <p className="text-[10px] text-slate-500">
              Conta os dispositivos cujo ponto satisfaz a condição (ex.: relé = 1). Dispositivo offline ou sem valor conta como &quot;sem dados&quot; — nunca como desligado.
            </p>
          </>
        )}
        {w.mode === 'point-list' && (
          <>
            <p className="text-[10px] text-slate-400">
              Selecione os pontos a contar (pode misturar dispositivos). Cada ponto conta como 1 unidade — ex.: 10 lâmpadas no mesmo equipamento → &quot;5/10&quot;.
            </p>
            <input
              type="text"
              value={pointSearch}
              onChange={(e) => setPointSearch(e.target.value)}
              placeholder="Buscar ponto ou dispositivo…"
              className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 placeholder:text-slate-500 outline-none focus:border-cyan-500"
            />
            <div className="max-h-56 overflow-y-auto rounded border border-slate-700 bg-slate-900 p-1">
              {pointListDevices.length === 0 && <p className="px-2 py-1.5 text-[11px] text-slate-500">Nenhum dispositivo com pontos nesta tela.</p>}
              {pointListDevices.length > 0 && visibleDevices.length === 0 && (
                <p className="px-2 py-1.5 text-[11px] text-slate-500">Nenhum ponto encontrado para &quot;{pointSearch.trim()}&quot;.</p>
              )}
              {visibleDevices.map(({ device: d, points: pts }) => {
                const selCount = pts.filter((p) => isPointSelected(d.id, p.tag)).length;
                const allSelected = selCount === pts.length;
                function toggleAllVisible() {
                  const next = allSelected
                    ? selectedPoints.filter((sp) => !(sp.deviceId === d.id && pts.some((p) => p.tag === sp.tag)))
                    : [
                        ...selectedPoints,
                        ...pts.filter((p) => !isPointSelected(d.id, p.tag)).map((p) => ({ deviceId: d.id, tag: p.tag })),
                      ];
                  upd({ points: next });
                }
                return (
                  <div key={d.id} className="mb-1 last:mb-0">
                    <label className="flex items-center gap-2 rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 hover:bg-slate-800 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => { if (el) el.indeterminate = selCount > 0 && !allSelected; }}
                        onChange={toggleAllVisible}
                        className="accent-cyan-500"
                        title="Marcar/desmarcar todos os pontos visíveis deste dispositivo"
                      />
                      <span className="truncate">{d.name}</span>
                      <span className="shrink-0 text-[9px] font-normal text-slate-500">{d.protocol.toUpperCase()}</span>
                    </label>
                    {pts.map((p) => (
                      <label key={`${d.id}:${p.tag}`} className="flex items-center gap-2 rounded px-2 py-1 pl-6 text-xs text-slate-300 hover:bg-slate-800 cursor-pointer">
                        <input type="checkbox" checked={isPointSelected(d.id, p.tag)} onChange={() => togglePoint(d.id, p.tag)} className="accent-cyan-500" />
                        <span className="flex-1 truncate">{p.tag}</span>
                      </label>
                    ))}
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-slate-500">{selectedPoints.length} ponto(s) selecionado(s)</p>
            {conditionRow}
            <p className="text-[10px] text-slate-500">
              Conta os pontos que satisfazem a condição (ex.: = 1). Ponto sem valor ou com leitura desatualizada conta como &quot;sem dados&quot; — nunca como desligado.
            </p>
          </>
        )}
        <Row label="Formato"><SelectInput value={w.format} onChange={(v) => upd({ format: v as DeviceCounterFormat })} options={DEVICE_COUNTER_FORMAT_OPTS} /></Row>
      </Section>
      <Section title="Aparência">
        <Row label="Rótulo"><TextInput value={w.label} onChange={(v) => upd({ label: v })} /></Row>
        <ToggleRow label="Mostrar rótulo" value={w.showLabel} onChange={(v) => upd({ showLabel: v })} />
        <Row label="Ícone">
          <IconPicker
            value={w.iconName ?? DEVICE_COUNTER_DEFAULT_ICON}
            onChange={(p) => upd({ iconName: p.iconName ?? '' })}
            allowNone
          />
        </Row>
        <Row label="Cor do número"><ColorInput value={w.colorOn} onChange={(v) => upd({ colorOn: v })} /></Row>
        <Row label="Cor do texto"><ColorInput value={w.textColor} onChange={(v) => upd({ textColor: v })} /></Row>
        <Row label="Cor de fundo"><FillColorInput value={w.backgroundColor} onChange={(v) => upd({ backgroundColor: v })} /></Row>
        <Row label="Tamanho da fonte"><NumInput value={w.fontSize} onChange={(v) => upd({ fontSize: v })} min={8} max={64} /></Row>
        <Row label="Raio da borda"><NumInput value={w.borderRadius} onChange={(v) => upd({ borderRadius: v })} min={0} max={999} /></Row>
      </Section>
    </>
  );
}

function IconProps({ w, upd }: { w: IconWidget; upd: (p: Partial<Widget>) => void }) {
  const def = SCADA_ICONS[w.iconName];
  const hasVariants = Boolean(def?.IconOn || def?.IconOff) && !w.iconAssetUrl;
  return (
    <Section title="Ícone">
      <Row label="Ícone">
        <IconPicker value={w.iconName} assetUrl={w.iconAssetUrl} onChange={(p) => upd(p)} allowUpload />
      </Row>
      <Row label="Cor (sem ponto vinculado)"><ColorInput value={w.color} onChange={(v) => upd({ color: v })} /></Row>
      <Row label="Cor ligado (valor 1)"><ColorInput value={w.colorOn} onChange={(v) => upd({ colorOn: v })} /></Row>
      <Row label="Cor desligado (valor 0)"><ColorInput value={w.colorOff} onChange={(v) => upd({ colorOff: v })} /></Row>
      <ToggleRow label="Estilo tile (quadrado arredondado)" value={Boolean(w.tileEnabled)} onChange={(v) => upd({ tileEnabled: v })} />
      {w.tileEnabled && (
        <p className="text-[10px] text-slate-500">
          O fundo do quadrado é derivado automaticamente da cor atual do ícone (tonalidade suave da mesma matiz).
        </p>
      )}
      <p className="text-[10px] text-slate-500">
        Com um ponto vinculado acima: 1 = ligado{hasVariants ? ' (variante acesa)' : ''}, 0 = desligado{hasVariants ? ' (variante apagada)' : ''}, sem leitura = cinza offline.
      </p>
    </Section>
  );
}

// ─── Ação ao clicar ──────────────────────────────────────────────────────────

const CLICK_ACTION_TYPE_OPTS: Opt[] = [
  { value: 'none', label: 'Nenhuma' },
  { value: 'command', label: 'Enviar comando (escrever em um ponto)' },
  { value: 'navigate', label: 'Navegar para outra tela' },
];
const CLICK_CMD_MODE_OPTS: Opt[] = [
  { value: 'set', label: 'Valor fixo' },
  { value: 'toggle', label: 'Alternar (toggle) ligado/desligado' },
];

/** true se o ponto escolhido é binário (BACnet BO/BV ou MQTT boolean) — habilita toggle. */
function isBinaryPoint(devices: ScreenDevice[], deviceId: string, tag: string): boolean {
  const dev = devices.find((d) => d.id === deviceId);
  const p = dev?.points.find((pt) => pt.tag === tag);
  if (!p) return false;
  if ('objectType' in p) return ['BO', 'BV'].includes((p as { objectType: string }).objectType);
  if ('valueType' in p) return (p as { valueType?: string }).valueType === 'boolean';
  return false;
}

/**
 * Seção "Ação ao clicar" — disponível para qualquer widget visual (exceto os que
 * já têm interação própria). A ação só executa no viewer/Preview; no editor o
 * clique continua apenas selecionando o widget.
 */
function ClickActionSection({
  widget, upd, devices, screenOpts,
}: { widget: Widget; upd: (p: Partial<Widget>) => void; devices: ScreenDevice[]; screenOpts: Opt[] }) {
  const a: ClickAction = widget.clickAction ?? { type: 'none' };
  function setAction(patch: Partial<ClickAction>) {
    upd({ clickAction: { ...a, ...patch } });
  }
  const binary = a.deviceId && a.tag ? isBinaryPoint(devices, a.deviceId, a.tag) : false;
  const mode: ClickActionCommandMode = a.commandMode ?? 'set';
  return (
    <Section title="Ação ao clicar">
      <Row label="Ação">
        <SelectInput
          value={a.type}
          onChange={(v) => {
            const t = v as ClickActionType;
            if (t === 'none') upd({ clickAction: undefined });
            else setAction({ type: t });
          }}
          options={CLICK_ACTION_TYPE_OPTS}
        />
      </Row>
      {a.type === 'command' && (
        <>
          <Row label="Equipamento">
            <SelectInput value={a.deviceId ?? ''} onChange={(v) => setAction({ deviceId: v, tag: '' })} options={writableDeviceOptions(devices)} />
          </Row>
          <Row label="Ponto (gravável)">
            <SelectInput value={sanitizeCommandTag(devices, a.deviceId ?? '', a.tag ?? '')} onChange={(v) => setAction({ tag: v })} options={writableTagOptions(devices, a.deviceId ?? '')} />
          </Row>
          <CommandPointNotes devices={devices} deviceId={a.deviceId ?? ''} savedTag={a.tag ?? ''} />
          <Row label="Modo">
            <SelectInput value={mode} onChange={(v) => setAction({ commandMode: v as ClickActionCommandMode })} options={CLICK_CMD_MODE_OPTS} />
          </Row>
          {mode === 'set' ? (
            <Row label="Valor a enviar"><NumInput value={a.value ?? 1} onChange={(v) => setAction({ value: v })} /></Row>
          ) : (
            <>
              {!binary && a.tag && (
                <p className="text-[10px] text-amber-400">Toggle é indicado para pontos binários — este ponto não é binário; alterna entre os valores abaixo pelo valor atual.</p>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Row label="Valor ligado"><NumInput value={a.onValue ?? 1} onChange={(v) => setAction({ onValue: v })} /></Row>
                <Row label="Valor desligado"><NumInput value={a.offValue ?? 0} onChange={(v) => setAction({ offValue: v })} /></Row>
              </div>
            </>
          )}
          <Row label="Prioridade BACnet (1–16)">
            <NumInput value={a.priority ?? 8} onChange={(v) => setAction({ priority: Math.min(16, Math.max(1, v)) })} min={1} max={16} />
          </Row>
          <ToggleRow label="Confirmar antes de enviar" value={a.confirm ?? false} onChange={(v) => setAction({ confirm: v })} />
        </>
      )}
      {a.type === 'navigate' && (
        <Row label="Tela de destino">
          <SelectInput value={a.targetScreenId ?? ''} onChange={(v) => setAction({ targetScreenId: v })} options={screenOpts} />
        </Row>
      )}
      {a.type !== 'none' && (
        <p className="text-[10px] text-slate-500">A ação executa apenas no modo de visualização — no editor o clique só seleciona.</p>
      )}
    </Section>
  );
}

function StatusSection({ widget, upd }: { widget: Widget; upd: (p: Partial<Widget>) => void }) {
  const status = widget.status;
  const enabled = Boolean(status);
  const { deviceId, tag } = readWidgetBinding(widget);
  const hasPoint = Boolean(deviceId && tag);
  function setStatus(patch: Partial<StatusBinding>) {
    const base: StatusBinding = status ?? { rules: [], effects: ['border'] };
    upd({ status: { ...base, ...patch } });
  }
  function toggleEffect(eff: StatusEffect) {
    const cur = status?.effects ?? [];
    setStatus({ effects: cur.includes(eff) ? cur.filter((e) => e !== eff) : [...cur, eff] });
  }
  return (
    <Section title="Status por ponto">
      <ToggleRow label="Realce por telemetria" value={enabled} onChange={(v) => upd({ status: v ? { rules: [], effects: ['border'] } : undefined })} />
      {enabled && status && (
        <>
          {!hasPoint && <p className="text-[11px] text-slate-500">Vincule um ponto acima para o realce reagir ao valor.</p>}
          <Row label="Aplicar cor em">
            <div className="flex flex-wrap gap-3 pt-1">
              {STATUS_EFFECT_OPTS.map((o) => (
                <label key={o.value} className="flex items-center gap-1 text-[11px] text-slate-300">
                  <input type="checkbox" checked={status.effects.includes(o.value)} onChange={() => toggleEffect(o.value)} className="accent-cyan-500" />
                  {o.label}
                </label>
              ))}
            </div>
          </Row>
          <p className="pt-1 text-[10px] text-slate-500">Regras (valor → cor / animação / texto)</p>
          <StateRulesEditor rules={status.rules} onChange={(rules) => setStatus({ rules })} showText />
        </>
      )}
    </Section>
  );
}

const HOVER_TARGET_OPTS: { value: ScadaHoverTarget; label: string }[] = [
  { value: 'border', label: 'Borda' },
  { value: 'content', label: 'Preenchimento' },
  { value: 'text', label: 'Texto' },
];
const HOVER_EASING_OPTS: { value: ScadaHoverEasing; label: string }[] = [
  { value: 'ease-out', label: 'Suave (recomendado)' },
  { value: 'ease', label: 'Padrão' },
  { value: 'ease-in-out', label: 'Entrada e saída' },
  { value: 'linear', label: 'Linear' },
];

function HoverSection({ widget, upd }: { widget: Widget; upd: (p: Partial<Widget>) => void }) {
  const hover = normalizeScadaHover(widget.hover) ?? {
    ...SCADA_HOVER_DEFAULTS,
    targets: [],
  };
  const capabilities = getScadaHoverCapabilities(widget).targets;
  const targetOptions = HOVER_TARGET_OPTS.filter((option) => capabilities.includes(option.value));
  const applicableTargets = hover.targets.filter((target) => capabilities.includes(target));
  const setHover = (patch: Partial<ScadaHoverConfig>) => {
    const nextTargets = (patch.targets ?? applicableTargets)
      .filter((target) => capabilities.includes(target));
    upd({ hover: { ...hover, ...patch, targets: [...new Set(nextTargets)] } });
  };
  const toggleTarget = (target: ScadaHoverTarget) => {
    if (!capabilities.includes(target)) return;
    const targets = applicableTargets.includes(target)
      ? applicableTargets.filter((item) => item !== target)
      : [...applicableTargets, target];
    setHover({ targets });
  };
  return (
    <Section title="Hover">
      <ToggleRow label="Realce ao passar o mouse" value={hover.enabled} onChange={(enabled) => setHover({ enabled })} />
      {hover.enabled && (
        <>
          <Row label="Aplicar cor em">
            <div className="flex flex-col gap-1.5 pt-1">
              {targetOptions.map((option) => (
                <label key={option.value} className="flex items-center gap-2 text-[11px] text-slate-300">
                  <input
                    type="checkbox"
                    checked={applicableTargets.includes(option.value)}
                    onChange={() => toggleTarget(option.value)}
                    className="accent-cyan-500"
                  />
                  {option.label}
                </label>
              ))}
            </div>
          </Row>
          {applicableTargets.includes('border') && (
            <Row label="Cor da borda"><ColorInput value={hover.borderColor} onChange={(borderColor) => setHover({ borderColor })} /></Row>
          )}
          {applicableTargets.includes('content') && (
            <Row label="Cor do preenchimento"><ColorInput value={hover.contentColor} onChange={(contentColor) => setHover({ contentColor })} /></Row>
          )}
          {applicableTargets.includes('text') && (
            <Row label="Cor do texto"><ColorInput value={hover.textColor} onChange={(textColor) => setHover({ textColor })} /></Row>
          )}
          {targetOptions.length === 0 ? (
            <p className="text-[10px] text-slate-500">Este widget não possui uma superfície compatível com hover.</p>
          ) : applicableTargets.length === 0 && (
            <p className="text-[10px] text-amber-400">Selecione pelo menos um alvo para o hover aparecer.</p>
          )}
          <Row label={`Duração (${hover.transitionMs} ms)`}>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={SCADA_HOVER_MAX_TRANSITION_MS}
                step={10}
                value={hover.transitionMs}
                onChange={(e) => setHover({ transitionMs: Number(e.target.value) })}
                className="flex-1 accent-cyan-500"
              />
              <input
                type="number"
                min={0}
                max={SCADA_HOVER_MAX_TRANSITION_MS}
                value={hover.transitionMs}
                onChange={(e) => setHover({ transitionMs: Math.min(SCADA_HOVER_MAX_TRANSITION_MS, Math.max(0, Number(e.target.value) || 0)) })}
                className="w-16 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 outline-none focus:border-cyan-500"
              />
            </div>
          </Row>
          <Row label="Curva da transição">
            <SelectInput value={hover.easing} onChange={(easing) => setHover({ easing: easing as ScadaHoverEasing })} options={HOVER_EASING_OPTS} />
          </Row>
        </>
      )}
      {!hover.enabled && (
        <p className="text-[10px] text-slate-500">
          Desabilitado. Widgets antigos sem essa configuração continuam usando apenas o comportamento legado.
        </p>
      )}
    </Section>
  );
}

const POPUP_TRIGGER_OPTIONS: Opt[] = [
  { value: 'hover', label: 'Hover' },
  { value: 'click', label: 'Clique / toque' },
  { value: 'hover-click', label: 'Hover + clique' },
];
const POPUP_PLACEMENT_OPTIONS: Opt[] = [
  { value: 'auto', label: 'Automática' },
  { value: 'top', label: 'Acima' },
  { value: 'right', label: 'À direita' },
  { value: 'bottom', label: 'Abaixo' },
  { value: 'left', label: 'À esquerda' },
];

function PopupSection({
  widget, upd, devices, screen, screenOpts, components = [], onDeleteComponent = () => {},
}: {
  widget: Widget;
  upd: (p: Partial<Widget>) => void;
  devices: ScreenDevice[];
  screen: { projectId?: string; tenantId: string };
  screenOpts: Opt[];
  components?: SavedComponent[];
  onDeleteComponent?: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (!canConfigureScadaPopup(widget)) return null;
  const popup = normalizeScadaPopup(widget.popup) ?? createScadaPopupDefaults();
  const setPopup = (patch: Partial<ScadaPopupConfig>) =>
    upd({ popup: { ...popup, ...patch } });
  const hasOwnInteraction = CLICK_ACTION_EXCLUDED_TYPES.has(widget.type);

  return (
    <Section title="Popup">
      <ToggleRow label="Habilitar popup" value={popup.enabled} onChange={(enabled) => setPopup({ enabled })} />
      {popup.enabled && (
        <>
          <Row label="Abrir por">
            <SelectInput value={popup.trigger} onChange={(value) => setPopup({ trigger: value as ScadaPopupTrigger })} options={POPUP_TRIGGER_OPTIONS} />
          </Row>
          <Row label="Título">
            <TextInput value={popup.title} onChange={(title) => setPopup({ title })} />
          </Row>
          <div className="grid grid-cols-2 gap-2">
            <Row label="Largura (px)">
              <NumInput value={popup.width} onChange={(width) => setPopup({ width: normalizeScadaPopupWidth(width) })} min={SCADA_POPUP_MIN_WIDTH} max={SCADA_POPUP_MAX_WIDTH} />
            </Row>
            <Row label="Altura (px)">
              <NumInput value={popup.height} onChange={(height) => setPopup({ height: normalizeScadaPopupHeight(height) })} min={SCADA_POPUP_MIN_HEIGHT} max={SCADA_POPUP_MAX_HEIGHT} />
            </Row>
          </div>
          <Row label="Posição">
            <SelectInput value={popup.placement} onChange={(value) => setPopup({ placement: value as ScadaPopupPlacement })} options={POPUP_PLACEMENT_OPTIONS} />
          </Row>
          <Row label="Distância">
            <NumInput value={popup.offset} onChange={(offset) => setPopup({ offset: Math.min(48, Math.max(0, offset)) })} min={0} max={48} />
          </Row>
          <div className="grid grid-cols-2 gap-2">
            <Row label="Fundo"><ColorInput value={popup.backgroundColor} onChange={(backgroundColor) => setPopup({ backgroundColor })} /></Row>
            <Row label="Borda"><ColorInput value={popup.borderColor} onChange={(borderColor) => setPopup({ borderColor })} /></Row>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Row label="Raio"><NumInput value={popup.borderRadius} onChange={(borderRadius) => setPopup({ borderRadius: Math.min(32, Math.max(0, borderRadius)) })} min={0} max={32} /></Row>
            <Row label="Borda px"><NumInput value={popup.borderWidth} onChange={(borderWidth) => setPopup({ borderWidth: Math.min(8, Math.max(0, borderWidth)) })} min={0} max={8} /></Row>
          </div>
          <ToggleRow label="Sombra" value={popup.shadow} onChange={(shadow) => setPopup({ shadow })} />
          <ToggleRow label="Fechar fora" value={popup.closeOnOutside} onChange={(closeOnOutside) => setPopup({ closeOnOutside })} />
          <ToggleRow label="Fechar com Escape" value={popup.closeOnEscape} onChange={(closeOnEscape) => setPopup({ closeOnEscape })} />
          <button
            type="button"
            data-testid="edit-scada-popup"
            onClick={() => setEditing(true)}
            className="mt-2 w-full rounded border border-cyan-700 bg-cyan-950/40 px-3 py-2 text-xs font-medium text-cyan-300 hover:border-cyan-500 hover:bg-cyan-900/40"
          >
            {popup.widgets.length ? `Editar conteúdo (${popup.widgets.length})` : 'Criar conteúdo do popup'}
          </button>
          {hasOwnInteraction && (
            <p className="mt-2 text-[10px] leading-relaxed text-amber-400/80">Este widget já possui uma interação própria. Ela mantém a precedência; o popup só abre quando o clique não for consumido pelo controle.</p>
          )}
          <p className="mt-2 text-[10px] leading-relaxed text-slate-500">O painel é ancorado ao widget, reposicionado nas bordas e salvo dentro desta tela.</p>
        </>
      )}
      {editing && (
        <PopupEditorDialog
          popup={popup}
          devices={devices}
          screen={screen}
          screenOpts={screenOpts}
          components={components}
          onDeleteComponent={onDeleteComponent}
          onCancel={() => setEditing(false)}
          onSave={(next) => { upd({ popup: next }); setEditing(false); }}
        />
      )}
    </Section>
  );
}

// ─── Dashboard / Cards ───────────────────────────────────────────────────────

const PERIOD_OPTS: Opt[] = [
  { value: '1', label: 'Última 1 h' }, { value: '6', label: 'Últimas 6 h' },
  { value: '24', label: 'Últimas 24 h' }, { value: '72', label: 'Últimos 3 dias' },
  { value: '168', label: 'Últimos 7 dias' },
];
const SEVERITY_OPTS: Opt[] = [
  { value: '', label: 'Todas' }, { value: 'HIGH', label: 'Alta' },
  { value: 'MEDIUM', label: 'Média' }, { value: 'LOW', label: 'Baixa' },
];

/** Seção de estilo compartilhada dos cartões de dashboard. */
function DashCardStyleSection({ w, upd }: { w: DashCardBase; upd: (p: Partial<Widget>) => void }) {
  return (
    <Section title="Estilo do cartão">
      <Row label="Fundo"><FillColorInput value={w.backgroundColor} onChange={(v) => upd({ backgroundColor: v } as Partial<Widget>)} /></Row>
      <Row label="Texto"><ColorInput value={w.textColor} onChange={(v) => upd({ textColor: v } as Partial<Widget>)} /></Row>
      <Row label="Texto secundário"><ColorInput value={w.mutedColor} onChange={(v) => upd({ mutedColor: v } as Partial<Widget>)} /></Row>
      <Row label="Borda"><ColorInput value={w.borderColor} onChange={(v) => upd({ borderColor: v } as Partial<Widget>)} /></Row>
      <Row label="Raio da borda"><NumInput value={w.borderRadius} onChange={(v) => upd({ borderRadius: Math.max(0, v) } as Partial<Widget>)} min={0} max={32} /></Row>
    </Section>
  );
}

function KpiCardProps({ w, upd }: { w: KpiCardWidget; upd: (p: Partial<Widget>) => void }) {
  return (
    <>
      <Section title="Card KPI">
        <Row label="Título"><TextInput value={w.title} onChange={(v) => upd({ title: v })} /></Row>
        <div className="grid grid-cols-2 gap-2">
          <Row label="Unidade"><TextInput value={w.unit} onChange={(v) => upd({ unit: v })} /></Row>
          <Row label="Casas decimais"><NumInput value={w.decimals} onChange={(v) => upd({ decimals: Math.min(4, Math.max(0, v)) })} min={0} max={4} /></Row>
        </div>
        <Row label="Subtexto"><TextInput value={w.subtext} onChange={(v) => upd({ subtext: v })} placeholder="ex.: meta diária 360 kWh" /></Row>
        <Row label="Tamanho do valor"><NumInput value={w.valueFontSize} onChange={(v) => upd({ valueFontSize: Math.max(12, v) })} min={12} max={72} /></Row>
      </Section>
      <Section title="Badge de estado">
        <ToggleRow label="Mostrar badge" value={w.showBadge} onChange={(v) => upd({ showBadge: v })} />
        {w.showBadge && (
          <>
            <p className="pt-1 text-[10px] text-slate-500">Regras (valor → cor / texto do badge)</p>
            <StateRulesEditor rules={w.badgeRules} onChange={(rules) => upd({ badgeRules: rules })} showText />
          </>
        )}
      </Section>
      <DashCardStyleSection w={w} upd={upd} />
    </>
  );
}

function SensorCardProps({ w, upd }: { w: SensorCardWidget; upd: (p: Partial<Widget>) => void }) {
  return (
    <>
      <Section title="Card Sensor">
        <Row label="Título"><TextInput value={w.title} onChange={(v) => upd({ title: v })} /></Row>
        <div className="grid grid-cols-2 gap-2">
          <Row label="Unidade"><TextInput value={w.unit} onChange={(v) => upd({ unit: v })} /></Row>
          <Row label="Casas decimais"><NumInput value={w.decimals} onChange={(v) => upd({ decimals: Math.min(4, Math.max(0, v)) })} min={0} max={4} /></Row>
        </div>
        <Row label="Tamanho do valor"><NumInput value={w.valueFontSize} onChange={(v) => upd({ valueFontSize: Math.max(12, v) })} min={12} max={72} /></Row>
      </Section>
      <Section title="Sparkline">
        <Row label="Cor da linha"><ColorInput value={w.sparkColor} onChange={(v) => upd({ sparkColor: v })} /></Row>
        <Row label="Período"><SelectInput value={String(w.periodHours)} onChange={(v) => upd({ periodHours: Number(v) as DashPeriodHours })} options={PERIOD_OPTS} /></Row>
        <p className="text-[10px] text-slate-500">O histórico vem das trends do ponto — crie uma trend para o ponto vinculado para a sparkline aparecer.</p>
      </Section>
      <Section title="Badge de estado">
        <ToggleRow label="Mostrar badge" value={w.showBadge} onChange={(v) => upd({ showBadge: v })} />
        {w.showBadge && (
          <>
            <p className="pt-1 text-[10px] text-slate-500">Regras (valor → cor / texto do badge)</p>
            <StateRulesEditor rules={w.badgeRules} onChange={(rules) => upd({ badgeRules: rules })} showText />
          </>
        )}
      </Section>
      <DashCardStyleSection w={w} upd={upd} />
    </>
  );
}

const SERIES_COLORS = ['#3B82F6', '#22C55E', '#F59E0B', '#A855F7'];

function DashChartProps({ w, upd, devices }: { w: DashChartWidget; upd: (p: Partial<Widget>) => void; devices: ScreenDevice[] }) {
  function setSeries(id: string, patch: Partial<DashChartWidget['series'][number]>) {
    upd({ series: w.series.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  }
  return (
    <>
      <Section title="Gráfico de tendência">
        <Row label="Título"><TextInput value={w.title} onChange={(v) => upd({ title: v })} /></Row>
        <Row label="Período"><SelectInput value={String(w.periodHours)} onChange={(v) => upd({ periodHours: Number(v) as DashPeriodHours })} options={PERIOD_OPTS} /></Row>
        <ToggleRow label="Mostrar legenda" value={w.showLegend} onChange={(v) => upd({ showLegend: v })} />
        <p className="text-[10px] text-slate-500">O histórico vem das trends de cada ponto (crie trends para os pontos das séries).</p>
      </Section>
      <Section title={`Séries (${w.series.length}/4)`}>
        {w.series.map((s, i) => (
          <div key={s.id} className="rounded border border-slate-700 p-2 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-slate-400">Série {i + 1}</span>
              <button type="button" onClick={() => upd({ series: w.series.filter((x) => x.id !== s.id) })} className="rounded p-0.5 text-slate-500 hover:text-red-400"><Trash2Icon /></button>
            </div>
            <Row label="Equipamento"><SelectInput value={s.deviceId} onChange={(v) => setSeries(s.id, { deviceId: v, tag: '' })} options={deviceOptions(devices)} /></Row>
            <Row label="Ponto"><SelectInput value={s.tag} onChange={(v) => setSeries(s.id, { tag: v })} options={tagOptions(devices, s.deviceId)} /></Row>
            <div className="grid grid-cols-2 gap-2">
              <Row label="Rótulo"><TextInput value={s.label} onChange={(v) => setSeries(s.id, { label: v })} /></Row>
              <Row label="Cor"><ColorInput value={s.color} onChange={(v) => setSeries(s.id, { color: v })} /></Row>
            </div>
          </div>
        ))}
        {w.series.length < 4 && (
          <button
            type="button"
            onClick={() => upd({ series: [...w.series, { id: nanoid(6), deviceId: '', tag: '', label: '', color: SERIES_COLORS[w.series.length % SERIES_COLORS.length] }] })}
            className="rounded border border-dashed border-slate-600 px-2 py-1.5 text-xs text-slate-400 hover:border-cyan-500 hover:text-cyan-400 transition-colors"
          >
            + Adicionar série
          </button>
        )}
      </Section>
      <Section title="Linha de limite">
        <ToggleRow label="Mostrar limite" value={w.limitEnabled} onChange={(v) => upd({ limitEnabled: v })} />
        {w.limitEnabled && (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Row label="Valor"><NumInput value={w.limitValue} onChange={(v) => upd({ limitValue: v })} /></Row>
              <Row label="Cor"><ColorInput value={w.limitColor} onChange={(v) => upd({ limitColor: v })} /></Row>
            </div>
            <Row label="Rótulo"><TextInput value={w.limitLabel} onChange={(v) => upd({ limitLabel: v })} placeholder="ex.: demanda contratada 60 kW" /></Row>
          </>
        )}
      </Section>
      <DashCardStyleSection w={w} upd={upd} />
    </>
  );
}

function BarListProps({ w, upd, devices }: { w: BarListWidget; upd: (p: Partial<Widget>) => void; devices: ScreenDevice[] }) {
  function setRow(id: string, patch: Partial<BarListWidget['rows'][number]>) {
    upd({ rows: w.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  }
  return (
    <>
      <Section title="Barras percentuais">
        <Row label="Título"><TextInput value={w.title} onChange={(v) => upd({ title: v })} /></Row>
      </Section>
      <Section title={`Linhas (${w.rows.length})`}>
        {w.rows.map((r, i) => (
          <div key={r.id} className="rounded border border-slate-700 p-2 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-slate-400">Linha {i + 1}</span>
              <button type="button" onClick={() => upd({ rows: w.rows.filter((x) => x.id !== r.id) })} className="rounded p-0.5 text-slate-500 hover:text-red-400"><Trash2Icon /></button>
            </div>
            <Row label="Equipamento"><SelectInput value={r.deviceId} onChange={(v) => setRow(r.id, { deviceId: v, tag: '' })} options={deviceOptions(devices)} /></Row>
            <Row label="Ponto"><SelectInput value={r.tag} onChange={(v) => setRow(r.id, { tag: v })} options={tagOptions(devices, r.deviceId)} /></Row>
            <div className="grid grid-cols-2 gap-2">
              <Row label="Rótulo"><TextInput value={r.label} onChange={(v) => setRow(r.id, { label: v })} /></Row>
              <Row label="Cor"><ColorInput value={r.color} onChange={(v) => setRow(r.id, { color: v })} /></Row>
              <Row label="Mín (0%)"><NumInput value={r.minValue} onChange={(v) => setRow(r.id, { minValue: v })} /></Row>
              <Row label="Máx (100%)"><NumInput value={r.maxValue} onChange={(v) => setRow(r.id, { maxValue: v })} /></Row>
              <Row label="Unidade"><TextInput value={r.unit} onChange={(v) => setRow(r.id, { unit: v })} /></Row>
              <Row label="Decimais"><NumInput value={r.decimals} onChange={(v) => setRow(r.id, { decimals: Math.min(4, Math.max(0, v)) })} min={0} max={4} /></Row>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => upd({ rows: [...w.rows, { id: nanoid(6), deviceId: '', tag: '', label: '', color: SERIES_COLORS[w.rows.length % SERIES_COLORS.length], minValue: 0, maxValue: 100, unit: '', decimals: 1 }] })}
          className="rounded border border-dashed border-slate-600 px-2 py-1.5 text-xs text-slate-400 hover:border-cyan-500 hover:text-cyan-400 transition-colors"
        >
          + Adicionar linha
        </button>
      </Section>
      <DashCardStyleSection w={w} upd={upd} />
    </>
  );
}

function EventFeedProps({ w, upd }: { w: EventFeedWidget; upd: (p: Partial<Widget>) => void }) {
  return (
    <>
      <Section title="Eventos recentes">
        <Row label="Título"><TextInput value={w.title} onChange={(v) => upd({ title: v })} /></Row>
        <Row label="Máx. de eventos"><NumInput value={w.limit} onChange={(v) => upd({ limit: Math.min(20, Math.max(1, v)) })} min={1} max={20} /></Row>
        <Row label="Severidade"><SelectInput value={w.severity} onChange={(v) => upd({ severity: v as EventFeedWidget['severity'] })} options={SEVERITY_OPTS} /></Row>
        <ToggleRow label="Somente ativos" value={w.onlyActive} onChange={(v) => upd({ onlyActive: v })} />
        <p className="text-[10px] text-slate-500">Escopo automático: alarmes do site/cliente desta tela.</p>
      </Section>
      <DashCardStyleSection w={w} upd={upd} />
    </>
  );
}

function PointTableProps({ w, upd, devices }: { w: PointTableWidget; upd: (p: Partial<Widget>) => void; devices: ScreenDevice[] }) {
  function setRow(id: string, patch: Partial<PointTableWidget['rows'][number]>) {
    upd({ rows: w.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  }
  return (
    <>
      <Section title="Tabela de pontos">
        <Row label="Título"><TextInput value={w.title} onChange={(v) => upd({ title: v })} /></Row>
        <ToggleRow label="Coluna de estado" value={w.showState} onChange={(v) => upd({ showState: v })} />
      </Section>
      <Section title={`Linhas (${w.rows.length})`}>
        {w.rows.map((r, i) => (
          <div key={r.id} className="rounded border border-slate-700 p-2 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-slate-400">Linha {i + 1}</span>
              <button type="button" onClick={() => upd({ rows: w.rows.filter((x) => x.id !== r.id) })} className="rounded p-0.5 text-slate-500 hover:text-red-400"><Trash2Icon /></button>
            </div>
            <Row label="Equipamento"><SelectInput value={r.deviceId} onChange={(v) => setRow(r.id, { deviceId: v, tag: '' })} options={deviceOptions(devices)} /></Row>
            <Row label="Ponto"><SelectInput value={r.tag} onChange={(v) => setRow(r.id, { tag: v })} options={tagOptions(devices, r.deviceId)} /></Row>
            <div className="grid grid-cols-3 gap-2">
              <Row label="Rótulo"><TextInput value={r.label} onChange={(v) => setRow(r.id, { label: v })} /></Row>
              <Row label="Unidade"><TextInput value={r.unit} onChange={(v) => setRow(r.id, { unit: v })} /></Row>
              <Row label="Decimais"><NumInput value={r.decimals} onChange={(v) => setRow(r.id, { decimals: Math.min(4, Math.max(0, v)) })} min={0} max={4} /></Row>
            </div>
            {w.showState && (
              <>
                <p className="text-[10px] text-slate-500">Estado da linha (valor → cor / texto)</p>
                <StateRulesEditor rules={r.stateRules} onChange={(rules) => setRow(r.id, { stateRules: rules })} showText />
              </>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => upd({ rows: [...w.rows, { id: nanoid(6), deviceId: '', tag: '', label: '', unit: '', decimals: 1, stateRules: [] }] })}
          className="rounded border border-dashed border-slate-600 px-2 py-1.5 text-xs text-slate-400 hover:border-cyan-500 hover:text-cyan-400 transition-colors"
        >
          + Adicionar linha
        </button>
      </Section>
      <DashCardStyleSection w={w} upd={upd} />
    </>
  );
}

function SegmentedControlProps({ w, upd, devices }: { w: SegmentedControlWidget; upd: (p: Partial<Widget>) => void; devices: ScreenDevice[] }) {
  function setOpt(id: string, patch: Partial<SegmentedControlWidget['options'][number]>) {
    upd({ options: w.options.map((o) => (o.id === id ? { ...o, ...patch } : o)) });
  }
  return (
    <>
      <Section title="Ponto comandável">
        <Row label="Equipamento"><SelectInput value={w.deviceId} onChange={(v) => upd({ deviceId: v, tag: '' })} options={writableDeviceOptions(devices)} /></Row>
        <Row label="Ponto (saída)"><SelectInput value={sanitizeCommandTag(devices, w.deviceId, w.tag)} onChange={(v) => upd({ tag: v })} options={writableTagOptions(devices, w.deviceId)} /></Row>
        <CommandPointNotes devices={devices} deviceId={w.deviceId} savedTag={w.tag} />
      </Section>
      <Section title="Controle segmentado">
        <Row label="Rótulo"><TextInput value={w.label} onChange={(v) => upd({ label: v })} /></Row>
        <ToggleRow label="Mostrar rótulo" value={w.showLabel} onChange={(v) => upd({ showLabel: v })} />
        {w.options.map((o, i) => (
          <div key={o.id} className="rounded border border-slate-700 p-2 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-semibold text-slate-400">Opção {i + 1}</span>
              {w.options.length > 2 && (
                <button type="button" onClick={() => upd({ options: w.options.filter((x) => x.id !== o.id) })} className="rounded p-0.5 text-slate-500 hover:text-red-400"><Trash2Icon /></button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Row label="Rótulo"><TextInput value={o.label} onChange={(v) => setOpt(o.id, { label: v })} /></Row>
              <Row label="Valor"><NumInput value={o.value} onChange={(v) => setOpt(o.id, { value: v })} /></Row>
            </div>
          </div>
        ))}
        {w.options.length < 3 && (
          <button
            type="button"
            onClick={() => upd({ options: [...w.options, { id: nanoid(6), label: `Opção ${w.options.length + 1}`, value: w.options.length }] })}
            className="rounded border border-dashed border-slate-600 px-2 py-1.5 text-xs text-slate-400 hover:border-cyan-500 hover:text-cyan-400 transition-colors"
          >
            + Adicionar opção
          </button>
        )}
        <ToggleRow label="Confirmar antes de enviar" value={w.confirm} onChange={(v) => upd({ confirm: v })} />
        {isBacnetDevice(devices, w.deviceId) && (
          <Row label="Prioridade (1–16)"><NumInput value={w.priority} onChange={(v) => upd({ priority: Math.min(16, Math.max(1, v)) })} min={1} max={16} /></Row>
        )}
      </Section>
      <Section title="Aparência do controle">
        <Row label="Cor ativa"><ColorInput value={w.activeColor} onChange={(v) => upd({ activeColor: v })} /></Row>
        <Row label="Texto ativo"><ColorInput value={w.activeTextColor} onChange={(v) => upd({ activeTextColor: v })} /></Row>
        <Row label="Tamanho da fonte"><NumInput value={w.fontSize} onChange={(v) => upd({ fontSize: Math.max(9, v) })} min={9} max={24} /></Row>
      </Section>
      <DashCardStyleSection w={w} upd={upd} />
    </>
  );
}

/** Ícone de lixeira compacto usado nas listas de linhas/séries. */
function Trash2Icon() {
  return <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />;
}

function WidgetTypeSpecificProps({
  widget, upd, devices, screen, screenOpts, canPin = false, unpinSiblings = () => {}, mode = 'all',
}: {
  widget: Widget;
  upd: (p: Partial<Widget>) => void;
  devices: ScreenDevice[];
  screen: { projectId?: string; tenantId: string };
  screenOpts: Opt[];
  canPin?: boolean;
  unpinSiblings?: () => void;
  mode?: 'all' | 'style' | 'rules';
}) {
  return (
    <>
      {widget.type === 'label-static' && <LabelStaticProps w={widget} upd={upd} />}
      {widget.type === 'section-title' && <SectionTitleProps w={widget} upd={upd} />}
      {widget.type === 'value-dynamic' && <ValueDynamicProps w={widget} upd={upd} />}
      {widget.type === 'label-value-block' && <LabelValueBlockProps w={widget} upd={upd} />}
      {widget.type === 'led-status' && <LedStatusProps w={widget} upd={upd} />}
      {widget.type === 'gauge' && <GaugeProps w={widget} upd={upd} />}
      {widget.type === 'thermometer' && <ThermometerProps w={widget} upd={upd} />}
      {widget.type === 'progress-bar' && <ProgressBarProps w={widget} upd={upd} />}
      {widget.type === 'traffic-light' && <TrafficLightProps w={widget} upd={upd} />}
      {widget.type === 'numeric-display' && <NumericDisplayProps w={widget} upd={upd} />}
      {widget.type === 'trend-arrow' && <TrendArrowProps w={widget} upd={upd} />}
      {EQUIPMENT_TYPES.has(widget.type) && <EquipmentProps w={widget as EquipmentWidget} upd={upd} devices={devices} mode={mode} />}
      {widget.type === 'line' && <LineProps w={widget} upd={upd} devices={devices} mode={mode} />}
      {widget.type === 'pipe' && <PipeProps w={widget} upd={upd} mode={mode} />}
      {SHAPE_TYPES.has(widget.type) && <ShapeProps w={widget as ShapeWidgetBase & { type: Widget['type'] }} upd={upd} mode={mode} />}
      {widget.type === 'icon' && <IconProps w={widget} upd={upd} />}
      {widget.type === 'image' && <ImageProps w={widget} upd={upd} />}
      {widget.type === 'titled-area' && <TitledAreaProps w={widget} upd={upd} />}
      {widget.type === 'separator' && <SeparatorProps w={widget} upd={upd} />}
      {widget.type === 'hotspot' && <HotspotProps w={widget} upd={upd} screenOpts={screenOpts} />}
      {widget.type === 'nav-sidebar' && <NavSidebarProps w={widget} upd={upd} screenOpts={screenOpts} canPin={canPin} unpinSiblings={unpinSiblings} />}
      {widget.type === 'nav-toolbar' && <NavToolbarProps w={widget} upd={upd} screenOpts={screenOpts} canPin={canPin} unpinSiblings={unpinSiblings} />}
      {widget.type === 'nav-button' && <NavButtonProps w={widget} upd={upd} screenOpts={screenOpts} />}
      {widget.type === 'command-button' && <CommandButtonProps w={widget} upd={upd} devices={devices} />}
      {widget.type === 'command-slider' && <CommandSliderProps w={widget} upd={upd} devices={devices} />}
      {widget.type === 'toggle-switch' && <ToggleSwitchProps w={widget} upd={upd} devices={devices} />}
      {widget.type === 'alarm-group-badge' && <AlarmGroupBadgeProps w={widget} upd={upd} tenantId={screen.tenantId} projectId={screen.projectId} />}
      {widget.type === 'device-counter' && <DeviceCounterProps w={widget} upd={upd} devices={devices} />}
      {widget.type === 'kpi-card' && <KpiCardProps w={widget} upd={upd} />}
      {widget.type === 'sensor-card' && <SensorCardProps w={widget} upd={upd} />}
      {widget.type === 'dash-chart' && <DashChartProps w={widget} upd={upd} devices={devices} />}
      {widget.type === 'bar-list' && <BarListProps w={widget} upd={upd} devices={devices} />}
      {widget.type === 'event-feed' && <EventFeedProps w={widget} upd={upd} />}
      {widget.type === 'point-table' && <PointTableProps w={widget} upd={upd} devices={devices} />}
      {widget.type === 'segmented-control' && <SegmentedControlProps w={widget} upd={upd} devices={devices} />}
      {widget.type === 'value-stepper' && <ValueStepperProps w={widget} upd={upd} devices={devices} />}
      {widget.type === 'setpoint-ring' && <SetpointRingProps w={widget} upd={upd} />}
      {widget.type === 'equipment-card' && <EquipmentCardProps w={widget} upd={upd} devices={devices} />}
      {widget.type === 'climate-card' && <ClimateCardProps w={widget} upd={upd} devices={devices} />}
    </>
  );
}

/**
 * O inspetor é deliberadamente um shell de sessão: aba, busca e seções abertas
 * nunca são serializadas junto com o widget. O conteúdo continua usando os
 * mesmos componentes e patches de antes.
 */
const INSPECTOR_TABS: { id: InspectorTabId; label: string }[] = [
  { id: 'general', label: 'Geral' },
  { id: 'data', label: 'Dados' },
  { id: 'style', label: 'Estilo' },
  { id: 'interaction', label: 'Interação' },
  { id: 'rules', label: 'Regras' },
];

function widgetDisplayName(widget: Widget): string {
  const value = widget as unknown as Record<string, unknown>;
  for (const key of ['labelText', 'text', 'label', 'title', 'componentName']) {
    if (typeof value[key] === 'string' && value[key]) return value[key] as string;
  }
  return widget.type;
}

function updateWidgetDisplayName(widget: Widget, name: string): Partial<Widget> {
  if (widget.type === 'component-instance') return { componentName: name };
  if ('labelText' in widget) return { labelText: name } as Partial<Widget>;
  if ('text' in widget) return { text: name } as Partial<Widget>;
  if ('label' in widget) return { label: name } as Partial<Widget>;
  if ('title' in widget) return { title: name } as Partial<Widget>;
  return { editorLabel: name };
}

function InspectorGeneral({ widget, upd }: { widget: Widget; upd: (p: Partial<Widget>) => void }) {
  return (
    <>
      <PropertyCategory id="general-identification" title="Identificação" resetKey={widget.id}>
        <Section title="Nome e camada" hideTitle>
          <Row label="Nome"><TextInput value={widgetDisplayName(widget)} onChange={(v) => upd(updateWidgetDisplayName(widget, v))} /></Row>
          <Row label="Camada"><TextInput value={widget.editorLabel ?? ''} onChange={(v) => upd({ editorLabel: v })} placeholder="Nome para localizar nas camadas" /></Row>
        </Section>
      </PropertyCategory>
      <PropertyCategory id="general-geometry" title="Posição e tamanho" resetKey={widget.id}>
        <Section title="Geometria" hideTitle>
          <div className="grid grid-cols-2 gap-2">
            <Row label="X"><NumInput value={widget.x} onChange={(v) => upd({ x: v })} /></Row>
            <Row label="Y"><NumInput value={widget.y} onChange={(v) => upd({ y: v })} /></Row>
            <Row label="Largura"><NumInput value={widget.width} onChange={(v) => upd({ width: Math.max(10, v) })} min={10} /></Row>
            <Row label="Altura"><NumInput value={widget.height} onChange={(v) => upd({ height: Math.max(10, v) })} min={10} /></Row>
          </div>
          <Row label="Rotação">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <input type="range" min={-180} max={180} step={1} value={widget.rotation ?? 0} onChange={(e) => upd({ rotation: Number(e.target.value) })} className="flex-1 accent-cyan-400" />
              <span className="w-10 text-right text-xs tabular-nums text-slate-400">{Math.round(widget.rotation ?? 0)}°</span>
            </div>
          </Row>
        </Section>
      </PropertyCategory>
      <PropertyCategory id="general-state" title="Estado" resetKey={widget.id}>
        <Section title="Estado do componente" hideTitle>
          <ToggleRow label="Visível" value={widget.visible} onChange={(v) => upd({ visible: v })} />
          <ToggleRow label="Bloqueado" value={Boolean(widget.locked)} onChange={(v) => upd({ locked: v })} />
          <div className="flex items-center gap-3" data-inspector-row="Opacidade">
            <span className="w-20 shrink-0 text-[11px] text-slate-400">Opacidade</span>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <input type="range" min={0} max={1} step={0.05} value={widget.opacity} onChange={(e) => upd({ opacity: Number(e.target.value) })} aria-label="Opacidade" className="min-w-0 flex-1 accent-cyan-400" />
              <span className="w-10 text-right text-xs tabular-nums text-slate-400">{Math.round(widget.opacity * 100)}%</span>
            </div>
          </div>
        </Section>
      </PropertyCategory>
      <PropertyCategory id="general-order" title="Ordem no canvas" resetKey={widget.id}>
        <Section title="Camadas" hideTitle>
          <Row label="Z-Index"><NumInput value={widget.zIndex} onChange={(v) => upd({ zIndex: v })} min={0} max={100} /></Row>
        </Section>
      </PropertyCategory>
    </>
  );
}

function InspectorFormat({ widget, upd }: { widget: Widget; upd: (p: Partial<Widget>) => void }) {
  const value = widget as unknown as Record<string, unknown>;
  const hasUnit = 'unit' in value || 'levelUnit' in value;
  const hasDecimals = 'decimals' in value || 'levelFontSize' in value;
  return (
    <Section title="Formato da leitura" hideTitle>
      {hasUnit && (
        <Row label="Unidade">
          <TextInput value={String(value.unit ?? value.levelUnit ?? '')} onChange={(v) => upd({ [('unit' in value ? 'unit' : 'levelUnit')]: v } as Partial<Widget>)} />
        </Row>
      )}
      {hasDecimals && 'decimals' in value && (
        <Row label="Casas decimais"><NumInput value={Number(value.decimals ?? 0)} min={0} max={4} onChange={(v) => upd({ decimals: Math.min(4, Math.max(0, v)) } as Partial<Widget>)} /></Row>
      )}
      {!hasUnit && !hasDecimals && <p className="text-[11px] text-slate-500">Este componente exibe estado, forma ou conteúdo sem formatação numérica.</p>}
      <p className="text-[10px] text-slate-500">A leitura ao vivo respeita o ponto selecionado e as unidades gravadas no widget.</p>
    </Section>
  );
}

function InspectorData({ widget, upd, devices, screen, screenOpts }: { widget: Widget; upd: (p: Partial<Widget>) => void; devices: ScreenDevice[]; screen: { projectId?: string; tenantId: string }; screenOpts: Opt[] }) {
  return (
    <>
      {!NO_UNIFIED_BINDING.has(widget.type) && (
        <PropertyCategory id="data-binding" title="Ponto vinculado" resetKey={widget.id}>
          <UnifiedBindingSection widget={widget} upd={upd} />
        </PropertyCategory>
      )}
      {NO_UNIFIED_BINDING.has(widget.type) && (
        <PropertyCategory id="data-command-binding" title="Ponto do controle" resetKey={widget.id}>
          <p className="px-4 pb-2 pt-1 text-[11px] text-slate-400">Este widget possui um seletor próprio para ponto comandável. A configuração completa fica na aba Estilo.</p>
        </PropertyCategory>
      )}
      <PropertyCategory id="data-format" title="Formato da leitura" resetKey={widget.id}>
        <InspectorFormat widget={widget} upd={upd} />
      </PropertyCategory>
      <PropertyCategory id="data-scope" title="Escopo e origem" resetKey={widget.id}>
        <Section title="Fonte da leitura" hideTitle>
          <p className="text-[11px] leading-relaxed text-slate-400">Equipamentos e pontos são filtrados pelo gateway da tela. O resumo abaixo acompanha a telemetria ao vivo sem alterar o vínculo salvo.</p>
          {!NO_UNIFIED_BINDING.has(widget.type) && <p className="font-mono text-[10px] text-slate-500">{readWidgetBinding(widget).tag || 'Sem ponto selecionado'}</p>}
        </Section>
      </PropertyCategory>
      {NO_UNIFIED_BINDING.has(widget.type) && (
        <PropertyCategory id="data-command-details" title="Configuração do controle" resetKey={widget.id}>
          <WidgetTypeSpecificProps widget={widget} upd={upd} devices={devices} screen={screen} screenOpts={screenOpts} mode="all" />
        </PropertyCategory>
      )}
    </>
  );
}

function InspectorInteraction({ widget, upd, devices, screen, screenOpts, components, onDeleteComponent }: {
  widget: Widget; upd: (p: Partial<Widget>) => void; devices: ScreenDevice[]; screen: { projectId?: string; tenantId: string }; screenOpts: Opt[]; components: SavedComponent[]; onDeleteComponent: (id: string) => void;
}) {
  return (
    <PropertyCategory id="interaction-settings" title="Ações e feedback" resetKey={widget.id}>
      {!CLICK_ACTION_EXCLUDED_TYPES.has(widget.type) && <ClickActionSection widget={widget} upd={upd} devices={devices} screenOpts={screenOpts} />}
      <StatusSection widget={widget} upd={upd} />
      <HoverSection widget={widget} upd={upd} />
      <PopupSection widget={widget} upd={upd} devices={devices} screen={screen} screenOpts={screenOpts} components={components} onDeleteComponent={onDeleteComponent} />
    </PropertyCategory>
  );
}

function InspectorRules({ widget, upd, devices, screen, screenOpts }: { widget: Widget; upd: (p: Partial<Widget>) => void; devices: ScreenDevice[]; screen: { projectId?: string; tenantId: string }; screenOpts: Opt[] }) {
  const hasValueRules = EQUIPMENT_TYPES.has(widget.type) || widget.type === 'line' || widget.type === 'pipe' || SHAPE_TYPES.has(widget.type);
  return (
    <>
      <PropertyCategory id="rules-value" title="Regras por valor" resetKey={widget.id}>
        {hasValueRules
          ? <WidgetTypeSpecificProps widget={widget} upd={upd} devices={devices} screen={screen} screenOpts={screenOpts} mode="rules" />
          : <Section title="Regras do componente" hideTitle><p className="text-[11px] text-slate-500">Este widget não possui regras de cor ou animação por ponto.</p></Section>}
      </PropertyCategory>
      <PropertyCategory id="rules-visibility" title="Visibilidade condicional" resetKey={widget.id}>
        <VisibilitySection widget={widget} onChange={upd} hideHeader />
      </PropertyCategory>
    </>
  );
}

function InspectorShell({ children, resetKey, widget, footerText, onRestore }: { children: React.ReactNode; resetKey: string; widget?: Widget; footerText?: string; onRestore?: () => void }) {
  const [tab, setTab] = useState<InspectorTabId>('general');
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const shellId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const counts = widget ? inspectorBadgeCounts(!NO_UNIFIED_BINDING.has(widget.type)) : { general: 1, data: 0, style: 0, interaction: 0, rules: 0 };

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (event.key === '/' && target && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', focusSearch, true);
    return () => window.removeEventListener('keydown', focusSearch, true);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    root.querySelectorAll<HTMLElement>('[data-inspector-panel]').forEach((panel) => {
      const panelName = panel.dataset.inspectorPanel as InspectorTabId;
      panel.hidden = panelName !== tab;
      panel.id = `scada-inspector-${shellId}-panel-${panelName}`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', `scada-inspector-${shellId}-tab-${panelName}`);
      panel.tabIndex = 0;
    });
    const query = search.trim().toLowerCase();
    const rows = Array.from(root.querySelectorAll<HTMLElement>('[data-inspector-row]'));
    rows.forEach((row) => { row.hidden = Boolean(query) && !row.dataset.inspectorRow!.toLowerCase().includes(query); });
    root.querySelectorAll<HTMLElement>('[data-inspector-section]').forEach((section) => {
      const title = section.dataset.inspectorSection?.toLowerCase() ?? '';
      const visibleRows = Array.from(section.querySelectorAll<HTMLElement>('[data-inspector-row]')).some((row) => !row.hidden);
      section.hidden = Boolean(query) && !title.includes(query) && !visibleRows;
    });
  }, [search, shellId, tab]);

  const jumpTab = (value: string) => {
    const target = resolveInspectorSearchTab(value);
    if (target) setTab(target);
  };

  const moveTabFocus = (event: React.KeyboardEvent<HTMLButtonElement>, current: InspectorTabId) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = INSPECTOR_TABS.findIndex((item) => item.id === current);
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? INSPECTOR_TABS.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + INSPECTOR_TABS.length) % INSPECTOR_TABS.length;
    const next = INSPECTOR_TABS[nextIndex].id;
    setTab(next);
    rootRef.current?.querySelector<HTMLButtonElement>(`#scada-inspector-${shellId}-tab-${next}`)?.focus();
  };

  return (
    <aside ref={rootRef} data-reset-key={resetKey} className="scada-inspector flex h-full w-[21rem] max-w-[38vw] min-w-0 flex-col overflow-hidden border-l border-slate-700/80 bg-[#101a2c] text-slate-200">
      <div className="shrink-0 border-b border-slate-700/80 px-3 pt-3">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" strokeWidth={1.5} />
          <input ref={searchRef} value={search} onChange={(e) => { setSearch(e.target.value); jumpTab(e.target.value); }} placeholder="Buscar propriedades..." aria-label="Buscar propriedades" className="h-9 w-full rounded-xl border border-slate-700 bg-[#07101e] pl-9 pr-9 text-xs text-slate-200 outline-none placeholder:text-slate-500 focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30" />
          <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-slate-700 px-1 py-0.5 text-[10px] text-slate-500">/</kbd>
        </label>
        <nav className="mt-2 flex items-end gap-1" aria-label="Abas do inspetor" role="tablist">
          {INSPECTOR_TABS.map((item) => (
            <button key={item.id} id={`scada-inspector-${shellId}-tab-${item.id}`} type="button" role="tab" aria-controls={`scada-inspector-${shellId}-panel-${item.id}`} tabIndex={tab === item.id ? 0 : -1} onKeyDown={(event) => moveTabFocus(event, item.id)} onClick={() => setTab(item.id)} className={`relative flex min-w-0 flex-1 items-center justify-center gap-1 px-1 py-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400 ${tab === item.id ? 'text-cyan-400' : 'text-slate-500 hover:text-slate-300'}`} aria-selected={tab === item.id}>
              {item.label}<span className="text-[10px] text-slate-500">{counts[item.id]}</span>
              {tab === item.id && <span className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-cyan-400" />}
            </button>
          ))}
        </nav>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" data-inspector-tab={tab}>
        {children}
      </div>
      <footer className="flex shrink-0 items-center gap-2 border-t border-slate-700/80 bg-[#0d1727] px-3 py-2">
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-slate-500">
          <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {footerText ?? 'nenhum ponto vinculado'}
        </span>
        {onRestore && <button type="button" onClick={onRestore} className="shrink-0 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-[10px] text-slate-400 transition-colors hover:border-cyan-500/60 hover:text-cyan-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-400">Restaurar padrões</button>}
      </footer>
    </aside>
  );
}

function restoreWidgetDefaults(widget: Widget, upd: (patch: Partial<Widget>) => void, addToast: (kind: 'success' | 'error' | 'info', text: string) => void) {
  upd(buildRestoredWidget(widget));
  addToast('success', 'Padrões restaurados; posição, camada e vínculo foram preservados.');
}

/**
 * Propriedades compartilhadas por telas e composições locais. O editor de
 * popup usa este bloco para manter bindings, comandos, estados e aparência em
 * sincronia com a paleta principal, mas não renderiza a seção de popup: uma
 * composição local nunca pode hospedar outra composição local.
 */
export function PopupWidgetProperties({
  widget, upd, devices, screen, screenOpts, resetKey,
}: {
  widget: Widget;
  upd: (patch: Partial<Widget>) => void;
  devices: ScreenDevice[];
  screen: { projectId?: string; tenantId: string };
  screenOpts: Opt[];
  resetKey?: string;
}) {
  return (
    <InspectorShell key={resetKey ?? widget.id} resetKey={resetKey ?? widget.id} widget={widget} footerText={readWidgetBinding(widget).tag || 'nenhum ponto vinculado'}>
      <div data-inspector-panel="general"><InspectorGeneral widget={widget} upd={upd} /></div>
      <div data-inspector-panel="data"><InspectorData widget={widget} upd={upd} devices={devices} screen={screen} screenOpts={screenOpts} /></div>
      <div data-inspector-panel="style">
        <PropertyCategory id="popup-style" title="Estilo" resetKey={resetKey ?? widget.id}>
          {!NO_TYPE_SPECIFIC_PROPS.has(widget.type) && <WidgetTypeSpecificProps widget={widget} upd={upd} devices={devices} screen={screen} screenOpts={screenOpts} mode="style" />}
        </PropertyCategory>
      </div>
      <div data-inspector-panel="interaction"><InspectorInteraction widget={widget} upd={upd} devices={devices} screen={screen} screenOpts={screenOpts} components={[]} onDeleteComponent={() => {}} /></div>
      <div data-inspector-panel="rules"><InspectorRules widget={widget} upd={upd} devices={devices} screen={screen} screenOpts={screenOpts} /></div>
    </InspectorShell>
  );
}

export function PropertiesPanel() {
  const { screen, selectedIds, updateWidget, updateComponentChild, moveWidgets, showProperties, components, deleteComponent, addToast } = useEditorStore();

  // Dados reais para bindings e navegação (escopados ao projeto da tela).
  const { devices } = useScreenDevices(screen?.projectId, screen?.tenantId);
  const { data: projectScreens = [] } = useQuery({
    queryKey: ['scada-screens', 'project', screen?.projectId ?? null],
    queryFn: () => getScreens({ projectId: screen?.projectId }),
    enabled: Boolean(screen?.projectId),
  });
  const screenOpts: Opt[] = [
    { value: '', label: '— selecionar —' },
    ...projectScreens.map((s) => ({ value: s.id, label: s.name })),
  ];

  if (!showProperties || !screen || selectedIds.length === 0) return null;

  // Multi-seleção: painel de alinhamento/distribuição em vez das props de um widget.
  if (selectedIds.length > 1) {
    const selectedWidgets = screen.widgets.filter((w) => selectedIds.includes(w.id));
    return (
      <InspectorShell key={selectedIds.join(':')} resetKey={selectedIds.join(':')} footerText={`${selectedWidgets.length} componentes selecionados`}>
        <div data-inspector-panel="general">
          <PropertyCategory id="multi-layout" title="Posição e tamanho" resetKey={selectedIds.join(':')}>
            <AlignmentSection widgets={selectedWidgets} moveWidgets={moveWidgets} />
          </PropertyCategory>
        </div>
        <div data-inspector-panel="data"><Section title="Dados"><p className="text-[11px] text-slate-500">Vínculos são editados individualmente para evitar alterar pontos distintos por engano.</p></Section></div>
        <div data-inspector-panel="style"><Section title="Estilo"><p className="text-[11px] text-slate-500">Selecione um componente para editar propriedades de aparência específicas.</p></Section></div>
        <div data-inspector-panel="interaction"><Section title="Interação"><p className="text-[11px] text-slate-500">Ações e popups permanecem independentes em cada componente.</p></Section></div>
        <div data-inspector-panel="rules"><Section title="Regras"><p className="text-[11px] text-slate-500">Regras condicionais permanecem independentes em cada componente.</p></Section></div>
      </InspectorShell>
    );
  }

  const id = selectedIds[0];
  const widget = screen.widgets.find((w) => w.id === id);
  if (!widget) return null;

  const upd = (patch: Partial<Widget>) => updateWidget(id, patch);
  const binding = readWidgetBinding(widget);
  const boundDevice = devices.find((device) => device.id === binding.deviceId);

  return (
    <InspectorShell
      key={widget.id}
      resetKey={widget.id}
      widget={widget}
      footerText={binding.tag ? `ponto vinculado · ${boundDevice?.name ?? binding.deviceId} · ${binding.tag}` : 'nenhum ponto vinculado'}
      onRestore={widget.type === 'component-instance' ? undefined : () => restoreWidgetDefaults(widget, upd, addToast)}
    >
      <div data-inspector-panel="general">
        <InspectorGeneral widget={widget} upd={upd} />
      </div>
      <div data-inspector-panel="data">
        {widget.type === 'component-instance' ? (
          <PropertyCategory id="component-elements" title={`Elementos internos (${widget.children.length})`} resetKey={widget.id}>
            <Section title="Instância e elementos" hideTitle>
              <p className="text-[11px] text-slate-500">Os elementos internos mantêm os próprios vínculos e configurações. Abra um item para editar sem alterar sua geometria relativa.</p>
              {widget.children.map((child, index) => {
                const childUpd = (patch: Partial<Widget>) => updateComponentChild(widget.id, child.id, patch);
                return (
                  <details key={child.id} className="rounded-lg border border-slate-700 bg-slate-950/40">
                    <summary className="cursor-pointer px-3 py-2 text-xs text-slate-300">{index + 1}. {widgetDisplayName(child)}</summary>
                    <div className="border-t border-slate-700">
                      {!NO_UNIFIED_BINDING.has(child.type) && <UnifiedBindingSection widget={child} upd={childUpd} />}
                      {!NO_TYPE_SPECIFIC_PROPS.has(child.type) && <WidgetTypeSpecificProps widget={child} upd={childUpd} devices={devices} screen={screen} screenOpts={screenOpts} />}
                      {!CLICK_ACTION_EXCLUDED_TYPES.has(child.type) && <ClickActionSection widget={child} upd={childUpd} devices={devices} screenOpts={screenOpts} />}
                      <StatusSection widget={child} upd={childUpd} />
                      <HoverSection widget={child} upd={childUpd} />
                      <PopupSection widget={child} upd={childUpd} devices={devices} screen={screen} screenOpts={screenOpts} components={components} onDeleteComponent={deleteComponent} />
                      <VisibilitySection widget={child} onChange={childUpd} />
                    </div>
                  </details>
                );
              })}
            </Section>
          </PropertyCategory>
        ) : <InspectorData widget={widget} upd={upd} devices={devices} screen={screen} screenOpts={screenOpts} />}
      </div>
      <div data-inspector-panel="style">
        <PropertyCategory id="style-content" title={widget.type === 'component-instance' ? 'Estilo da instância' : 'Ícone, rótulo e aparência'} resetKey={widget.id}>
          {widget.type === 'component-instance' ? (
            <Section title="Aparência da instância" hideTitle>
              <Row label="Opacidade"><input type="range" min={0} max={1} step={0.05} value={widget.opacity} onChange={(e) => upd({ opacity: Number(e.target.value) })} className="w-full accent-cyan-400" /></Row>
            </Section>
          ) : !NO_TYPE_SPECIFIC_PROPS.has(widget.type) ? (
            <WidgetTypeSpecificProps
              widget={widget}
              upd={upd}
              devices={devices}
              screen={screen}
              screenOpts={screenOpts}
              mode="style"
              canPin={Boolean(screen.projectId)}
              unpinSiblings={() => {
                screen.widgets
                  .filter((other) => other.type === widget.type && other.id !== widget.id && 'pinnedToProject' in other && other.pinnedToProject)
                  .forEach((other) => updateWidget(other.id, { pinnedToProject: false }));
              }}
            />
          ) : <Section title="Aparência" hideTitle><p className="text-[11px] text-slate-500">Este componente não possui propriedades visuais adicionais.</p></Section>}
        </PropertyCategory>
      </div>
      <div data-inspector-panel="interaction">
        {widget.type === 'component-instance'
          ? <Section title="Interação"><p className="text-[11px] text-slate-500">As ações pertencem aos elementos internos do componente.</p></Section>
          : <InspectorInteraction widget={widget} upd={upd} devices={devices} screen={screen} screenOpts={screenOpts} components={components} onDeleteComponent={deleteComponent} />}
      </div>
      <div data-inspector-panel="rules">
        {widget.type === 'component-instance'
          ? <PropertyCategory id="component-visibility" title="Visibilidade condicional" resetKey={widget.id}><VisibilitySection widget={widget} onChange={upd} hideHeader /></PropertyCategory>
          : <InspectorRules widget={widget} upd={upd} devices={devices} screen={screen} screenOpts={screenOpts} />}
      </div>
    </InspectorShell>
  );
}

// ─── Widgets de controle de clima ────────────────────────────────────────────

/** Estilo compartilhado dos widgets/cards de clima (fundo/texto/borda/raio + acento). */
function ClimateStyleRows({ w, upd }: { w: DashCardBase & { accentColor?: string }; upd: (p: Partial<Widget>) => void }) {
  return (
    <Section title="Estilo do cartão">
      {w.accentColor !== undefined && <Row label="Cor de acento"><ColorInput value={w.accentColor} onChange={(v) => upd({ accentColor: v } as Partial<Widget>)} /></Row>}
      <Row label="Fundo"><FillColorInput value={w.backgroundColor} onChange={(v) => upd({ backgroundColor: v } as Partial<Widget>)} /></Row>
      <Row label="Texto"><ColorInput value={w.textColor} onChange={(v) => upd({ textColor: v } as Partial<Widget>)} /></Row>
      <Row label="Texto secundário"><ColorInput value={w.mutedColor} onChange={(v) => upd({ mutedColor: v } as Partial<Widget>)} /></Row>
      <Row label="Borda"><ColorInput value={w.borderColor} onChange={(v) => upd({ borderColor: v } as Partial<Widget>)} /></Row>
      <Row label="Raio da borda"><NumInput value={w.borderRadius} onChange={(v) => upd({ borderRadius: Math.max(0, v) } as Partial<Widget>)} min={0} max={32} /></Row>
    </Section>
  );
}

/** Cabeçalho comum dos cards de clima: título/subtítulo + ponto e regras de status. */
function ClimateHeaderSection({ w, upd, devices }: { w: EquipmentCardWidget | ClimateCardWidget; upd: (p: Partial<Widget>) => void; devices: ScreenDevice[] }) {
  return (
    <Section title="Cabeçalho">
      <Row label="Título"><TextInput value={w.title} onChange={(v) => upd({ title: v })} /></Row>
      <Row label="Subtítulo"><TextInput value={w.subtitle} onChange={(v) => upd({ subtitle: v })} /></Row>
      <Row label="Equipamento (status)"><SelectInput value={w.statusDeviceId} onChange={(v) => upd({ statusDeviceId: v, statusTag: '' })} options={deviceOptions(devices)} /></Row>
      <Row label="Ponto (status)"><SelectInput value={w.statusTag} onChange={(v) => upd({ statusTag: v })} options={tagOptions(devices, w.statusDeviceId)} /></Row>
      <p className="pt-1 text-[10px] text-slate-500">Regras (valor → cor / texto da pill)</p>
      <StateRulesEditor rules={w.statusRules} onChange={(rules) => upd({ statusRules: rules })} showText />
    </Section>
  );
}

function ValueStepperProps({ w, upd, devices }: { w: ValueStepperWidget; upd: (p: Partial<Widget>) => void; devices: ScreenDevice[] }) {
  return (
    <>
      <Section title="Ponto comandável (analógico)">
        <Row label="Equipamento"><SelectInput value={w.deviceId} onChange={(v) => upd({ deviceId: v, tag: '' })} options={writableDeviceOptions(devices, true)} /></Row>
        <Row label="Ponto (analógico)"><SelectInput value={sanitizeCommandTag(devices, w.deviceId, w.tag, true)} onChange={(v) => upd({ tag: v })} options={writableTagOptions(devices, w.deviceId, true)} /></Row>
        <CommandPointNotes devices={devices} deviceId={w.deviceId} savedTag={w.tag} analogOnly />
      </Section>
      <Section title="Comando">
        <div className="grid grid-cols-3 gap-2">
          <Row label="Mín"><NumInput value={w.minValue} onChange={(v) => upd({ minValue: v })} /></Row>
          <Row label="Máx"><NumInput value={w.maxValue} onChange={(v) => upd({ maxValue: v })} /></Row>
          <Row label="Passo"><NumInput value={w.step} onChange={(v) => upd({ step: Math.max(0, v) })} min={0} /></Row>
        </div>
        {isBacnetDevice(devices, w.deviceId) && (
          <Row label="Prioridade (1–16)"><NumInput value={w.priority} onChange={(v) => upd({ priority: Math.min(16, Math.max(1, v)) })} min={1} max={16} /></Row>
        )}
      </Section>
      <Section title="Aparência">
        <div className="grid grid-cols-2 gap-2">
          <Row label="Unidade"><TextInput value={w.unit} onChange={(v) => upd({ unit: v })} /></Row>
          <Row label="Casas decimais"><NumInput value={w.decimals} onChange={(v) => upd({ decimals: Math.min(4, Math.max(0, v)) })} min={0} max={4} /></Row>
        </div>
        <Row label="Tamanho do valor"><NumInput value={w.valueFontSize} onChange={(v) => upd({ valueFontSize: Math.max(12, v) })} min={12} max={48} /></Row>
        <Row label="Fundo"><FillColorInput value={w.backgroundColor} onChange={(v) => upd({ backgroundColor: v })} /></Row>
        <Row label="Fundo dos botões"><ColorInput value={w.buttonColor} onChange={(v) => upd({ buttonColor: v })} /></Row>
        <Row label="Texto"><ColorInput value={w.textColor} onChange={(v) => upd({ textColor: v })} /></Row>
        <Row label="Texto secundário"><ColorInput value={w.mutedColor} onChange={(v) => upd({ mutedColor: v })} /></Row>
        <Row label="Borda"><ColorInput value={w.borderColor} onChange={(v) => upd({ borderColor: v })} /></Row>
        <Row label="Cor de acento"><ColorInput value={w.accentColor} onChange={(v) => upd({ accentColor: v })} /></Row>
        <Row label="Raio da borda"><NumInput value={w.borderRadius} onChange={(v) => upd({ borderRadius: Math.max(0, v) })} min={0} max={32} /></Row>
      </Section>
    </>
  );
}

function SetpointRingProps({ w, upd }: { w: SetpointRingWidget; upd: (p: Partial<Widget>) => void }) {
  return (
    <>
      <Section title="Anel de setpoint">
        <div className="grid grid-cols-2 gap-2">
          <Row label="Mín"><NumInput value={w.minValue} onChange={(v) => upd({ minValue: v })} /></Row>
          <Row label="Máx"><NumInput value={w.maxValue} onChange={(v) => upd({ maxValue: v })} /></Row>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Row label="Unidade"><TextInput value={w.unit} onChange={(v) => upd({ unit: v })} /></Row>
          <Row label="Casas decimais"><NumInput value={w.decimals} onChange={(v) => upd({ decimals: Math.min(4, Math.max(0, v)) })} min={0} max={4} /></Row>
        </div>
        <Row label="Rótulo"><TextInput value={w.label} onChange={(v) => upd({ label: v })} placeholder="ex.: AMBIENTE" /></Row>
        <ToggleRow label="Mostrar rótulo" value={w.showLabel} onChange={(v) => upd({ showLabel: v })} />
      </Section>
      <Section title="Aparência">
        <Row label="Cor do anel"><ColorInput value={w.ringColor} onChange={(v) => upd({ ringColor: v })} /></Row>
        <Row label="Cor da trilha"><ColorInput value={w.trackColor} onChange={(v) => upd({ trackColor: v })} /></Row>
        <Row label="Texto"><ColorInput value={w.textColor} onChange={(v) => upd({ textColor: v })} /></Row>
        <Row label="Texto secundário"><ColorInput value={w.mutedColor} onChange={(v) => upd({ mutedColor: v })} /></Row>
        <Row label="Fundo"><FillColorInput value={w.backgroundColor} onChange={(v) => upd({ backgroundColor: v })} /></Row>
        <Row label="Raio da borda"><NumInput value={w.borderRadius} onChange={(v) => upd({ borderRadius: Math.max(0, v) })} min={0} max={32} /></Row>
      </Section>
    </>
  );
}

const ROW_DISPLAY_OPTS: Opt[] = [
  { value: 'value', label: 'Valor ao vivo' },
  { value: 'toggle', label: 'Toggle (digital comandável)' },
  { value: 'slider', label: 'Slider (analógico comandável)' },
];

function EquipmentCardProps({ w, upd, devices }: { w: EquipmentCardWidget; upd: (p: Partial<Widget>) => void; devices: ScreenDevice[] }) {
  function setRow(id: string, patch: Partial<EquipmentCardRow>) {
    upd({ rows: w.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
  }
  function addRow() {
    const row: EquipmentCardRow = {
      id: nanoid(6), deviceId: '', tag: '', iconName: 'thermometer', label: '', subtitle: '',
      display: 'value', unit: '', decimals: 1, valueColor: '',
      onValue: 1, offValue: 0, minValue: 0, maxValue: 100, step: 1,
    };
    upd({ rows: [...w.rows, row] });
  }
  return (
    <>
      <ClimateHeaderSection w={w} upd={upd} devices={devices} />
      <Section title={`Linhas de pontos (${w.rows.length})`}>
        {w.rows.map((r, i) => {
          const writable = r.display !== 'value';
          const analog = r.display === 'slider';
          return (
            <div key={r.id} className="rounded border border-slate-700 p-2 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-slate-400">Linha {i + 1}</span>
                <button type="button" onClick={() => upd({ rows: w.rows.filter((x) => x.id !== r.id) })} className="rounded p-0.5 text-slate-500 hover:text-red-400"><Trash2 className="h-3 w-3" /></button>
              </div>
              <Row label="Exibição"><SelectInput value={r.display} onChange={(v) => setRow(r.id, { display: v as EquipmentCardRowDisplay, deviceId: '', tag: '' })} options={ROW_DISPLAY_OPTS} /></Row>
              <Row label="Equipamento"><SelectInput value={r.deviceId} onChange={(v) => setRow(r.id, { deviceId: v, tag: '' })} options={writable ? writableDeviceOptions(devices, analog) : deviceOptions(devices)} /></Row>
              <Row label="Ponto"><SelectInput value={writable ? sanitizeCommandTag(devices, r.deviceId, r.tag, analog) : r.tag} onChange={(v) => setRow(r.id, { tag: v })} options={writable ? writableTagOptions(devices, r.deviceId, analog) : tagOptions(devices, r.deviceId)} /></Row>
              <div className="grid grid-cols-2 gap-2">
                <Row label="Nome"><TextInput value={r.label} onChange={(v) => setRow(r.id, { label: v })} /></Row>
                <Row label="Subtítulo"><TextInput value={r.subtitle} onChange={(v) => setRow(r.id, { subtitle: v })} /></Row>
              </div>
              <Row label="Ícone"><IconPicker value={r.iconName} onChange={(p) => setRow(r.id, { iconName: (p as { iconName?: string }).iconName ?? '' })} allowNone /></Row>
              {r.display === 'value' && (
                <div className="grid grid-cols-2 gap-2">
                  <Row label="Unidade"><TextInput value={r.unit} onChange={(v) => setRow(r.id, { unit: v })} /></Row>
                  <Row label="Casas decimais"><NumInput value={r.decimals} onChange={(v) => setRow(r.id, { decimals: Math.min(4, Math.max(0, v)) })} min={0} max={4} /></Row>
                </div>
              )}
              {r.display === 'toggle' && (
                <div className="grid grid-cols-2 gap-2">
                  <Row label="Valor ligado"><NumInput value={r.onValue} onChange={(v) => setRow(r.id, { onValue: v })} /></Row>
                  <Row label="Valor desligado"><NumInput value={r.offValue} onChange={(v) => setRow(r.id, { offValue: v })} /></Row>
                </div>
              )}
              {r.display === 'slider' && (
                <div className="grid grid-cols-3 gap-2">
                  <Row label="Mín"><NumInput value={r.minValue} onChange={(v) => setRow(r.id, { minValue: v })} /></Row>
                  <Row label="Máx"><NumInput value={r.maxValue} onChange={(v) => setRow(r.id, { maxValue: v })} /></Row>
                  <Row label="Passo"><NumInput value={r.step} onChange={(v) => setRow(r.id, { step: Math.max(0, v) })} min={0} /></Row>
                </div>
              )}
              <Row label="Cor da linha (vazio = acento)"><ColorInput value={r.valueColor || w.accentColor} onChange={(v) => setRow(r.id, { valueColor: v })} /></Row>
            </div>
          );
        })}
        <button type="button" onClick={addRow} className="w-full rounded border border-dashed border-slate-600 py-1.5 text-[11px] text-slate-400 hover:border-cyan-500 hover:text-cyan-400">
          + Adicionar linha
        </button>
        {w.rows.some((r) => r.display !== 'value') && isBacnetDevice(devices, w.rows.find((r) => r.display !== 'value')?.deviceId ?? '') && (
          <Row label="Prioridade (1–16)"><NumInput value={w.priority} onChange={(v) => upd({ priority: Math.min(16, Math.max(1, v)) })} min={1} max={16} /></Row>
        )}
      </Section>
      <ClimateStyleRows w={w} upd={upd} />
    </>
  );
}

function ClimateCardProps({ w, upd, devices }: { w: ClimateCardWidget; upd: (p: Partial<Widget>) => void; devices: ScreenDevice[] }) {
  return (
    <>
      <ClimateHeaderSection w={w} upd={upd} devices={devices} />
      <Section title="Leitura principal">
        <Row label="Equipamento"><SelectInput value={w.readingDeviceId} onChange={(v) => upd({ readingDeviceId: v, readingTag: '' })} options={deviceOptions(devices)} /></Row>
        <Row label="Ponto"><SelectInput value={w.readingTag} onChange={(v) => upd({ readingTag: v })} options={tagOptions(devices, w.readingDeviceId)} /></Row>
        <Row label="Rótulo"><TextInput value={w.readingLabel} onChange={(v) => upd({ readingLabel: v })} /></Row>
        <div className="grid grid-cols-2 gap-2">
          <Row label="Unidade"><TextInput value={w.readingUnit} onChange={(v) => upd({ readingUnit: v })} /></Row>
          <Row label="Casas decimais"><NumInput value={w.readingDecimals} onChange={(v) => upd({ readingDecimals: Math.min(4, Math.max(0, v)) })} min={0} max={4} /></Row>
        </div>
        <ToggleRow label="Mostrar sparkline" value={w.showSparkline} onChange={(v) => upd({ showSparkline: v })} />
        {w.showSparkline && (
          <>
            <Row label="Cor da sparkline"><ColorInput value={w.sparkColor} onChange={(v) => upd({ sparkColor: v })} /></Row>
            <Row label="Período"><SelectInput value={String(w.periodHours)} onChange={(v) => upd({ periodHours: Number(v) as DashPeriodHours })} options={PERIOD_OPTS} /></Row>
            <p className="text-[10px] text-slate-500">O histórico vem das trends do ponto — crie uma trend para a sparkline aparecer.</p>
          </>
        )}
      </Section>
      <Section title="Setpoint (analógico comandável)">
        <Row label="Equipamento"><SelectInput value={w.setpointDeviceId} onChange={(v) => upd({ setpointDeviceId: v, setpointTag: '' })} options={writableDeviceOptions(devices, true)} /></Row>
        <Row label="Ponto (analógico)"><SelectInput value={sanitizeCommandTag(devices, w.setpointDeviceId, w.setpointTag, true)} onChange={(v) => upd({ setpointTag: v })} options={writableTagOptions(devices, w.setpointDeviceId, true)} /></Row>
        <Row label="Rótulo"><TextInput value={w.setpointLabel} onChange={(v) => upd({ setpointLabel: v })} /></Row>
        <div className="grid grid-cols-3 gap-2">
          <Row label="Mín"><NumInput value={w.minValue} onChange={(v) => upd({ minValue: v })} /></Row>
          <Row label="Máx"><NumInput value={w.maxValue} onChange={(v) => upd({ maxValue: v })} /></Row>
          <Row label="Passo"><NumInput value={w.step} onChange={(v) => upd({ step: Math.max(0, v) })} min={0} /></Row>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Row label="Unidade"><TextInput value={w.setpointUnit} onChange={(v) => upd({ setpointUnit: v })} /></Row>
          <Row label="Casas decimais"><NumInput value={w.setpointDecimals} onChange={(v) => upd({ setpointDecimals: Math.min(4, Math.max(0, v)) })} min={0} max={4} /></Row>
        </div>
      </Section>
      <Section title="Liga/desliga (digital comandável)">
        <Row label="Equipamento"><SelectInput value={w.powerDeviceId} onChange={(v) => upd({ powerDeviceId: v, powerTag: '' })} options={writableDeviceOptions(devices)} /></Row>
        <Row label="Ponto"><SelectInput value={sanitizeCommandTag(devices, w.powerDeviceId, w.powerTag)} onChange={(v) => upd({ powerTag: v })} options={writableTagOptions(devices, w.powerDeviceId)} /></Row>
        <div className="grid grid-cols-2 gap-2">
          <Row label="Valor ligado"><NumInput value={w.onValue} onChange={(v) => upd({ onValue: v })} /></Row>
          <Row label="Valor desligado"><NumInput value={w.offValue} onChange={(v) => upd({ offValue: v })} /></Row>
        </div>
        <ToggleRow label="Pedir confirmação" value={w.powerConfirm} onChange={(v) => upd({ powerConfirm: v })} />
        {(isBacnetDevice(devices, w.setpointDeviceId) || isBacnetDevice(devices, w.powerDeviceId)) && (
          <Row label="Prioridade (1–16)"><NumInput value={w.priority} onChange={(v) => upd({ priority: Math.min(16, Math.max(1, v)) })} min={1} max={16} /></Row>
        )}
      </Section>
      <Section title="Rodapé">
        <Row label="Texto de origem"><TextInput value={w.footerText} onChange={(v) => upd({ footerText: v })} placeholder="ex.: MQTT · aeris/008065" /></Row>
      </Section>
      <ClimateStyleRows w={w} upd={upd} />
    </>
  );
}
