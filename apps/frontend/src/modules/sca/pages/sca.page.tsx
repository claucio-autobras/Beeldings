'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Bell,
  DoorOpen,
  LineChart,
  Loader2,
  Pencil,
  Plus,
  Radar,
  ScanSearch,
  Stethoscope,
  Trash2,
  X,
} from 'lucide-react';
import { CriticalStarButton } from '@/components/CriticalStarButton';
import PasswordConfirmDialog from '@/components/PasswordConfirmDialog';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useTenantFilter } from '@/hooks/useTenantFilter';
import { useSiteFilter } from '@/hooks/useSiteFilter';
import { useBacnetTelemetry, deviceTagKey } from '@/hooks/useBacnetTelemetry';
import { useGateways } from '@/modules/gateways/hooks/useGateways';
import { useSites } from '@/modules/sites/hooks/useSites';
import { useTenants } from '@/modules/tenants/hooks/useTenants';
import { PointConfigPanel } from '@/modules/trends/components/PointConfigPanel';
import { getAlarmRules, type AlarmRuleItem } from '@/modules/alarms/services/alarms-api.service';
import { getTrends, type TrendItem } from '@/modules/trends/services/trends-api.service';
import { SnmpDiagnoseModal } from '@/modules/cftv/components/SnmpDiagnoseModal';
import { useControllers } from '../hooks/useControllers';
import {
  type Controller,
  type ControllerInput,
  type SnmpTestOutcome,
  createController,
  updateController,
  deleteController,
  testControllerSnmp,
  diagnoseControllerSnmp,
  getDiagnoseProgress,
  applySnmpOids,
  getMonitoringProfiles,
} from '../services/sca.service';
import {
  cameraHealth,
  cameraHealthInfo,
  liveOrSeed,
  formatUptime,
} from '@/modules/cftv/utils/telemetry-format';
import type { Camera } from '@/modules/cftv/services/cftv.service';
import { apiPatch } from '@/lib/api-client';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

/** Converte Controller para o shape mínimo que liveOrSeed/cameraHealth esperam. */
function asCamera(c: Controller): Camera {
  return c as unknown as Camera;
}

/** Formata o valor de um ponto da controladora para exibição. */
function formatHealthValue(metric: string, value: number, unit: string): string {
  if (metric === 'uptime') return formatUptime(value);
  const v = metric === 'temperature' ? value.toFixed(1) : String(Math.round(value));
  const u = unit.trim();
  if (!u) return v;
  return u.startsWith('°') || u === '%' ? `${v}${u}` : `${v} ${u}`;
}

const HEALTH_METRICS = ['cpu', 'memory', 'temperature', 'packet_loss'] as const;
type HealthMetricKey = (typeof HEALTH_METRICS)[number];

const HEALTH_LABELS: Record<HealthMetricKey | string, string> = {
  cpu: 'CPU',
  memory: 'Memória',
  temperature: 'Temp.',
  packet_loss: 'Pacotes',
  ram_total: 'RAM total',
  ping_loss: 'Perda ping',
};

// ─── Página ──────────────────────────────────────────────────────────────────

