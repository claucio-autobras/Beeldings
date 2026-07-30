'use client';

import { useMemo, useState } from 'react';
import {
  Activity,
  Bell,
  ChevronDown,
  Clock,
  Loader2,
  Plus,
  Power,
  Settings2,
  X,
} from 'lucide-react';
import { useDevices } from '@/modules/devices/hooks/useDevices';
import { useSites } from '@/modules/sites/hooks/useSites';
import { isDigitalPoint } from '@/modules/trends/lib/trends-utils';
import { useCreateAutomation, useUpdateAutomation } from '../hooks/useAutomations';
import type {
  Automation,
  AutomationActionInput,
  AutomationBranch,
  AutomationMode,
  ConditionOperator,
  CreateAutomationInput,
  ScheduleEntry,
} from '../types/automation.types';
import type { Device } from '@/modules/devices/types/device.types';

interface Props {
  open: boolean;
  automation: Automation | null;
  tenantId: string;
  defaultSiteId: string | null;
  onClose: () => void;
}

/** Ponto normalizado (achatado dos devices) para os seletores. */
interface FlatPoint {
  id: string;
  deviceId: string;
  deviceName: string;
  label: string;
  name: string;
  unit: string;
  isDigital: boolean;
  /** Gravável (aparece no seletor de AÇÃO): BACnet AO/AV/BO/BV/MSO e Modbus coil/holding. MQTT nunca. */
  writable: boolean;
}

/** Tipos BACnet graváveis (comandáveis). */
const WRITABLE_BACNET = new Set(['AO', 'AV', 'BO', 'BV', 'MSO']);
/** Tipos de registrador Modbus graváveis. */
const WRITABLE_MODBUS = new Set(['coil', 'holding']);

const DAY_LABELS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const DAY_FULL = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

const OPERATORS: { value: ConditionOperator; label: string }[] = [
  { value: 'GT', label: 'for maior que' },
  { value: 'LT', label: 'for menor que' },
  { value: 'GTE', label: 'for maior ou igual a' },
  { value: 'LTE', label: 'for menor ou igual a' },
  { value: 'EQ', label: 'for igual a' },
  { value: 'NEQ', label: 'for diferente de' },
];

function pointName(p: { tag: string; objectName?: string; displayName?: string }): string {
  return p.objectName || p.displayName || p.tag;
}

function flattenPoints(devices: Device[]): FlatPoint[] {
  const out: FlatPoint[] = [];
  for (const d of devices) {
    if (d.protocol === 'bacnet') {
      for (const p of d.points) {
        const name = pointName(p);
        out.push({
          id: p.id,
          deviceId: d.id,
          deviceName: d.name,
          name,
          label: `${d.name} · ${name} (${p.objectType})`,
          unit: p.unit ?? '',
          isDigital: isDigitalPoint(p.objectType),
          writable: WRITABLE_BACNET.has(p.objectType),
        });
      }
    } else if (d.protocol === 'modbus') {
      for (const p of d.points) {
        const name = pointName(p);
        out.push({
          id: p.id,
          deviceId: d.id,
          deviceName: d.name,
          name,
          label: `${d.name} · ${name} (Modbus)`,
          unit: p.unit ?? '',
          isDigital: p.registerType === 'coil' || p.registerType === 'discrete',
          writable: WRITABLE_MODBUS.has(p.registerType),
        });
      }
    } else {
      // MQTT: somente leitura — nunca aparece em ações.
      for (const p of d.points) {
        const name = pointName(p);
        out.push({
          id: p.id,
          deviceId: d.id,
          deviceName: d.name,
          name,
          label: `${d.name} · ${name} (MQTT)`,
          unit: p.unit ?? '',
          isDigital: p.valueType === 'boolean',
          writable: false,
        });
      }
    }
  }
  return out;
}

function daysText(days: number[]): string {
  const s = [...days].sort((a, b) => a - b);
  if (s.length === 7) return 'todos os dias';
  if (s.length === 5 && [1, 2, 3, 4, 5].every((d) => s.includes(d))) return 'de segunda a sexta';
  if (s.length === 2 && s.includes(0) && s.includes(6)) return 'aos fins de semana';
  if (s.length === 0) return 'nenhum dia';
  return s.map((d) => DAY_FULL[d]).join(', ');
}

