'use client';

import type { IconWidget } from '../../types/scada.types';
import { toScadaNumber } from '../../types/scada.types';
import { getScadaIcon, deriveTileStyle, AssetIconImage } from './scadaIcons';

const OFFLINE_COLOR = '#64748B';

interface Props {
  widget: IconWidget;
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  staticRender?: boolean;
}

/**
 * Ícone da biblioteca embutida OU imagem enviada (iconAssetUrl — mostrada como
 * está, sem recolorir). Sem binding (ou no render estático do editor) mostra a
 * cor de projeto. Com ponto vinculado: 1 → variante "ligado" (colorOn + brilho),
 * 0 → variante "desligado" (colorOff), sem leitura → cinza offline.
 * Modo "tile" (opt-in): quadrado arredondado com fundo derivado da cor atual.
 */
export function IconWidgetView({ widget, getValue, staticRender }: Props) {
  const def = getScadaIcon(widget.iconName);
  const bound = Boolean(widget.deviceId && widget.tag);

  let Icon = def.Icon;
  let color = widget.color;
  let glow = false;

  if (!staticRender && bound) {
    const raw = getValue(widget.deviceId, widget.tag);
    const v = toScadaNumber(raw);
    if (raw === null || raw === undefined || Number.isNaN(v)) {
      color = OFFLINE_COLOR;
      if (def.IconOff) Icon = def.IconOff;
    } else if (v !== 0) {
      color = widget.colorOn;
      glow = true;
      if (def.IconOn) Icon = def.IconOn;
    } else {
      color = widget.colorOff;
      if (def.IconOff) Icon = def.IconOff;
    }
  }

  const box = Math.max(12, Math.min(widget.width, widget.height));
  const tile = Boolean(widget.tileEnabled);
  // Com tile, o ícone ocupa ~58% do quadrado; sem tile, comportamento legado.
  const iconSize = tile ? Math.max(10, Math.round(box * 0.58)) : box;

  const inner = widget.iconAssetUrl ? (
    <AssetIconImage url={widget.iconAssetUrl} size={iconSize} />
  ) : (
    <Icon
      size={iconSize}
      color={color}
      strokeWidth={1.75}
      style={glow ? { filter: `drop-shadow(0 0 ${Math.max(4, iconSize * 0.12)}px ${color})` } : undefined}
    />
  );

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {tile ? (
        <span
          style={{
            width: box, height: box, borderRadius: Math.max(4, Math.round(box * 0.24)),
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            ...deriveTileStyle(color),
          }}
        >
          {inner}
        </span>
      ) : inner}
    </div>
  );
}
