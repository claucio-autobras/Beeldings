'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Star } from 'lucide-react';
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
  /**
   * Quando definido, o popover exibe o botão "Definir papel Status" que chama
   * este callback. Só deve ser passado para pontos digitais/binários sem opRole
   * 'status'. O loading e o erro são gerenciados internamente no popover.
   */
  onSetStatusRole?: () => Promise<void>;
}

/**
 * Estrela de "ativo crítico": marca/desmarca equipamentos, pontos e câmeras
 * para acompanhamento no card Ativos Críticos do dashboard.
 */
export function CriticalStarButton({ critical, onToggle, busy, size = 16, className, markHint, onSetStatusRole }: CriticalStarButtonProps) {
  const t = useT();
  const [showHint, setShowHint] = useState(false);
  const [settingRole, setSettingRole] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  async function handleSetStatusRole(e: React.MouseEvent) {
    e.stopPropagation();
    setRoleError(null);
    setSettingRole(true);
    try {
      await onSetStatusRole!();
      setShowHint(false);
    } catch {
      setRoleError(t('Erro ao definir papel. Tente novamente.'));
    } finally {
      setSettingRole(false);
    }
  }

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
            setRoleError(null);
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

          {onSetStatusRole && (
            <button
              type="button"
              disabled={settingRole}
              onClick={handleSetStatusRole}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-amber-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-amber-700 disabled:opacity-60 dark:bg-amber-500 dark:hover:bg-amber-400"
            >
              {settingRole && <Loader2 className="h-3 w-3 animate-spin" />}
              {settingRole ? t('Definindo papel...') : t('Definir papel Status')}
            </button>
          )}

          {roleError && (
            <p className="mt-1.5 text-[10px] font-medium text-red-700 dark:text-red-400">{roleError}</p>
          )}

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
