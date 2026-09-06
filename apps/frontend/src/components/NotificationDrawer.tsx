'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle, Bell, BellOff, Check, ExternalLink, Trash2, WifiOff, X, Zap,
} from 'lucide-react';
import type { AlarmSeverity } from '@/modules/alarms/types/alarm.types';
import { getCurrentLanguage, useT } from '@/lib/i18n';

// ─── Tipos das notificações do sino ──────────────────────────────────────────

export interface AlarmNotification {
  kind: 'alarm';
  /** true quando a origem é um aviso de automação (NOTIFY), não um alarme de telemetria. */
  isAutomation: boolean;
  /** Id da automação de origem (avisos) — deep-link p/ o histórico pré-filtrado. */
  sourceId?: string | null;
  id: string;
  /** Chave estável de dispensa (muda a cada reativação/nova ocorrência). */
  dismissKey: string;
  tenantId: string;
  tenantName: string;
  title: string;
  subtitle: string;
  severity?: AlarmSeverity;
  occurredAt: string;
}

export interface OfflineNotification {
  kind: 'offline';
  id: string;
  /** Chave estável de dispensa (muda quando o dispositivo volta e cai de novo). */
  dismissKey: string;
  tenantId: string;
  tenantName: string;
  title: string;
  subtitle: string;
  lastSeen: string | null;
  occurredAt: string;
}

export type AppNotification = AlarmNotification | OfflineNotification;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeShort(iso: string): string {
  const en = getCurrentLanguage() === 'en';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return en ? 'now' : 'agora';
  if (minutes < 60) return en ? `${minutes}min ago` : `há ${minutes}min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return en ? `${hours}h ago` : `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return en ? `${days}d ago` : `há ${days}d`;
}

type TimeGroup = 'today' | 'yesterday' | 'week' | 'older';

const GROUP_ORDER: TimeGroup[] = ['today', 'yesterday', 'week', 'older'];

const GROUP_LABELS: Record<TimeGroup, string> = {
  today: 'Hoje',
  yesterday: 'Ontem',
  week: 'Esta semana',
  older: 'Anteriores',
};

function timeGroupOf(iso: string): TimeGroup {
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (d >= startOfToday) return 'today';
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  if (d >= startOfYesterday) return 'yesterday';
  const startOfWeek = new Date(startOfToday);
  startOfWeek.setDate(startOfWeek.getDate() - 6);
  if (d >= startOfWeek) return 'week';
  return 'older';
}

type FilterKind = 'all' | 'alarms' | 'devices' | 'automations';

const FILTERS: { value: FilterKind; label: string }[] = [
  { value: 'all',         label: 'Todas' },
  { value: 'alarms',      label: 'Alarmes' },
  { value: 'devices',     label: 'Dispositivos' },
  { value: 'automations', label: 'Automações' },
];

function matchesFilter(n: AppNotification, f: FilterKind): boolean {
  if (f === 'all') return true;
  if (f === 'devices') return n.kind === 'offline';
  if (f === 'automations') return n.kind === 'alarm' && n.isAutomation;
  return n.kind === 'alarm' && !n.isAutomation;
}

// Estilo visual por tipo/severidade: barra lateral, círculo do ícone e ícone.
function visualsOf(n: AppNotification): {
  bar: string;
  circle: string;
  icon: React.ReactNode;
} {
  if (n.kind === 'offline') {
    return {
      bar: 'bg-slate-400 dark:bg-slate-500',
      circle: 'bg-slate-100 text-slate-500 dark:bg-slate-500/15 dark:text-slate-400',
      icon: <WifiOff size={15} strokeWidth={2} />,
    };
  }
  if (n.isAutomation) {
    return {
      bar: 'bg-cyan-400 dark:bg-cyan-500',
      circle: 'bg-cyan-50 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-400',
      icon: <Zap size={15} strokeWidth={2} />,
    };
  }
  switch (n.severity) {
    case 'MEDIUM':
      return {
        bar: 'bg-amber-400 dark:bg-amber-500',
        circle: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-400',
        icon: <AlertCircle size={15} strokeWidth={2} />,
      };
    case 'LOW':
      return {
        bar: 'bg-blue-400 dark:bg-blue-500',
        circle: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400',
        icon: <AlertCircle size={15} strokeWidth={2} />,
      };
    default: // HIGH ou sem severidade conhecida → tratamento crítico
      return {
        bar: 'bg-red-400 dark:bg-red-500',
        circle: 'bg-red-50 text-red-500 dark:bg-red-500/15 dark:text-red-400',
        icon: <AlertCircle size={15} strokeWidth={2} />,
      };
  }
}

