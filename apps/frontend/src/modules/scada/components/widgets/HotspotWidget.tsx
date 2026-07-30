'use client';

import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { HotspotWidget } from '@/mocks/data/scada.mock';
import { ScadaNavGlyph } from './scadaIcons';

const WEIGHT_MAP = { normal: '400', medium: '500', semibold: '600', bold: '700' };

interface Props {
  widget: HotspotWidget;
  onNavigate?: (screenId: string) => void;
  isEditor?: boolean;
}

export function HotspotWidgetView({ widget, onNavigate, isEditor = false }: Props) {
  const [hovered, setHovered] = useState(false);

  const hasIcon = widget.showIcon && Boolean(widget.iconAssetUrl || widget.iconName);

  const isInvisible = widget.shape === 'invisible';
  const isCircle = widget.shape === 'circle';

  const borderRadius = isCircle
    ? '50%'
    : widget.shape === 'ellipse'
      ? '50%'
      : `${widget.borderRadius}px`;

  const bgAlpha = `${Math.round(widget.fillOpacity * 255).toString(16).padStart(2, '0')}`;
  const fillColor = widget.fillColor === 'transparent' ? 'transparent' : `${widget.fillColor}${bgAlpha}`;
  const hoverFill = hovered ? widget.hoverFillColor : fillColor;
  const hoverBorder = hovered ? widget.hoverBorderColor : widget.borderColor;
  const scale = hovered ? widget.hoverScale : 1;

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
      <span style={{
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
      title={!isEditor && widget.tooltip ? widget.tooltip : undefined}
      onClick={() => !isEditor && onNavigate?.(widget.targetScreenId)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: isInvisible ? 'transparent' : hoverFill,
        border: isInvisible ? 'none' : `${widget.borderWidth}px ${widget.borderStyle} ${hoverBorder}`,
        borderRadius,
        cursor,
        transform: `scale(${scale})`,
        transition: 'transform 150ms ease-out, background-color 150ms, border-color 150ms',
        boxSizing: 'border-box',
        overflow: 'hidden',
        userSelect: 'none',
      }}
    >
      {renderContent()}
    </div>
  );
}
