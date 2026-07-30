'use client';

import type { NavToolbarWidget } from '@/mocks/data/scada.mock';
import { ScadaNavGlyph } from './scadaIcons';

interface Props {
  widget: NavToolbarWidget;
  currentScreenId?: string;
  /** Nome da tela atual — fallback visual quando nenhum item corresponde. */
  currentScreenName?: string;
  onNavigate?: (screenId: string) => void;
  isEditor?: boolean;
}

export function NavToolbarWidgetView({ widget, currentScreenId, currentScreenName, onNavigate, isEditor }: Props) {
  const hasActiveItem = widget.items.some((item) => item.targetScreenId === currentScreenId);
  const showFallback = !isEditor && !hasActiveItem && Boolean(currentScreenName);
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: widget.backgroundColor,
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center',
        padding: '0 8px',
        gap: 4,
        overflowX: 'auto',
      }}
    >
      {widget.items.length === 0 && isEditor && (
        <p style={{ color: '#475569', fontSize: 11, padding: '0 8px' }}>
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
              gap: 6,
              padding: '6px 12px',
              borderRadius: 6,
              color: isActive ? widget.activeColor : widget.textColor,
              backgroundColor: isActive ? `${widget.activeColor}20` : 'transparent',
              borderBottom: isActive ? `2px solid ${widget.activeColor}` : '2px solid transparent',
              cursor: isEditor ? 'default' : 'pointer',
              transition: 'background-color 150ms',
              userSelect: 'none',
              whiteSpace: 'nowrap',
              fontSize: 12,
              fontFamily: 'Inter, sans-serif',
            }}
          >
            <ScadaNavGlyph name={item.iconName} assetUrl={item.iconAssetUrl} size={14} tileEnabled={item.tileEnabled} tileColor={item.tileColor} />
            {item.text}
          </button>
        );
      })}
      {showFallback && (
        <span
          data-testid="nav-current-fallback"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            marginLeft: 'auto',
            borderRadius: 6,
            color: widget.activeColor,
            backgroundColor: `${widget.activeColor}20`,
            borderBottom: `2px solid ${widget.activeColor}`,
            userSelect: 'none',
            whiteSpace: 'nowrap',
            fontSize: 12,
            fontFamily: 'Inter, sans-serif',
          }}
        >
          <ScadaNavGlyph name="monitor" size={14} />
          {currentScreenName}
        </span>
      )}
    </div>
  );
}
