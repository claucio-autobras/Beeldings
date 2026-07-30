'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import { createTrend, updateTrend, type TrendItem, type TrendMode } from '../services/trends-api.service';
import { useT } from '@/lib/i18n';

interface Props {
  pointId: string;
  pointLabel: string;
  /** Ponto digital (BI/BO/BV/MSx)? Desliga o campo de COV (deadband só faz sentido em analógico). */
  isDigital?: boolean;
  unit?: string | null;
  /** Trend existente → modo edição (pré-preenche e chama PATCH em vez de POST). */
  trend?: TrendItem;
  onClose: () => void;
  onCreated: () => void;
}

const INTERVAL_OPTS = [
  { value: 60, label: '1 minuto' },
  { value: 300, label: '5 minutos' },
  { value: 900, label: '15 minutos' },
  { value: 1800, label: '30 minutos' },
  { value: 3600, label: '1 hora' },
];
const HEARTBEAT_OPTS = [
  { value: 0, label: 'Desligado' },
  { value: 300, label: '5 minutos' },
  { value: 900, label: '15 minutos' },
  { value: 1800, label: '30 minutos' },
  { value: 3600, label: '1 hora' },
];
const RETENTION_OPTS = [
  { value: 30, label: '30 dias' },
  { value: 60, label: '60 dias' },
  { value: 90, label: '90 dias' },
];

export function CreateTrendModal({ pointId, pointLabel, isDigital = false, unit, trend, onClose, onCreated }: Props) {
  const t = useT();
  const isEdit = !!trend;
  const [name, setName] = useState(trend?.name ?? pointLabel);
  const [mode, setMode] = useState<TrendMode>(trend?.mode ?? 'INTERVAL');
  const [intervalSeconds, setIntervalSeconds] = useState(trend?.intervalSeconds ?? 300);
  const [covThreshold, setCovThreshold] = useState(trend?.covThreshold ?? 0);
  const [maxIntervalSeconds, setMaxIntervalSeconds] = useState(trend?.maxIntervalSeconds ?? 0);
  const [retentionDays, setRetentionDays] = useState(trend?.retentionDays ?? 90);
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => {
      const fields = {
        name: name.trim(),
        mode,
        intervalSeconds: mode === 'INTERVAL' ? intervalSeconds : null,
        // COV só em analógico; heartbeat só no modo por mudança.
        covThreshold: mode === 'ON_CHANGE' && !isDigital && covThreshold > 0 ? covThreshold : null,
        maxIntervalSeconds: mode === 'ON_CHANGE' && maxIntervalSeconds > 0 ? maxIntervalSeconds : null,
        retentionDays,
      };
      if (isEdit) return updateTrend(trend!.id, fields);
      return createTrend({
        pointId,
        ...fields,
        intervalSeconds: fields.intervalSeconds ?? undefined,
      });
    },
    onSuccess: () => { onCreated(); onClose(); },
    onError: (err: Error) => setError(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) { setError(t('Informe um nome para a trend')); return; }
    mutation.mutate();
  }

  const inputCls = 'w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">{isEdit ? t('Editar Trend (histórico)') : t('Criar Trend (histórico)')}</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            Ponto: <span className="font-medium text-foreground">{pointLabel}</span>
          </p>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Nome</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} autoFocus />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">Modo de coleta</label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setMode('INTERVAL')}
                className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${mode === 'INTERVAL' ? 'border-cyan-600 bg-cyan-50 text-cyan-700' : 'border-border text-muted-foreground hover:bg-muted/50'}`}>
                Por intervalo
              </button>
              <button type="button" onClick={() => setMode('ON_CHANGE')}
                className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${mode === 'ON_CHANGE' ? 'border-cyan-600 bg-cyan-50 text-cyan-700' : 'border-border text-muted-foreground hover:bg-muted/50'}`}>
                Por mudança
              </button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {mode === 'INTERVAL' ? 'Grava uma amostra a cada intervalo fixo.' : 'Grava apenas quando o valor muda.'}
            </p>
          </div>

          {mode === 'INTERVAL' && (
            <div>
              <label className="mb-1 block text-sm font-medium text-foreground">Intervalo</label>
              <select value={intervalSeconds} onChange={(e) => setIntervalSeconds(Number(e.target.value))} className={`${inputCls} cursor-pointer`}>
                {INTERVAL_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}

          {mode === 'ON_CHANGE' && (
            <>
              {!isDigital && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">
                    Variação mínima (COV){unit ? <span className="text-muted-foreground"> · {unit}</span> : null}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    value={covThreshold}
                    onChange={(e) => setCovThreshold(Math.max(0, Number(e.target.value)))}
                    className={inputCls}
                  />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Só grava quando o valor variar pelo menos isso. 0 = grava qualquer mudança.
                  </p>
                </div>
              )}
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">Gravar no máximo a cada (heartbeat)</label>
                <select value={maxIntervalSeconds} onChange={(e) => setMaxIntervalSeconds(Number(e.target.value))} className={`${inputCls} cursor-pointer`}>
                  {HEARTBEAT_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Mesmo sem variação, garante uma amostra periódica (evita buracos no gráfico).
                </p>
              </div>
            </>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">Retenção</label>
            <select value={retentionDays} onChange={(e) => setRetentionDays(Number(e.target.value))} className={`${inputCls} cursor-pointer`}>
              {RETENTION_OPTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">Dados mais antigos que isso são apagados automaticamente.</p>
          </div>

          {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors">Cancelar</button>
            <button type="submit" disabled={mutation.isPending} className="flex items-center gap-2 rounded-md bg-cyan-700 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-800 disabled:opacity-50 transition-colors">
              {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isEdit ? t('Salvar alterações') : t('Criar Trend')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
