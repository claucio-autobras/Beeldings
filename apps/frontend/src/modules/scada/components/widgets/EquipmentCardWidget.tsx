'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { EquipmentCardWidget, EquipmentCardRow } from '../../types/scada.types';
import { toScadaNumber } from '../../types/scada.types';
import type { SendCommand } from '../../hooks/useScreenCommand';
import type { PointStatus } from '../../hooks/useScreenTelemetry';
import { dashCardStyle, NoData, withAlpha } from './dashCard';
import { SCADA_ICONS } from './scadaIcons';
import { ClimateCardHeader, resolveHeaderStatus, fmtClimateValue } from './climateCard';
import { useEditorStore } from '../../store/editor.store';

interface Props {
  widget: EquipmentCardWidget;
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  getTagStatus?: (deviceId: string, tag: string) => PointStatus;
  onCommand?: SendCommand;
  isEditor?: boolean;
  staticRender?: boolean;
}

/** Ícone da linha em quadradinho arredondado (estilo da referência). */
function RowIcon({ name, color }: { name: string; color: string }) {
  const def = SCADA_ICONS[name];
  const Icon = def?.Icon;
  return (
    <span style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      width: 30, height: 30, borderRadius: 8,
      backgroundColor: withAlpha(color, 0.12),
      color,
    }}>
      {Icon ? <Icon size={16} strokeWidth={1.8} /> : <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: color }} />}
    </span>
  );
}

/**
 * Card compacto de equipamento — cabeçalho (nome + pill de status + indicador)
 * e linhas de pontos com ícone/nome/subtítulo e, à direita, valor ao vivo,
 * toggle (digital comandável) ou slider (analógico comandável). Multi-ponto:
 * fora do binding unificado, cada linha resolve o próprio ponto; comandos
 * usam o fluxo otimista compartilhado e ficam bloqueados sem comunicação.
 */
