'use client';

import { useState } from 'react';
import { useT } from '@/lib/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Bell,
  ChevronDown,
  ChevronRight,
  Clock,
  DoorOpen,
  Fingerprint,
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
import { DeviceCardActionBar } from '@/components/DeviceCardActionBar';
import { HealthMetricsGrid } from '@/components/HealthMetricsGrid';
import { buildHealthTiles, formatMb, isUnsupportedHealthPoint } from '@/components/health-metrics';
import PasswordConfirmDialog from '@/components/PasswordConfirmDialog';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useTenantFilter } from '@/hooks/useTenantFilter';
import { useSiteFilter } from '@/hooks/useSiteFilter';
import { useBacnetTelemetry, deviceTagKey, type TelemetryMap } from '@/hooks/useBacnetTelemetry';
import { useGateways } from '@/modules/gateways/hooks/useGateways';
import { useSites } from '@/modules/sites/hooks/useSites';
import { useTenants } from '@/modules/tenants/hooks/useTenants';
import { PointConfigPanel } from '@/modules/trends/components/PointConfigPanel';
import { getAlarmRules, type AlarmRuleItem } from '@/modules/alarms/services/alarms-api.service';
import { getTrends, type TrendItem } from '@/modules/trends/services/trends-api.service';
import { SnmpDiagnoseModal } from '@/modules/cftv/components/SnmpDiagnoseModal';
import {
  displayForHealth,
  formatHealthValue,
  normalizeHealthReading,
  selectOperationalPoints,
} from '@/modules/cftv/utils/snmp-health';
import { useControllers } from '../hooks/useControllers';
import {
  type Controller,
  type ControllerInput,
  type SnmpTestOutcome,
  createController,
  updateController,
  deleteController,
  removeControllerPoint,
  testControllerSnmp,
  diagnoseControllerSnmp,
  getDiagnoseProgress,
  applySnmpOids,
  getMonitoringProfiles,
  getAcOidProfiles,
  testControllerOid,
} from '../services/sca.service';
import {
  cameraHealth,
  cameraHealthInfo,
  liveOrSeed,
  formatReadTime,
  formatUptime,
  formatPointLiveValue,
  POINT_STATE_LABELS,
  TELEMETRY_TAG_ORDER,
} from '@/modules/cftv/utils/telemetry-format';
import type { Camera } from '@/modules/cftv/services/cftv.service';
import { apiPatch } from '@/lib/api-client';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/40';

const HEALTH_METRICS = ['cpu', 'memory', 'temperature', 'packet_loss'] as const;
const HEALTH_LABELS: Record<(typeof HEALTH_METRICS)[number], string> = {
  cpu: 'CPU',
  memory: 'Memória',
  temperature: 'Temp.',
  packet_loss: 'Pacotes',
};

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

const alarmSeverityColor: Record<string, string> = {
  HIGH: 'text-red-500',
  MEDIUM: 'text-amber-500',
  LOW: 'text-blue-500',
};

// ─── Página ──────────────────────────────────────────────────────────────────

