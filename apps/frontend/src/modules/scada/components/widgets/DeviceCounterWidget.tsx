'use client';

import { useState } from 'react';
import { createPortal } from 'react-dom';
import { MonitorSmartphone, X } from 'lucide-react';
import { useMemo } from 'react';
import type { DeviceCounterWidget } from '../../types/scada.types';
import { scadaBackgroundStyle } from '../../types/scada.types';
import type { PointStatus } from '../../hooks/useScreenTelemetry';
import type { ScreenDevice } from '../../types/virtual.types';
import { isCameraDevice } from '../../types/virtual.types';
import { countDevices, formatCount, listCounterPoints, type CountState } from './deviceCounterLogic';
import { cameraHealthFromReader } from '@/modules/cftv/utils/telemetry-format';
import { usePortalContainer } from '../../hooks/usePortalContainer';

// Lógica pura de contagem (testável sem React) vive em deviceCounterLogic.ts.
export { countDevices, countPoints, eligibleDevices, type DeviceCounterResult } from './deviceCounterLogic';

interface Props {
  widget: DeviceCounterWidget;
  devices: ScreenDevice[];
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  getTagStatus?: (deviceId: string, tag: string) => PointStatus;
  /**
   * Leitura completa (valor + timestamp) de um ponto. Quando fornecida, o modo
   * 'connectivity' usa o critério canônico CFTV para câmeras: STATUS + gateway
   * liveness + frescor de 5 min (em vez do valor bruto do STATUS).
   */
  getTagReading?: (deviceId: string, tag: string) => { value: number | boolean | string | null; timestamp: string | null } | null;
  /** Render estático (editor fora do Preview): aparência de projeto, sem telemetria. */
  staticRender?: boolean;
  /**
   * Clique abre o popup "quais pontos" (somente viewer, modo point-list e sem
   * ação de clique configurada — o WidgetRenderer decide e passa true).
   */
  interactive?: boolean;
}

const STATE_META: Record<CountState, { label: string; color: string }> = {
  on: { label: 'Ligado', color: '#22C55E' },
  off: { label: 'Desligado', color: '#64748B' },
  'no-data': { label: 'Sem dados', color: '#94A3B8' },
};

