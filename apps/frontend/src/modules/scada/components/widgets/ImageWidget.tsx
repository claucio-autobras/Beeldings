'use client';

import { ImageOff } from 'lucide-react';
import type { ImageWidget } from '../../types/scada.types';
import { resolveAssetUrl } from '../../services/scada.service';

interface Props {
  widget: ImageWidget;
}

export function ImageWidgetView({ widget }: Props) {
  if (!widget.src) {
    return (
      <div
        style={{
          width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 6,
          border: '1px dashed #475569', borderRadius: widget.borderRadius,
          color: '#64748B', background: 'rgba(15,23,42,0.4)', userSelect: 'none',
        }}
      >
        <ImageOff style={{ width: 24, height: 24 }} strokeWidth={1.5} />
        <span style={{ fontSize: 11 }}>Sem imagem</span>
      </div>
    );
  }
  // Padding interno uniforme (px). Ausente/0 = imagem preenche todo o widget.
  const pad = Math.max(0, widget.padding ?? 0);
  return (
    <div style={{ width: '100%', height: '100%', padding: pad, boxSizing: 'border-box' }}>
      {/* PNG dinâmico do SCADA (asset/CDN próprio) — next/image não se aplica */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={resolveAssetUrl(widget.src)}
        alt=""
        draggable={false}
        style={{
          width: '100%', height: '100%',
          objectFit: widget.objectFit,
          borderRadius: widget.borderRadius,
          userSelect: 'none', pointerEvents: 'none', display: 'block',
        }}
      />
    </div>
  );
}
