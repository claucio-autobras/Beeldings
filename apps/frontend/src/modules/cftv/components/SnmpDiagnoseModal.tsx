'use client';

/**
 * SnmpDiagnoseModal — componente compartilhado entre CFTV e SCA.
 *
 * Testa cada OID cadastrado e os candidatos de todos os perfis de fabricante
 * diretamente no dispositivo via gateway. Exibe sugestões aplicáveis e um
 * walk resumido da MIB. Funciona para câmeras e controladoras de acesso.
 */

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { useMutation } from '@tanstack/react-query';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  ScanSearch,
  X,
  XCircle,
} from 'lucide-react';
import type {
  DiagMetric,
  SnmpDiagnoseOutcome,
  SnmpDiagnoseProgress,
} from '../services/cftv.service';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Formata o valor cru de uma métrica de diagnóstico para exibição. */
function formatDiagValue(
  metric: DiagMetric,
  value: number | null | undefined,
  unit?: string,
): string | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  if (metric === 'uptime') {
    const s = value;
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }
  const u = unit?.trim() || '';
  const formatted =
    metric === 'temperature' ? value.toFixed(1) : String(Math.round(value));
  return u ? `${formatted}${u.startsWith('°') ? u : ' ' + u}` : formatted;
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface SnmpDiagnoseDevice {
  id: string;
  name: string;
  ip: string;
  port: number;
  community: string;
}

interface Props {
  device: SnmpDiagnoseDevice;
  /** Função que dispara o diagnóstico (ex.: diagnoseCameraSnmp ou diagnoseControllerSnmp). */
  diagnoseFn: (deviceId: string, diagnoseId: string) => Promise<SnmpDiagnoseOutcome>;
  /** Polling de progresso (ex.: getDiagnoseProgress da cftv ou sca service). */
  getProgressFn: (diagnoseId: string) => Promise<SnmpDiagnoseProgress | null>;
  /** Aplica os OIDs selecionados ao dispositivo. */
  applyFn: (deviceId: string, oids: Partial<Record<DiagMetric, string>>) => Promise<unknown>;
  onClose: () => void;
  onApplied: () => void;
  /** Rótulo do tipo de dispositivo exibido nos textos ("câmera" | "controladora"). */
  deviceLabel?: string;
}

// ─── Componente ──────────────────────────────────────────────────────────────