export default function ScaPage({ embedded = false }: { embedded?: boolean }) {
  const t = useT();
  const user = useCurrentUser();
  const isAdmin = user.role === 'ADMIN' || user.role === 'CCO';
  const { selectedTenantId } = useTenantFilter();

  const { data: controllers = [], refetch, isLoading } = useControllers();
  const { byDevice } = useBacnetTelemetry();

  const [formOpen, setFormOpen] = useState(false);
  const [controllerToEdit, setControllerToEdit] = useState<Controller | null>(null);
  const [controllerToDelete, setControllerToDelete] = useState<Controller | null>(null);
  const [controllerToDiagnose, setControllerToDiagnose] = useState<Controller | null>(null);
  const [controllerForAlarm, setControllerForAlarm] = useState<Controller | null>(null);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  // Alarm/trend config per point
  const [alarmRuleByPoint, setAlarmRuleByPoint] = useState<Record<string, AlarmRuleItem>>({});
  const [trendByPoint, setTrendByPoint] = useState<Record<string, TrendItem>>({});

  async function refreshPointConfig(controllerId: string) {
    const c = controllers.find((x) => x.id === controllerId);
    if (!c) return;
    const pointIds = c.points.map((p) => p.id);
    const [rules, trends] = await Promise.all([
      Promise.all(pointIds.map((id) => getAlarmRules({ pointId: id }))).then((r) => r.flat()),
      Promise.all(pointIds.map((id) => getTrends({ pointId: id }))).then((r) => r.flat()),
    ]);
    setAlarmRuleByPoint((prev) => {
      const next = { ...prev };
      for (const r of rules) next[r.pointId] = r;
      return next;
    });
    setTrendByPoint((prev) => {
      const next = { ...prev };
      for (const trend of trends) next[trend.pointId] = trend;
      return next;
    });
  }

  const deleteMutation = useMutation({
    mutationFn: ({ id, token }: { id: string; token: string }) =>
      deleteController(id, token),
    onSuccess: () => {
      setControllerToDelete(null);
      void refetch();
    },
  });

  // KPIs
  const online = controllers.filter((c) => {
    const health = cameraHealth(asCamera(c), byDevice);
    return health === 'online';
  }).length;

  return (
    <div className={embedded ? '' : 'space-y-6'}>
      {!embedded && (
        <div>
          <h1 className="text-xl font-semibold text-foreground">{t('SCA — Controle de Acesso')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('Controladoras de acesso monitoradas via SNMP')}
          </p>
        </div>
      )}

      {/* Barra de ações */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-sm">
          <span className="font-medium text-foreground">
            {controllers.length} {controllers.length !== 1 ? t('controladoras') : t('controladora')}
          </span>
          {controllers.length > 0 && (
            <span className="text-muted-foreground">
              {online} {t('online')}
            </span>
          )}
        </div>
        {isAdmin && (
          <button
            onClick={() => setFormOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            {t('Adicionar controladora')}
          </button>
        )}
      </div>

      {saveNotice && (
        <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300">
          {saveNotice}
          <button
            type="button"
            onClick={() => setSaveNotice(null)}
            className="ml-2 text-sky-500 hover:text-sky-700"
          >
            ✕
          </button>
        </div>
      )}

      {/* Lista */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : controllers.length === 0 ? (
        <div className="rounded-lg border border-border bg-card py-16 text-center">
          <DoorOpen className="mx-auto mb-3 h-8 w-8 text-muted-foreground opacity-40" />
          <p className="text-sm font-medium text-foreground">{t('Nenhuma controladora cadastrada')}</p>
          {isAdmin && (
            <p className="mt-1 text-sm text-muted-foreground">
              {t('Clique em "Adicionar controladora" para começar.')}
            </p>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {controllers.map((controller) => {
            const statusEntry = liveOrSeed(asCamera(controller), 'STATUS', byDevice);
            const hi = cameraHealthInfo(asCamera(controller), byDevice);
            const health = hi.health;
            const isOnline = health === 'online';
            const uptimeEntry = liveOrSeed(asCamera(controller), 'UPTIME', byDevice);
            const uptimeVal =
              uptimeEntry?.value !== null && uptimeEntry?.value !== undefined
                ? Number(uptimeEntry.value)
                : null;

            return (
              <div
                key={controller.id}
                className="rounded-xl border border-border bg-card p-4 space-y-3"
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      {isAdmin && (
                        <CriticalStarButton
                          critical={controller.critical ?? false}
                          onToggle={() =>
                            void apiPatch(`/devices/${controller.id}`, { critical: !(controller.critical ?? false) }).then(
                              () => void refetch(),
                            )
                          }
                        />
                      )}
                      <p className="truncate text-sm font-semibold text-foreground">
                        {controller.name}
                      </p>
                    </div>
                    {controller.site && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {controller.site}
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground font-mono mt-0.5">
                      {controller.ip}:{controller.port}
                      {controller.manufacturer
                        ? ` · ${controller.manufacturer}`
                        : ''}
                    </p>
                  </div>

                  {/* Status pill */}
                  <div className="shrink-0 flex flex-col items-end gap-1">
                    <span
                      className={[
                        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                        isOnline
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                          : health === 'unknown'
                            ? 'bg-muted text-muted-foreground'
                            : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
                      ].join(' ')}
                    >
                      <span
                        className={[
                          'h-1.5 w-1.5 rounded-full',
                          isOnline
                            ? 'bg-emerald-500'
                            : health === 'unknown'
                              ? 'bg-slate-400'
                              : 'bg-red-500',
                        ].join(' ')}
                      />
                      {isOnline ? t('Online') : health === 'unknown' ? t('Sem dados') : t('Offline')}
                    </span>
                    {isOnline && uptimeVal !== null && Number.isFinite(uptimeVal) && (
                      <span className="text-[10px] text-muted-foreground">
                        {formatUptime(uptimeVal)}
                      </span>
                    )}
                  </div>
                </div>

                {/* Métricas de saúde */}
                <div className="grid grid-cols-4 gap-x-3 gap-y-1 border-t border-border pt-2 text-xs">
                  {HEALTH_METRICS.map((m) => {
                    const point = controller.points.find((p) => p.metric === m);
                    if (!point) return null;
                    const entry = liveOrSeed(asCamera(controller), point.tag, byDevice);
                    const v = entry?.value;
                    const has = typeof v === 'number' && Number.isFinite(v);
                    return (
                      <div key={m} className="min-w-0">
                        <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground/70">
                          {HEALTH_LABELS[m]}
                        </p>
                        <p
                          className={has ? 'font-medium text-foreground' : 'text-muted-foreground'}
                          title={
                            !has && point.unsupported
                              ? t('OID não suportado pela controladora (último diagnóstico SNMP)')
                              : undefined
                          }
                        >
                          {has
                            ? formatHealthValue(m, v as number, point.unit)
                            : point.unsupported
                              ? t('não suportado')
                              : t('sem dados')}
                        </p>
                      </div>
                    );
                  })}
                </div>

                {/* Ações */}
                {isAdmin && (
                  <div className="flex items-center gap-1 border-t border-border pt-2">
                    <button
                      onClick={() => {
                        setControllerForAlarm(controller);
                        void refreshPointConfig(controller.id);
                      }}
                      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                      title={t('Alarmes e trends')}
                    >
                      <Bell className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setControllerToDiagnose(controller)}
                      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                      title={t('Diagnóstico SNMP')}
                    >
                      <Stethoscope className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setControllerToEdit(controller)}
                      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                      title={t('Editar')}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => setControllerToDelete(controller)}
                      className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-red-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-500/10"
                      title={t('Excluir')}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de criação */}
      {formOpen && (
        <ControllerFormModal
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false);
            void refetch();
          }}
        />
      )}

      {/* Modal de edição */}
      {controllerToEdit && (
        <ControllerFormModal
          controller={controllerToEdit}
          onClose={() => setControllerToEdit(null)}
          onSaved={() => {
            setControllerToEdit(null);
            void refetch();
          }}
        />
      )}

      {/* Diagnóstico SNMP */}
      {controllerToDiagnose && (
        <SnmpDiagnoseModal
          device={{
            id: controllerToDiagnose.id,
            name: controllerToDiagnose.name,
            ip: controllerToDiagnose.ip,
            port: controllerToDiagnose.port,
            community: controllerToDiagnose.community,
          }}
          diagnoseFn={diagnoseControllerSnmp}
          getProgressFn={getDiagnoseProgress}
          applyFn={applySnmpOids}
          deviceLabel="controladora"
          onClose={() => setControllerToDiagnose(null)}
          onApplied={() => void refetch()}
        />
      )}

      {/* Alarmes e trends por ponto */}
      {controllerForAlarm && (
        <ControllerPointConfigModal
          controller={controllerForAlarm}
          alarmRuleByPoint={alarmRuleByPoint}
          trendByPoint={trendByPoint}
          onChanged={() => refreshPointConfig(controllerForAlarm.id)}
          onClose={() => setControllerForAlarm(null)}
        />
      )}

      {/* Confirmação de exclusão (senha) */}
      {controllerToDelete && (
        <PasswordConfirmDialog
          title={`Excluir a controladora "${controllerToDelete.name}"?`}
          description={
            <>
              A controladora <strong>{controllerToDelete.ip}</strong> deixará de ser
              monitorada e os pontos de saúde serão removidos. Esta ação não pode ser
              desfeita.
            </>
          }
          isPending={deleteMutation.isPending}
          error={deleteMutation.error ? (deleteMutation.error as Error).message : null}
          onCancel={() => {
            setControllerToDelete(null);
            deleteMutation.reset();
          }}
          onConfirm={(token) =>
            deleteMutation.mutate({ id: controllerToDelete.id, token })
          }
        />
      )}
    </div>
  );
}

// ─── Modal de formulário (criar/editar) ──────────────────────────────────────

function ControllerFormModal({
  controller,
  onClose,
  onSaved,
}: {
  controller?: Controller;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const user = useCurrentUser();
  const isGlobal = user.role === 'ADMIN' || user.role === 'CCO' || user.role === 'SUPERVISOR';
  const { selectedTenantId } = useTenantFilter();
  const { selectedSiteId } = useSiteFilter();
  const { data: tenants = [] } = useTenants();

  const [modalTenantId, setModalTenantId] = useState(
    controller?.tenantId ?? (isGlobal ? (selectedTenantId ?? '') : (user.tenantId ?? '')),
  );
  const tenantId = controller?.tenantId ?? (isGlobal ? modalTenantId || undefined : user.tenantId ?? undefined);

  // Perfil global sem cliente escolhido: não busca sites/gateways (tenant
  // vazio no backend = "sem filtro") e mantém os selects travados.
  const tenantChosen = Boolean(tenantId);
  const { data: sites = [] } = useSites(tenantId, { enabled: tenantChosen });
  const { data: gateways = [] } = useGateways(tenantId, { enabled: tenantChosen });

  const [name, setName] = useState(controller?.name ?? '');
  const [ip, setIp] = useState(controller?.ip ?? '');
  const [port, setPort] = useState(controller?.port ?? 161);
  const [siteId, setSiteId] = useState(controller?.siteId ?? '');
  const [gatewayId, setGatewayId] = useState(controller?.gatewayId ?? '');
  const [snmpVersion, setSnmpVersion] = useState<'1' | '2c'>(controller?.snmpVersion ?? '2c');
  const [community, setCommunity] = useState(controller?.community ?? 'public');
  const [pollingInterval, setPollingInterval] = useState(controller?.pollingInterval ?? 30);
  const [manufacturer, setManufacturer] = useState(controller?.manufacturer ?? '');

  const valid = name.trim() && ip.trim() && (controller || (tenantId && gatewayId));

  // ─── Teste SNMP antes de salvar ─────────────────────────────────────────────
  const testGatewayId = controller?.gatewayId ?? gatewayId;
  const testTenantId = controller?.tenantId ?? tenantId;
  const canTest = Boolean(testTenantId && testGatewayId && ip.trim());

  const [testResult, setTestResult] = useState<SnmpTestOutcome | null>(null);

  const snmpTest = useMutation({
    mutationFn: () =>
      testControllerSnmp({
        tenantId: testTenantId as string,
        gatewayId: testGatewayId as string,
        ip: ip.trim(),
        port: Number(port) || 161,
        snmpVersion,
        community: community.trim() || 'public',
        manufacturer: manufacturer.trim() || null,
      }),
    onSuccess: (res) => setTestResult(res),
  });

  const save = useMutation({
    mutationFn: () => {
      const payload: ControllerInput = {
        name: name.trim(),
        ip: ip.trim(),
        port: Number(port),
        siteId: siteId || undefined,
        pollingInterval: Number(pollingInterval),
        snmpVersion,
        community: community.trim() || 'public',
        manufacturer: manufacturer.trim() || null,
      };
      if (controller) return updateController(controller.id, payload);
      return createController({ ...payload, tenantId, gatewayId });
    },
    onSuccess: () => onSaved(),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && !save.isPending) save.mutate();
        }}
        className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            {controller ? t('Editar controladora') : t('Adicionar controladora')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {isGlobal && !controller && (
          <Field label={t('Cliente *')}>
            <select
              value={modalTenantId}
              onChange={(e) => {
                setModalTenantId(e.target.value);
                setSiteId('');
                setGatewayId('');
              }}
              className={inputCls}
            >
              <option value="">{t('Selecione o cliente…')}</option>
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name}
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label={t('Site')}>
          <select
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            disabled={!tenantChosen}
            className={inputCls + (!tenantChosen ? ' opacity-60 cursor-not-allowed' : '')}
          >
            <option value="">{tenantChosen ? t('Sem site') : t('Selecione o cliente primeiro')}</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>

        {!controller && (
          <Field label={t('Gateway (faz o polling) *')}>
            <select
              value={gatewayId}
              onChange={(e) => setGatewayId(e.target.value)}
              disabled={!tenantChosen}
              className={inputCls + (!tenantChosen ? ' opacity-60 cursor-not-allowed' : '')}
            >
              <option value="">{tenantChosen ? t('Selecione…') : t('Selecione o cliente primeiro')}</option>
              {gateways.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.id} ({g.status})
                </option>
              ))}
            </select>
          </Field>
        )}

        <Field label={t('Nome *')}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('Controladora recepção')}
            className={inputCls}
          />
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label={t('Endereço IP *')}>
              <input
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                placeholder="192.168.0.100"
                className={inputCls}
              />
            </Field>
          </div>
          <Field label={t('Porta SNMP')}>
            <input
              type="number"
              value={port}
              onChange={(e) => setPort(Number(e.target.value))}
              className={inputCls}
            />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <Field label={t('Versão SNMP')}>
            <select
              value={snmpVersion}
              onChange={(e) => setSnmpVersion(e.target.value as '1' | '2c')}
              className={inputCls}
            >
              <option value="2c">v2c</option>
              <option value="1">v1</option>
            </select>
          </Field>
          <Field label={t('Community')}>
            <input
              value={community}
              onChange={(e) => setCommunity(e.target.value)}
              className={inputCls}
            />
          </Field>
          <Field label={t('Polling (s)')}>
            <input
              type="number"
              min={5}
              value={pollingInterval}
              onChange={(e) => setPollingInterval(Number(e.target.value))}
              className={inputCls}
            />
          </Field>
        </div>

        <Field label={t('Fabricante (opcional)')}>
          <input
            value={manufacturer}
            onChange={(e) => setManufacturer(e.target.value)}
            list="ac-manufacturers"
            placeholder={t('Ex.: Hikvision, Control iD, Intelbras…')}
            className={inputCls}
            title={t('Identifica o perfil de OIDs proprietários da controladora.')}
          />
          <datalist id="ac-manufacturers">
            <option value="Hikvision" />
            <option value="Control iD" />
            <option value="Intelbras" />
          </datalist>
        </Field>

        <p className="text-[11px] text-muted-foreground">
          {t('Os pontos de saúde (status, uptime, CPU, memória, temperatura, pacotes perdidos e perda de ping) são criados automaticamente e podem gerar alarmes e trends como qualquer outro ponto.')}
        </p>

        {/* ─── Bloco de teste SNMP ─────────────────────────────────────────── */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => { setTestResult(null); snmpTest.mutate(); }}
            disabled={!canTest || snmpTest.isPending}
            className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
          >
            {snmpTest.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t('Testando…')}</>
              : <><ScanSearch className="h-3.5 w-3.5" /> {t('Testar SNMP')}</>}
          </button>
          {!canTest && (
            <p className="text-[11px] text-muted-foreground">
              {t('Preencha o IP e selecione o gateway para testar.')}
            </p>
          )}
          {snmpTest.error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
              {(snmpTest.error as Error).message}
            </p>
          )}
          {testResult && (
            <div className={[
              'rounded-md border px-3 py-2 text-xs space-y-1',
              testResult.reachable
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400'
                : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400',
            ].join(' ')}>
              <p className="font-medium">
                {testResult.reachable
                  ? t('Controladora respondeu ao SNMP')
                  : t('Controladora não respondeu ao SNMP (verifique community, porta e se o SNMP está habilitado)')}
              </p>
              {testResult.reachable && (
                <ul className="space-y-0.5">
                  {HEALTH_METRICS.map((m) => {
                    const v = testResult.values[m];
                    return (
                      <li key={m} className="flex justify-between gap-3">
                        <span>{HEALTH_LABELS[m]}</span>
                        <span className="font-mono">
                          {typeof v === 'number' && Number.isFinite(v) ? v : t('sem resposta')}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>

        {save.error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            {(save.error as Error).message}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            {t('Cancelar')}
          </button>
          <button
            type="submit"
            disabled={!valid || save.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {controller ? t('Salvar') : t('Adicionar')}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Modal de alarmes/trends por ponto ───────────────────────────────────────

function ControllerPointConfigModal({
  controller,
  alarmRuleByPoint,
  trendByPoint,
  onChanged,
  onClose,
}: {
  controller: Controller;
  alarmRuleByPoint: Record<string, AlarmRuleItem>;
  trendByPoint: Record<string, TrendItem>;
  onChanged: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            {controller.name} — {t('Alarmes e Trends')}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2">
          {controller.points
            .filter((p) => p.metric !== 'status')
            .map((point) => (
              <PointConfigPanel
                key={point.id}
                pointId={point.id}
                pointLabel={point.objectName ?? point.tag}
                unit={point.unit ?? null}
                deviceId={controller.id}
                alarmRule={alarmRuleByPoint[point.id] ?? undefined}
                trend={trendByPoint[point.id] ?? undefined}
                onChanged={onChanged}
              />
            ))}
        </div>
        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            {t('Fechar')}
          </button>
        </div>
      </div>
    </div>
  );
}
