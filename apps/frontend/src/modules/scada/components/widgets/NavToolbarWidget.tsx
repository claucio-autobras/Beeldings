'use client';

import { useState } from 'react';
import { ImageOff } from 'lucide-react';
import type { NavToolbarWidget } from '../../types/scada.types';
import {
  normalizeNavHorizontalAlign,
  normalizeNavToolbarFontSize,
  normalizeNavToolbarGap,
  normalizeNavToolbarLogo,
  normalizeNavToolbarPaddingX,
  normalizeNavToolbarPaddingY,
  normalizeNavToolbarVerticalAlign,
  scadaBackgroundStyle,
} from '../../types/scada.types';
import { resolveAssetUrl } from '../../services/scada.service';
import { ScadaNavGlyph } from './scadaIcons';

interface Props {
  widget: NavToolbarWidget;
  currentScreenId?: string;
  /** Nome da tela atual — fallback visual quando nenhum item corresponde. */
  currentScreenName?: string;
  onNavigate?: (screenId: string) => void;
  isEditor?: boolean;
}

function ToolbarLogo({ widget }: { widget: NavToolbarWidget }) {
  const logo = normalizeNavToolbarLogo(widget.logo);
  const src = resolveAssetUrl(logo?.url);
  const [failed, setFailed] = useState(false);

  if (!logo || !src) return null;
  if (failed) {
    return (
      <span
        data-testid="nav-toolbar-logo-fallback"
        title="Não foi possível carregar a imagem da barra"
        style={{
          position: 'absolute',
          left: logo.position === 'left' ? 8 : undefined,
          right: logo.position === 'right' ? 8 : undefined,
          top: '50%',
          transform: 'translateY(-50%)',
          width: logo.width,
          height: logo.height,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
          borderRadius: 4,
          backgroundColor: 'rgba(100,116,139,0.25)',
          color: '#64748B',
          zIndex: 2,
        }}
      >
        <ImageOff size={Math.max(12, Math.min(logo.width, logo.height) * 0.45)} strokeWidth={1.5} />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      data-testid="nav-toolbar-logo"
      src={src}
      alt="Logo"
      onError={() => setFailed(true)}
      draggable={false}
      style={{
        position: 'absolute',
        left: logo.position === 'left' ? 8 : undefined,
        right: logo.position === 'right' ? 8 : undefined,
        top: '50%',
        transform: 'translateY(-50%)',
        width: logo.width,
        height: logo.height,
        objectFit: logo.fit,
        flexShrink: 0,
        display: 'block',
        zIndex: 2,
      }}
    />
  );
}

export function NavToolbarWidgetView({ widget, currentScreenId, currentScreenName, onNavigate, isEditor }: Props) {
  const hasActiveItem = widget.items.some((item) => item.targetScreenId === currentScreenId);
  const showFallback = !isEditor && !hasActiveItem && Boolean(currentScreenName);
  const contentAlign = normalizeNavHorizontalAlign(widget.contentAlign);
  const verticalAlign = normalizeNavToolbarVerticalAlign(widget.verticalAlign);
  const justifyContent = contentAlign === 'center' ? 'center' : contentAlign === 'right' ? 'flex-end' : 'flex-start';
  const verticalAlignItems = verticalAlign === 'center' ? 'center' : verticalAlign === 'bottom' ? 'flex-end' : 'flex-start';
  const itemGap = normalizeNavToolbarGap(widget.itemGap);
  const itemPaddingX = normalizeNavToolbarPaddingX(widget.itemPaddingX);
  const itemPaddingY = normalizeNavToolbarPaddingY(widget.itemPaddingY);
  const fontSize = normalizeNavToolbarFontSize(widget.fontSize);
  const glyphSize = Math.max(10, Math.min(32, Math.round(fontSize * 1.17)));
  const logo = normalizeNavToolbarLogo(widget.logo);
  // Only same-side logo/menu combinations reserve space. A centered menu must
  // remain centered against the full bar, regardless of logo dimensions.
  const reserveLogoStart = logo?.position === 'left' && contentAlign === 'left';
  const reserveLogoEnd = logo?.position === 'right' && contentAlign === 'right';
  const itemGroupStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: verticalAlignItems,
    justifyContent,
    gap: itemGap,
    minWidth: '100%',
    width: 'max-content',
    minHeight: '100%',
    boxSizing: 'border-box',
    paddingLeft: reserveLogoStart ? 8 + logo!.width + itemGap : 8,
    paddingRight: reserveLogoEnd ? 8 + logo!.width + itemGap : 8,
  };
  const itemViewportStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    display: 'flex',
    minWidth: 0,
    overflowX: 'auto',
    overflowY: 'hidden',
    zIndex: 1,
  };
  const rowStyle: React.CSSProperties = {
    position: 'relative',
    display: 'flex',
    flexDirection: 'row',
    width: '100%',
    height: '100%',
    minWidth: 0,
    minHeight: '100%',
    boxSizing: 'border-box',
    overflow: 'hidden',
  };
  const itemStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: `${itemPaddingY}px ${itemPaddingX}px`,
    borderRadius: 6,
    cursor: isEditor ? 'default' : 'pointer',
    transition: 'background-color 150ms',
    userSelect: 'none',
    whiteSpace: 'nowrap',
    fontSize,
    lineHeight: 1.2,
    fontFamily: 'Inter, sans-serif',
    flexShrink: 0,
  };
  return (
    <div
      data-scada-hover-content-surface="true"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        ...scadaBackgroundStyle(widget.backgroundColor),
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={rowStyle}
      >
        {logo && <ToolbarLogo key={`${logo.position}:${logo.url}`} widget={widget} />}
        <div data-testid="nav-toolbar-items" style={itemViewportStyle}>
          <div style={itemGroupStyle}>
            {widget.items.length === 0 && isEditor && (
              <p style={{ color: '#475569', fontSize: 11 }}>
                + Adicionar itens no painel
              </p>
            )}
            {widget.items.map((item) => {
              const isActive = item.targetScreenId === currentScreenId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => !isEditor && onNavigate?.(item.targetScreenId)}
                  style={{
                    ...itemStyle,
                    color: isActive ? widget.activeColor : widget.textColor,
                    backgroundColor: isActive ? `${widget.activeColor}20` : 'transparent',
                    borderBottom: isActive ? `2px solid ${widget.activeColor}` : '2px solid transparent',
                  }}
                >
                  <ScadaNavGlyph name={item.iconName} assetUrl={item.iconAssetUrl} size={glyphSize} tileEnabled={item.tileEnabled} tileColor={item.tileColor} />
                  <span data-scada-hover-text-surface="true">{item.text}</span>
                </button>
              );
            })}
            {showFallback && (
              <span
                data-testid="nav-current-fallback"
                style={{
                  ...itemStyle,
                  color: widget.activeColor,
                  backgroundColor: `${widget.activeColor}20`,
                  borderBottom: `2px solid ${widget.activeColor}`,
                }}
              >
                <ScadaNavGlyph name="monitor" size={glyphSize} />
                <span data-scada-hover-text-surface="true">{currentScreenName}</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