export function SnmpDiagnoseModal({
  device,
  diagnoseFn,
  getProgressFn,
  applyFn,
  onClose,
  onApplied,
  deviceLabel = 'dispositivo',
}: Props) {
  const t = useT();
  const [result, setResult] = useState<SnmpDiagnoseOutcome | null>(null);
  const [progress, setProgress] = useState<SnmpDiagnoseProgress | null>(null);
  const [selected, setSelected] = useState<Partial<Record<DiagMetric, string>>>({});
  const [walkOpen, setWalkOpen] = useState(false);
  const [walkFilter, setWalkFilter] = useState('');
  const [copiedOid, setCopiedOid] = useState<string | null>(null);
  const [techOpen, setTechOpen] = useState<Partial<Record<DiagMetric, boolean>>>({});
  const [applied, setApplied] = useState(false);
  const diagnoseIdRef = useRef<string | null>(null);

  const diagnose = useMutation({
    mutationFn: () => {
      const diagnoseId = crypto.randomUUID();
      diagnoseIdRef.current = diagnoseId;
      setResult(null);
      setProgress(null);
      return diagnoseFn(device.id, diagnoseId);
    },
    onSuccess: (outcome) => {
      setResult(outcome);
      // Pré-seleciona: 1º candidato que respondeu quando o OID atual não responde.
      const pre: Partial<Record<DiagMetric, string>> = {};
      for (const m of outcome.metrics) {
        if (m.currentResponded || (!m.pointId && m.metric === 'uptime')) continue;
        const suggestion = m.candidates.find((c) => c.responded && !c.isCurrent);
        if (suggestion) pre[m.metric] = suggestion.oid;
      }
      setSelected(pre);
    },
    onSettled: () => {
      diagnoseIdRef.current = null;
      setProgress(null);
    },
  });

  // Dispara automaticamente ao abrir.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    diagnose.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Aviso de espera longa quando não há progresso após 6s.
  const [waitingLong, setWaitingLong] = useState(false);
  useEffect(() => {
    if (!diagnose.isPending || progress) {
      setWaitingLong(false);
      return;
    }
    const handle = setTimeout(() => setWaitingLong(true), 6000);
    return () => clearTimeout(handle);
  }, [diagnose.isPending, progress]);

  // Polling do progresso enquanto o diagnóstico roda.
  useEffect(() => {
    if (!diagnose.isPending) return;
    const interval = setInterval(async () => {
      const id = diagnoseIdRef.current;
      if (!id) return;
      try {
        const p = await getProgressFn(id);
        if (p && diagnoseIdRef.current === id) setProgress(p);
      } catch {
        // best-effort
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [diagnose.isPending, getProgressFn]);

  const apply = useMutation({
    mutationFn: () => applyFn(device.id, selected),
    onSuccess: () => {
      setApplied(true);
      onApplied();
    },
  });

  const selectedCount = Object.keys(selected).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-xl border border-border bg-card p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            {t('Diagnóstico SNMP —')} {device.name}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          {t('Testa cada OID cadastrado e os OIDs conhecidos de todos os perfis de fabricante')}{' '}
          {t('diretamente no')} {deviceLabel} {device.ip}, {t('via gateway.')}
        </p>

        {diagnose.isPending && !result && (
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm text-muted-foreground space-y-2">
            <p className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {progress
                ? progress.phase === 'walk'
                  ? `${t('Explorando a MIB…')} (${progress.tested}/${progress.total} ${t('subárvores')})`
                  : `${t('Testando OIDs…')} ${progress.tested}/${progress.total}`
                : waitingLong
                  ? t('Ainda aguardando o gateway responder… ele pode estar ocupado ou lento.')
                  : t('Iniciando o diagnóstico no gateway…')}
            </p>
            {progress && progress.total > 0 && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.round((progress.tested / progress.total) * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {diagnose.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400 space-y-2">
            <p>
              {/em andamento/i.test((diagnose.error as Error).message)
                ? `O gateway está ocupado com outro diagnóstico SNMP. Aguarde e tente novamente.`
                : (diagnose.error as Error).message}
            </p>
            <button
              type="button"
              onClick={() => diagnose.mutate()}
              className="rounded-md border border-red-300 px-2.5 py-1 font-medium hover:bg-red-100 dark:border-red-500/40 dark:hover:bg-red-500/20"
            >
              {t('Tentar novamente')}
            </button>
          </div>
        )}

        {result && !result.reachable && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
            {result.cause === 'community' ? (
              <>
                {t('O')} {deviceLabel} {t('respondeu com a community padrão')}{' '}
                <span className="font-mono">public</span>, {t('mas não com a community configurada')} (<span className="font-mono">{device.community || '—'}</span>).{' '}
                {t('Corrija a community no cadastro.')}
              </>
            ) : (
              <>
                {t('O')} {deviceLabel} {t('não respondeu ao SNMP em nenhuma tentativa (nem ao teste com a community padrão). Verifique se o SNMP está habilitado, a porta')} ({device.port}) {t('e a conectividade de rede a partir do gateway.')}
              </>
            )}
          </div>
        )}

        {result && result.reachable && (
          <>
            {result.sysDescr && (
              <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground font-mono break-all">
                {result.sysDescr}
              </p>
            )}

            <div className="space-y-3">
              {result.metrics.map((m) => {
                const suggestions = m.candidates.filter((c) => c.responded && !c.isCurrent);
                const hasSuggestions =
                  suggestions.length > 0 && (!!m.pointId || m.metric !== 'uptime');
                const friendly = formatDiagValue(
                  m.metric,
                  m.currentValue,
                );
                const isTechOpen = !!techOpen[m.metric];
                return (
                  <div key={m.metric} className="rounded-lg border border-border p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-baseline gap-2 min-w-0">
                        <p className="text-sm font-medium text-foreground">{m.label}</p>
                        {m.currentResponded && friendly !== null && (
                          <p className="text-base font-semibold text-foreground">{friendly}</p>
                        )}
                      </div>
                      {!m.supported ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {t('não suportada pelo')} {deviceLabel}
                        </span>
                      ) : m.currentResponded ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                          <CheckCircle2 className="h-3 w-3" /> {t('Funcionando')}
                        </span>
                      ) : hasSuggestions ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                          <ScanSearch className="h-3 w-3" /> {t('Sugestão disponível')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700 dark:bg-red-500/15 dark:text-red-400">
                          <XCircle className="h-3 w-3" /> {t('Não funciona')}
                        </span>
                      )}
                    </div>

                    {!m.currentOid && m.supported && (
                      <p className="text-xs text-muted-foreground">
                        {t('Sem OID cadastrado para esta métrica.')}
                      </p>
                    )}

                    {hasSuggestions && (
                      <div className="space-y-1">
                        <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                          {t('Alternativas que funcionaram')}
                        </p>
                        {suggestions.map((c) => (
                          <label
                            key={c.oid}
                            className="flex items-start gap-2 rounded-md border border-border px-2.5 py-1.5 text-xs cursor-pointer hover:bg-muted/50"
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5 h-3.5 w-3.5 accent-primary"
                              checked={selected[m.metric] === c.oid}
                              onChange={(e) =>
                                setSelected((prev) => {
                                  const next = { ...prev };
                                  if (e.target.checked) next[m.metric] = c.oid;
                                  else delete next[m.metric];
                                  return next;
                                })
                              }
                            />
                            <span className="min-w-0">
                              <span className="font-medium text-foreground">
                                {c.profileLabel}
                              </span>
                              <span className="text-muted-foreground">
                                {' '}— {t('leu')}{' '}
                                <span className="font-medium text-foreground">
                                  {formatDiagValue(m.metric, c.value, c.unit) ?? c.raw ?? '—'}
                                </span>
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() =>
                        setTechOpen((prev) => ({ ...prev, [m.metric]: !prev[m.metric] }))
                      }
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
                    >
                      {isTechOpen ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                      {t('Detalhes técnicos')}
                    </button>
                    {isTechOpen && (
                      <div className="rounded-md bg-muted/40 px-2.5 py-2 text-[11px] text-muted-foreground space-y-1">
                        {m.currentOid ? (
                          <p className="break-all">
                            <span className="font-medium">{t('OID atual:')}</span>{' '}
                            <span className="font-mono">{m.currentOid}</span>
                            {m.currentResponded && (
                              <>
                                {' '}
                                <span className="text-foreground">
                                  = {m.currentRaw ?? m.currentValue}
                                </span>
                              </>
                            )}
                          </p>
                        ) : (
                          <p>{t('Sem OID cadastrado para esta métrica.')}</p>
                        )}
                        {suggestions.map((c) => (
                          <p key={c.oid} className="break-all">
                            <span className="font-medium">{c.profileLabel}:</span>{' '}
                            <span className="font-mono">{c.oid}</span>{' '}
                            <span className="text-foreground">= {c.raw ?? c.value}</span>
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Walk resumido (avançado) */}
            <div className="rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setWalkOpen((v) => !v)}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/50"
              >
                {walkOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                {t('Avançado: OIDs expostos pelo')} {deviceLabel} {t('(walk resumido)')}
              </button>
              {walkOpen && (
                <div className="border-t border-border px-3 py-2 space-y-3">
                  {result.walk.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      {t('Nenhuma subárvore respondeu.')}
                    </p>
                  ) : (
                    <input
                      value={walkFilter}
                      onChange={(e) => setWalkFilter(e.target.value)}
                      placeholder={t('Buscar por OID ou valor…')}
                      className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  )}
                  <div className="space-y-3 max-h-72 overflow-y-auto">
                    {result.walk.map((section) => {
                      const q = walkFilter.trim().toLowerCase();
                      const entries = q
                        ? section.entries.filter(
                            (e) =>
                              e.oid.toLowerCase().includes(q) ||
                              e.value.toLowerCase().includes(q),
                          )
                        : section.entries;
                      if (q && entries.length === 0) return null;
                      return (
                        <div key={section.root} className="space-y-1">
                          <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                            {section.label}
                            {section.truncated ? ` ${t('(parcial)')}` : ''} — {entries.length}
                            {q ? ` de ${section.entries.length}` : ''} OID
                            {entries.length !== 1 ? 's' : ''}
                          </p>
                          {entries.length > 0 && (
                            <ul className="space-y-0.5 font-mono text-[11px] text-muted-foreground">
                              {entries.map((e) => (
                                <li
                                  key={e.oid}
                                  className="group flex items-start gap-1.5 break-all"
                                >
                                  <span className="min-w-0">
                                    {e.oid} = {e.value}
                                  </span>
                                  <button
                                    type="button"
                                    title={t('Copiar OID')}
                                    onClick={() => {
                                      void navigator.clipboard?.writeText(e.oid);
                                      setCopiedOid(e.oid);
                                      setTimeout(
                                        () =>
                                          setCopiedOid((c) => (c === e.oid ? null : c)),
                                        1500,
                                      );
                                    }}
                                    className="shrink-0 rounded border border-border px-1 text-[10px] text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                                  >
                                    {copiedOid === e.oid ? t('copiado') : t('copiar')}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {apply.error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            {(apply.error as Error).message}
          </p>
        )}
        {applied && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
            {t('OIDs aplicados — o gateway já recebeu a nova configuração.')}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            {t('Fechar')}
          </button>
          {result?.reachable && (
            <button
              type="button"
              disabled={selectedCount === 0 || apply.isPending}
              onClick={() => {
                setApplied(false);
                apply.mutate();
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {apply.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {selectedCount === 1 ? t('Aplicar sugestão') : t('Aplicar sugestões')}
              {selectedCount > 0 ? ` (${selectedCount})` : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
