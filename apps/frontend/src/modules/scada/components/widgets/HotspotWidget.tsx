'use client';

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { HotspotWidget } from '../../types/scada.types';
import { ScadaNavGlyph } from './scadaIcons';
import { isGradientColor } from '../../types/scada.types';

const WEIGHT_MAP = { normal: '400', medium: '500', semibold: '600', bold: '700' };

interface Props {
  widget: HotspotWidget;
  onNavigate?: (screenId: string) => void;
  isEditor?: boolean;
}

export function HotspotWidgetView({ widget, onNavigate, isEditor = false }: Props) {
  const [hovered, setHovered] = useState(false);
  // A configuração compartilhada no WidgetRenderer tem precedência. Sem ela,
  // preservamos o hover legado salvo no hotspot (fill/border/scale).
  const legacyHover = widget.hover === undefined && !isEditor;

  const hasIcon = widget.showIcon && Boolean(widget.iconAssetUrl || widget.iconName);

  const isInvisible = widget.shape === 'invisible';
  const isCircle = widget.shape === 'circle';

  const borderRadius = isCircle
    ? '50%'
    : widget.shape === 'ellipse'
      ? '50%'
      : `${widget.borderRadius}px`;

  const bgAlpha = `${Math.round(widget.fillOpacity * 255).toString(16).padStart(2, '0')}`;
  // Gradiente: usar a string como está (sem concatenar alpha hex, que corromperia o CSS).
  const fillColor = widget.fillColor === 'transparent'
    ? 'transparent'
    : isGradientColor(widget.fillColor)
      ? widget.fillColor
      : `${widget.fillColor}${bgAlpha}`;
  const hoverFill = legacyHover && hovered ? widget.hoverFillColor : fillColor;
  const hoverBorder = legacyHover && hovered ? widget.hoverBorderColor : widget.borderColor;
  const scale = legacyHover && hovered ? widget.hoverScale : 1;

  const cursor = isEditor ? 'default' : widget.cursor === 'grab' ? 'grab' : widget.cursor === 'crosshair' ? 'crosshair' : 'pointer';

  function renderContent() {
    if (isInvisible) {
      if (isEditor) {
        return (
          <div style={{ width: '100%', height: '100%', border: '1px dashed rgba(6,182,212,0.4)', borderRadius, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <ExternalLink style={{ width: 16, height: 16, color: 'rgba(6,182,212,0.5)' }} strokeWidth={1.5} />
          </div>
        );
      }
      return null;
    }

    const iconEl = hasIcon ? (
      <ScadaNavGlyph
        name={widget.iconName}
        assetUrl={widget.iconAssetUrl}
        size={widget.iconSize}
        tileEnabled={widget.tileEnabled}
        tileColor={widget.tileColor}
        color={widget.iconColor}
      />
    ) : null;

    const labelEl = widget.showLabel && widget.labelText ? (
      <span data-scada-hover-text-surface="true" style={{
        fontFamily: widget.labelFont || 'Inter, sans-serif',
        fontSize: widget.labelSize,
        fontWeight: WEIGHT_MAP[widget.labelWeight] ?? '400',
        color: widget.labelColor,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {widget.labelText}
      </span>
    ) : null;

    const isVertical = widget.iconPosition === 'above' || widget.iconPosition === 'below';

    return (
      <div style={{
        width: '100%', height: '100%',
        display: 'flex',
        flexDirection: isVertical ? 'column' : 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        padding: 6,
        overflow: 'hidden',
      }}>
        {(widget.iconPosition === 'left' || widget.iconPosition === 'above') && iconEl}
        {labelEl}
        {(widget.iconPosition === 'right' || widget.iconPosition === 'center') && !widget.showLabel && iconEl}
        {widget.iconPosition === 'right' && widget.showLabel && iconEl}
        {widget.iconPosition === 'below' && iconEl}
        {widget.iconPosition === 'center' && widget.showLabel && !widget.showIcon && null}
      </div>
    );
  }

  return (
    <div
      data-scada-hover-border-surface="true"
      data-scada-hover-content-surface="true"
      title={!isEditor && widget.tooltip ? widget.tooltip : undefined}
      onClick={() => !isEditor && onNavigate?.(widget.targetScreenId)}
      onMouseEnter={legacyHover ? () => setHovered(true) : undefined}
      onMouseLeave={legacyHover ? () => setHovered(false) : undefined}
      style={{
        width: '100%',
        height: '100%',
        background: isInvisible ? 'transparent' : hoverFill,
        border: isInvisible ? 'none' : `${widget.borderWidth}px ${widget.borderStyle} ${hoverBorder}`,
        borderRadius,
        cursor,
        transform: `scale(${scale})`,
         transition: legacyHover ? 'transform 150ms ease-out, background-color 150ms, border-color 150ms' : undefined,
        boxSizing: 'border-box',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {renderContent()}
    </div>
  );
}
