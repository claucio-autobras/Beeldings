'use client';

import { useState } from 'react';
import { Bell, Check, Clock, Eye, Loader2, RefreshCw, X } from 'lucide-react';
import type { AlarmEventItem, AlarmEventState, AlarmSeverity } from '../services/alarms-api.service';
import { useT, useLanguage } from '@/lib/i18n';

interface Props {
  events: AlarmEventItem[];
  onAcknowledge: (eventId: string, note: string) => void;
  onAcknowledgeMany?: (ids: string[], note: string) => Promise<unknown>;
  acknowledgingId?: string | null;
  bulkPending?: boolean;
  showTenantColumn?: boolean;
  highlightId?: string;
}

const SEVERITY: Record<AlarmSeverity, { label: string; cls: string }> = {
  HIGH: { label: 'Alta', cls: 'border-red-200 bg-red-100 text-red-700' },
  MEDIUM: { label: 'Média', cls: 'border-amber-200 bg-amber-100 text-amber-700' },
  LOW: { label: 'Baixa', cls: 'border-blue-200 bg-blue-100 text-blue-700' },
};

const STATE: Record<AlarmEventState, { label: string; cls: string }> = {
  ACTIVE: { label: 'Ativo', cls: 'border-red-200 bg-red-50 text-red-700' },
  ACTIVE_ACK: { label: 'Ativo · reconhecido', cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  NORMALIZED_UNACK: { label: 'Normalizado · aguarda ACK', cls: 'border-blue-200 bg-blue-50 text-blue-700' },
  NORMALIZED_ACK: { label: 'Normalizado', cls: 'border-border bg-muted text-muted-foreground' },
};

// Só normalizados sem ACK são reconhecíveis. Alarmes ativos ainda em condição de
// alarme não podem ser reconhecidos (nem selecionados para ACK em massa).
const PENDING_ACK: AlarmEventState[] = ['NORMALIZED_UNACK'];

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ─── Detail Dialog ────────────────────────────────────────────────────────────

function DetailDialog({ event, onClose }: { event: AlarmEventItem; onClose: () => void }) {
  const t = useT();
  const lang = useLanguage();
  const sev = SEVERITY[event.severity];
  const st = STATE[event.state];
  const value = event.valueAtTrigger === null ? '—' : `${event.valueAtTrigger}${event.unit ? ` ${event.unit}` : ''}`;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">
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

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${sev.cls}`}>{t(sev.label)}</span>
            <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{t(st.label)}</span>
            {event.reactivationCount > 0 && (
              <span className="inline-flex items-center gap-1 rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700">
                <RefreshCw size={10} strokeWidth={2} />
                {lang === 'en' ? `reactivated ${event.reactivationCount}×` : `reativou ${event.reactivationCount}×`}
              </span>
            )}
          </div>

          <div>
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">{t('Alarme')}</p>
            <p className="text-sm font-semibold text-foreground leading-snug">{event.name}</p>
            <p className="text-xs text-muted-foreground">{event.message}</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">{t('Equipamento')}</p>
              <p className="text-xs text-foreground font-medium">{event.deviceName}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">{t('Ponto')}</p>
              <p className="text-xs text-foreground">{event.objectName || event.tag}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">{t('Valor no disparo')}</p>
              <p className="text-xs text-foreground">{value}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">{t('Ativado em')}</p>
              <p className="flex items-center gap-1 text-xs text-foreground">
                <Clock size={11} strokeWidth={1.5} className="text-muted-foreground" />
                {fmtDate(event.activatedAt)}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">{t('Normalizado em')}</p>
              <p className="text-xs text-foreground">{fmtDate(event.normalizedAt)}</p>
            </div>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">{t('Reconhecido em')}</p>
              <p className="text-xs text-foreground">{fmtDate(event.acknowledgedAt)}</p>
            </div>
          </div>

          {event.reactivationCount > 0 && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">{t('Reativações')}</p>
                <p className="text-xs text-foreground">
                  {lang === 'en'
                    ? `${event.reactivationCount}× before acknowledgment`
                    : `${event.reactivationCount}× antes do reconhecimento`}
                </p>
              </div>
              <div>
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">{t('Última reativação')}</p>
                <p className="text-xs text-foreground">{fmtDate(event.lastReactivatedAt)}</p>
              </div>
            </div>
          )}

          {event.ackNote && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-0.5">{t('Motivo do reconhecimento')}</p>
              <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground leading-relaxed">
                {event.ackNote}
              </p>
              {event.acknowledgedBy && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {t('Por')} {event.acknowledgedByName ?? t('Usuário removido')}
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
  event: AlarmEventItem;
  onConfirm: (note: string) => void;
  onCancel: () => void;
  isPending: boolean;
}

function AckDialog({ event, onConfirm, onCancel, isPending }: AckDialogProps) {
  const t = useT();
  const [note, setNote] = useState('');
  const noteValid = note.trim().length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">{t('Reconhecer Alarme')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {event.deviceName} · {event.objectName || event.tag}
          </p>
          <p className="mt-1 text-xs font-medium text-foreground">{event.name}</p>
          <p className="mt-0.5 text-[11px] text-muted-foreground flex items-center gap-1">
            <Clock size={10} strokeWidth={1.5} />
            {fmtDate(event.activatedAt)}
          </p>
        </div>

        <div className="px-5 py-4 space-y-3">
          <div>
            <label htmlFor="ack-note" className="block text-xs font-medium text-foreground mb-1">
              {t('Motivo')} <span className="text-red-500">*</span>
            </label>
            <textarea
              id="ack-note"
              required
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('Descreva o motivo do reconhecimento ou a ação tomada...')}
              rows={3}
              className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">{t('Obrigatório — esta nota fica registrada e aparece no relatório de alarmes.')}</p>
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
            onClick={() => onConfirm(note.trim())}
            disabled={isPending || !noteValid}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} strokeWidth={2} />}
            {isPending ? t('Salvando...') : t('Confirmar')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Bulk Acknowledge Dialog ──────────────────────────────────────────────────

function BulkAckDialog({
  count,
  onConfirm,
  onCancel,
  isPending,
  errorMessage,
}: {
  count: number;
  onConfirm: (note: string) => void;
  onCancel: () => void;
  isPending: boolean;
  errorMessage?: string | null;
}) {
  const t = useT();
  const lang = useLanguage();
  const [note, setNote] = useState('');
  const noteValid = note.trim().length > 0;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl">
        <div className="border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">
            {lang === 'en' ? `Acknowledge ${count} alarm(s)` : `Reconhecer ${count} alarme(s)`}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('O reconhecimento será aplicado a todas as ocorrências selecionadas.')}
          </p>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label htmlFor="bulk-ack-note" className="block text-xs font-medium text-foreground mb-1">
              {t('Motivo')} <span className="text-red-500">*</span>
            </label>
            <textarea
              id="bulk-ack-note"
              required
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('Descreva o motivo do reconhecimento ou a ação tomada...')}
              rows={3}
              className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t('Obrigatório — a mesma nota será registrada em todas as ocorrências selecionadas.')}
            </p>
          </div>
          {errorMessage && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {errorMessage}
            </div>
          )}
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
            onClick={() => onConfirm(note.trim())}
            disabled={isPending || !noteValid}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
          >
            {isPending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} strokeWidth={2} />}
            {isPending ? t('Salvando...') : t('Confirmar')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Table ────────────────────────────────────────────────────────────────────

export function AlarmEventsTable({
  events,
  onAcknowledge,
  onAcknowledgeMany,
  acknowledgingId,
  bulkPending,
  showTenantColumn,
  highlightId,
}: Props) {
  const t = useT();
  const lang = useLanguage();
  const [detailTarget, setDetailTarget] = useState<AlarmEventItem | null>(null);
  const [ackTarget, setAckTarget] = useState<AlarmEventItem | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const bulkEnabled = !!onAcknowledgeMany;
  const ackableIds = events.filter((e) => PENDING_ACK.includes(e.state)).map((e) => e.id);
  const ackableSet = new Set(ackableIds);
  const selectedIds = [...selected].filter((id) => ackableSet.has(id));
  const allSelected = ackableIds.length > 0 && selectedIds.length === ackableIds.length;

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(ackableIds));
  const clearSelection = () => setSelected(new Set());

  const handleConfirm = (note: string) => {
    if (!ackTarget) return;
    onAcknowledge(ackTarget.id, note);
    setAckTarget(null);
  };

  // Só fecha o diálogo e limpa a seleção após o sucesso — em caso de falha o
  // usuário vê a mensagem de erro e mantém os alarmes selecionados.
  const handleBulkConfirm = async (note: string) => {
    if (selectedIds.length === 0 || !onAcknowledgeMany) return;
    setBulkError(null);
    try {
      await onAcknowledgeMany(selectedIds, note);
      setBulkOpen(false);
      clearSelection();
    } catch (err) {
      const detail = err instanceof Error && err.message ? err.message : t('Erro desconhecido');
      setBulkError(`${t('Falha ao reconhecer os alarmes selecionados.')} ${detail}`);
    }
  };

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-muted/20 py-12 text-center">
        <Bell size={32} strokeWidth={1.5} className="mb-3 text-muted-foreground/50" />
        <p className="text-sm font-medium text-foreground">{t('Nenhum alarme')}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('Nenhuma ocorrência para os filtros atuais.')}</p>
      </div>
    );
  }

  return (
    <>
      {bulkEnabled && selectedIds.length > 0 && (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-cyan-200 bg-cyan-50 px-4 py-2.5">
          <span className="text-sm font-medium text-cyan-800">
            {lang === 'en' ? `${selectedIds.length} selected` : `${selectedIds.length} selecionado(s)`}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={clearSelection}
              className="rounded-md border border-cyan-300 bg-card px-3 py-1.5 text-xs font-medium text-cyan-700 hover:bg-cyan-100 transition-colors"
            >
              {t('Limpar')}
            </button>
            <button
              type="button"
              onClick={() => setBulkOpen(true)}
              disabled={bulkPending}
              className="flex items-center gap-1.5 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-700 disabled:opacity-50 transition-colors"
            >
              {bulkPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {t('Reconhecer selecionados')}
            </button>
          </div>
        </div>
      )}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-muted/40 text-left text-xs font-medium text-muted-foreground">
            <tr>
              {bulkEnabled && (
                <th className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    aria-label={t('Selecionar todos')}
                    checked={allSelected}
                    onChange={toggleAll}
                    disabled={ackableIds.length === 0}
                    className="h-4 w-4 cursor-pointer rounded border-border accent-cyan-600 disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </th>
              )}
              <th className="px-3 py-2.5">{t('Severidade')}</th>
              <th className="px-3 py-2.5">{t('Alarme')}</th>
              {showTenantColumn && <th className="px-3 py-2.5">{t('Cliente')}</th>}
              <th className="px-3 py-2.5">{t('Ponto')}</th>
              <th className="px-3 py-2.5">{t('Valor')}</th>
              <th className="px-3 py-2.5">{t('Estado')}</th>
              <th className="px-3 py-2.5 whitespace-nowrap">{t('Ativado')}</th>
              <th className="px-3 py-2.5 whitespace-nowrap">{t('Normalizado')}</th>
              <th className="px-3 py-2.5">{t('Reconhec.')}</th>
              <th className="px-3 py-2.5 text-right">{t('Ações')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {events.map((e) => {
              const sev = SEVERITY[e.severity];
              const st = STATE[e.state];
              const canAck = PENDING_ACK.includes(e.state);
              const isAck = acknowledgingId === e.id;
              const isSelected = selected.has(e.id) && canAck;
              const rowCls = isSelected
                ? 'bg-cyan-50/70'
                : highlightId === e.id
                  ? 'bg-cyan-50'
                  : 'hover:bg-muted/20';
              return (
                <tr key={e.id} className={rowCls}>
                  {bulkEnabled && (
                    <td className="px-3 py-2.5">
                      {canAck && (
                        <input
                          type="checkbox"
                          aria-label={t('Selecionar alarme')}
                          checked={isSelected}
                          onChange={() => toggleOne(e.id)}
                          className="h-4 w-4 cursor-pointer rounded border-border accent-cyan-600"
                        />
                      )}
                    </td>
                  )}
                  <td className="px-3 py-2.5">
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${sev.cls}`}>{t(sev.label)}</span>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-foreground">{e.name}</div>
                    <div className="text-xs text-muted-foreground">{e.message}</div>
                  </td>
                  {showTenantColumn && <td className="px-3 py-2.5 text-xs text-muted-foreground">{e.tenantName}</td>}
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    <div className="text-foreground">{e.objectName || e.tag}</div>
                    <div>{e.deviceName}</div>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {e.valueAtTrigger === null ? '—' : `${e.valueAtTrigger}${e.unit ? ` ${e.unit}` : ''}`}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-col items-start gap-1">
                      <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium ${st.cls}`}>{t(st.label)}</span>
                      {e.reactivationCount > 0 && (
                        <span
                          title={
                            e.lastReactivatedAt
                              ? `${t('Última reativação:')} ${fmtDate(e.lastReactivatedAt)}`
                              : undefined
                          }
                          className="inline-flex items-center gap-1 rounded-md border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] font-medium text-orange-700"
                        >
                          <RefreshCw size={10} strokeWidth={2} />
                          {lang === 'en' ? `reactivated ${e.reactivationCount}×` : `reativou ${e.reactivationCount}×`}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{fmtDate(e.activatedAt)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-xs text-muted-foreground">{fmtDate(e.normalizedAt)}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">
                    {e.acknowledgedBy ? fmtDate(e.acknowledgedAt) : '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        type="button"
                        onClick={() => setDetailTarget(e)}
                        title={t('Ver detalhes')}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-card px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                      >
                        <Eye className="h-3 w-3" />
                        {t('Detalhes')}
                      </button>
                      {canAck && (
                        <button
                          type="button"
                          onClick={() => setAckTarget(e)}
                          disabled={isAck}
                          className="inline-flex items-center gap-1 rounded-md border border-cyan-200 px-2.5 py-1 text-xs font-medium text-cyan-700 hover:bg-cyan-50 disabled:opacity-50 transition-colors"
                        >
                          {isAck ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
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

      {detailTarget && <DetailDialog event={detailTarget} onClose={() => setDetailTarget(null)} />}
      {ackTarget && (
        <AckDialog
          event={ackTarget}
          onConfirm={handleConfirm}
          onCancel={() => setAckTarget(null)}
          isPending={acknowledgingId === ackTarget.id}
        />
      )}
      {bulkOpen && (
        <BulkAckDialog
          count={selectedIds.length}
          onConfirm={(note) => void handleBulkConfirm(note)}
          onCancel={() => {
            setBulkOpen(false);
            setBulkError(null);
          }}
          isPending={!!bulkPending}
          errorMessage={bulkError}
        />
      )}
    </>
  );
}
