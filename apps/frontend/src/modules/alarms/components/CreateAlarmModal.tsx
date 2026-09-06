'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, X } from 'lucide-react';
import {
  createAlarmRule,
  updateAlarmRule,
  type AlarmCondition,
  type AlarmRuleItem,
  type AlarmSeverity,
} from '../services/alarms-api.service';
import { useT } from '@/lib/i18n';

interface Props {
  pointId: string;
  pointLabel: string;
  /** Ponto digital (BI/BO/BV/MSx) → Mudança de Estado; analógico → Intervalo de Valor. */
  isDigital: boolean;
  unit?: string | null;
  /** Regra existente → modo edição (pré-preenche e chama PATCH em vez de POST). */
  rule?: AlarmRuleItem;
  onClose: () => void;
  onCreated: () => void;
}

const SEVERITY_OPTS: { value: AlarmSeverity; label: string; cls: string }[] = [
  { value: 'LOW', label: 'Baixa', cls: 'border-blue-500 bg-blue-50 text-blue-700' },
  { value: 'MEDIUM', label: 'Média', cls: 'border-amber-500 bg-amber-50 text-amber-700' },
  { value: 'HIGH', label: 'Alta', cls: 'border-red-500 bg-red-50 text-red-700' },
];

const CONDITION_OPTS: { value: AlarmCondition; label: string; band: boolean }[] = [
  { value: 'GT', label: 'Maior que (>)', band: false },
  { value: 'GTE', label: 'Maior ou igual (≥)', band: false },
  { value: 'LT', label: 'Menor que (<)', band: false },
  { value: 'LTE', label: 'Menor ou igual (≤)', band: false },
  { value: 'OUTSIDE', label: 'Fora da faixa', band: true },
  { value: 'BETWEEN', label: 'Dentro da faixa', band: true },
];