export function EquipmentCardWidgetView({ widget: w, getValue, getTagStatus, onCommand, isEditor, staticRender }: Props) {
  const [sendingRow, setSendingRow] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, number>>({});

  const status = resolveHeaderStatus(w.statusRules, w.statusDeviceId, w.statusTag, getValue, Boolean(staticRender));

  function rowOffline(r: EquipmentCardRow): boolean {
    if (staticRender || isEditor || !getTagStatus || !r.deviceId || !r.tag) return false;
    return getTagStatus(r.deviceId, r.tag) !== 'live';
  }

  async function send(r: EquipmentCardRow, value: number): Promise<void> {
    if (isEditor || staticRender || !onCommand || !r.deviceId || !r.tag || sendingRow) return;
    if (rowOffline(r)) {
      useEditorStore.getState().addToast('error', 'Ponto sem comunicação — comando bloqueado');
      return;
    }
    setSendingRow(r.id);
    const res = await onCommand(r.deviceId, r.tag, value, w.priority);
    setSendingRow(null);
    if (!res.ok) useEditorStore.getState().addToast('error', res.error ?? 'Falha ao enviar comando');
  }

  function rowRight(r: EquipmentCardRow): React.ReactNode {
    const accent = r.valueColor || w.accentColor;
    const bound = Boolean(r.deviceId && r.tag);
    const raw = staticRender || !bound ? null : getValue(r.deviceId, r.tag);
    const offline = rowOffline(r);

    if (r.display === 'toggle') {
      const num = raw === null ? NaN : toScadaNumber(raw);
      // Estático: aparência de projeto (ligado) para mostrar a cor escolhida.
      const isOn = staticRender ? true : !Number.isNaN(num) && num !== r.offValue;
      const noData = !staticRender && (raw === null || Number.isNaN(num));
      const disabled = isEditor || staticRender || !bound || offline || noData || sendingRow === r.id;
      const trackW = 40, trackH = 22, knob = trackH - 5;
      return (
        <button
          type="button"
          disabled={disabled}
          onClick={() => void send(r, isOn ? r.offValue : r.onValue)}
          title={offline ? 'Sem comunicação — comando bloqueado' : noData ? 'Sem dados' : r.tag}
          style={{
            position: 'relative', flexShrink: 0, width: trackW, height: trackH, borderRadius: trackH / 2,
            backgroundColor: noData ? '#334155' : isOn ? accent : '#334155',
            border: '1px solid rgba(255,255,255,0.1)', padding: 0,
            cursor: disabled ? 'default' : 'pointer',
            boxShadow: isOn && !noData ? `0 0 8px ${withAlpha(accent, 0.4)}` : undefined,
            transition: 'background-color 180ms',
            opacity: noData ? 0.6 : 1,
          }}
        >
          <span style={{
            position: 'absolute', top: '50%', transform: 'translateY(-50%)',
            left: isOn ? trackW - knob - 3 : 2,
            width: knob, height: knob, borderRadius: '50%', backgroundColor: '#FFFFFF',
            boxShadow: '0 1px 2px rgba(0,0,0,0.4)', transition: 'left 180ms ease',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {sendingRow === r.id && <Loader2 className="animate-spin" style={{ width: 11, height: 11, color: '#64748B' }} strokeWidth={2} />}
          </span>
        </button>
      );
    }

    // 'value' (e o número do slider — o slider em si vai na segunda linha)
    const text = staticRender ? '––' : fmtClimateValue(raw, r.decimals);
    if (text === null) return <NoData color={w.mutedColor} compact />;
    return (
      <span style={{ display: 'flex', alignItems: 'baseline', gap: 3, flexShrink: 0 }}>
        <span style={{ fontSize: 16, fontWeight: 700, fontFamily: 'Roboto Mono, monospace', fontVariantNumeric: 'tabular-nums', color: accent }}>
          {sendingRow === r.id ? '…' : text}
        </span>
        {r.unit && <span style={{ fontSize: 10, fontWeight: 600, color: w.mutedColor }}>{r.unit}</span>}
      </span>
    );
  }

  return (
    <div style={{ ...dashCardStyle(w), padding: '12px 14px', gap: 10 }}>
      <ClimateCardHeader title={w.title} subtitle={w.subtitle} status={status} textColor={w.textColor} mutedColor={w.mutedColor} />
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {w.rows.length === 0 && (
          <span style={{ fontSize: 10, fontStyle: 'italic', color: w.mutedColor }}>adicione linhas de pontos nas propriedades</span>
        )}
        {w.rows.map((r) => {
          const accent = r.valueColor || w.accentColor;
          const bound = Boolean(r.deviceId && r.tag);
          const isSlider = r.display === 'slider';
          const raw = staticRender || !bound ? null : getValue(r.deviceId, r.tag);
          const num = raw === null ? NaN : toScadaNumber(raw);
          const live = Number.isNaN(num) ? null : num;
          const cur = draft[r.id] ?? (staticRender ? (r.minValue + r.maxValue) / 2 : live ?? r.minValue);
          const clamped = Math.min(r.maxValue, Math.max(r.minValue, cur));
          const pct = r.maxValue > r.minValue ? ((clamped - r.minValue) / (r.maxValue - r.minValue)) * 100 : 0;
          const sliderDisabled = isEditor || staticRender || !bound || rowOffline(r) || live === null;
          return (
            <div key={r.id} style={{
              display: 'flex', flexDirection: 'column', gap: 6,
              padding: '8px 10px', borderRadius: 10,
              backgroundColor: withAlpha('#94A3B8', 0.06),
              border: `1px solid ${w.borderColor}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {r.iconName && <RowIcon name={r.iconName} color={accent} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: w.textColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label || r.tag || '—'}</div>
                  {r.subtitle && <div style={{ fontSize: 9, color: w.mutedColor, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.subtitle}</div>}
                </div>
                {rowRight(r)}
              </div>
              {isSlider && (
                <input
                  type="range"
                  min={r.minValue} max={r.maxValue} step={r.step || 1}
                  value={clamped}
                  disabled={sliderDisabled}
                  onChange={(e) => setDraft((d) => ({ ...d, [r.id]: Number(e.target.value) }))}
                  onPointerUp={() => { const v = draft[r.id]; if (!isEditor && v !== undefined) { void send(r, v); setDraft((d) => { const n = { ...d }; delete n[r.id]; return n; }); } }}
                  onKeyUp={() => { const v = draft[r.id]; if (!isEditor && v !== undefined) { void send(r, v); setDraft((d) => { const n = { ...d }; delete n[r.id]; return n; }); } }}
                  style={{
                    width: '100%', accentColor: accent, height: 4, borderRadius: 4,
                    appearance: 'none', WebkitAppearance: 'none',
                    background: `linear-gradient(to right, ${accent} ${pct}%, rgba(148,163,184,0.25) ${pct}%)`,
                    cursor: sliderDisabled ? 'default' : 'pointer',
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
