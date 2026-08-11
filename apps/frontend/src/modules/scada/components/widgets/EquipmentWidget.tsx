'use client';

import { WifiOff } from 'lucide-react';
import type { EquipmentWidget, ScadaAnimation, VisibilityOperator } from '../../types/scada.types';
import { toScadaNumber, scadaAnimationCss, isTransparentColor } from '../../types/scada.types';
import { resolveAssetUrl } from '../../services/scada.service';

interface Props {
  widget: EquipmentWidget;
  getValue: (deviceId: string, tag: string) => number | boolean | string | null;
  staticRender?: boolean;
}

/** Avalia uma regra de estado contra o valor numérico do ponto vinculado. */
function matchOp(v: number, op: VisibilityOperator, target: number): boolean {
  switch (op) {
    case 'eq': return v === target;
    case 'neq': return v !== target;
    case 'gt': return v > target;
    case 'lt': return v < target;
    case 'gte': return v >= target;
    case 'lte': return v <= target;
    default: return false;
  }
}

// ─── Renders 3D isométricos embutidos ─────────────────────────────────────────
// PNGs com fundo transparente em public/scada-equipment/. A cor de estado é
// aplicada como brilho (glow) ao redor do render + LED de status no canto,
// preservando o realismo da imagem (não recolorimos o equipamento).

export const EQUIPMENT_IMAGES: Record<string, string> = {
  pump: '/scada-equipment/pump.png',
  fan: '/scada-equipment/fan.png',
  tank: '/scada-equipment/tank.png',
  valve: '/scada-equipment/valve.png',
  ahu: '/scada-equipment/ahu.png',
  chiller: '/scada-equipment/chiller.png',
  compressor: '/scada-equipment/compressor.png',
  generator: '/scada-equipment/generator.png',
  'cooling-tower': '/scada-equipment/cooling-tower.png',
  'fan-coil': '/scada-equipment/fan-coil.png',
  meter: '/scada-equipment/meter.png',
  controller: '/scada-equipment/controller.png',
  'electrical-panel': '/scada-equipment/electrical-panel.png',
  sensor: '/scada-equipment/sensor.png',
  'smoke-detector': '/scada-equipment/smoke-detector.png',
  'manual-call-point': '/scada-equipment/manual-call-point.png',
  'zone-module': '/scada-equipment/zone-module.png',
  'monitor-module': '/scada-equipment/monitor-module.png',
  'command-module': '/scada-equipment/command-module.png',
  'flow-switch': '/scada-equipment/flow-switch.png',
  'fire-panel': '/scada-equipment/fire-panel.png',
  'fire-siren': '/scada-equipment/fire-siren.png',
  'heat-detector': '/scada-equipment/heat-detector.png',
  sprinkler: '/scada-equipment/sprinkler.png',
  'fire-hydrant': '/scada-equipment/fire-hydrant.png',
  'fire-extinguisher': '/scada-equipment/fire-extinguisher.png',
  'fire-pump': '/scada-equipment/fire-pump.png',
  'fire-damper': '/scada-equipment/fire-damper.png',
  'fire-door': '/scada-equipment/fire-door.png',
  camera: '/scada-equipment/camera.png',
  lighting: '/scada-equipment/lighting.png',
};

/** Render alternativo da câmera (modelo dome) — selecionado via widget.cameraModel. */
export const CAMERA_DOME_IMAGE = '/scada-equipment/camera-dome.png';

// Proporção (largura/altura) de cada render embutido, medida dos PNGs recortados.
// Permite calcular deterministicamente o retângulo visível da imagem dentro do
// widget (fit proporcional), para posicionar LED/nível/offline sobre o desenho.
export const EQUIPMENT_ASPECT: Record<string, number> = {
  pump: 1.1012,
  fan: 0.787,
  tank: 0.5671,
  valve: 0.5603,
  ahu: 1.0104,
  chiller: 0.8417,
  compressor: 0.7454,
  generator: 1.0792,
  'cooling-tower': 0.9245,
  'fan-coil': 1.2386,
  meter: 0.6599,
  controller: 0.7704,
  'electrical-panel': 0.4188,
  sensor: 0.6398,
  'smoke-detector': 1.4293,
  'manual-call-point': 0.9359,
  'zone-module': 0.7967,
  'monitor-module': 0.9761,
  'command-module': 0.9528,
  'flow-switch': 1.1381,
  'fire-panel': 0.7116,
  'fire-siren': 1.0568,
  'heat-detector': 1.2062,
  sprinkler: 0.4923,
  'fire-hydrant': 0.6396,
  'fire-extinguisher': 0.4844,
  'fire-pump': 1.2795,
  'fire-damper': 0.9308,
  'fire-door': 0.4552,
  camera: 1.3339,
  lighting: 1.6309,
};