interface DraftAction extends AutomationActionInput {
  key: string;
}

let keyCounter = 0;
const nextKey = () => `a${keyCounter++}`;

export function AutomationDrawer({
  open,
  automation,
  tenantId,
  defaultSiteId,
  onClose,
}: Props) {
  const { data: devices = [] } = useDevices(tenantId);
  const { data: sites = [] } = useSites(tenantId);
  const create = useCreateAutomation();
  const update = useUpdateAutomation();
  const isEdit = Boolean(automation);

  const points = useMemo(() => flattenPoints(devices), [devices]);
  // Condição (leitura) usa TODOS os pontos; ação (escrita) só os graváveis.
  const writablePoints = useMemo(() => points.filter((p) => p.writable), [points]);
  const pointById = useMemo(() => {
    const m = new Map<string, FlatPoint>();
    for (const p of points) m.set(p.id, p);
    return m;
  }, [points]);

  // ─── Estado ────────────────────────────────────────────────────────────────
  const [name, setName] = useState(automation?.name ?? '');
  const [siteId, setSiteId] = useState<string | null>(automation?.siteId ?? defaultSiteId ?? null);
  const [mode, setMode] = useState<AutomationMode>(automation?.mode ?? 'ONESHOT');
  const [entries, setEntries] = useState<ScheduleEntry[]>(
    automation?.triggerConfig?.entries?.length
      ? automation.triggerConfig.entries
      : [{ time: '18:00', days: [1, 2, 3, 4, 5] }],
  );
  const [conditionPointId, setConditionPointId] = useState<string>(
    automation?.condition?.pointId ?? '',
  );
  const [operator, setOperator] = useState<ConditionOperator>(
    automation?.condition?.operator ?? 'GT',
  );
  const [conditionValue, setConditionValue] = useState<number | boolean>(
    automation?.condition?.value ?? 0,
  );
  const [actions, setActions] = useState<DraftAction[]>(
    automation?.actions?.length
      ? automation.actions.map((a) => ({
          key: nextKey(),
          order: a.order,
          branch: a.branch,
          type: a.type,
          targetPointId: a.targetPointId,
          value: a.value,
          delaySeconds: a.delaySeconds,
          config: a.config,
        }))
      : [],
  );
  const [priority, setPriority] = useState(automation?.priority ?? 8);
  const [evalSeconds, setEvalSeconds] = useState(automation?.evalSeconds ?? 30);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const conditionPoint = conditionPointId ? pointById.get(conditionPointId) : undefined;
  const conditionDigital = conditionPoint?.isDigital ?? false;

  const saving = create.isPending || update.isPending;

  if (!open) return null;

  // ─── Handlers: mode ──────────────────────────────────────────────────────────
  const switchMode = (m: AutomationMode) => {
    if (m === mode) return;
    setMode(m);
    // Normaliza o branch das ações: ONESHOT→ALWAYS; CONTINUOUS→ON_TRUE (mantém ON_FALSE).
    setActions((prev) =>
      prev.map((a) => ({
        ...a,
        branch:
          m === 'ONESHOT'
            ? 'ALWAYS'
            : a.branch === 'ON_FALSE'
              ? 'ON_FALSE'
              : 'ON_TRUE',
      })),
    );
  };

  // ─── Handlers: schedule ──────────────────────────────────────────────────────
  const updateEntry = (idx: number, patch: Partial<ScheduleEntry>) => {
    setEntries((prev) => prev.map((e, i) => (i === idx ? { ...e, ...patch } : e)));
  };
  const toggleDay = (idx: number, day: number) => {
    setEntries((prev) =>
      prev.map((e, i) => {
        if (i !== idx) return e;
        const has = e.days.includes(day);
        return { ...e, days: has ? e.days.filter((d) => d !== day) : [...e.days, day] };
      }),
    );
  };
  const addEntry = () =>
    setEntries((prev) => [...prev, { time: '08:00', days: [1, 2, 3, 4, 5] }]);
  const removeEntry = (idx: number) =>
    setEntries((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));

  // ─── Handlers: actions ───────────────────────────────────────────────────────
  const addAction = (type: 'WRITE_POINT' | 'NOTIFY', branch: AutomationBranch) => {
    setActions((prev) => [
      ...prev,
      {
        key: nextKey(),
        order: prev.length,
        branch,
        type,
        targetPointId: type === 'WRITE_POINT' ? '' : null,
        value: type === 'WRITE_POINT' ? true : null,
        delaySeconds: 0,
        config: type === 'NOTIFY' ? { message: '' } : null,
      },
    ]);
  };
  const updateAction = (key: string, patch: Partial<DraftAction>) => {
    setActions((prev) => prev.map((a) => (a.key === key ? { ...a, ...patch } : a)));
  };
  const removeAction = (key: string) =>
    setActions((prev) => prev.filter((a) => a.key !== key));

  // ─── Save ────────────────────────────────────────────────────────────────────
  const handleSave = () => {
    setFormError(null);
    if (!name.trim()) return setFormError('Dê um nome para a automação.');

    if (mode === 'ONESHOT') {
      if (entries.some((e) => e.days.length === 0)) {
        return setFormError('Escolha pelo menos um dia da semana.');
      }
    } else {
      if (!conditionPointId) return setFormError('Escolha o ponto a monitorar.');
    }

    if (actions.length === 0) return setFormError('Adicione pelo menos uma ação.');
    for (const a of actions) {
      if (a.type === 'WRITE_POINT') {
        if (!a.targetPointId) return setFormError('Escolha o ponto a comandar em cada ação.');
        if (a.value === null || a.value === undefined) {
          return setFormError('Defina o valor de cada ação de comando.');
        }
      }
      if (a.type === 'NOTIFY' && !a.config?.message?.trim()) {
        return setFormError('Escreva a mensagem do aviso.');
      }
    }

    const cleanEntries: ScheduleEntry[] = entries.map((e) => ({
      time: e.time,
      ...(e.endTime && e.endTime.trim() ? { endTime: e.endTime } : {}),
      days: e.days,
    }));

    const payload: CreateAutomationInput = {
      name: name.trim(),
      tenantId,
      siteId: siteId ?? null,
      mode,
      triggerType: 'SCHEDULE',
      triggerConfig: {
        entries: cleanEntries,
        timezone: 'America/Sao_Paulo',
      },
      condition:
        mode === 'CONTINUOUS'
          ? { pointId: conditionPointId, operator, value: conditionDigital ? Boolean(conditionValue) : Number(conditionValue) }
          : null,
      evalSeconds,
      executesOn: 'CLOUD',
      priority,
      actions: actions.map((a, i) => ({
        order: i,
        branch: a.branch,
        type: a.type,
        targetPointId: a.targetPointId ?? null,
        value: a.value ?? null,
        delaySeconds: a.delaySeconds ?? 0,
        config: a.config ?? null,
      })),
    };

    const onDone = { onSuccess: () => onClose() };
    if (isEdit && automation) {
      update.mutate({ id: automation.id, input: payload }, onDone);
    } else {
      create.mutate(payload, onDone);
    }
  };

  const mutationError = (create.error ?? update.error) as Error | undefined;
  const hasWritablePoints = writablePoints.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[1px]" onClick={onClose} />
      <div className="relative flex h-full w-full flex-col overflow-hidden bg-card shadow-xl sm:max-w-md">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-base font-semibold text-foreground">
            {isEdit ? 'Editar automação' : 'Nova automação'}
          </h2>
          <button
            onClick={onClose}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-6 overflow-y-auto overflow-x-hidden px-5 py-5">
          {/* Nome + Site */}
          <div className="space-y-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Dê um nome (ex.: Luz do corredor)"
              className="h-11 w-full min-w-0 rounded-lg border border-border px-3 text-base sm:text-sm"
            />
            {sites.length > 0 && (
              <select
                value={siteId ?? ''}
                onChange={(e) => setSiteId(e.target.value || null)}
                className="h-11 w-full min-w-0 rounded-lg border border-border px-3 text-base sm:text-sm"
              >
                <option value="">Todos os locais do cliente</option>
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Passo 1 */}
          <section className="space-y-3">
            <StepHeader n={1} title="Quando isso deve acontecer?" />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <ChoiceCard
                active={mode === 'ONESHOT'}
                icon={<Clock className="h-4 w-4" />}
                title="Em horários"
                subtitle="Nos dias e horas que você escolher"
                onClick={() => switchMode('ONESHOT')}
              />
              <ChoiceCard
                active={mode === 'CONTINUOUS'}
                icon={<Activity className="h-4 w-4" />}
                title="Quando um ponto mudar"
                subtitle="Reage ao valor de um sensor (ex.: temperatura, falha)"
                onClick={() => switchMode('CONTINUOUS')}
              />
            </div>

            <div className="space-y-3 rounded-xl bg-muted/20 p-3">
              {mode === 'ONESHOT' ? (
                <div className="space-y-4">
                  {entries.map((entry, idx) => (
                    <div key={idx} className="space-y-2 border-b border-border/50 pb-4 last:border-0 last:pb-0">
                      <div className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-sm text-muted-foreground">Ligar às</span>
                        <input
                          type="time"
                          value={entry.time}
                          onChange={(e) => updateEntry(idx, { time: e.target.value })}
                          className="h-11 min-w-0 flex-1 rounded-lg border border-border px-3 text-base sm:text-sm"
                        />
                        {entries.length > 1 && (
                          <button
                            onClick={() => removeEntry(idx)}
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                      {entry.endTime !== undefined ? (
                        <div className="flex items-center gap-2">
                          <span className="w-16 shrink-0 text-sm text-muted-foreground">Desligar às</span>
                          <input
                            type="time"
                            value={entry.endTime}
                            onChange={(e) => updateEntry(idx, { endTime: e.target.value })}
                            className="h-11 min-w-0 flex-1 rounded-lg border border-border px-3 text-base sm:text-sm"
                          />
                          <button
                            onClick={() => updateEntry(idx, { endTime: undefined })}
                            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => updateEntry(idx, { endTime: '06:00' })}
                          className="text-xs font-medium text-cyan-700 hover:text-cyan-800"
                        >
                          + desligar em um horário
                        </button>
                      )}
                      <div className="grid grid-cols-7 gap-1">
                        {DAY_LABELS.map((d, day) => (
                          <button
                            key={day}
                            onClick={() => toggleDay(idx, day)}
                            className={`h-9 w-full rounded-lg border text-xs font-medium transition-colors ${
                              entry.days.includes(day)
                                ? 'border-cyan-600 bg-cyan-600 text-white'
                                : 'border-border text-muted-foreground hover:bg-muted/40'
                            }`}
                          >
                            {d}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                  <button
                    onClick={addEntry}
                    className="text-xs font-medium text-cyan-700 hover:text-cyan-800"
                  >
                    + outro horário
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <label className="text-sm text-muted-foreground">Monitorar o ponto</label>
                    <select
                      value={conditionPointId}
                      onChange={(e) => {
                        setConditionPointId(e.target.value);
                        const p = pointById.get(e.target.value);
                        setConditionValue(p?.isDigital ? true : 0);
                      }}
                      className="h-11 w-full min-w-0 rounded-lg border border-border px-3 text-base sm:text-sm"
                    >
                      <option value="">Selecione um ponto…</option>
                      {points.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  {conditionPoint && conditionDigital && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setConditionValue(true)}
                        className={`h-11 flex-1 rounded-lg border text-sm font-medium transition-colors ${
                          conditionValue ? 'border-cyan-600 bg-cyan-600 text-white' : 'border-border text-muted-foreground'
                        }`}
                      >
                        quando ligado
                      </button>
                      <button
                        onClick={() => setConditionValue(false)}
                        className={`h-11 flex-1 rounded-lg border text-sm font-medium transition-colors ${
                          !conditionValue ? 'border-cyan-600 bg-cyan-600 text-white' : 'border-border text-muted-foreground'
                        }`}
                      >
                        quando desligado
                      </button>
                    </div>
                  )}
                  {conditionPoint && !conditionDigital && (
                    <div className="flex items-center gap-2">
                      <select
                        value={operator}
                        onChange={(e) => setOperator(e.target.value as ConditionOperator)}
                        className="h-11 min-w-0 flex-1 rounded-lg border border-border px-3 text-base sm:text-sm"
                      >
                        {OPERATORS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <input
                        type="number"
                        value={typeof conditionValue === 'number' ? conditionValue : 0}
                        onChange={(e) => setConditionValue(Number(e.target.value))}
                        className="h-11 w-20 shrink-0 rounded-lg border border-border px-3 text-base sm:text-sm"
                      />
                      {conditionPoint.unit && (
                        <span className="shrink-0 text-sm text-muted-foreground">{conditionPoint.unit}</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Passo 2 */}
          <section className="space-y-3">
            <StepHeader n={2} title="O que deve fazer?" />
            {!hasWritablePoints && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                Nenhum ponto gravável disponível neste cliente.
              </div>
            )}

            {mode === 'ONESHOT' ? (
              <ActionList
                actions={actions.filter((a) => a.branch === 'ALWAYS')}
                points={writablePoints}
                pointById={pointById}
                onAdd={(t) => addAction(t, 'ALWAYS')}
                onUpdate={updateAction}
                onRemove={removeAction}
              />
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-green-500" />
                    <span className="text-sm font-medium text-foreground">Enquanto isso for verdade</span>
                  </div>
                  <ActionList
                    actions={actions.filter((a) => a.branch === 'ON_TRUE' || a.branch === 'ALWAYS')}
                    points={writablePoints}
                    pointById={pointById}
                    onAdd={(t) => addAction(t, 'ON_TRUE')}
                    onUpdate={updateAction}
                    onRemove={removeAction}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-slate-400" />
                    <span className="text-sm font-medium text-foreground">Quando voltar ao normal (opcional)</span>
                  </div>
                  <ActionList
                    actions={actions.filter((a) => a.branch === 'ON_FALSE')}
                    points={writablePoints}
                    pointById={pointById}
                    onAdd={(t) => addAction(t, 'ON_FALSE')}
                    onUpdate={updateAction}
                    onRemove={removeAction}
                  />
                </div>
              </div>
            )}
          </section>

          {/* Resumo */}
          <div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-cyan-700">Em resumo</p>
            <p className="mt-1 text-sm text-cyan-900">
              {buildSummary({
                mode,
                entries,
                conditionPoint,
                conditionDigital,
                operator,
                conditionValue,
                actions,
                pointById,
              })}
            </p>
          </div>

          {/* Avançado */}
          <div className="rounded-xl border border-border">
            <button
              onClick={() => setAdvancedOpen((v) => !v)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-medium text-foreground"
            >
              <span className="flex items-center gap-2">
                <Settings2 className="h-4 w-4 text-muted-foreground" /> Opções avançadas
              </span>
              <ChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
            </button>
            {advancedOpen && (
              <div className="space-y-3 border-t border-border px-3 py-3">
                <p className="text-xs text-muted-foreground">Executa na nuvem</p>
                <div className="space-y-1.5">
                  <label className="text-sm text-foreground">Prioridade (1–16)</label>
                  <input
                    type="number"
                    min={1}
                    max={16}
                    value={priority}
                    onChange={(e) => setPriority(Math.min(16, Math.max(1, Number(e.target.value))))}
                    className="h-11 w-full min-w-0 rounded-lg border border-border px-3 text-base sm:text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Número menor tem prioridade maior e vence os outros comandos no mesmo ponto. 8 é
                    o padrão do operador/manual; use um número maior para permitir que um comando
                    manual sobreponha esta automação.
                  </p>
                </div>
                {mode === 'CONTINUOUS' && (
                  <div className="space-y-1.5">
                    <label className="text-sm text-foreground">Verificar a cada (segundos)</label>
                    <input
                      type="number"
                      min={5}
                      value={evalSeconds}
                      onChange={(e) => setEvalSeconds(Math.max(5, Number(e.target.value)))}
                      className="h-11 w-full min-w-0 rounded-lg border border-border px-3 text-base sm:text-sm"
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 space-y-3 border-t border-border px-5 py-4">
          {(formError || mutationError) && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
              {formError ?? mutationError?.message}
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="h-11 flex-1 rounded-lg border border-border text-sm text-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-cyan-700 text-sm font-medium text-white transition-colors hover:bg-cyan-800 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar automação
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Subcomponentes ──────────────────────────────────────────────────────────

function StepHeader({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-cyan-600 text-[11px] font-semibold text-white">
        {n}
      </span>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
    </div>
  );
}

function ChoiceCard({
  active,
  icon,
  title,
  subtitle,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col gap-2 rounded-xl border p-3 text-left transition-colors ${
        active ? 'border-cyan-500 ring-1 ring-cyan-500' : 'border-border hover:bg-muted/30'
      }`}
    >
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-lg ${
          active ? 'bg-cyan-600 text-white' : 'bg-muted/50 text-muted-foreground'
        }`}
      >
        {icon}
      </span>
      <span className="text-sm font-medium text-foreground">{title}</span>
      <span className="text-xs text-muted-foreground">{subtitle}</span>
    </button>
  );
}

interface DraftActionLike extends AutomationActionInput {
  key: string;
}

function ActionList({
  actions,
  points,
  pointById,
  onAdd,
  onUpdate,
  onRemove,
}: {
  actions: DraftActionLike[];
  points: FlatPoint[];
  pointById: Map<string, FlatPoint>;
  onAdd: (type: 'WRITE_POINT' | 'NOTIFY') => void;
  onUpdate: (key: string, patch: Partial<DraftActionLike>) => void;
  onRemove: (key: string) => void;
}) {
  return (
    <div className="space-y-3">
      {actions.map((a) => {
        const target = a.targetPointId ? pointById.get(a.targetPointId) : undefined;
        const digital = target?.isDigital ?? true;
        return (
          <div key={a.key} className="space-y-2 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                {a.type === 'WRITE_POINT' ? (
                  <Power className="h-4 w-4 text-cyan-700" />
                ) : (
                  <Bell className="h-4 w-4 text-cyan-700" />
                )}
                {a.type === 'WRITE_POINT' ? 'Comandar ponto' : 'Avisar operador'}
              </span>
              <button
                onClick={() => onRemove(a.key)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-red-50 hover:text-red-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {a.type === 'WRITE_POINT' ? (
              <div className="space-y-2">
                <select
                  value={a.targetPointId ?? ''}
                  onChange={(e) => {
                    const p = pointById.get(e.target.value);
                    onUpdate(a.key, {
                      targetPointId: e.target.value,
                      value: p?.isDigital ? true : 0,
                    });
                  }}
                  className="h-11 w-full min-w-0 rounded-lg border border-border px-3 text-base sm:text-sm"
                >
                  <option value="">Escolha o ponto…</option>
                  {points.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                {target && digital && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => onUpdate(a.key, { value: true })}
                      className={`h-11 flex-1 rounded-lg border text-sm font-medium transition-colors ${
                        a.value ? 'border-cyan-600 bg-cyan-600 text-white' : 'border-border text-muted-foreground'
                      }`}
                    >
                      Ligar
                    </button>
                    <button
                      onClick={() => onUpdate(a.key, { value: false })}
                      className={`h-11 flex-1 rounded-lg border text-sm font-medium transition-colors ${
                        !a.value ? 'border-cyan-600 bg-cyan-600 text-white' : 'border-border text-muted-foreground'
                      }`}
                    >
                      Desligar
                    </button>
                  </div>
                )}
                {target && !digital && (
                  <div className="flex items-center gap-2">
                    <span className="shrink-0 text-sm text-muted-foreground">ajustar para</span>
                    <input
                      type="number"
                      value={typeof a.value === 'number' ? a.value : 0}
                      onChange={(e) => onUpdate(a.key, { value: Number(e.target.value) })}
                      className="h-11 w-24 min-w-0 rounded-lg border border-border px-3 text-base sm:text-sm"
                    />
                    {target.unit && (
                      <span className="shrink-0 text-sm text-muted-foreground">{target.unit}</span>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <input
                value={a.config?.message ?? ''}
                onChange={(e) => onUpdate(a.key, { config: { message: e.target.value } })}
                placeholder="Mensagem do aviso"
                className="h-11 w-full min-w-0 rounded-lg border border-border px-3 text-base sm:text-sm"
              />
            )}
          </div>
        );
      })}

      <div className="flex gap-2">
        <button
          onClick={() => onAdd('WRITE_POINT')}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted/40"
        >
          <Plus className="h-3.5 w-3.5" /> comandar ponto
        </button>
        <button
          onClick={() => onAdd('NOTIFY')}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground transition-colors hover:bg-muted/40"
        >
          <Plus className="h-3.5 w-3.5" /> avisar
        </button>
      </div>
    </div>
  );
}

// ─── Resumo em frase ─────────────────────────────────────────────────────────

function actionPhrase(
  a: AutomationActionInput,
  pointById: Map<string, FlatPoint>,
): string {
  if (a.type === 'NOTIFY') return `avisar "${a.config?.message ?? ''}"`;
  const p = a.targetPointId ? pointById.get(a.targetPointId) : undefined;
  const label = p?.name ?? 'o ponto';
  if (p?.isDigital || typeof a.value === 'boolean') {
    return `${a.value ? 'ligar' : 'desligar'} ${label}`;
  }
  return `ajustar ${label} para ${a.value ?? 0}${p?.unit ? ` ${p.unit}` : ''}`;
}

function buildSummary(args: {
  mode: AutomationMode;
  entries: ScheduleEntry[];
  conditionPoint?: FlatPoint;
  conditionDigital: boolean;
  operator: ConditionOperator;
  conditionValue: number | boolean;
  actions: DraftAction[];
  pointById: Map<string, FlatPoint>;
}): string {
  const { mode, entries, conditionPoint, conditionDigital, operator, conditionValue, actions, pointById } = args;

  if (mode === 'ONESHOT') {
    const e = entries[0];
    if (!e) return 'Configure um horário para ver o resumo.';
    const onActions = actions.filter((a) => a.branch === 'ALWAYS');
    if (onActions.length === 0) return 'Adicione uma ação para ver o resumo.';
    const acts = onActions.map((a) => actionPhrase(a, pointById)).join(', ');
    const when = e.endTime
      ? `${daysText(e.days)} das ${e.time} às ${e.endTime}`
      : `${daysText(e.days)} às ${e.time}`;
    const revert = e.endTime ? ' (e desliga no término)' : '';
    return `${capitalize(when)}, ${acts}${revert}.`;
  }

  // CONTINUOUS
  if (!conditionPoint) return 'Escolha um ponto para ver o resumo.';
  const opLabel = OPERATORS.find((o) => o.value === operator)?.label ?? '';
  const condPhrase = conditionDigital
    ? `${conditionPoint.name} estiver ${conditionValue ? 'ligado' : 'desligado'}`
    : `${conditionPoint.name} ${opLabel} ${typeof conditionValue === 'number' ? conditionValue : 0}${conditionPoint.unit ? ` ${conditionPoint.unit}` : ''}`;
  const trueActs = actions.filter((a) => a.branch === 'ON_TRUE' || a.branch === 'ALWAYS');
  const falseActs = actions.filter((a) => a.branch === 'ON_FALSE');
  if (trueActs.length === 0) return `Enquanto ${condPhrase}, adicione uma ação.`;
  const truePhrase = trueActs.map((a) => actionPhrase(a, pointById)).join(', ');
  let out = `Enquanto ${condPhrase}, ${truePhrase}.`;
  if (falseActs.length > 0) {
    out += ` Quando voltar ao normal, ${falseActs.map((a) => actionPhrase(a, pointById)).join(', ')}.`;
  }
  return out;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