/** Popup (portal) listando cada ponto selecionado com seu estado atual. */
function PointListPopup({
  widget, devices, getValue, getTagStatus, onClose,
}: Omit<Props, 'staticRender' | 'interactive'> & { onClose: () => void }) {
  const details = listCounterPoints(widget, devices, getValue, getTagStatus);
  const on = details.filter((d) => d.state === 'on').length;
  const portalContainer = usePortalContainer();

  if (!portalContainer) return null;

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'rgba(0,0,0,0.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(440px, calc(100vw - 32px))',
          maxHeight: 'min(520px, calc(100vh - 64px))',
          display: 'flex', flexDirection: 'column',
          background: '#0F172A', border: '1px solid #334155', borderRadius: 12,
          boxShadow: '0 20px 50px rgba(0,0,0,0.5)', color: '#E2E8F0',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px', borderBottom: '1px solid #1E293B' }}>
          <MonitorSmartphone style={{ width: 16, height: 16, color: widget.colorOn, flexShrink: 0 }} strokeWidth={2} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {widget.label || 'Contador de dispositivos'}
            </div>
            <div style={{ fontSize: 11, color: '#94A3B8' }}>
              {on} de {details.length} ligado{on === 1 ? '' : 's'}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Fechar"
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              width: 26, height: 26, borderRadius: 6, border: 'none',
              background: '#1E293B', color: '#94A3B8', cursor: 'pointer',
            }}
          >
            <X style={{ width: 14, height: 14 }} strokeWidth={2} />
          </button>
        </div>
        <div style={{ overflowY: 'auto', padding: '6px 8px' }}>
          {details.length === 0 && (
            <div style={{ padding: '18px 10px', fontSize: 12, color: '#94A3B8', textAlign: 'center' }}>
              Nenhum ponto selecionado neste widget.
            </div>
          )}
          {details.map((d, i) => {
            const meta = STATE_META[d.state];
            return (
              <div
                key={`${d.deviceId}:${d.tag}:${i}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '8px 8px', borderRadius: 8,
                  borderBottom: i < details.length - 1 ? '1px solid #16233B' : 'none',
                }}
              >
                <span
                  style={{
                    width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                    background: d.state === 'no-data' ? 'transparent' : meta.color,
                    border: d.state === 'no-data' ? `2px dashed ${meta.color}` : 'none',
                    boxShadow: d.state === 'on' ? `0 0 6px ${meta.color}` : 'none',
                  }}
                />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {d.pointName}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {d.deviceName} · {d.tag}
                  </div>
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, color: meta.color, flexShrink: 0 }}>
                  {meta.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    portalContainer,
  );
}

export function DeviceCounterWidgetView({ widget, devices, getValue, getTagStatus, getTagReading, staticRender, interactive }: Props) {
  const [open, setOpen] = useState(false);

  // Build the canonical camera-health callback from getTagReading (when available).
  // This ensures connectivity mode uses STATUS + gateway liveness + 5-min staleness,
  // matching the CFTV module — a frozen STATUS on an offline gateway won't count online.
  const getCameraHealth = useMemo(() => {
    if (!getTagReading) return undefined;
    return (camera: Parameters<typeof cameraHealthFromReader>[0]) =>
      cameraHealthFromReader(camera, getTagReading).health;
  }, [getTagReading]);

  const result = staticRender ? null : countDevices(widget, devices, getValue, getTagStatus, getCameraHealth);

  // "Sem dados": render estático, nenhum dispositivo elegível ou nenhum com informação.
  const hasData = Boolean(result && result.total > 0 && result.noData < result.total);
  const countText = hasData && result ? formatCount(widget, result) : '—';
  const accent = hasData ? widget.colorOn : '#64748B';
  const iconSize = Math.max(14, Math.min(widget.height * 0.4, widget.fontSize));

  // Popup só faz sentido no modo point-list (lista explícita de pontos).
  const clickable = Boolean(interactive && !staticRender && widget.mode === 'point-list');

  return (
    <>
      <div
        onClick={clickable ? (e) => { e.stopPropagation(); setOpen(true); } : undefined}
        title={clickable ? 'Clique para ver quais pontos estão ligados' : undefined}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 10px',
          boxSizing: 'border-box',
          ...scadaBackgroundStyle(widget.backgroundColor),
          border: `1px solid ${accent}`,
          borderRadius: widget.borderRadius,
          color: widget.textColor,
          overflow: 'hidden',
          cursor: clickable ? 'pointer' : undefined,
        }}
      >
        <MonitorSmartphone
          style={{ width: iconSize, height: iconSize, color: accent, flexShrink: 0 }}
          strokeWidth={2}
        />
        <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', lineHeight: 1.15 }}>
          {widget.showLabel && (
            <span
              style={{
                fontSize: Math.max(9, widget.fontSize * 0.42),
                color: widget.textColor,
                opacity: 0.7,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {widget.label}
            </span>
          )}
          <span
            style={{
              fontSize: widget.fontSize,
              fontWeight: 600,
              color: accent,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
          >
            {countText}
            {!hasData && (
              <span style={{ fontSize: Math.max(9, widget.fontSize * 0.42), opacity: 0.7, marginLeft: 6, fontWeight: 400 }}>
                sem dados
              </span>
            )}
            {hasData && result && result.noData > 0 && (
              <span style={{ fontSize: Math.max(9, widget.fontSize * 0.42), color: '#94A3B8', marginLeft: 6, fontWeight: 400 }}>
                {result.noData} sem dados
              </span>
            )}
          </span>
        </div>
      </div>
      {open && (
        <PointListPopup
          widget={widget}
          devices={devices}
          getValue={getValue}
          getTagStatus={getTagStatus}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