export function CreateAlarmModal({ pointId, pointLabel, isDigital, unit, rule, onClose, onCreated }: Props) {
  const t = useT();
  const isEdit = !!rule;
  const [name, setName] = useState(rule?.name ?? pointLabel);
  const [message, setMessage] = useState(rule?.message ?? `${pointLabel} em alarme`);
  const [severity, setSeverity] = useState<AlarmSeverity>(rule?.severity ?? 'MEDIUM');
  const [delaySeconds, setDelaySeconds] = useState(rule?.delaySeconds ?? 0);
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);

  // Digital
  const [activationState, setActivationState] = useState(rule?.activationState ?? true);
  // Analógico
  const [condition, setCondition] = useState<AlarmCondition>(rule?.condition ?? 'GT');
  const [limitValue, setLimitValue] = useState(rule?.limitValue != null ? String(rule.limitValue) : '');
  const [limitLow, setLimitLow] = useState(rule?.limitLow != null ? String(rule.limitLow) : '');
  const [limitHigh, setLimitHigh] = useState(rule?.limitHigh != null ? String(rule.limitHigh) : '');
  const [hysteresis, setHysteresis] = useState(rule?.hysteresis != null ? String(rule.hysteresis) : '0');

  const [error, setError] = useState<string | null>(null);

  const isBand = CONDITION_OPTS.find((c) => c.value === condition)?.band ?? false;

  const mutation = useMutation({
    mutationFn: () => {
      const fields = {
        name: name.trim(),
        message: message.trim(),
        severity,
        delaySeconds,
        ...(isDigital
          ? { activationState }
          : {
              condition,
              limitValue: isBand ? null : Number(limitValue),
              limitLow: isBand ? Number(limitLow) : null,
              limitHigh: isBand ? Number(limitHigh) : null,
              hysteresis: Number(hysteresis) || 0,
            }),
      };
      if (isEdit) return updateAlarmRule(rule!.id, { ...fields, enabled });
      return createAlarmRule({
        pointId,
        type: isDigital ? 'STATE_CHANGE' : 'VALUE_RANGE',
        ...fields,
      });
    },
    onSuccess: () => {
      onCreated();
      onClose();
    },
    onError: (err: Error) => setError(err.message),
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError(t('Informe um nome para o alarme'));
    if (!message.trim()) return setError(t('Informe a mensagem do alarme'));
    if (!isDigital) {
      if (isBand) {
        if (limitLow === '' || limitHigh === '') return setError(t('Informe os limites inferior e superior'));
        if (Number(limitLow) > Number(limitHigh)) return setError(t('O limite inferior não pode ser maior que o superior'));
      } else if (limitValue === '') {
        return setError(t('Informe o valor limite'));
      }
    }
    mutation.mutate();
  }

  const inputCls =
    'w-full rounded-md border border-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">{isEdit ? t('Editar Alarme') : t('Criar Alarme')}</h2>
          <button type="button" onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="max-h-[70vh] space-y-4 overflow-y-auto px-6 py-5">
          <p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            {t('Ponto:')} <span className="font-medium text-foreground">{pointLabel}</span>
            <span className="ml-2 rounded-full border border-border bg-card px-1.5 py-0.5 text-[10px]">
              {isDigital ? t('digital') : t('analógico')}
            </span>
          </p>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">{t('Nome')}</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} autoFocus />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">{t('Mensagem')}</label>
            <input type="text" value={message} onChange={(e) => setMessage(e.target.value)} className={inputCls} />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">{t('Severidade')}</label>
            <div className="grid grid-cols-3 gap-2">
              {SEVERITY_OPTS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => setSeverity(s.value)}
                  className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                    severity === s.value ? s.cls : 'border-border text-muted-foreground hover:bg-muted/50'
                  }`}
                >
                  {t(s.label)}
                </button>
              ))}
            </div>
          </div>

          {isDigital ? (
            <div>
              <label className="mb-1.5 block text-sm font-medium text-foreground">{t('Dispara quando o estado for')}</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setActivationState(true)}
                  className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                    activationState ? 'border-cyan-600 bg-cyan-50 text-cyan-700' : 'border-border text-muted-foreground hover:bg-muted/50'
                  }`}
                >
                  {t('Ativo / Ligado (1)')}
                </button>
                <button
                  type="button"
                  onClick={() => setActivationState(false)}
                  className={`rounded-md border px-3 py-2 text-xs font-medium transition-colors ${
                    !activationState ? 'border-cyan-600 bg-cyan-50 text-cyan-700' : 'border-border text-muted-foreground hover:bg-muted/50'
                  }`}
                >
                  {t('Inativo / Desligado (0)')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">{t('Condição')}</label>
                <select value={condition} onChange={(e) => setCondition(e.target.value as AlarmCondition)} className={`${inputCls} cursor-pointer`}>
                  {CONDITION_OPTS.map((c) => (
                    <option key={c.value} value={c.value}>{t(c.label)}</option>
                  ))}
                </select>
              </div>

              {isBand ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-foreground">{t('Limite inferior')}</label>
                    <input type="number" step="any" value={limitLow} onChange={(e) => setLimitLow(e.target.value)} className={inputCls} placeholder={unit ?? ''} />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-foreground">{t('Limite superior')}</label>
                    <input type="number" step="any" value={limitHigh} onChange={(e) => setLimitHigh(e.target.value)} className={inputCls} placeholder={unit ?? ''} />
                  </div>
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-sm font-medium text-foreground">{t('Valor limite')} {unit ? `(${unit})` : ''}</label>
                  <input type="number" step="any" value={limitValue} onChange={(e) => setLimitValue(e.target.value)} className={inputCls} />
                </div>
              )}

              <div>
                <label className="mb-1 block text-sm font-medium text-foreground">{t('Histerese (banda morta)')}</label>
                <input type="number" step="any" min="0" value={hysteresis} onChange={(e) => setHysteresis(e.target.value)} className={inputCls} />
                <p className="mt-1 text-[11px] text-muted-foreground">{t('Margem para só normalizar após o valor recuar — evita oscilação.')}</p>
              </div>
            </>
          )}

          <div>
            <label className="mb-1 block text-sm font-medium text-foreground">{t('Atraso de disparo (segundos)')}</label>
            <input type="number" min="0" value={delaySeconds} onChange={(e) => setDelaySeconds(Number(e.target.value) || 0)} className={inputCls} />
            <p className="mt-1 text-[11px] text-muted-foreground">{t('A condição precisa persistir esse tempo antes de disparar.')}</p>
          </div>

          {isEdit && (
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="h-4 w-4 rounded border-border accent-cyan-700"
              />
              {t('Regra habilitada')}
            </label>
          )}

          {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="rounded-md border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors">
              {t('Cancelar')}
            </button>
            <button type="submit" disabled={mutation.isPending} className="flex items-center gap-2 rounded-md bg-cyan-700 px-4 py-2 text-sm font-medium text-white hover:bg-cyan-800 disabled:opacity-50 transition-colors">
              {mutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isEdit ? t('Salvar alterações') : t('Criar Alarme')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