export default function ScaPage({ embedded = false }: { embedded?: boolean }) {
  const t = useT();
  const user = useCurrentUser();
  const isAdmin = user.role === 'ADMIN' || user.role === 'CCO' || user.role === 'SUPERVISOR';
  const { selectedTenantId } = useTenantFilter();

  const { data: controllers = [], refetch, isLoading } = useControllers();
  const { byDevice } = useBacnetTelemetry();

  const [formOpen, setFormOpen] = useState(false);
  const [controllerToEdit, setControllerToEdit] = useState<Controller | null>(null);
  const [controllerToDelete, setControllerToDelete] = useState<Controller | null>(null);
  const [controllerToDiagnose, setControllerToDiagnose] = useState<Controller | null>(null);
  const [controllerForAlarm, setControllerForAlarm] = useState<Controller | null>(null);
  const [controllerForTelemetry, setControllerForTelemetry] = useState<Controller | null>(null);
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

  const removePointMutation = useMutation({
    mutationFn: ({ controllerId, pointId }: { controllerId: string; pointId: string }) =>
      removeControllerPoint(controllerId, pointId),
    onSuccess: () => {
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
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
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
            const healthTiles = buildHealthTiles(
              health === 'offline'
                ? controller.points.map((point) => ({ ...point, unsupported: false }))
                : controller.points,
              (tag) => {
                if (health === 'offline') return null;
                const entry = liveOrSeed(asCamera(controller), tag, byDevice);
                return entry ? { value: entry.value, unreliable: entry.unreliable } : null;
              },
            );

            return (
              <div key={controller.id} className="space-y-2 rounded-xl border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <div
                      className={[
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
                        isOnline
                          ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400'
                          : health === 'unknown'
                            ? 'bg-muted text-muted-foreground'
                            : 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400',
                      ].join(' ')}
                    >
                      <Fingerprint className="h-4.5 w-4.5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        {isAdmin && (
                          <CriticalStarButton
                            critical={controller.critical ?? false}
                            onToggle={() =>
                              void apiPatch(`/devices/${controller.id}`, {
                                critical: !(controller.critical ?? false),
                              }).then(() => void refetch())
                            }
                          />
                        )}
                        <p className="truncate text-sm font-semibold text-foreground">{controller.name}</p>
                        <span className="shrink-0 rounded border border-border px-1 py-px text-[10px] font-medium uppercase text-muted-foreground">
                          SNMP
                        </span>
                      </div>
                      {controller.site && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{controller.site}</p>
                      )}
                      <p className="mt-0.5 text-[11px] font-mono text-muted-foreground">
                        {controller.ip}:{controller.port}
                        {controller.manufacturer ? ` · ${controller.manufacturer}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-start gap-1.5">
                    <span
                      className={[
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
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
                          isOnline ? 'bg-emerald-500' : health === 'unknown' ? 'bg-slate-400' : 'bg-red-500',
                        ].join(' ')}
                      />
                      {isOnline ? t('Online') : health === 'unknown' ? t('Sem dados') : t('Offline')}
                    </span>
                    {isOnline && uptimeVal !== null && Number.isFinite(uptimeVal) && (
                      <div className="rounded-lg border border-border bg-muted/40 px-2.5 py-1.5 text-center">
                        <p className="flex items-center justify-center gap-1 text-xs font-semibold text-foreground">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          {formatUptime(uptimeVal)}
                        </p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">{t('Tempo ativo')}</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="border-t border-border pt-2.5">
                  <HealthMetricsGrid
                    tiles={healthTiles}
                    canRemove={user.role === 'ADMIN' || user.role === 'CCO'}
                    onRemovePoint={(pointId) =>
                      removePointMutation.mutate({ controllerId: controller.id, pointId })
                    }
                  />
                </div>

                <DeviceCardActionBar
                  actions={[
                    {
                      key: 'telemetry',
                      label: t('Telemetria'),
                      icon: Activity,
                      onClick: () => setControllerForTelemetry(controller),
                    },
                    ...(isAdmin
                      ? [
                          {
                            key: 'alarms',
                            label: t('Alarmes'),
                            icon: Bell,
                            title: t('Alarmes e trends'),
                            onClick: () => {
                              setControllerForAlarm(controller);
                              void refreshPointConfig(controller.id);
                            },
                          },
                          {
                            key: 'diagnose',
                            label: t('Diagnóstico'),
                            icon: Stethoscope,
                            title: t('Diagnóstico SNMP'),
                            onClick: () => setControllerToDiagnose(controller),
                          },
                          {
                            key: 'edit',
                            label: t('Editar'),
                            icon: Pencil,
                            onClick: () => setControllerToEdit(controller),
                          },
                          {
                            key: 'delete',
                            label: t('Remover'),
                            icon: Trash2,
                            tone: 'danger' as const,
                            title: t('Excluir'),
                            onClick: () => setControllerToDelete(controller),
                          },
                        ]
                      : []),
                  ]}
                />
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
            mibLabel: controllerToDiagnose.snmpMib?.label ?? null,
            mibManufacturer: controllerToDiagnose.snmpMib?.manufacturer ?? null,
            mibIsOffline: controllerToDiagnose.snmpMib?.isOffline ?? false,
          }}
          diagnoseFn={diagnoseControllerSnmp}
          getProgressFn={getDiagnoseProgress}
          applyFn={applySnmpOids}
          getProfilesFn={getAcOidProfiles}
          testOidFn={testControllerOid}
          deviceLabel="controladora"
          existingPointOids={controllerToDiagnose.points
            .map((p) => p.oid)
            .filter((oid): oid is string => oid !== null)}
          onClose={() => setControllerToDiagnose(null)}
          onApplied={() => void refetch()}
        />
      )}

      {/* Valores atuais — somente leitura, separado da configuração por ponto. */}
      {controllerForTelemetry && (
        <ControllerTelemetryModal
          controller={controllers.find((c) => c.id === controllerForTelemetry.id) ?? controllerForTelemetry}
          live={byDevice}
          showIp={isAdmin}
          onClose={() => setControllerForTelemetry(null)}
        />
      )}

      {/* Alarmes e trends por ponto */}
      {controllerForAlarm && (
        <ControllerPointConfigModal
          controller={controllerForAlarm}
          byDevice={byDevice}
          isAdmin={isAdmin}
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
  const [snmpVersion, setSnmpVersion] = useState<'1' | '2c' | '3'>(
    controller?.snmpVersion ?? '2c',
  );
  const [community, setCommunity] = useState(controller?.community ?? 'public');
  // SNMPv3 (USM): chaves NUNCA vêm da API — em edição, campo vazio = manter.
  const cred = controller?.snmpCredential ?? null;
  const [securityName, setSecurityName] = useState(cred?.securityName ?? '');
  const [authProtocol, setAuthProtocol] = useState(cred?.authProtocol ?? '');
  const [authKey, setAuthKey] = useState('');
  const [privProtocol, setPrivProtocol] = useState(cred?.privProtocol ?? '');
  const [privKey, setPrivKey] = useState('');
  const [contextName, setContextName] = useState(cred?.contextName ?? '');
  const isV3 = snmpVersion === '3';
  const v3Payload = isV3
    ? {
        securityName: securityName.trim(),
        authProtocol: authProtocol || undefined,
        authKey: authKey || undefined,
        privProtocol: privProtocol || undefined,
        privKey: privKey || undefined,
        contextName: contextName.trim() || undefined,
      }
    : {};
  const [pollingInterval, setPollingInterval] = useState(controller?.pollingInterval ?? 30);
  const [manufacturer, setManufacturer] = useState(controller?.manufacturer ?? '');
  const [profileId, setProfileId] = useState(controller?.profileId ?? '');
  const { data: oidProfiles = [] } = useQuery({
    queryKey: ['sca-oid-profiles'],
    queryFn: getMonitoringProfiles,
  });

  const v3Valid =
    !isV3 ||
    (securityName.trim() &&
      // Chave nova obrigatória com protocolo escolhido — exceto em edição com
      // chave já salva (vazio = manter).
      (!authProtocol || authKey || cred?.hasAuthKey) &&
      (!privProtocol || privKey || cred?.hasPrivKey) &&
      // Privacidade exige autenticação (USM).
      (!privProtocol || Boolean(authProtocol)));
  const valid =
    name.trim() && ip.trim() && v3Valid && (controller || (tenantId && gatewayId));

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
        ...v3Payload,
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
        ...v3Payload,
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
              onChange={(e) => setSnmpVersion(e.target.value as '1' | '2c' | '3')}
              className={inputCls}
            >
              <option value="2c">v2c</option>
              <option value="1">v1</option>
              <option value="3">v3</option>
            </select>
          </Field>
          {!isV3 && (
            <Field label={t('Community')}>
              <input
                value={community}
                onChange={(e) => setCommunity(e.target.value)}
                className={inputCls}
              />
            </Field>
          )}
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

        {isV3 && (
          <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-[11px] font-medium text-muted-foreground">
              {t('Credenciais SNMPv3 (USM) — as chaves são criptografadas e nunca reexibidas')}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('Usuário (securityName) *')}>
                <input
                  value={securityName}
                  onChange={(e) => setSecurityName(e.target.value)}
                  className={inputCls}
                />
              </Field>
              <Field label={t('Contexto (opcional)')}>
                <input
                  value={contextName}
                  onChange={(e) => setContextName(e.target.value)}
                  className={inputCls}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('Autenticação')}>
                <select
                  value={authProtocol}
                  onChange={(e) => setAuthProtocol(e.target.value)}
                  className={inputCls}
                >
                  <option value="">{t('Sem autenticação')}</option>
                  <option value="sha">SHA-1</option>
                  <option value="sha256">SHA-256</option>
                  <option value="sha512">SHA-512</option>
                  <option value="md5">MD5</option>
                </select>
              </Field>
              <Field label={t('Chave de autenticação')}>
                <input
                  type="password"
                  value={authKey}
                  onChange={(e) => setAuthKey(e.target.value)}
                  disabled={!authProtocol}
                  placeholder={
                    cred?.hasAuthKey ? t('Deixe em branco para manter') : t('Mínimo 8 caracteres')
                  }
                  className={inputCls + (!authProtocol ? ' opacity-60 cursor-not-allowed' : '')}
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('Privacidade (criptografia)')}>
                <select
                  value={privProtocol}
                  onChange={(e) => setPrivProtocol(e.target.value)}
                  disabled={!authProtocol}
                  className={inputCls + (!authProtocol ? ' opacity-60 cursor-not-allowed' : '')}
                >
                  <option value="">{t('Sem privacidade')}</option>
                  <option value="aes">AES-128</option>
                  <option value="aes256">AES-256</option>
                  <option value="des">DES</option>
                </select>
              </Field>
              <Field label={t('Chave de privacidade')}>
                <input
                  type="password"
                  value={privKey}
                  onChange={(e) => setPrivKey(e.target.value)}
                  disabled={!privProtocol}
                  placeholder={
                    cred?.hasPrivKey ? t('Deixe em branco para manter') : t('Mínimo 8 caracteres')
                  }
                  className={inputCls + (!privProtocol ? ' opacity-60 cursor-not-allowed' : '')}
                />
              </Field>
            </div>
          </div>
        )}

        <Field label={t('Fabricante (opcional)')}>
          <select
            value={profileId || (manufacturer && !oidProfiles.some((p) => p.label === manufacturer) ? 'other' : '')}
            onChange={(e) => {
              const value = e.target.value;
              setProfileId(value === 'other' || !value ? '' : value);
              if (value && value !== 'other') {
                const profile = oidProfiles.find((p) => p.id === value);
                if (profile) setManufacturer(profile.label);
              } else if (value !== 'other') setManufacturer('');
            }}
            className={inputCls}
            title={t('Seleciona o perfil curado que orienta a coleta, sem ativar novos pontos automaticamente.')}
          >
            <option value="">{t('Detecção automática / genérico')}</option>
            {oidProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>{profile.label}</option>
            ))}
            <option value="other">{t('Outro fabricante')}</option>
          </select>
          {(profileId === '' && manufacturer && !oidProfiles.some((p) => p.label === manufacturer)) ||
          manufacturer && !oidProfiles.some((p) => p.label === manufacturer) ? (
            <input
              value={manufacturer}
              onChange={(e) => setManufacturer(e.target.value)}
              placeholder={t('Digite o fabricante')}
              className={inputCls + ' mt-2'}
            />
          ) : null}
          <p className="text-[11px] text-muted-foreground">
            {t('O perfil orienta leituras já configuradas. Não cria pontos, trends ou alarmes novos.')}
          </p>
        </Field>

        <p className="text-[11px] text-muted-foreground">
          {t('As métricas confirmadas pelo diagnóstico são ativadas automaticamente sem substituir fontes já configuradas.')}
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

// ─── Telemetria e configuração por ponto ─────────────────────────────────────

/** Detalhe somente de leitura dos valores atuais da controladora. */
function ControllerTelemetryModal({
  controller,
  live,
  showIp,
  onClose,
}: {
  controller: Controller;
  live: TelemetryMap;
  /** Dados de rede e OID são exibidos apenas para perfis administrativos. */
  showIp: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const points = selectOperationalPoints(controller.points);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl space-y-4 overflow-y-auto rounded-xl border border-border bg-card p-6 shadow-xl max-h-[85vh]">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            {t('Telemetria')} — {controller.name}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Fechar telemetria')}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs text-muted-foreground">
          {[
            showIp ? `${controller.ip}:${controller.port}` : null,
            controller.manufacturer,
            controller.profileLabel || null,
          ]
            .filter(Boolean)
            .join(' — ')}
        </p>

        <ul className="divide-y divide-border rounded-lg border border-border">
          {points.map((point) => {
            const entry = liveOrSeed(asCamera(controller), point.tag, live);
            const display = displayForHealth(point, point.display);
            const blocked =
              isUnsupportedHealthPoint(point) ||
              point.healthState === 'broken' ||
              (point.healthState === 'pending' && entry?.value === null);
            const normalized = blocked
              ? null
              : normalizeHealthReading(point.metric, entry?.value, display.unit || point.unit);
            const value = normalized === null ? null : formatHealthValue(point.metric, normalized, display.unit || point.unit);
            const stateLabel = entry?.state ? POINT_STATE_LABELS[entry.state] : undefined;
            const readAt = formatReadTime(entry?.timestamp ?? null);
            const unreliable = value !== null && entry?.unreliable === true;
            return (
              <li key={point.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm text-foreground">{display.label}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span
                    className={
                      unreliable
                        ? 'block text-sm font-medium text-amber-600 dark:text-amber-400'
                        : value !== null
                          ? 'block text-sm font-medium text-foreground'
                          : 'block text-xs text-muted-foreground'
                    }
                    title={
                      unreliable
                        ? t('Dado não confiável — o firmware responde um valor fixo neste OID.')
                        : undefined
                    }
                  >
                    {value !== null
                      ? `${value}${unreliable ? ' ⚠' : ''}`
                      : point.healthState === 'broken'
                        ? t('fonte quebrada')
                        : point.healthState === 'pending'
                          ? t('atualização pendente')
                        : isUnsupportedHealthPoint(point)
                          ? t('não suportado')
                          : (stateLabel ? t(stateLabel) : t('sem dados'))}
                  </span>
                  {readAt && (
                    <span className="block text-[11px] text-muted-foreground">
                      {t('lido às')} {readAt}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>

      </div>
    </div>
  );
}

/**
 * Modal de configuração por ponto da controladora: lista os pontos de saúde
 * (incluindo STATUS) com valor ao vivo, indicadores de alarme/trend e estrela
 * de ativo crítico — no mesmo padrão visual do modal de câmera do CFTV.
 */
function ControllerPointConfigModal({
  controller,
  byDevice,
  isAdmin,
  alarmRuleByPoint,
  trendByPoint,
  onChanged,
  onClose,
}: {
  controller: Controller;
  byDevice: TelemetryMap;
  isAdmin: boolean;
  alarmRuleByPoint: Record<string, AlarmRuleItem>;
  trendByPoint: Record<string, TrendItem>;
  onChanged: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [pointCriticalById, setPointCriticalById] = useState<Record<string, boolean>>({});

  const isPointCritical = (p: { id: string; critical?: boolean }) =>
    pointCriticalById[p.id] ?? !!p.critical;

  async function handleTogglePointCritical(pointId: string) {
    const current = isPointCritical(
      controller.points.find((p) => p.id === pointId) ?? { id: pointId },
    );
    const next = !current;
    setPointCriticalById((m) => ({ ...m, [pointId]: next }));
    try {
      await apiPatch(`/devices/${controller.id}/points/${pointId}`, { critical: next });
      void queryClient.invalidateQueries({ queryKey: ['sca-controllers'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-critical-assets'] });
    } catch {
      setPointCriticalById((m) => ({ ...m, [pointId]: current }));
    }
  }

  const points = [...controller.points].sort((a, b) => {
    const ia = TELEMETRY_TAG_ORDER.indexOf(a.tag);
    const ib = TELEMETRY_TAG_ORDER.indexOf(b.tag);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <h3 className="text-sm font-semibold text-foreground">
            {t('Alarmes e histórico')} — {controller.name}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
          <p className="text-xs text-muted-foreground">
            {t('Escolha um ponto para configurar alarmes, trend (histórico) e criticidade. O valor exibido abaixo é apenas um resumo para identificar o ponto.')}
          </p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {points.map((p) => {
              const entry = liveOrSeed(asCamera(controller), p.tag, byDevice);
              const value =
                p.healthState === 'broken' ||
                (p.healthState === 'pending' && entry?.value === null)
                  ? null
                  : formatPointLiveValue(p, entry?.value ?? null);
              const pointAlarm = alarmRuleByPoint[p.id];
              const pointTrend = trendByPoint[p.id];
              const expanded = expandedId === p.id;
              const isDigital = p.metric === 'status' || p.tag === 'STATUS';
              return (
                <li key={p.id} className="flex flex-col">
                  <div
                    className={`flex items-center gap-1 px-3 py-2.5 hover:bg-muted transition-colors ${expanded ? 'bg-muted/50' : ''}`}
                  >
                    {isAdmin && (
                      <CriticalStarButton
                        critical={isPointCritical(p)}
                        size={14}
                        onToggle={() => void handleTogglePointCritical(p.id)}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : p.id)}
                      className="flex flex-1 items-center justify-between gap-3 text-left"
                    >
                      <span className="min-w-0">
                        <span className="flex items-center gap-1.5 min-w-0">
                          {pointTrend && (
                            <LineChart
                              className="h-3.5 w-3.5 shrink-0 text-cyan-600"
                              strokeWidth={2}
                              aria-label="Trend ativa"
                            />
                          )}
                          {pointAlarm && (
                            <Bell
                              className={`h-3.5 w-3.5 shrink-0 ${alarmSeverityColor[pointAlarm.severity] ?? 'text-amber-500'}`}
                              strokeWidth={2}
                              aria-label="Alarme configurado"
                            />
                          )}
                          <span className="truncate text-sm text-foreground">{p.objectName}</span>
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {p.tag}{p.unit ? ` · ${p.unit}` : ''}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span
                          className={
                            value !== null
                              ? 'text-sm font-medium text-foreground'
                              : 'text-xs text-muted-foreground'
                          }
                        >
                          {value !== null ? value : p.unsupported ? 'não suportado' : 'sem dados'}
                        </span>
                        {expanded
                          ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                          : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      </span>
                    </button>
                  </div>
                  {expanded && (
                    <PointConfigPanel
                      pointId={p.id}
                      pointLabel={`${controller.name} — ${p.objectName}`}
                      isDigital={isDigital}
                      unit={p.unit || null}
                      trend={pointTrend}
                      alarmRule={pointAlarm}
                      deviceId={controller.id}
                      onChanged={onChanged}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
