'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  Clock,
  ExternalLink,
  Info,
  MapPin,
  Power,
  WifiOff,
  X,
} from 'lucide-react';
import { useT, useLanguage } from '@/lib/i18n';
import { usePortalContainer } from '@/hooks/usePortalContainer';
import type { CriticalAsset } from '../services/dashboard.service';

interface CriticalAssetInfoModalProps {
  asset: CriticalAsset;
  /** Atalho contextual (ex.: "Ver no SCADA"/"Ver no CFTV") quando fizer sentido. */
  actionLabel?: string;
  onAction?: () => void;
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

/**
 * Painel informativo do ativo crítico para o perfil cliente: em vez de levar a
 * telas técnicas (ou à SCADA com o ponto mudo, no caso de "Sem resposta"),
 * mostra o contexto do item — estado, desde quando, última comunicação e local.
 * O atalho de navegação só aparece quando faz sentido (nunca para itens sem
 * resposta rumo ao SCADA).
 */
export function CriticalAssetInfoModal({
  asset,
  actionLabel,
  onAction,
  onClose,
}: CriticalAssetInfoModalProps) {
  const t = useT();
  const lang = useLanguage();
  const container = usePortalContainer();

  // Escape fecha o painel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!container) return null;

  const locale = lang === 'en' ? 'en-US' : 'pt-BR';
  const fmtDateTime = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' });

  const isNoResponse = asset.state === 'no_response';

  // Estado + duração vigente (só com evidência real — nunca duração inventada).
  const stateInfo =
    asset.state === 'no_response'
      ? {
          icon: <WifiOff size={15} />,
          label: t('Sem resposta'),
          cls: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
          sinceMs: asset.offlineMs,
          sinceIso: asset.offlineSince,
          sincePrefix: t('Sem resposta há'),
        }
      : asset.state === 'running'
        ? {
            icon: <Activity size={15} />,
            label: t('Ligado'),
            cls: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-400',
            sinceMs: asset.activeMs,
            sinceIso: asset.activeSince,
            sincePrefix: t('Ligado há'),
          }
        : asset.state === 'stopped'
          ? {
              icon: <Power size={15} />,
              label: t('Desligado'),
              cls: 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300',
              sinceMs: asset.stoppedMs,
              sinceIso: asset.stoppedSince,
              sincePrefix: t('Desligado há'),
            }
          : {
              icon: <Activity size={15} />,
              label: t('Monitorando'),
              cls: 'border-border bg-muted/40 text-muted-foreground',
              sinceMs: null,
              sinceIso: null,
              sincePrefix: '',
            };

  const body = (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-border bg-card shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-foreground">{asset.name}</h3>
            <p className="truncate text-xs text-muted-foreground">
              {asset.kind === 'point' ? asset.deviceName : t('Ativo crítico')}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label={t('Fechar')}
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 overflow-y-auto px-4 py-4">
          {/* Estado atual */}
          <div className={`flex items-center gap-2.5 rounded-md border p-3 ${stateInfo.cls}`}>
            {stateInfo.icon}
            <div className="min-w-0">
              <p className="text-sm font-semibold">{stateInfo.label}</p>
              {stateInfo.sinceMs !== null && stateInfo.sinceMs !== undefined ? (
                <p className="text-xs opacity-90">
                  {stateInfo.sincePrefix} {humanizeMs(stateInfo.sinceMs, t)}
                  {stateInfo.sinceIso ? ` (${t('desde')} ${fmtDateTime(stateInfo.sinceIso)})` : ''}
                </p>
              ) : (
                <p className="text-xs opacity-90">{t('Sem dados de duração')}</p>
              )}
            </div>
          </div>

          {/* O que significa "Sem resposta" */}
          {isNoResponse && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
              <Info size={14} className="mt-0.5 shrink-0" />
              <p>
                {t('O equipamento parou de se comunicar com a plataforma — as leituras dele estão indisponíveis até a comunicação voltar. A equipe técnica acompanha este estado.')}
              </p>
            </div>
          )}

          {/* Detalhes */}
          <div className="space-y-2 rounded-md border border-border bg-muted/30 p-3 text-xs">
            <div className="flex items-center gap-2 text-foreground">
              <MapPin size={13} className="shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">{t('Local')}:</span>
              <span className="min-w-0 truncate font-medium">
                {asset.siteName ?? t('Sem site')}
              </span>
            </div>
            <div className="flex items-center gap-2 text-foreground">
              <Clock size={13} className="shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">{t('Última comunicação')}:</span>
              <span className="min-w-0 truncate font-medium">
                {asset.lastSeen ? fmtDateTime(asset.lastSeen) : t('Sem dados')}
              </span>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-3">
          <button
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            {t('Fechar')}
          </button>
          {actionLabel && onAction && (
            <button
              onClick={onAction}
              className="flex items-center gap-1.5 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-cyan-700"
            >
              <ExternalLink size={12} />
              {actionLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(body, container);
}
