'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { EquipmentWidget } from '../../types/scada.types';
import { toScadaNumber, scadaAnimationCss } from '../../types/scada.types';
import type { PointReading } from '../../hooks/useScreenTelemetry';
import type { ScreenDevice } from '../../types/virtual.types';
import { isCameraDevice } from '../../types/virtual.types';
import { EQUIPMENT_IMAGES, CAMERA_DOME_IMAGE } from './EquipmentWidget';
import {
  ESTIMATED_UPTIME_HINT,
  estimatedUptimeSeconds,
  formatPointLiveValue,
  formatReadTime,
  formatUptime,
  TELEMETRY_TAG_ORDER,
} from '@/modules/cftv/utils/telemetry-format';

interface Props {
  widget: EquipmentWidget;
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  /** Leitura completa (valor + horário) — popup de telemetria no hover. */
  getReading?: (deviceId: string, tag: string) => PointReading | null;
  /** Dispositivos da tela — usado para resolver a câmera vinculada e seus pontos. */
  devices?: ScreenDevice[];
  isEditor?: boolean;
  staticRender?: boolean;
}

// Ponto padrão de estado criado no cadastro da câmera (backend CFTV).
const TAG_STATUS = 'STATUS';

const GREEN = '#22C55E';
const RED = '#EF4444';
const GREY = '#64748B';

/**
 * Widget SCADA de câmera CFTV. Estado dirigido pelo ponto STATUS da câmera:
 * verde = online (1), vermelho = offline (0), cinza = sem dados / edição estática.
 * No viewer ao vivo, passar o mouse abre um popup com a telemetria completa da
 * câmera (mesmos valores/formatação do modal de telemetria da área CFTV), com
 * reposicionamento automático perto das bordas da tela.
 */
