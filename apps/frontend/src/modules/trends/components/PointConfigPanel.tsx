'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Gauge, LineChart, Loader2, Pencil, Plus, Save, Trash2, Waves, Zap } from 'lucide-react';
import { deleteTrend, type TrendItem } from '../services/trends-api.service';
import { CreateTrendModal } from './CreateTrendModal';
import { CreateAlarmModal } from '@/modules/alarms/components/CreateAlarmModal';
import { deleteAlarmRule, type AlarmRuleItem } from '@/modules/alarms/services/alarms-api.service';
import {
  setPointOpRole,
  setPointSiteMetric,
  type PointOpRole,
  type PointSiteMetric,
  type PointSiteMetricMode,
} from '@/modules/devices/services/devices.service';
import { useT } from '@/lib/i18n';
import { useCurrentUser } from '@/hooks/useCurrentUser';

interface Props {
  pointId: string;
  pointLabel: string;
  /** Ponto digital (BI/BO/BV/MSx)? Define o tipo de alarme oferecido. */
  isDigital?: boolean;
  unit?: string | null;
  /** Trend existente deste ponto (se houver). */
  trend?: TrendItem;
  /** Regra de alarme existente deste ponto (se houver). */
  alarmRule?: AlarmRuleItem;
  /** Chamado após criar/remover trend para o pai recarregar. */
  onChanged: () => void;
  /** Chamado após criar/remover alarme. Padrão: onChanged. */
  onAlarmChanged?: () => void;
  /** ID do dispositivo — habilita o seletor de papel operacional. */
  deviceId?: string;
  /** Exibe a classificação para energia, água e horas no dashboard do site. */
  showSiteMetric?: boolean;
  /** Papel operacional atual do ponto (status | mode | setpoint | null). */
  opRole?: PointOpRole;
  /** Chamado após salvar o papel operacional (para o pai atualizar o estado local). */
  onOpRoleChanged?: (pointId: string, opRole: PointOpRole) => void;
  /** Fonte explícita da visão geral do site. */
  siteMetric?: PointSiteMetric;
  siteMetricMode?: PointSiteMetricMode;
  onSiteMetricChanged?: (
    pointId: string,
    siteMetric: PointSiteMetric,
    siteMetricMode: PointSiteMetricMode,
    unit: string,
  ) => void;
}

const OP_ROLE_OPTIONS: {
  value: '' | 'status' | 'fault' | 'mode' | 'setpoint';
  label: string;
  /** Explicação curta em linguagem simples, mostrada abaixo do seletor. */
  description: string;
}[] = [
  { value: '', label: 'Nenhum', description: 'Sem papel definido — no card Ativos Críticos o item aparece só com o estado de comunicação.' },
  { value: 'status', label: 'Status', description: 'Informa se o equipamento está ligado ou desligado — o card Ativos Críticos mostra "Ligado há X" ou "Desligado".' },
  { value: 'fault', label: 'Falha', description: 'Informa se o equipamento está em defeito — valor ativo mostra o item como "Em falha há X" no card, mesmo sem regra de alarme.' },
  { value: 'mode', label: 'Modo', description: 'Modo de operação (ex.: automático/manual) — usado pela IA para análise, não afeta o card.' },
  { value: 'setpoint', label: 'Setpoint', description: 'Valor de ajuste desejado — usado pela IA para análise, não afeta o card.' },
];

const INTERVAL_LABEL: Record<number, string> = { 60: '1 min', 300: '5 min', 900: '15 min', 1800: '30 min', 3600: '1 h' };

const SEVERITY_LABEL: Record<string, { label: string; cls: string }> = {
  HIGH: { label: 'Alta', cls: 'border-red-200 bg-red-50 text-red-700' },
  MEDIUM: { label: 'Média', cls: 'border-amber-200 bg-amber-50 text-amber-700' },
  LOW: { label: 'Baixa', cls: 'border-blue-200 bg-blue-50 text-blue-700' },
};

const CONDITION_LABEL: Record<string, string> = {
  GT: '>', GTE: '≥', LT: '<', LTE: '≤', OUTSIDE: 'fora de', BETWEEN: 'dentro de',
};

