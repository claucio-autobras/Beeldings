'use client';

import type { TitledAreaWidget } from '@/mocks/data/scada.mock';
import { scadaBackgroundStyle } from '../../types/scada.types';

interface Props { widget: TitledAreaWidget }

const WEIGHT_MAP: Record<string, number> = { normal: 400, medium: 500, semibold: 600, bold: 700 };

/**
 * Área com título estilo "fieldset": o rótulo sobre a borda usa <legend>,
 * que recorta a borda nativamente — sem caixinha de fundo sólido. Funciona
 * com fundo transparente e acompanha o raio da borda. Telas antigas (sem as
 * novas propriedades) mantêm o visual: 11px, semibold, sobre a borda, à esquerda.
 */
export function TitledAreaWidgetView({ widget }: Props) {
  const fontSize = widget.titleFontSize ?? 11;
  const fontWeight = WEIGHT_MAP[widget.titleFontWeight ?? 'semibold'] ?? 600;
  const position = widget.titlePosition ?? 'border';
  const align = widget.titleAlign ?? 'left';
  const title = widget.title || 'Área';

  const titleStyle: React.CSSProperties = {
    fontSize,
    color: widget.titleColor,
    fontFamily: 'Inter, sans-serif',
    fontWeight,
    letterSpacing: '0.03em',
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '85%',
  };

  if (position === 'inside') {
    const alignItems = align === 'center' ? 'center' : align === 'right' ? 'flex-end' : 'flex-start';
    return (
      <div style={{ width: '100%', height: '100%', position: 'relative', ...scadaBackgroundStyle(widget.fillColor), border: `1px solid ${widget.borderColor}`, borderRadius: widget.borderRadius, userSelect: 'none', display: 'flex', flexDirection: 'column', alignItems }}>
        <span style={{ ...titleStyle, padding: `${Math.max(4, Math.round(fontSize * 0.5))}px 10px 0` }}>{title}</span>
      </div>
    );
  }

  // Sobre a borda: <fieldset>/<legend> recorta a borda sem precisar de fundo
  // sólido no rótulo — compatível com fillColor 'transparent' e borderRadius.
  const legendMargin: React.CSSProperties =
    align === 'center' ? { marginLeft: 'auto', marginRight: 'auto' }
    : align === 'right' ? { marginLeft: 'auto', marginRight: Math.max(10, widget.borderRadius) }
    : { marginLeft: Math.max(10, widget.borderRadius) };

  return (
    <fieldset style={{ width: '100%', height: '100%', margin: 0, padding: 0, minWidth: 0, ...scadaBackgroundStyle(widget.fillColor), border: `1px solid ${widget.borderColor}`, borderRadius: widget.borderRadius, userSelect: 'none' }}>
      <legend style={{ ...titleStyle, ...legendMargin, padding: '0 6px' }}>{title}</legend>
    </fieldset>
  );
}