/** Proporção do render da câmera dome. */
export const CAMERA_DOME_ASPECT = 1.2139;

// ─── Component ────────────────────────────────────────────────────────────────

export function EquipmentWidgetView({ widget, getValue, staticRender }: Props) {
  const raw = staticRender ? null : getValue(widget.deviceId, widget.tagStatus);
  const isOffline = !staticRender && raw === null;
  const value = toScadaNumber(raw);

  // Cor + animação pela 1ª regra que casar com o valor do ponto; senão cor base.
  // No modo estático: cor base, sem regras/animação e sem o visual de offline.
  let color = widget.baseColor ?? '#64748B';
  let animation: ScadaAnimation = 'none';
  let stateMatched = false;
  if (!staticRender && !isOffline && !Number.isNaN(value)) {
    for (const rule of widget.stateRules ?? []) {
      if (matchOp(value, rule.operator, rule.value)) {
        color = rule.color;
        animation = rule.animation;
        stateMatched = true;
        break;
      }
    }
  }
  if (isOffline) color = '#64748B';

  // Padding interno controlável: com o campo definido, o conteúdo ocupa o widget
  // menos 2×padding (0 = preenche praticamente tudo). Ausente = margem pequena
  // (~5% do menor lado) só para o glow/LED não cortarem — a caixa de seleção
  // passa a "abraçar" o desenho, sem mudar posição/tamanho de widgets salvos.
  const minDim = Math.min(widget.width, widget.height);
  const padEff = widget.padding !== undefined
    ? Math.max(0, widget.padding)
    : Math.max(2, Math.round(minDim * 0.05));
  const isDome = widget.type === 'camera' && widget.cameraModel === 'dome';
  const builtinSrc = isDome ? CAMERA_DOME_IMAGE : EQUIPMENT_IMAGES[widget.type];

  // Tanque com nível líquido analógico. No modo estático: nível vazio + placeholder.
  const isTank = widget.type === 'tank';
  let levelPct = 0;
  let levelLabel = '';
  let levelNum: number | null = null;
  if (isTank && widget.tagLevel) {
    if (staticRender) {
      levelLabel = '––';
    } else {
      const rawLevel = getValue(widget.deviceId, widget.tagLevel);
      const num = Number(rawLevel);
      if (rawLevel !== null && rawLevel !== undefined && !Number.isNaN(num)) {
        const min = widget.levelMin ?? 0;
        const max = widget.levelMax ?? 100;
        levelPct = max > min ? Math.max(0, Math.min(1, (num - min) / (max - min))) : 0;
        levelLabel = `${num.toFixed(1)}${widget.levelUnit ?? '%'}`;
        levelNum = num;
      } else {
        levelLabel = '—';
      }
    }
  }

  const animCss = scadaAnimationCss(animation);

  // ── Retângulo disponível para o desenho ──────────────────────────────────
  // A imagem embutida ocupa largura×altura do widget (menos padding e o espaço
  // reservado aos rótulos abaixo), com ajuste proporcional — widgets largos ou
  // altos aproveitam a área toda em vez do quadrado min(w,h).
  const levelFontSizePre = widget.levelFontSize ?? 13;
  const reservedLevel = isTank && widget.tagLevel ? Math.round(levelFontSizePre * 1.1) + 4 : 0;
  const reservedLabel = widget.showLabel ? Math.round((widget.labelFontSize ?? 11) * 1.25) + 4 : 0;
  const availW = Math.max(8, widget.width - 2 * padEff);
  const availH = Math.max(8, widget.height - 2 * padEff - reservedLevel - reservedLabel);
  const aspect = isDome ? CAMERA_DOME_ASPECT : (EQUIPMENT_ASPECT[widget.type] ?? 1);
  let imgW = availW;
  let imgH = imgW / aspect;
  if (imgH > availH) { imgH = availH; imgW = imgH * aspect; }
  imgW = Math.max(8, Math.round(imgW));
  imgH = Math.max(8, Math.round(imgH));
  // Base de escala para glow/LED/ícones sobrepostos ao desenho.
  const iconSize = Math.max(imgW, imgH);

  // Glow de estado só quando uma regra casou (equipamento "com estado ativo");
  // na cor base o render fica neutro, apenas com o LED indicando a cor do projeto.
  // Cor transparente = "sem cor": desativa glow/LED-shadow em vez de gerar efeito inválido.
  const showGlow = !staticRender && !isOffline && stateMatched && !isTransparentColor(color);
  const glowPx = Math.max(5, Math.round(iconSize * 0.06));
  const ledSize = Math.max(8, Math.round(iconSize * 0.11));
  const levelColor = widget.levelColor ?? '#38BDF8';

  // Rótulo de nível: tamanho/cor configuráveis + regras condicionais próprias
  // (avaliadas contra o valor do ponto de nível). Defaults preservam telas
  // antigas: 13px e cor do líquido. Modo estático: sem regras/animação.
  let levelLabelColor = widget.levelLabelColor ?? levelColor;
  let levelLabelAnim: ScadaAnimation = 'none';
  if (!staticRender && levelNum !== null) {
    for (const rule of widget.levelLabelRules ?? []) {
      if (matchOp(levelNum, rule.operator, rule.value)) {
        levelLabelColor = rule.color;
        levelLabelAnim = rule.animation;
        break;
      }
    }
  }
  const levelFontSize = widget.levelFontSize ?? 13;

  // Imagem enviada substitui o render embutido (vale para qualquer equipamento,
  // inclusive o tanque, cujo medidor de nível dá lugar à imagem — o rótulo numérico
  // de nível, se houver, continua visível abaixo). Fica estática (sem animação
  // própria); a cor/glow de estado é aplicada como borda ao redor da imagem.
  const hasImage = Boolean(widget.iconAssetUrl);

  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', userSelect: 'none', gap: 4 }}>
      <div style={{
        animation: hasImage ? undefined : animCss,
        filter: isOffline
          ? 'grayscale(60%) opacity(0.5)'
          : undefined,
        position: 'relative',
        lineHeight: 0,
      }}>
        {hasImage ? (
          <div style={{
            width: availW, height: availH,
            borderRadius: 10,
            border: `3px solid ${color}`,
            boxShadow: isOffline || isTransparentColor(color) ? 'none' : `0 0 14px 2px ${color}`,
            background: 'rgba(15,23,42,0.35)',
            overflow: 'hidden',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxSizing: 'border-box',
          }}>
            {/* PNG dinâmico do SCADA (asset/CDN próprio) — next/image não se aplica */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={resolveAssetUrl(widget.iconAssetUrl)}
              alt={widget.labelText || 'Equipamento'}
              draggable={false}
              style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
            />
          </div>
        ) : builtinSrc ? (
          <div style={{ position: 'relative', width: imgW, height: imgH }}>
            {/* PNG dinâmico do SCADA (asset/CDN próprio) — next/image não se aplica */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={builtinSrc}
              alt={widget.labelText || widget.type}
              draggable={false}
              style={{
                width: '100%', height: '100%', objectFit: 'contain', display: 'block',
                filter: showGlow
                  ? `drop-shadow(0 0 ${glowPx}px ${color}) drop-shadow(0 2px 4px rgba(0,0,0,0.3))`
                  : 'drop-shadow(0 2px 4px rgba(0,0,0,0.35))',
              }}
            />
            {/* LED de status na cor de estado (opcional por widget; ausente = mostra) */}
            {widget.showStatusLed !== false && <span style={{
              position: 'absolute', right: 1, top: 1,
              width: ledSize, height: ledSize, borderRadius: '50%',
              background: color,
              boxShadow: showGlow ? `0 0 ${Math.round(ledSize * 0.6)}px 1px ${color}` : 'none',
              border: '1.5px solid rgba(255,255,255,0.75)',
              boxSizing: 'border-box',
            }} />}
            {/* medidor de nível do tanque (barra vertical sobreposta à direita) */}
            {isTank && widget.tagLevel && (
              <div style={{
                position: 'absolute', right: -Math.round(imgW * 0.03), bottom: '12%',
                width: Math.max(6, Math.round(imgW * 0.10)), height: '64%',
                borderRadius: 999,
                background: 'rgba(100,116,139,0.30)',
                border: '1px solid rgba(100,116,139,0.45)',
                overflow: 'hidden',
                display: 'flex', alignItems: 'flex-end',
                boxSizing: 'border-box',
              }}>
                <div style={{
                  width: '100%', height: `${Math.round(levelPct * 100)}%`,
                  background: levelColor,
                  borderRadius: 999,
                  transition: 'height 0.4s ease',
                }} />
              </div>
            )}
          </div>
        ) : null}
        {isOffline && (
          <WifiOff
            style={{
              position: 'absolute', right: 0, bottom: 0,
              width: Math.min(imgW, imgH) * 0.28, height: Math.min(imgW, imgH) * 0.28,
              color: '#64748B',
            }}
            strokeWidth={2}
          />
        )}
      </div>
      {isTank && widget.tagLevel && (
        <span style={{ fontSize: levelFontSize, fontWeight: 600, color: levelLabelColor, fontFamily: 'Roboto Mono, monospace', lineHeight: 1.1, animation: scadaAnimationCss(levelLabelAnim) }}>
          {levelLabel}
        </span>
      )}
      {widget.showLabel && (
        <span style={{ fontSize: widget.labelFontSize ?? 11, color: '#94A3B8', fontFamily: 'Inter, sans-serif', textAlign: 'center', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {widget.labelText}
        </span>
      )}
    </div>
  );
}