function describeRule(r: AlarmRuleItem): string {
  if (r.type === 'STATE_CHANGE') {
    return `Mudança de estado → dispara em ${r.activationState ? 'Ativo (1)' : 'Inativo (0)'}`;
  }
  const c = r.condition ?? 'GT';
  if (c === 'BETWEEN' || c === 'OUTSIDE') {
    return `Valor ${CONDITION_LABEL[c]} [${r.limitLow}, ${r.limitHigh}]`;
  }
  return `Valor ${CONDITION_LABEL[c]} ${r.limitValue}`;
}

/** Painel de configuração de um ponto: Trend (histórico) e Alarme. */
export function PointConfigPanel({
  pointId, pointLabel, isDigital = false, unit, trend, alarmRule, onChanged, onAlarmChanged,
  deviceId, showSiteMetric = true, opRole, onOpRoleChanged,
  siteMetric, siteMetricMode, onSiteMetricChanged,
}: Props) {
  const t = useT();
  const user = useCurrentUser();
  const canEditSemantics = ['ADMIN', 'CCO', 'SUPERVISOR'].includes(user.role);
  const [creating, setCreating] = useState(false);
  const [role, setRole] = useState<PointOpRole>(opRole ?? null);
  const [savingRole, setSavingRole] = useState(false);
  const [roleError, setRoleError] = useState(false);
  const [metric, setMetric] = useState<PointSiteMetric>(siteMetric ?? null);
  const [metricMode, setMetricMode] = useState<PointSiteMetricMode>(siteMetricMode ?? null);
  const [metricUnit, setMetricUnit] = useState(unit ?? '');
  const [savingMetric, setSavingMetric] = useState(false);
  const [metricError, setMetricError] = useState<string | null>(null);

  async function handleRoleChange(nextRaw: string) {
    const next: PointOpRole = nextRaw === '' ? null : (nextRaw as NonNullable<PointOpRole>);
    const previous = role;
    setRole(next);
    setRoleError(false);
    setSavingRole(true);
    try {
      await setPointOpRole(deviceId!, pointId, next);
      onOpRoleChanged?.(pointId, next);
      // O card Ativos Críticos depende do papel 'status' — atualiza sem recarregar.
      void qc.invalidateQueries({ queryKey: ['dashboard-critical-assets'] });
      void qc.invalidateQueries({ queryKey: ['devices'] });
    } catch {
      setRole(previous);
      setRoleError(true);
    } finally {
      setSavingRole(false);
    }
  }
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [creatingAlarm, setCreatingAlarm] = useState(false);
  const [editingAlarm, setEditingAlarm] = useState(false);
  const [confirmingAlarm, setConfirmingAlarm] = useState(false);
  const refreshAlarm = onAlarmChanged ?? onChanged;
  const qc = useQueryClient();

  function selectMetric(nextRaw: string) {
    const next = nextRaw === '' ? null : nextRaw as NonNullable<PointSiteMetric>;
    setMetric(next);
    setMetricError(null);
    if (next === 'runtime') {
      setMetricMode('state');
      setMetricUnit('');
    } else if (next === 'energy') {
      setMetricMode('cumulative');
      setMetricUnit('kWh');
    } else if (next === 'water') {
      setMetricMode('cumulative');
      setMetricUnit('L');
    } else {
      setMetricMode(null);
      setMetricUnit(unit ?? '');
    }
  }

  async function saveMetric() {
    if (!deviceId) return;
    setSavingMetric(true);
    setMetricError(null);
    try {
      await setPointSiteMetric(deviceId, pointId, metric, metricMode, metricUnit);
      onSiteMetricChanged?.(pointId, metric, metricMode, metricUnit);
      void qc.invalidateQueries({ queryKey: ['dashboard-site-overview'] });
      void qc.invalidateQueries({ queryKey: ['devices'] });
    } catch {
      setMetricError(t('Não foi possível salvar a fonte da visão geral. Revise tipo, unidade e comportamento.'));
    } finally {
      setSavingMetric(false);
    }
  }

  const removeMutation = useMutation({
    mutationFn: () => deleteTrend(trend!.id),
    onSuccess: () => { setConfirming(false); onChanged(); },
  });

  const removeAlarmMutation = useMutation({
    mutationFn: () => deleteAlarmRule(alarmRule!.id),
    onSuccess: () => {
      setConfirmingAlarm(false);
      refreshAlarm();
      // O delete cascateia as ocorrências no banco, mas não emite evento no
      // socket; invalida manualmente as telas de alarmes ativos para o alarme
      // sumir do dashboard, do sino e da página de alarmes sem recarregar.
      void qc.invalidateQueries({ queryKey: ['alarm-events'] });
      void qc.invalidateQueries({ queryKey: ['alarms'] });
      void qc.invalidateQueries({ queryKey: ['dashboard-alarms'] });
    },
  });

  return (
    <div className="grid grid-cols-1 gap-3 bg-muted/30 p-4 sm:grid-cols-2">
      {/* ── Trend ─────────────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="mb-2 flex items-center gap-2">
          <LineChart className="h-4 w-4 text-cyan-600" strokeWidth={1.5} />
          <span className="text-sm font-medium text-foreground">Trend (histórico)</span>
          {trend && <span className="ml-auto rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Ativa</span>}
        </div>

        {trend ? (
          <>
            <p className="text-xs text-muted-foreground">
              {trend.mode === 'INTERVAL'
                ? `Por intervalo · ${INTERVAL_LABEL[trend.intervalSeconds ?? 0] ?? `${trend.intervalSeconds}s`}`
                : `Por mudança${trend.covThreshold ? ` · COV ${trend.covThreshold}${unit ? ` ${unit}` : ''}` : ''}${trend.maxIntervalSeconds ? ` · heartbeat ${INTERVAL_LABEL[trend.maxIntervalSeconds] ?? `${trend.maxIntervalSeconds}s`}` : ''}`}{' '}
              · retenção {trend.retentionDays} dias
            </p>
            {confirming ? (
              <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-2">
                <p className="text-[11px] text-red-700">Remover apaga o histórico já coletado. Confirmar?</p>
                <div className="mt-1.5 flex gap-2">
                  <button type="button" disabled={removeMutation.isPending} onClick={() => removeMutation.mutate()} className="flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">
                    {removeMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />} Remover
                  </button>
                  <button type="button" onClick={() => setConfirming(false)} className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/50">Cancelar</button>
                </div>
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:border-cyan-300 hover:text-cyan-700 transition-colors">
                  <Pencil className="h-3 w-3" /> Editar
                </button>
                <button type="button" onClick={() => setConfirming(true)} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:border-red-300 hover:text-red-600 transition-colors">
                  <Trash2 className="h-3 w-3" /> Remover
                </button>
              </div>
            )}
          </>
        ) : (
          <button type="button" onClick={() => setCreating(true)} className="inline-flex items-center gap-1 rounded-md border border-cyan-200 px-2.5 py-1 text-xs font-medium text-cyan-700 hover:bg-cyan-50 transition-colors">
            <Plus className="h-3 w-3" /> Criar Trend
          </button>
        )}
      </div>

      {/* ── Alarme ─────────────────────────────────────────── */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="mb-2 flex items-center gap-2">
          <Bell className="h-4 w-4 text-amber-600" strokeWidth={1.5} />
          <span className="text-sm font-medium text-foreground">Alarme</span>
          {alarmRule && (
            <span className={`ml-auto rounded-full border px-2 py-0.5 text-[11px] font-medium ${SEVERITY_LABEL[alarmRule.severity]?.cls ?? ''}`}>
              {SEVERITY_LABEL[alarmRule.severity]?.label ?? alarmRule.severity}
            </span>
          )}
        </div>

        {alarmRule ? (
          <>
            <p className="text-xs text-muted-foreground">{describeRule(alarmRule)}</p>
            {confirmingAlarm ? (
              <div className="mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-2">
                <p className="text-[11px] text-red-700">Remover apaga a regra e suas ocorrências. Confirmar?</p>
                <div className="mt-1.5 flex gap-2">
                  <button type="button" disabled={removeAlarmMutation.isPending} onClick={() => removeAlarmMutation.mutate()} className="flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50">
                    {removeAlarmMutation.isPending && <Loader2 className="h-3 w-3 animate-spin" />} Remover
                  </button>
                  <button type="button" onClick={() => setConfirmingAlarm(false)} className="rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/50">Cancelar</button>
                </div>
                {removeAlarmMutation.isError && (
                  <p className="mt-1.5 text-[11px] font-medium text-red-700">
                    Falha ao remover a regra. Verifique a conexão e tente novamente.
                  </p>
                )}
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={() => setEditingAlarm(true)} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:border-cyan-300 hover:text-cyan-700 transition-colors">
                  <Pencil className="h-3 w-3" /> Editar
                </button>
                <button type="button" onClick={() => setConfirmingAlarm(true)} className="inline-flex items-center gap-1 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:border-red-300 hover:text-red-600 transition-colors">
                  <Trash2 className="h-3 w-3" /> Remover
                </button>
              </div>
            )}
          </>
        ) : (
          <button type="button" onClick={() => setCreatingAlarm(true)} className="inline-flex items-center gap-1 rounded-md border border-amber-200 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50 transition-colors">
            <Plus className="h-3 w-3" /> Criar Alarme
          </button>
        )}
      </div>

      {/* ── Papel operacional ─────────────────────────────── */}
      {deviceId && canEditSemantics && (
        <div className="rounded-lg border border-border bg-card p-3 sm:col-span-2">
          <div className="mb-2 flex items-center gap-2">
            <Gauge className="h-4 w-4 text-violet-600" strokeWidth={1.5} />
            <span className="text-sm font-medium text-foreground">{t('Papel operacional')}</span>
            {role && (
              <span className="ml-auto rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">
                {t(OP_ROLE_OPTIONS.find((o) => o.value === role)?.label ?? role)}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('Use "Status" para o ponto que diz se o equipamento está ligado/desligado e "Falha" para o ponto que indica defeito (ex.: "Falha Bomba 1"). É isso que define como o item aparece no card Ativos Críticos.')}
          </p>
          <div className="mt-2 flex items-center gap-2">
            <select
              value={role ?? ''}
              disabled={savingRole}
              onChange={(e) => void handleRoleChange(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              aria-label={t('Papel operacional')}
              className="rounded-md border border-border bg-background px-2.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-violet-400 disabled:opacity-50"
            >
              {OP_ROLE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{t(o.label)}</option>
              ))}
            </select>
            {savingRole && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
            {t(OP_ROLE_OPTIONS.find((o) => o.value === (role ?? ''))?.description ?? '')}
          </p>
          {roleError && (
            <p className="mt-1.5 text-[11px] font-medium text-red-700">
              {t('Não foi possível salvar o papel operacional. Tente novamente.')}
            </p>
          )}
        </div>
      )}

      {/* ── Fonte da visão geral do site ───────────────────── */}
      {showSiteMetric && deviceId && canEditSemantics && (
        <div className="rounded-lg border border-border bg-card p-3 sm:col-span-2">
          <div className="mb-2 flex items-center gap-2">
            {metric === 'water'
              ? <Waves className="h-4 w-4 text-blue-600" strokeWidth={1.5} />
              : <Zap className="h-4 w-4 text-cyan-600" strokeWidth={1.5} />}
            <span className="text-sm font-medium text-foreground">{t('Fonte da visão geral do site')}</span>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t('Classifique somente pontos cuja semântica foi confirmada. Medidor acumulativo é uma leitura que só cresce (salvo reset); taxa é uma leitura instantânea. Funcionamento exige um ponto digital ligado/desligado.')}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-[1.2fr_1fr_1fr_auto] sm:items-end">
            <label className="space-y-1 text-[11px] font-medium text-muted-foreground">
              <span>{t('Indicador')}</span>
              <select
                value={metric ?? ''}
                disabled={savingMetric}
                onChange={(e) => selectMetric(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-cyan-400"
              >
                <option value="">{t('Não usar na visão geral')}</option>
                {!isDigital && <option value="energy">{t('Consumo de energia')}</option>}
                {!isDigital && <option value="water">{t('Consumo de água')}</option>}
                {isDigital && <option value="runtime">{t('Horas de funcionamento')}</option>}
              </select>
            </label>

            <label className="space-y-1 text-[11px] font-medium text-muted-foreground">
              <span>{t('Comportamento')}</span>
              <select
                value={metricMode ?? ''}
                disabled={!metric || metric === 'runtime' || savingMetric}
                onChange={(e) => {
                  const nextMode = e.target.value as PointSiteMetricMode;
                  setMetricMode(nextMode);
                  if (metric === 'energy') setMetricUnit(nextMode === 'rate' ? 'kW' : 'kWh');
                  if (metric === 'water') setMetricUnit(nextMode === 'rate' ? 'L/h' : 'L');
                }}
                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground disabled:opacity-60"
              >
                {!metric && <option value="">—</option>}
                {metric === 'runtime' && <option value="state">{t('Estado ligado/desligado')}</option>}
                {(metric === 'energy' || metric === 'water') && (
                  <>
                    <option value="cumulative">{t('Medidor acumulativo')}</option>
                    <option value="rate">{t('Taxa instantânea')}</option>
                  </>
                )}
              </select>
            </label>

            <label className="space-y-1 text-[11px] font-medium text-muted-foreground">
              <span>{t('Unidade')}</span>
              {metric === 'energy' ? (
                <select
                  value={metricUnit}
                  disabled={savingMetric}
                  onChange={(e) => setMetricUnit(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground"
                >
                  {(metricMode === 'rate' ? ['W', 'kW', 'MW'] : ['Wh', 'kWh', 'MWh']).map((v) => <option key={v}>{v}</option>)}
                </select>
              ) : metric === 'water' ? (
                <select
                  value={metricUnit}
                  disabled={savingMetric}
                  onChange={(e) => setMetricUnit(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground"
                >
                  {(metricMode === 'rate'
                    ? ['L/s', 'L/min', 'L/h', 'm³/s', 'm³/min', 'm³/h']
                    : ['L', 'm³']).map((v) => <option key={v}>{v}</option>)}
                </select>
              ) : (
                <div className="rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground">
                  {metric === 'runtime' ? t('Sem unidade') : '—'}
                </div>
              )}
            </label>

            <button
              type="button"
              disabled={savingMetric}
              onClick={() => void saveMetric()}
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
            >
              {savingMetric ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              {t('Salvar')}
            </button>
          </div>
          {metricError && <p className="mt-2 text-[11px] font-medium text-red-700">{metricError}</p>}
        </div>
      )}

      {creating && (
        <CreateTrendModal
          pointId={pointId}
          pointLabel={pointLabel}
          isDigital={isDigital}
          unit={unit}
          onClose={() => setCreating(false)}
          onCreated={onChanged}
        />
      )}

      {editing && trend && (
        <CreateTrendModal
          pointId={pointId}
          pointLabel={pointLabel}
          isDigital={isDigital}
          unit={unit}
          trend={trend}
          onClose={() => setEditing(false)}
          onCreated={onChanged}
        />
      )}

      {creatingAlarm && (
        <CreateAlarmModal
          pointId={pointId}
          pointLabel={pointLabel}
          isDigital={isDigital}
          unit={unit}
          onClose={() => setCreatingAlarm(false)}
          onCreated={refreshAlarm}
        />
      )}

      {editingAlarm && alarmRule && (
        <CreateAlarmModal
          pointId={pointId}
          pointLabel={pointLabel}
          isDigital={isDigital}
          unit={unit}
          rule={alarmRule}
          onClose={() => setEditingAlarm(false)}
          onCreated={() => {
            refreshAlarm();
            // Nome/severidade/mensagem podem ter mudado: atualiza sino e telas de alarmes.
            void qc.invalidateQueries({ queryKey: ['alarm-events'] });
            void qc.invalidateQueries({ queryKey: ['alarms'] });
            void qc.invalidateQueries({ queryKey: ['dashboard-alarms'] });
          }}
        />
      )}
    </div>
  );
}