export function CameraWidgetView({ widget, getValue, getReading, devices, isEditor, staticRender }: Props) {
  const deviceId = widget.deviceId;
  const live = !staticRender && !!deviceId;

  const camera = deviceId ? devices?.find((d) => d.id === deviceId) : undefined;
  const cameraInfo = camera && isCameraDevice(camera) ? camera : undefined;

  const rawStatus = live ? getValue(deviceId, widget.tagStatus || TAG_STATUS) : null;
  const n = toScadaNumber(rawStatus);
  const state: 'online' | 'offline' | 'unknown' =
    rawStatus === null || Number.isNaN(n) ? 'unknown' : n >= 1 ? 'online' : 'offline';

  const color = state === 'online' ? GREEN : state === 'offline' ? RED : GREY;

  // Popup de telemetria: apenas no viewer ao vivo (nunca no editor / render estático).
  const canPopup = live && !isEditor;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  // Fechamento com tolerância: pequeno delay para o trajeto widget → popup.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  };
  const scheduleClose = () => {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 180);
  };
  useEffect(() => cancelClose, []);
  // Reposicionamento perto das bordas: desloca horizontalmente e/ou vira para baixo.
  const [pos, setPos] = useState<{ dx: number; below: boolean }>({ dx: 0, below: false });

  useLayoutEffect(() => {
    if (!open || !popupRef.current || !rootRef.current) return;
    const el = popupRef.current;
    const rect = el.getBoundingClientRect();
    const rootRect = rootRef.current.getBoundingClientRect();
    // O canvas do viewer aplica `transform: scale(...)` — o rect é medido em
    // pixels de viewport, mas o deslocamento é aplicado em coordenadas locais
    // do widget. Converte pelo fator de escala renderizado/lógico de cada eixo.
    const scaleX = el.offsetWidth > 0 ? rect.width / el.offsetWidth : 1;
    const scaleY = el.offsetHeight > 0 ? rect.height / el.offsetHeight : 1;
    const margin = 8;
    const gap = 8 * (scaleY || 1);
    // Vertical: mede o espaço real acima/abaixo do ÍCONE (âncora estável) — o
    // rect do próprio popup mudaria após o flip e causaria oscilação.
    const fitsAbove = rootRect.top - gap - rect.height >= margin;
    const fitsBelow = rootRect.bottom + gap + rect.height <= window.innerHeight - margin;
    const below = fitsAbove
      ? false
      : fitsBelow
        ? true
        : rootRect.top < window.innerHeight - rootRect.bottom; // nenhum cabe: usa o lado com mais espaço
    // Horizontal: posição desejada centralizada no ícone, deslocada para dentro
    // da viewport quando encostar nas laterais (dx absoluto, não acumulado).
    const centerX = rootRect.left + rootRect.width / 2;
    const left = centerX - rect.width / 2;
    let dxViewport = 0;
    if (left < margin) dxViewport = margin - left;
    else if (left + rect.width > window.innerWidth - margin) dxViewport = window.innerWidth - margin - (left + rect.width);
    const dx = dxViewport / (scaleX || 1);
    if (Math.abs(dx - pos.dx) > 0.5 || below !== pos.below) setPos({ dx, below });
  }, [open, pos.dx, pos.below]);

  const points = cameraInfo
    ? [...cameraInfo.points].sort((a, b) => {
        const ia = TELEMETRY_TAG_ORDER.indexOf(a.tag);
        const ib = TELEMETRY_TAG_ORDER.indexOf(b.tag);
        return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
      })
    : [];

  const anim =
    !staticRender && state === 'offline' ? scadaAnimationCss('pulse') : undefined;

  // Escala uniforme do popup: todas as dimensões internas derivam desse fator.
  const ps = widget.popupSize === 'large' ? 1.5 : widget.popupSize === 'medium' ? 1.25 : 1;

  // "Tempo ligada" estimado (mesma camada do card/modal da área CFTV): só
  // quando a câmera está online e o ponto UPTIME não tem leitura real.
  const estUptime = estimatedUptimeSeconds(
    cameraInfo?.estimatedOnlineSince,
    state === 'online',
  );

  const info = cameraInfo?.deviceInfo;
  const title = cameraInfo?.name || widget.labelText || 'Câmera';
  const subtitle = info?.model
    ? [info.manufacturer, info.model].filter(Boolean).join(' ')
    : null;

  return (
    <div
      ref={rootRef}
      style={{ width: '100%', height: '100%', position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}
      onMouseEnter={canPopup ? () => { cancelClose(); if (!open) setPos({ dx: 0, below: false }); setOpen(true); } : undefined}
      onMouseLeave={canPopup ? scheduleClose : undefined}
    >
      {/* Padding interno configurável (px); ausente/0 = ocupa toda a área (legado). */}
      <div style={{ flex: 1, minHeight: 0, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', animation: anim, cursor: canPopup ? 'pointer' : undefined, padding: Math.max(0, widget.padding ?? 0), boxSizing: 'border-box' }}>
        {/* Render isométrico da câmera (bullet ou dome) — estado via glow + LED, nunca recolorindo o PNG */}
        <div style={{ position: 'relative', width: '100%', height: '100%', filter: state === 'unknown' && !staticRender ? 'grayscale(60%) opacity(0.6)' : undefined }}>
          {/* PNG dinâmico do SCADA (asset/CDN próprio) — next/image não se aplica */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={widget.cameraModel === 'dome' ? CAMERA_DOME_IMAGE : EQUIPMENT_IMAGES.camera}
            alt={widget.labelText || 'Câmera'}
            draggable={false}
            style={{
              width: '100%', height: '100%', objectFit: 'contain', display: 'block',
              filter: !staticRender && state !== 'unknown'
                ? `drop-shadow(0 0 6px ${color}) drop-shadow(0 2px 4px rgba(0,0,0,0.3))`
                : 'drop-shadow(0 2px 4px rgba(0,0,0,0.35))',
            }}
          />
          {/* LED de status na cor de estado (opcional por widget; ausente = mostra) */}
          {widget.showStatusLed !== false && (
            <span style={{
              position: 'absolute', right: 1, top: 1,
              width: 10, height: 10, borderRadius: '50%',
              background: color,
              boxShadow: !staticRender && state !== 'unknown' ? `0 0 6px 1px ${color}` : 'none',
              border: '1.5px solid rgba(255,255,255,0.75)',
              boxSizing: 'border-box',
            }} />
          )}
        </div>
      </div>

      {widget.showLabel && (
        <div style={{ fontSize: widget.labelFontSize ?? 11, lineHeight: 1.3, color: '#CBD5E1', textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
          {widget.labelText || cameraInfo?.name || 'Câmera'}
        </div>
      )}

      {open && canPopup && (
        <div
          ref={popupRef}
          className="rounded-xl border border-border bg-card shadow-2xl"
          style={{
            position: 'absolute',
            ...(pos.below ? { top: '100%' } : { bottom: '100%' }),
            left: '50%',
            transform: `translate(calc(-50% + ${pos.dx}px), ${pos.below ? '8px' : '-8px'})`,
            zIndex: 50, width: 264 * ps, maxHeight: 300 * ps,
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            cursor: 'default',
          }}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          {/* Cabeçalho: nome/modelo + badge de estado */}
          <div className="border-b border-border bg-muted/40" style={{ padding: `${10 * ps}px ${12 * ps}px ${8 * ps}px`, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 * ps }}>
              <span style={{ position: 'relative', width: 9 * ps, height: 9 * ps, flexShrink: 0 }}>
                <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: color }} />
                {state === 'online' && (
                  <span style={{ position: 'absolute', inset: -3 * ps, borderRadius: '50%', background: color, opacity: 0.25 }} />
                )}
              </span>
              <span className="text-foreground" style={{ fontSize: 13 * ps, fontWeight: 600, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                {title}
              </span>
              <span
                style={{
                  marginLeft: 'auto', flexShrink: 0, fontSize: 9.5 * ps, fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.04em', color,
                  background: `color-mix(in srgb, ${color} 14%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
                  borderRadius: 999, padding: `${2 * ps}px ${8 * ps}px`, lineHeight: `${12 * ps}px`,
                }}
              >
                {state === 'online' ? 'Online' : state === 'offline' ? 'Offline' : 'Sem dados'}
              </span>
            </div>
            {subtitle && (
              <div className="text-muted-foreground" style={{ fontSize: 10.5 * ps, marginTop: 3 * ps, paddingLeft: 17 * ps, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {subtitle}
              </div>
            )}
          </div>

          {/* Lista de pontos com rolagem interna */}
          <div
            style={{
              overflowY: 'auto', minHeight: 0, padding: `${4 * ps}px ${12 * ps}px ${8 * ps}px`,
              scrollbarWidth: 'thin',
              scrollbarColor: 'var(--color-border) transparent',
            }}
          >
            {points.length === 0 ? (
              <p className="text-muted-foreground" style={{ fontSize: 11 * ps, margin: `${6 * ps}px 0` }}>
                Câmera não encontrada — verifique o vínculo do widget.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {points.map((p) => {
                  const reading = getReading?.(deviceId, p.tag) ?? null;
                  const value = formatPointLiveValue(p, reading?.value ?? null);
                  const readAt = formatReadTime(reading?.timestamp ?? null);
                  // UPTIME sem leitura real: mostra o tempo estimado (transições do STATUS).
                  const showEstimated = p.tag === 'UPTIME' && value === null && estUptime !== null;
                  const hasValue = value !== null || showEstimated;
                  return (
                    <div key={p.id} className="border-t border-border/60 first:border-t-0" style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 * ps, padding: `${6 * ps}px 0` }}>
                      <span className="text-muted-foreground" style={{ fontSize: 11 * ps, lineHeight: `${14 * ps}px`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                        {p.objectName}
                      </span>
                      <span style={{ textAlign: 'right', flexShrink: 0 }}>
                        <span
                          className={hasValue ? 'text-foreground' : 'text-muted-foreground'}
                          style={{
                            display: 'block', fontSize: 11.5 * ps, lineHeight: `${14 * ps}px`,
                            fontWeight: hasValue ? 600 : 400,
                            fontStyle: !hasValue ? 'italic' : undefined,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                          title={showEstimated ? ESTIMATED_UPTIME_HINT : undefined}
                        >
                          {value !== null
                            ? value
                            : showEstimated
                              ? (
                                  <>
                                    {formatUptime(estUptime as number)}
                                    <span className="text-muted-foreground" style={{ marginLeft: 4 * ps, fontSize: 9.5 * ps, fontWeight: 400 }}>
                                      (estimado)
                                    </span>
                                  </>
                                )
                              : p.unsupported
                                ? 'não suportado'
                                : 'sem dados'}
                        </span>
                        {readAt && (
                          <span className="text-muted-foreground" style={{ display: 'block', fontSize: 9 * ps, lineHeight: `${12 * ps}px`, marginTop: 1 * ps, opacity: 0.8 }}>
                            lido às {readAt}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
