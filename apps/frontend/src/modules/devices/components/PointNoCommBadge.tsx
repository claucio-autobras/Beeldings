'use client';

import { useT } from '@/lib/i18n';

/**
 * Selo neutro por ponto exibido quando o equipamento está sem comunicação
 * (mesma detecção do banner âmbar — useDeviceNoCommunication).
 *
 * Substitui APENAS o selo "normal" nas telas de detalhe (decisão centralizada
 * em showNoCommBadge, ../utils/point-no-comm): repetir um "Normal" verde com
 * valor antigo confunde o operador, mas selos "alarm"/"fault" preservam a
 * severidade conhecida e nunca são ocultados. Quando a comunicação volta, o
 * chamador volta a renderizar o selo real automaticamente (o hook reavalia a
 * cada ~1s).
 */
export function PointNoCommBadge() {
  const t = useT();
  return (
    <span
      title={t('Equipamento sem comunicação — o último status conhecido pode estar desatualizado.')}
      className="inline-flex cursor-help items-center px-1.5 py-0.5 rounded text-xs font-medium border bg-muted text-muted-foreground border-border"
    >
      {t('Sem comunicação')}
    </span>
  );
}
