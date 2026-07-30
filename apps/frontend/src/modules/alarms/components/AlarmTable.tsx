'use client';

import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle2, Clock, AlertCircle, Eye, X, MapPin } from 'lucide-react';
import type { Alarm, AlarmStatus } from '@/mocks/data/alarms.mock';
import { useT, useLanguage } from '@/lib/i18n';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelative(iso: string, lang: 'pt-BR' | 'en' = 'pt-BR'): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (lang === 'en') {
    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }
  if (minutes < 1) return 'agora';
  if (minutes < 60) return `${minutes}min atrás`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h atrás`;
  return `${Math.floor(hours / 24)}d atrás`;
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hour = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hour}:${min}`;
}

function rowClasses(alarm: Alarm, isHighlighted: boolean): string {
  if (isHighlighted) return 'bg-cyan-50 ring-1 ring-inset ring-cyan-300';
  if (alarm.status === 'ALARME') return 'animate-alarm-pulse';
  return 'bg-card';
}

function cardClasses(alarm: Alarm, isHighlighted: boolean): string {
  if (isHighlighted) return 'rounded-lg border border-cyan-300 ring-1 ring-cyan-300 bg-cyan-50 p-3';
  if (alarm.status === 'ALARME') {
    return 'rounded-lg border border-border p-3 animate-alarm-pulse';
  }
  return 'rounded-lg border border-border p-3 bg-card';
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<AlarmStatus, string> = {
  ALARME:      'bg-red-100 text-red-700 border-red-200',
  NORMAL:      'bg-green-50 text-green-700 border-green-200',
  RECONHECIDO: 'bg-gray-100 text-gray-500 border-gray-200',
};

const STATUS_LABELS: Record<AlarmStatus, string> = {
  ALARME:      'Alarme',
  NORMAL:      'Normal',
  RECONHECIDO: 'Reconhecido',
};

function StatusBadge({ status }: { status: AlarmStatus }) {
  const t = useT();
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[status]}`}
    >
      {status === 'ALARME' && <AlertCircle size={10} strokeWidth={2} />}
      {status === 'NORMAL' && <CheckCircle2 size={10} strokeWidth={2} />}
      {t(STATUS_LABELS[status])}
    </span>
  );
}

// ─── Detail Dialog ────────────────────────────────────────────────────────────

function DetailDialog({ alarm, onClose }: { alarm: Alarm; onClose: () => void }) {
  const t = useT();
  const lang = useLanguage();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">{t('Detalhes do Alarme')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted transition-colors"
          >
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">{t('Texto do Alarme')}</p>
            <p className="text-sm font-semibold text-foreground leading-snug">{alarm.alarmText}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">{t('Dispositivo')}</p>
              <p className="text-xs text-foreground font-medium">{alarm.deviceName}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">{t('Local')}</p>
              <p className="text-xs text-foreground">{alarm.site}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">{t('Data / Hora')}</p>
              <p className="flex items-center gap-1 text-xs text-foreground">
                <Clock size={11} strokeWidth={1.5} className="text-muted-foreground" />
                {formatDateTime(alarm.occurredAt)}
              </p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">{t('Status')}</p>
              <StatusBadge status={alarm.status} />
            </div>
          </div>

          {alarm.ackNote && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">{t('Nota de Reconhecimento')}</p>
              <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground leading-relaxed">
                {alarm.ackNote}
              </p>
              {alarm.acknowledgedBy && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {lang === 'en' ? 'By' : 'Por'} {alarm.acknowledgedByName ?? t('Usuário removido')}
                  {alarm.acknowledgedAt ? ` · ${formatRelative(alarm.acknowledgedAt, lang)}` : ''}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
          >
            {t('Fechar')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Acknowledge Dialog ───────────────────────────────────────────────────────

interface AckDialogProps {
  alarm: Alarm;
  onConfirm: (note: string) => void;
  onCancel: () => void;
  isPending: boolean;
}

function AckDialog({ alarm, onConfirm, onCancel, isPending }: AckDialogProps) {
  const t = useT();
  const [note, setNote] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">{t('Reconhecer Alarme')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {alarm.deviceName} · {alarm.site}
          </p>
          <p className="mt-1 text-xs font-medium text-foreground">{alarm.alarmText}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground flex items-center gap-1">
            <Clock size={10} strokeWidth={1.5} />
            {formatDateTime(alarm.occurredAt)}
          </p>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <label htmlFor="ack-note" className="block text-xs font-medium text-foreground mb-1">
              {t('Nota (opcional)')}
            </label>
            <textarea
              id="ack-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('Descreva a ação tomada ou observação...')}
              rows={3}
              className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isPending}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-50"
          >
            {t('Cancelar')}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(note)}
            disabled={isPending}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            <CheckCircle2 size={14} strokeWidth={2} />
            {isPending ? t('Salvando...') : t('Confirmar')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Filter Tabs ──────────────────────────────────────────────────────────────

type FilterValue = 'ALARME' | 'NORMAL' | 'RECONHECIDO' | 'all';

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: 'ALARME',      label: 'Ativos'       },
  { value: 'NORMAL',      label: 'Aguard. ACK'  },
  { value: 'RECONHECIDO', label: 'Reconhecidos' },
  { value: 'all',         label: 'Todos'        },
];

// ─── Main Component ───────────────────────────────────────────────────────────

interface AlarmTableProps {
  alarms: Alarm[];
  onAcknowledge: (alarmId: string, userId: string, note: string) => Promise<void>;
  isAcknowledging: boolean;
  highlightId?: string;
  initialFilter?: FilterValue;
  showTenantColumn?: boolean;
}

export function AlarmTable({ alarms, onAcknowledge, isAcknowledging, highlightId, initialFilter, showTenantColumn = false }: AlarmTableProps) {
  const t = useT();
  const lang = useLanguage();
  const [filter, setFilter] = useState<FilterValue>(initialFilter ?? 'ALARME');
  const [ackTarget, setAckTarget] = useState<Alarm | null>(null);
  const [detailTarget, setDetailTarget] = useState<Alarm | null>(null);
  const [activeHighlight, setActiveHighlight] = useState<string | undefined>(highlightId);
  const highlightRef = useRef<Element | null>(null);

  useEffect(() => {
    if (!highlightId) return;

    setActiveHighlight(highlightId);

    const alarm = alarms.find((a) => a.id === highlightId);
    if (alarm) {
      setFilter(alarm.status === 'ALARME' ? 'ALARME' : alarm.status === 'NORMAL' ? 'NORMAL' : 'RECONHECIDO');
    }

    const timeout = setTimeout(() => setActiveHighlight(undefined), 3000);
    return () => clearTimeout(timeout);
  }, [highlightId, alarms]);

  useEffect(() => {
    if (activeHighlight && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeHighlight, filter]);

  const filtered = filter === 'all' ? alarms : alarms.filter((a) => a.status === filter);

  const handleConfirm = async (note: string) => {
    if (!ackTarget) return;
    await onAcknowledge(ackTarget.id, 'op.usuario@autobras.com.br', note);
    setAckTarget(null);
  };

  return (
    <>
      {/* Filter Tabs */}
      <div className="flex overflow-x-auto border-b border-border scrollbar-none">
        {FILTERS.map(({ value, label }) => {
          const count = value === 'all' ? alarms.length : alarms.filter((a) => a.status === value).length;
          const isActive = filter === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => setFilter(value)}
              className={[
                'px-4 py-2.5 text-xs font-medium whitespace-nowrap transition-colors border-b-2 -mb-px',
                isActive
                  ? 'border-cyan-600 text-cyan-700'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
              ].join(' ')}
            >
              {t(label)}
              <span className={`ml-1.5 text-[11px] ${isActive ? 'text-cyan-600' : 'text-muted-foreground'}`}>
                ({count})
              </span>
            </button>
          );
        })}
      </div>

      {/* Empty state */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-card py-16 text-center">
          <CheckCircle2 size={36} strokeWidth={1.5} className="text-muted-foreground mb-3" />
          <p className="text-sm font-medium text-foreground">{t('Nenhum alarme encontrado')}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {filter === 'all'
              ? t('Não há alarmes registrados para este Cliente.')
              : lang === 'en'
                ? `There are no alarms with status "${t(FILTERS.find((f) => f.value === filter)?.label ?? '')}".`
                : `Não há alarmes com status "${FILTERS.find((f) => f.value === filter)?.label}".`}
          </p>
        </div>
      ) : (
        <>
          {/* Mobile cards — hidden on md+ */}
          <div className="space-y-5 md:hidden">
            {filtered.map((alarm) => {
              const isHighlighted = alarm.id === activeHighlight;
              return (
              <div
                key={alarm.id}
                ref={isHighlighted ? (el: HTMLDivElement | null) => { highlightRef.current = el; } : undefined}
                className={`${cardClasses(alarm, isHighlighted)} space-y-2.5`}
              >
                <div className="flex items-center justify-between gap-2">
                  <StatusBadge status={alarm.status} />
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground whitespace-nowrap">
                    <Clock size={11} strokeWidth={1.5} />
                    {formatRelative(alarm.triggeredAt, lang)}
                  </span>
                </div>

                <p className="text-xs font-semibold text-foreground leading-snug">{alarm.alarmText}</p>
                {showTenantColumn && (
                  <p className="text-[11px] font-medium text-cyan-700">{alarm.tenantName}</p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  {alarm.deviceName} · {alarm.site}
                </p>
                <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Clock size={10} strokeWidth={1.5} />
                  {formatDateTime(alarm.occurredAt)}
                </p>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setDetailTarget(alarm)}
                    className="flex items-center gap-1 rounded-md border border-slate-200 bg-card px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors min-h-[44px]"
                  >
                    <Eye size={13} strokeWidth={2} />
                    {t('Ver detalhes')}
                  </button>
                  {alarm.status === 'NORMAL' && (
                    <button
                      type="button"
                      onClick={() => setAckTarget(alarm)}
                      className="flex items-center gap-1 rounded-md border border-primary/30 bg-card px-3 py-2 text-xs font-medium text-primary hover:bg-primary/5 transition-colors min-h-[44px]"
                    >
                      <CheckCircle2 size={13} strokeWidth={2} />
                      {t('Reconhecer')}
                    </button>
                  )}
                  {alarm.status === 'ALARME' && (
                    <button
                      type="button"
                      disabled
                      title={t('Aguardando normalização no campo')}
                      className="flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-400 cursor-not-allowed min-h-[44px]"
                    >
                      <CheckCircle2 size={13} strokeWidth={2} />
                      {t('Reconhecer')}
                    </button>
                  )}
                </div>
              </div>
              );
            })}
          </div>

          {/* Desktop table — hidden on mobile */}
          <div className="hidden md:block overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm border-separate border-spacing-y-1.5">
              <thead className="bg-muted/50">
                <tr>
                  <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
                    {t('Dispositivo')}
                  </th>
                  {showTenantColumn && (
                    <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
                      {t('Cliente')}
                    </th>
                  )}
                  <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
                    <span className="flex items-center gap-1">
                      <MapPin size={11} strokeWidth={1.5} />
                      {t('Local')}
                    </span>
                  </th>
                  <th className="hidden whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border sm:table-cell">
                    {t('Texto do alarme')}
                  </th>
                  <th className="hidden whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border md:table-cell">
                    {t('Data / Hora')}
                  </th>
                  <th className="hidden whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border lg:table-cell">
                    {t('Status')}
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
                    {t('Ações')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((alarm) => {
                  const isHighlighted = alarm.id === activeHighlight;
                  return (
                  <tr
                    key={alarm.id}
                    ref={isHighlighted ? (el: HTMLTableRowElement | null) => { highlightRef.current = el; } : undefined}
                    className={`transition-colors ${rowClasses(alarm, isHighlighted)}`}
                  >
                    {/* Dispositivo */}
                    <td className="px-4 py-4">
                      <p className="font-semibold text-foreground text-xs leading-tight truncate max-w-[160px]">
                        {alarm.deviceName}
                      </p>
                    </td>

                    {/* Cliente */}
                    {showTenantColumn && (
                      <td className="px-4 py-4">
                        <p className="text-xs font-medium text-cyan-700 truncate max-w-[120px]">
                          {alarm.tenantName}
                        </p>
                      </td>
                    )}

                    {/* Local */}
                    <td className="px-4 py-4">
                      <p className="text-xs text-muted-foreground truncate max-w-[180px]">
                        {alarm.site}
                      </p>
                    </td>

                    {/* Texto do alarme */}
                    <td className="hidden px-4 py-4 sm:table-cell max-w-[260px]">
                      <span className="block truncate text-xs font-medium text-foreground" title={alarm.alarmText}>
                        {alarm.alarmText}
                      </span>
                    </td>

                    {/* Data / Hora */}
                    <td className="hidden whitespace-nowrap px-4 py-4 md:table-cell">
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock size={11} strokeWidth={1.5} />
                        {formatDateTime(alarm.occurredAt)}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="hidden whitespace-nowrap px-4 py-4 lg:table-cell">
                      <StatusBadge status={alarm.status} />
                    </td>

                    {/* Actions */}
                    <td className="whitespace-nowrap px-4 py-4">
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => setDetailTarget(alarm)}
                          title={t('Ver detalhes')}
                          className="flex items-center gap-1 rounded-md border border-slate-200 bg-card px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                        >
                          <Eye size={12} strokeWidth={2} />
                          {t('Detalhes')}
                        </button>
                        {alarm.status === 'NORMAL' ? (
                          <button
                            type="button"
                            onClick={() => setAckTarget(alarm)}
                            className="flex items-center gap-1 rounded-md border border-primary/30 bg-card px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/5 transition-colors"
                          >
                            <CheckCircle2 size={12} strokeWidth={2} />
                            {t('Reconhecer')}
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled
                            title={t('Aguardando normalização no campo')}
                            className="flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2.5 py-1.5 text-xs font-medium text-gray-400 cursor-not-allowed"
                          >
                            <CheckCircle2 size={12} strokeWidth={2} />
                            {t('Reconhecer')}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Detail Dialog */}
      {detailTarget && (
        <DetailDialog
          alarm={detailTarget}
          onClose={() => setDetailTarget(null)}
        />
      )}

      {/* Acknowledge Dialog */}
      {ackTarget && (
        <AckDialog
          alarm={ackTarget}
          onConfirm={handleConfirm}
          onCancel={() => setAckTarget(null)}
          isPending={isAcknowledging}
        />
      )}
    </>
  );
}
