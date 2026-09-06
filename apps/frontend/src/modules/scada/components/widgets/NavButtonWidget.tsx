'use client';

import type { NavButtonWidget } from '../../types/scada.types';
import { scadaBackgroundStyle } from '../../types/scada.types';
import { ScadaNavGlyph } from './scadaIcons';

interface Props {
  widget: NavButtonWidget;
  onNavigate?: (screenId: string) => void;
  isEditor?: boolean;
}

export function NavButtonWidgetView({ widget, onNavigate, isEditor }: Props) {
  const hasIcon = Boolean(widget.iconName || widget.iconAssetUrl);
  const iconSizePx = widget.fontSize * 1.1;
  const legacyHover = widget.hover === undefined && !isEditor;

  return (
    <button
      type="button"
      data-scada-hover-content-surface="true"
      onClick={() => !isEditor && onNavigate?.(widget.targetScreenId)}
      title={widget.targetScreenId || undefined}
      style={{
        width: '100%', height: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
        ...scadaBackgroundStyle(widget.backgroundColor), color: widget.textColor,
        borderRadius: widget.borderRadius, fontSize: widget.fontSize,
        fontFamily: 'Inter, sans-serif', fontWeight: 500,
        cursor: isEditor ? 'default' : 'pointer',
        transition: 'filter 150ms', userSelect: 'none', border: 'none', padding: 0,
      }}
      onMouseEnter={legacyHover ? (e) => { (e.currentTarget as HTMLButtonElement).style.filter = 'brightness(1.12)'; } : undefined}
      onMouseLeave={legacyHover ? (e) => { (e.currentTarget as HTMLButtonElement).style.filter = ''; } : undefined}
    >
      {hasIcon && (
        <ScadaNavGlyph
          name={widget.iconName}
          assetUrl={widget.iconAssetUrl}
          size={iconSizePx}
          tileEnabled={widget.tileEnabled}
          tileColor={widget.tileColor}
        />
      )}
      <span data-scada-hover-text-surface="true">{widget.label}</span>
    </button>
  );
}
