'use client';

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { AlertTriangle, Bell, Building2, MapPin, Clock, X, CheckCircle2, CheckCheck, ExternalLink, AlertCircle, Info, Zap } from 'lucide-react';
import type { Alarm, AlarmStatus } from '@/mocks/data/alarms.mock';
import { ROUTES } from '@/lib/routes';
import { useT, useLanguage } from '@/lib/i18n';
import { usePortalContainer } from '@/hooks/usePortalContainer';

/**
 * Sai da tela cheia (se ativa) antes de navegar — o destino (ex.: painel de
 * alarmes) fica fora do elemento em fullscreen e não seria visível.
 */
async function exitFullscreenIfNeeded(): Promise<void> {
  if (document.fullscreenElement) {
    try {
      await document.exitFullscreen();
    } catch {
      // ignora — navegação segue mesmo se sair do fullscreen falhar
    }
  }
}

function isAutomation(alarm: Alarm): boolean {
  return alarm.kind === 'automation';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ─── Status config ────────────────────────────────────────────────────────────

interface StatusItemConfig {
  badge: string;
  itemBorder: string;
  note: string;
}

const STATUS_ITEM_CONFIG: Record<AlarmStatus, StatusItemConfig> = {
  ALARME: {
    badge: 'bg-red-100 text-red-700 border-red-300',
    itemBorder: 'border-l-red-500',
    note: 'Ponto em falha — aguardando normalização',
  },
  NORMAL: {
    badge: 'bg-emerald-100 text-emerald-700 border-emerald-300',
    itemBorder: 'border-l-emerald-500',
    note: 'Normalizado — pronto para reconhecer',
  },
  RECONHECIDO: {
    badge: 'bg-gray-100 text-gray-500 border-gray-200',
    itemBorder: 'border-l-gray-300',
    note: '',
  },
};

const STATUS_LABELS: Record<AlarmStatus, string> = {
  ALARME: 'Em Alarme',
  NORMAL: 'Normalizado',
  RECONHECIDO: 'Reconhecido',
};

interface HeaderConfig {
  headerBg: string;
  headerBorder: string;
  iconPulse: boolean;
  modalRing: string;
  subtitle: string;
}

function getHeaderConfig(alarms: Alarm[]): HeaderConfig {
  // Alarme crítico de telemetria (vermelho) tem prioridade visual. Avisos de
  // automação (ciano/azul, informativo) só definem o cabeçalho quando não há
  // nenhum alarme crítico ativo na leva.
  const hasCriticalAlarm = alarms.some((a) => a.status === 'ALARME' && !isAutomation(a));
  const hasAutomation = alarms.some(isAutomation);
  const hasNormal = alarms.some((a) => a.status === 'NORMAL');

  if (hasCriticalAlarm) {
    return {
      headerBg: 'bg-red-600',
      headerBorder: 'border-red-700',
      iconPulse: true,
      modalRing: 'ring-2 ring-red-300',
      subtitle: 'Ponto(s) em falha no campo',
    };
  }
  if (hasAutomation) {
    return {
      headerBg: 'bg-cyan-600',
      headerBorder: 'border-cyan-700',
      iconPulse: false,
      modalRing: 'ring-2 ring-cyan-300',
      subtitle: 'Aviso enviado por uma automação',
    };
  }
  if (hasNormal) {
    return {
      headerBg: 'bg-amber-500',
      headerBorder: 'border-amber-600',
      iconPulse: false,
      modalRing: 'ring-2 ring-amber-300',
      subtitle: 'Aguardando reconhecimento do operador',
    };
  }
  return {
    headerBg: 'bg-gray-500',
    headerBorder: 'border-gray-600',
    iconPulse: false,
    modalRing: 'ring-1 ring-gray-200',
    subtitle: 'Alarmes recebidos',
  };
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AlarmStatus }) {
  const t = useT();
  const cfg = STATUS_ITEM_CONFIG[status];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cfg.badge}`}
    >
      {status === 'ALARME' && <AlertCircle size={9} strokeWidth={2} />}
      {status === 'NORMAL' && <CheckCircle2 size={9} strokeWidth={2} />}
      {t(STATUS_LABELS[status])}
    </span>
  );
}

// ─── Alarm Item ───────────────────────────────────────────────────────────────

interface AlarmItemProps {
  alarm: Alarm;
  isAdmin: boolean;
}

function AlarmItem({ alarm, isAdmin }: AlarmItemProps) {
  const t = useT();
  // Aviso de automação: layout informativo (ciano), sem status de ciclo de vida
  // de alarme nem dispositivo/site — a origem é a automação.
  if (isAutomation(alarm)) {
    const source = alarm.sourceName ?? alarm.deviceName;
    return (
      <div className="flex flex-col gap-1.5 rounded-r-lg border border-l-4 border-border border-l-cyan-500 bg-cyan-50/40 p-3">
        <div className="flex items-start justify-between gap-2">
          <p className="flex-1 text-xs font-semibold leading-snug text-foreground">
            {alarm.alarmText}
          </p>
          <span className="inline-flex items-center gap-1 rounded-full border border-cyan-300 bg-cyan-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-700">
            <Info size={9} strokeWidth={2} />
            {t('Aviso')}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="flex items-center gap-1 text-[11px] font-medium text-cyan-700">
            <Zap size={10} strokeWidth={1.5} />
            {source}
          </span>
          {isAdmin && alarm.tenantName && (
            <span className="flex items-center gap-1 text-[11px] font-medium text-cyan-700">
              <Building2 size={10} strokeWidth={1.5} />
              {alarm.tenantName}
            </span>
          )}
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock size={10} strokeWidth={1.5} />
            {formatDateTime(alarm.occurredAt)}
          </span>
        </div>

        <p className="text-[10px] font-medium text-cyan-600">{t('Aviso enviado por uma automação')}</p>
      </div>
    );
  }

  const cfg = STATUS_ITEM_CONFIG[alarm.status];
  return (
    <div
      className={`flex flex-col gap-1.5 rounded-r-lg border border-l-4 border-border bg-card p-3 ${cfg.itemBorder}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex-1 text-xs font-semibold leading-snug text-foreground">
          {alarm.alarmText}
        </p>
        <StatusBadge status={alarm.status} />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Bell size={10} strokeWidth={1.5} />
          {alarm.deviceName}
        </span>
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <MapPin size={10} strokeWidth={1.5} />
          {alarm.site}
        </span>
        {isAdmin && alarm.tenantName && (
          <span className="flex items-center gap-1 text-[11px] font-medium text-cyan-700">
            <Building2 size={10} strokeWidth={1.5} />
            {alarm.tenantName}
          </span>
        )}
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock size={10} strokeWidth={1.5} />
          {formatDateTime(alarm.occurredAt)}
        </span>
      </div>

      {cfg.note && (
        <p className={`text-[10px] font-medium ${alarm.status === 'ALARME' ? 'text-red-500' : 'text-emerald-600'}`}>
          {t(cfg.note)}
        </p>
      )}
    </div>
  );
}

