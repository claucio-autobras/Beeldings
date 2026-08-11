'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  BookOpen,
  ExternalLink,
  History,
  Info,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import { useT, useLanguage } from '@/lib/i18n';
import { usePortalContainer } from '@/hooks/usePortalContainer';
import type { CriticalAsset } from '../services/dashboard.service';
import {
  getFirstActionSuggestion,
  type FirstActionResult,
} from '../services/dashboard.service';
import { SimilarCasesList } from '@/modules/ai/components/SimilarCasesList';

interface FirstActionModalProps {
  asset: CriticalAsset;
  /** Navegação contextual do card (Alarmes/CFTV/SCADA/Dispositivos). */
  onNavigate: () => void;
  onClose: () => void;
}

/** "3d 4h" / "2h 15m" / "12m" a partir de milissegundos. */
function humanizeMs(ms: number, t: (s: string) => string): string {
  const totalMin = Math.floor(ms / 60_000);
  if (totalMin < 1) return t('agora mesmo');
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}

const CONFIDENCE_LABEL: Record<'high' | 'medium' | 'low', string> = {
  high: 'Confiança alta',
  medium: 'Confiança média',
  low: 'Confiança baixa',
};

const CONFIDENCE_STYLE: Record<'high' | 'medium' | 'low', string> = {
  high: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-400',
  medium:
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/60 dark:text-amber-400',
  low: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400',
};

/**
 * Painel "Primeira ação sugerida": aberto ao clicar num ativo crítico em falha
 * no dashboard. Mostra o resumo factual da falha (o quê, há quanto tempo,
 * reincidência) e 2–3 passos gerados pela IA a partir do alarme, histórico e
 * base de conhecimento. Fallback gracioso: se a IA falhar/estourar limite, o
 * painel exibe só o contexto factual — o botão de navegação contextual segue
 * disponível sempre.
 */
export function FirstActionModal({ asset, onNavigate, onClose }: FirstActionModalProps) {
  const t = useT();
  const lang = useLanguage();
  const container = usePortalContainer();

  const [result, setResult] = useState<FirstActionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Uma única tentativa por abertura — sem retry agressivo (custo + rate limit).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setResult(null);
    getFirstActionSuggestion({
      deviceId: asset.deviceId,
      pointId: asset.pointId ?? undefined,
      alarmEventId: asset.faultAlarmEventId ?? undefined,
      locale: lang === 'en' ? 'en' : 'pt',
    })
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : t('Erro ao gerar a sugestão.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset.deviceId, asset.pointId, asset.faultAlarmEventId]);

  // Escape fecha o painel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!container) return null;

  const alarm = result?.context.alarm ?? null;
  const suggestion = result?.suggestion ?? null;
  const recurrence = result?.context.recurrence30d ?? null;
  const ackHistory = result?.context.ackHistory ?? [];
  const aiFailed = !!error || (result?.aiError ?? false);

  const body = (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border bg-red-50/60 px-4 py-3 dark:bg-red-950/20">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 rounded-md border border-red-200 bg-red-50 p-1.5 text-red-600 dark:border-red-900 dark:bg-red-950/60 dark:text-red-400">
              <AlertTriangle size={15} />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-foreground">
                {t('Primeira ação sugerida')}
              </h3>
              <p className="truncate text-xs text-muted-foreground">
                {asset.name}
                {asset.kind === 'point' ? ` · ${asset.deviceName}` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t('Fechar')}
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {/* Resumo factual da falha */}
          <div className="rounded-md border border-border bg-muted/40 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('Resumo da falha')}
            </p>
            <div className="mt-1.5 space-y-1 text-xs text-foreground">
              <p className="font-medium">
                {alarm?.name ?? asset.faultRuleName ?? t('Falha sinalizada no dashboard')}
              </p>
              {(alarm?.message ?? null) && (
                <p className="text-muted-foreground">{alarm!.message}</p>
              )}
              <p className="text-muted-foreground">
                {asset.faultMs !== null && (
                  <>
                    {t('Em falha há')} {humanizeMs(asset.faultMs, t)}
                    {' · '}
                  </>
                )}
                {recurrence !== null && recurrence > 1
                  ? `${recurrence} ${t('ocorrências desta falha nos últimos 30 dias')}`
                  : t('Primeira ocorrência desta falha nos últimos 30 dias')}
              </p>
            </div>
          </div>

          {/* Histórico de reconhecimentos anteriores considerado pela IA */}
          {ackHistory.length > 0 && (
            <div className="rounded-md border border-cyan-200 bg-cyan-50/50 p-3 dark:border-cyan-900 dark:bg-cyan-950/30">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-400">
                <History size={12} />
                {t('Histórico de reconhecimentos considerado')}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                {t('Motivos registrados pelo operador em ocorrências anteriores deste alarme (últimos 90 dias):')}
              </p>
              <ul className="mt-1.5 space-y-1">
                {ackHistory.map((h, i) => (
                  <li key={i} className="text-xs text-foreground">
                    <span className="text-muted-foreground">
                      {new Date(h.acknowledgedAt).toLocaleDateString(
                        lang === 'en' ? 'en-US' : 'pt-BR',
                      )}
                      {' — '}
                    </span>
                    “{h.note}”
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Casos semelhantes da memória operacional anônima (cross-tenant) */}
          <SimilarCasesList cases={result?.similarCases} />

          {/* Sugestão da IA */}
          {loading ? (
            <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border p-6 text-center">
              <Loader2 size={18} className="animate-spin text-cyan-600" />
              <p className="text-xs text-muted-foreground">
                {t('Gerando sugestão com base no alarme, histórico e base de conhecimento...')}
              </p>
            </div>
          ) : aiFailed || !suggestion ? (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              <Info size={14} className="mt-0.5 shrink-0" />
              <p>
                {error ?? t('A sugestão de IA está indisponível no momento. Use o contexto acima e a navegação abaixo.')}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Sparkles size={12} className="text-cyan-600" />
                  {t('Sugestão da IA')}
                </p>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${CONFIDENCE_STYLE[suggestion.confidence]}`}
                >
                  {t(CONFIDENCE_LABEL[suggestion.confidence])}
                </span>
              </div>
              <ol className="space-y-2">
                {suggestion.steps.map((s, i) => (
                  <li key={i} className="flex gap-2.5 rounded-md border border-border p-2.5">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-600 text-[11px] font-semibold text-white">
                      {i + 1}
                    </span>
                    <div className="min-w-0 text-xs leading-relaxed text-foreground">
                      <p>{s.text}</p>
                      {s.source && (
                        <p className="mt-1 flex items-center gap-1 text-[11px] text-cyan-700 dark:text-cyan-400">
                          <BookOpen size={11} />
                          {s.source}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
              {suggestion.note && (
                <p className="text-[11px] italic text-muted-foreground">{suggestion.note}</p>
              )}
            </div>
          )}

          {/* Disclaimer */}
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-2.5 text-[11px] leading-relaxed text-muted-foreground">
            <Info size={13} className="mt-0.5 shrink-0" />
            <p>
              {t('Sugestão de apoio gerada por IA — não substitui o procedimento operacional. A decisão e a execução são do operador.')}
            </p>
          </div>
        </div>

        {/* Footer: navegação contextual continua disponível */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            {t('Fechar')}
          </button>
          <button
            onClick={onNavigate}
            className="flex items-center gap-1.5 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-700"
          >
            <ExternalLink size={12} />
            {t('Ver alarme')}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(body, container);
}
