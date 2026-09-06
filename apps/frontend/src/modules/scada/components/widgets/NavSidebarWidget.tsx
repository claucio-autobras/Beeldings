'use client';

import type { NavSidebarWidget } from '../../types/scada.types';
import { normalizeNavHorizontalAlign, normalizeNavSidebarVerticalAlign, scadaBackgroundStyle } from '../../types/scada.types';
import { ScadaNavGlyph } from './scadaIcons';

interface Props {
  widget: NavSidebarWidget;
  currentScreenId?: string;
  /** Nome da tela atual — fallback visual quando nenhum item corresponde. */
  currentScreenName?: string;
  onNavigate?: (screenId: string) => void;
  isEditor?: boolean;
}

export function NavSidebarWidgetView({ widget, currentScreenId, currentScreenName, onNavigate, isEditor }: Props) {
  const hasActiveItem = widget.items.some((item) => item.targetScreenId === currentScreenId);
  const showFallback = !isEditor && !hasActiveItem && Boolean(currentScreenName);
  const verticalAlign = normalizeNavSidebarVerticalAlign(widget.verticalAlign);
  const contentAlign = normalizeNavHorizontalAlign(widget.contentAlign);
  const verticalJustify = verticalAlign === 'center' ? 'center' : verticalAlign === 'bottom' ? 'flex-end' : 'flex-start';
  const horizontalJustify = contentAlign === 'center' ? 'center' : contentAlign === 'right' ? 'flex-end' : 'flex-start';
  return (
    <div
      data-scada-hover-content-surface="true"
      style={{
        width: '100%',
        height: '100%',
        ...scadaBackgroundStyle(widget.backgroundColor),
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          justifyContent: verticalJustify,
          minHeight: '100%',
          height: 'max-content',
          boxSizing: 'border-box',
          padding: '8px 0',
        }}
      >
        {widget.items.length === 0 && isEditor && (
          <p style={{ color: '#475569', fontSize: 11, textAlign: 'center', padding: '8px 4px' }}>
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
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 12px',
                color: isActive ? widget.activeColor : widget.textColor,
                backgroundColor: isActive ? `${widget.activeColor}20` : 'transparent',
                borderLeft: isActive ? `3px solid ${widget.activeColor}` : '3px solid transparent',
                cursor: isEditor ? 'default' : 'pointer',
                transition: 'background-color 150ms',
                userSelect: 'none',
                width: '100%',
                justifyContent: horizontalJustify,
                textAlign: contentAlign,
                fontSize: 13,
                fontFamily: 'Inter, sans-serif',
              }}
            >
              <ScadaNavGlyph name={item.iconName} assetUrl={item.iconAssetUrl} size={15} tileEnabled={item.tileEnabled} tileColor={item.tileColor} />
              <span data-scada-hover-text-surface="true" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {item.text}
              </span>
            </button>
          );
        })}
        {showFallback && (
          <span
            data-testid="nav-current-fallback"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: horizontalJustify,
              gap: 8,
              padding: '10px 12px',
              marginTop: 4,
              color: widget.activeColor,
              backgroundColor: `${widget.activeColor}20`,
              borderLeft: `3px solid ${widget.activeColor}`,
              userSelect: 'none',
              width: '100%',
              boxSizing: 'border-box',
              textAlign: contentAlign,
              fontSize: 13,
              fontFamily: 'Inter, sans-serif',
            }}
          >
            <ScadaNavGlyph name="monitor" size={15} />
            <span data-scada-hover-text-surface="true" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {currentScreenName}
            </span>
          </span>
        )}
      </div>
    </div>
  );
}