// ─── NewAlarmModal ────────────────────────────────────────────────────────────

interface NewAlarmModalProps {
  alarms: Alarm[];
  onDismiss: () => void;
  onAcknowledgeNormalized: () => void;
  /** Ação ao clicar em "Ver Painel de Alarmes". Quando informado, sobrepõe o link `panelHref`. */
  onViewPanel?: () => void;
  panelHref?: string;
  isAdmin: boolean;
  /** Marca os avisos de automação (ids) como lidos. */
  onMarkNoticesRead?: (ids: string[]) => void;
}

export function NewAlarmModal({
  alarms,
  onDismiss,
  onAcknowledgeNormalized,
  onViewPanel,
  panelHref = ROUTES.alarms(),
  isAdmin,
  onMarkNoticesRead,
}: NewAlarmModalProps) {
  const t = useT();
  const lang = useLanguage();
  const portalContainer = usePortalContainer();
  const headerCfg = getHeaderConfig(alarms);
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const normalizedAlarms = alarms.filter((a) => a.status === 'NORMAL');
  const canAcknowledge = normalizedAlarms.length > 0;

  const noticeIds = alarms.filter(isAutomation).map((a) => a.id);
  const hasNotices = noticeIds.length > 0;
  // Ações de alarme (ver painel / reconhecer) só fazem sentido quando há ao menos
  // um alarme de telemetria na leva; avisos de automação apenas se marcam como lidos.
  const hasAlarms = alarms.some((a) => !isAutomation(a));

  const alarmCount = alarms.length;
  const allAutomation = alarmCount > 0 && alarms.every(isAutomation);
  const headerTitle = allAutomation
    ? alarmCount === 1
      ? t('Novo Aviso Recebido')
      : lang === 'en'
        ? `${alarmCount} New Notices Received`
        : `${alarmCount} Novos Avisos Recebidos`
    : alarmCount === 1
      ? t('Novo Alarme Recebido')
      : lang === 'en'
        ? `${alarmCount} New Alarms Received`
        : `${alarmCount} Novos Alarmes Recebidos`;

  useEffect(() => {
    // Depende do container: no 1º render (portal ainda nulo) o botão não existe.
    closeButtonRef.current?.focus();
  }, [portalContainer]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onDismiss();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onDismiss]);

  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === overlayRef.current) onDismiss();
  }

  // Portal dinâmico: dentro do elemento em fullscreen (ex.: SCADA em tela
  // cheia) quando houver, senão document.body. Sem container ainda (1º render
  // no cliente), não renderiza — evita mismatch de SSR.
  if (!portalContainer) return null;

  return createPortal(
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-alarm-modal-title"
      className="fixed inset-0 z-[200] flex items-end justify-center p-4 backdrop-blur-sm bg-black/45 sm:items-center"
      style={{ animation: 'fadeIn 200ms ease-out' }}
    >
      <div
        className={`w-full max-w-lg rounded-xl border border-border bg-card shadow-2xl ${headerCfg.modalRing}`}
        style={{ animation: 'slideInFromBottom 220ms cubic-bezier(0.16, 1, 0.3, 1)' }}
      >
        {/* Header */}
        <div
          className={`relative flex items-center gap-3 rounded-t-xl px-5 py-4 ${headerCfg.headerBg} border-b ${headerCfg.headerBorder}`}
        >
          <div
            className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-card/20 ${headerCfg.iconPulse ? 'animate-pulse' : ''}`}
            aria-hidden="true"
          >
            <AlertTriangle size={18} strokeWidth={2} className="text-white" />
          </div>

          <div className="min-w-0 flex-1">
            <h2
              id="new-alarm-modal-title"
              className="text-sm font-bold leading-tight text-white"
            >
              {headerTitle}
            </h2>
            <p className="mt-0.5 text-[11px] font-medium text-white opacity-85">
              {t(headerCfg.subtitle)}
            </p>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            onClick={onDismiss}
            aria-label={t('Fechar notificação de alarmes')}
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-white transition-colors hover:bg-card/20 focus:outline-none focus:ring-2 focus:ring-card/50"
          >
            <X size={15} strokeWidth={2} />
          </button>
        </div>

        {/* Alarm list */}
        <div className="max-h-[50vh] space-y-2 overflow-y-auto overscroll-contain px-4 py-3">
          {alarms.map((alarm) => (
            <AlarmItem key={alarm.id} alarm={alarm} isAdmin={isAdmin} />
          ))}
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 rounded-b-xl border-t border-border bg-muted/30 px-4 py-3 sm:flex-row sm:justify-end">
          {/* Aviso(s) de automação: apenas marcar como lido. */}
          {hasNotices && (
            <button
              type="button"
              onClick={() => {
                onMarkNoticesRead?.(noticeIds);
                if (!hasAlarms) onDismiss();
              }}
              className="flex items-center justify-center gap-1.5 rounded-md border border-cyan-300 bg-cyan-50 px-3.5 py-2 text-sm font-medium text-cyan-700 transition-colors hover:bg-cyan-100 focus:outline-none focus:ring-2 focus:ring-cyan-400/50"
            >
              <CheckCheck size={13} strokeWidth={2} />
              {noticeIds.length === 1 ? t('Marcar como lida') : t('Marcar como lidas')}
            </button>
          )}

          {/* Ações de alarme só aparecem quando há alarme(s) de telemetria na leva. */}
          {hasAlarms && (
            <>
              {onViewPanel ? (
                <button
                  type="button"
                  onClick={() => {
                    void exitFullscreenIfNeeded().then(onViewPanel);
                  }}
                  className="flex items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <ExternalLink size={13} strokeWidth={2} />
                  {t('Ver Painel de Alarmes')}
                </button>
              ) : (
                <Link
                  href={panelHref}
                  onClick={() => {
                    void exitFullscreenIfNeeded();
                    onDismiss();
                  }}
                  className="flex items-center justify-center gap-1.5 rounded-md border border-border bg-card px-3.5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/50"
                >
                  <ExternalLink size={13} strokeWidth={2} />
                  {t('Ver Painel de Alarmes')}
                </Link>
              )}

              <button
                type="button"
                onClick={canAcknowledge ? onAcknowledgeNormalized : undefined}
                disabled={!canAcknowledge}
                title={
                  canAcknowledge
                    ? lang === 'en'
                      ? `Acknowledge ${normalizedAlarms.length} normalized alarm(s)`
                      : `Reconhecer ${normalizedAlarms.length} alarme(s) normalizado(s)`
                    : t('Nenhum alarme normalizado — aguardando retorno do ponto ao normal')
                }
                className={`flex items-center justify-center gap-1.5 rounded-md px-3.5 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50 ${
                  canAcknowledge
                    ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                    : 'cursor-not-allowed bg-muted text-muted-foreground'
                }`}
              >
                <CheckCircle2 size={13} strokeWidth={2} />
                {t('Reconhecer Normalizados')}
                {canAcknowledge && (
                  <span className="ml-0.5 rounded-full bg-card/20 px-1.5 py-0.5 text-[10px] font-bold">
                    {normalizedAlarms.length}
                  </span>
                )}
              </button>
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes slideInFromBottom {
          from { opacity: 0; transform: translateY(20px) scale(0.97); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>,
    portalContainer,
  );
}