// ─── Card de notificação ──────────────────────────────────────────────────────

interface NotificationCardProps {
  notif: AppNotification;
  isAdmin: boolean;
  unread: boolean;
  isNew: boolean;
  dismissing: boolean;
  dismissDelayMs?: number;
  onOpen: () => void;
  onDismiss: () => void;
  onAck?: () => void;
  ackPending?: boolean;
}

function NotificationCard({
  notif, isAdmin, unread, isNew, dismissing, dismissDelayMs = 0,
  onOpen, onDismiss, onAck, ackPending,
}: NotificationCardProps) {
  const t = useT();
  const v = visualsOf(notif);

  return (
    <div
      className={`group relative transition-all duration-300 ${
        dismissing ? 'opacity-0 translate-x-6' : 'opacity-100 translate-x-0'
      } ${isNew ? 'animate-notif-item-in' : ''}`}
      style={dismissing ? { transitionDelay: `${dismissDelayMs}ms` } : undefined}
    >
      <button
        type="button"
        onClick={onOpen}
        className={`w-full text-left flex items-start gap-3 rounded-xl border py-3 pl-4 pr-3 transition-colors overflow-hidden relative ${
          unread
            ? 'border-border bg-cyan-50/50 hover:bg-cyan-50 dark:bg-cyan-500/[0.06] dark:hover:bg-cyan-500/10'
            : 'border-border bg-card hover:bg-muted/40'
        }`}
      >
        {/* Barra lateral de severidade */}
        <span className={`absolute left-0 top-0 bottom-0 w-1 ${v.bar}`} aria-hidden="true" />

        {/* Ícone em círculo */}
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${v.circle}`}>
          {v.icon}
        </span>

        <span className="flex-1 min-w-0 block">
          <span className="flex items-start gap-1.5">
            <span className="flex-1 min-w-0 text-xs font-semibold text-foreground leading-snug line-clamp-2">
              {notif.title}
            </span>
            {unread && (
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-cyan-500 transition-opacity duration-500" aria-hidden="true" />
            )}
          </span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground truncate">
            {notif.subtitle}
          </span>
          <span className="mt-1.5 flex items-center gap-1.5 flex-wrap">
            {isAdmin && (
              <span className="inline-flex max-w-[140px] items-center rounded-full border border-border bg-muted/60 px-1.5 py-px text-[10px] font-medium text-muted-foreground truncate">
                {notif.tenantName}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground/70">
              {formatRelativeShort(notif.occurredAt)}
            </span>
            {notif.kind === 'offline' && notif.lastSeen && (
              <span className="text-[10px] text-muted-foreground/70">
                · {t('Última leitura:')} {formatRelativeShort(notif.lastSeen)}
              </span>
            )}
          </span>
        </span>
      </button>

      {/* Ações no hover */}
      <div className="absolute right-2 top-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity duration-150">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          title={t('Ver detalhes')}
          aria-label={t('Ver detalhes')}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm hover:text-cyan-600 hover:border-cyan-300 dark:hover:text-cyan-400 transition-colors"
        >
          <ExternalLink size={12} strokeWidth={2} />
        </button>
        {onAck && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAck(); }}
            disabled={ackPending}
            title={t('Reconhecer')}
            aria-label={t('Reconhecer')}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm hover:text-emerald-600 hover:border-emerald-300 dark:hover:text-emerald-400 transition-colors disabled:opacity-50"
          >
            <Check size={12} strokeWidth={2.5} />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDismiss(); }}
          title={t('Dispensar')}
          aria-label={t('Dispensar')}
          className="flex h-6 w-6 items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm hover:text-red-500 hover:border-red-300 dark:hover:text-red-400 transition-colors"
        >
          <X size={12} strokeWidth={2} />
        </button>
      </div>
    </div>
  );
}

// ─── Drawer ───────────────────────────────────────────────────────────────────

interface NotificationDrawerProps {
  open: boolean;
  notifications: AppNotification[];
  isAdmin: boolean;
  unreadIds: Set<string>;
  onClose: () => void;
  onDismiss: (id: string) => void;
  onClearAll: () => void;
  onNavigate: (href: string) => void;
  /** ACK inline (apenas alarmes de telemetria). Undefined = indisponível. */
  onAck?: (id: string) => void;
  ackPendingId?: string | null;
}

export function NotificationDrawer({
  open, notifications, isAdmin, unreadIds,
  onClose, onDismiss, onClearAll, onNavigate, onAck, ackPendingId,
}: NotificationDrawerProps) {
  const t = useT();
  const [filter, setFilter] = useState<FilterKind>('all');
  const [closing, setClosing] = useState(false);
  const [clearing, setClearing] = useState(false);
  // Ids que estavam presentes na abertura — os que chegarem depois animam a entrada.
  const [initialIds, setInitialIds] = useState<Set<string>>(new Set());
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open && !wasOpen.current) {
      setInitialIds(new Set(notifications.map((n) => n.id)));
      setFilter('all');
      setClosing(false);
      setClearing(false);
    }
    wasOpen.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function requestClose() {
    if (closing) return;
    setClosing(true);
    setTimeout(onClose, 220);
  }

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') requestClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, closing]);

  const filtered = useMemo(
    () => notifications.filter((n) => matchesFilter(n, filter)),
    [notifications, filter],
  );

  const grouped = useMemo(() => {
    const map = new Map<TimeGroup, AppNotification[]>();
    for (const n of filtered) {
      const g = timeGroupOf(n.occurredAt);
      const arr = map.get(g);
      if (arr) arr.push(n); else map.set(g, [n]);
    }
    return GROUP_ORDER.filter((g) => map.has(g)).map((g) => ({
      group: g,
      items: map.get(g)!,
    }));
  }, [filtered]);

  // "Limpar" com cascata suave antes de efetivar.
  useEffect(() => {
    if (!clearing) return;
    const total = Math.min(filtered.length, 12) * 40 + 300;
    const timer = setTimeout(() => {
      onClearAll();
      setClearing(false);
    }, total);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearing]);

  const countByFilter = useMemo(() => {
    const acc: Record<FilterKind, number> = { all: notifications.length, alarms: 0, devices: 0, automations: 0 };
    for (const n of notifications) {
      if (n.kind === 'offline') acc.devices += 1;
      else if (n.isAutomation) acc.automations += 1;
      else acc.alarms += 1;
    }
    return acc;
  }, [notifications]);

  if (!open) return null;

  let flatIndex = 0;

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={t('Notificações')}>
      {/* Overlay */}
      <div
        className={`absolute inset-0 bg-black/30 backdrop-blur-[2px] animate-notif-overlay-in transition-opacity duration-200 ${
          closing ? 'opacity-0' : 'opacity-100'
        }`}
        onClick={requestClose}
        aria-hidden="true"
      />

      {/* Painel */}
      <div
        className={`absolute right-0 top-0 h-full w-full max-w-[400px] bg-card border-l border-border shadow-2xl flex flex-col animate-notif-drawer-in transition-transform duration-200 ease-in ${
          closing ? 'translate-x-full' : 'translate-x-0'
        }`}
      >
        {/* Cabeçalho fixo */}
        <div className="shrink-0 border-b border-border">
          <div className="flex items-center justify-between px-5 pt-4 pb-3">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Bell size={15} strokeWidth={2} className="text-cyan-600 dark:text-cyan-400" />
              {t('Notificações')}
              {notifications.length > 0 && (
                <span className="inline-flex items-center rounded-full bg-red-100 border border-red-200 px-2 py-0.5 text-[11px] font-semibold text-red-600 dark:bg-red-500/15 dark:border-red-500/30 dark:text-red-400">
                  {notifications.length}
                </span>
              )}
            </h2>
            <div className="flex items-center gap-1">
              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={() => setClearing(true)}
                  disabled={clearing}
                  className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-50"
                >
                  <Trash2 size={12} strokeWidth={1.75} />
                  {t('Limpar')}
                </button>
              )}
              <button
                type="button"
                onClick={requestClose}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/60 transition-colors"
                aria-label={t('Fechar')}
              >
                <X size={15} strokeWidth={2} />
              </button>
            </div>
          </div>

          {/* Filtros rápidos */}
          <div className="flex items-center gap-1.5 px-5 pb-3 overflow-x-auto">
            {FILTERS.map((f) => {
              const active = filter === f.value;
              const count = countByFilter[f.value];
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setFilter(f.value)}
                  className={`shrink-0 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    active
                      ? 'border-cyan-300 bg-cyan-50 text-cyan-700 dark:border-cyan-500/40 dark:bg-cyan-500/10 dark:text-cyan-300'
                      : 'border-border bg-card text-muted-foreground hover:bg-muted/40 hover:text-foreground'
                  }`}
                >
                  {t(f.label)}
                  {count > 0 && (
                    <span className={`inline-flex min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-4 ${
                      active
                        ? 'bg-cyan-600 text-white dark:bg-cyan-500'
                        : 'bg-muted text-muted-foreground'
                    }`}>
                      {count > 99 ? '99+' : count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Corpo com rolagem */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-3">
          {filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center px-6 pb-10">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-500 dark:bg-emerald-500/10 dark:text-emerald-400 mb-3">
                <BellOff size={24} strokeWidth={1.5} />
              </div>
              <p className="text-sm font-semibold text-foreground">{t('Tudo em ordem por aqui')}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('Nenhuma notificação no momento')}
              </p>
            </div>
          ) : (
            grouped.map(({ group, items }) => (
              <div key={group} className="mb-4 last:mb-0">
                <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
                  {t(GROUP_LABELS[group])}
                </p>
                <div className="space-y-2">
                  {items.map((notif) => {
                    const idx = flatIndex;
                    flatIndex += 1;
                    const isAlarmKind = notif.kind === 'alarm';
                    const isAutomation = isAlarmKind && notif.isAutomation;
                    const href = isAutomation
                      ? (notif.sourceId ? `/automation?tab=history&automationId=${notif.sourceId}` : null)
                      : isAlarmKind
                        ? `/alarms?highlight=${notif.id}`
                        : '/devices';
                    return (
                      <NotificationCard
                        key={notif.id}
                        notif={notif}
                        isAdmin={isAdmin}
                        unread={unreadIds.has(notif.id)}
                        isNew={!initialIds.has(notif.id)}
                        dismissing={clearing}
                        dismissDelayMs={Math.min(idx, 12) * 40}
                        onOpen={() => {
                          if (clearing) return;
                          if (isAutomation) onDismiss(notif.id);
                          if (href) {
                            onNavigate(href);
                            requestClose();
                          }
                        }}
                        onDismiss={() => onDismiss(notif.id)}
                        onAck={isAlarmKind && !isAutomation && onAck ? () => onAck(notif.id) : undefined}
                        ackPending={ackPendingId === notif.id}
                      />
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Rodapé */}
        {filtered.length > 0 && (
          <div className="shrink-0 border-t border-border">
            <button
              type="button"
              onClick={() => { onNavigate('/alarms'); requestClose(); }}
              className="w-full px-4 py-2.5 text-xs font-medium text-cyan-700 dark:text-cyan-400 hover:bg-muted/40 transition-colors text-center"
            >
              {t('Ver Painel de Alarmes')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Reexporta helpers usados pelo Topbar.
export { formatRelativeShort };
