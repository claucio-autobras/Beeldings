'use client';

import { useEffect, useRef, useState } from 'react';
import { Star } from 'lucide-react';
import { useT } from '@/lib/i18n';

interface CriticalStarButtonProps {
  critical: boolean;
  onToggle: () => void;
  busy?: boolean;
  /** Tamanho do ícone (px). */
  size?: number;
  className?: string;
  /**
   * Dica mostrada ao MARCAR como crítico (ex.: ponto sem papel "Status" só
   * aparece no card Ativos Críticos quando estiver em alarme). Não é exibida
   * ao desmarcar. Texto em pt-BR — traduzido via i18n internamente.
   */
  markHint?: string;
}

/**
 * Estrela de "ativo crítico": marca/desmarca equipamentos, pontos e câmeras
 * para acompanhamento no card Ativos Críticos do dashboard.
 */
export function CriticalStarButton({ critical, onToggle, busy, size = 16, className, markHint }: CriticalStarButtonProps) {
  const t = useT();
  const [showHint, setShowHint] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        title={critical ? t('Remover dos ativos críticos') : t('Marcar como ativo crítico')}
        aria-label={critical ? t('Remover dos ativos críticos') : t('Marcar como ativo crítico')}
        aria-pressed={critical}
        disabled={busy}
        onClick={(e) => {
          e.stopPropagation();
          if (!critical && markHint) {
            setShowHint(true);
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => setShowHint(false), 10000);
          } else {
            setShowHint(false);
          }
          onToggle();
        }}
        className={`rounded p-1.5 transition-colors disabled:opacity-50 ${
          critical
            ? 'text-amber-500 hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-500/10'
            : 'text-muted-foreground hover:bg-amber-50 hover:text-amber-500 dark:hover:bg-amber-500/10'
        } ${className ?? ''}`}
      >
        <Star style={{ width: size, height: size }} className={critical ? 'fill-current' : ''} />
      </button>

      {showHint && markHint && (
        <div
          role="status"
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 top-full z-50 mt-1.5 w-64 rounded-lg border border-amber-200 bg-amber-50 p-2.5 shadow-lg dark:border-amber-500/30 dark:bg-amber-950/90"
        >
          <p className="text-[11px] leading-snug text-amber-800 dark:text-amber-200">{t(markHint)}</p>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setShowHint(false); }}
            className="mt-1.5 rounded-md border border-amber-300 px-2 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/10"
          >
            {t('Entendi')}
          </button>
        </div>
      )}
    </span>
  );
}
