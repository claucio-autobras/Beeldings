'use client';

import { CriticalStarButton } from '@/components/CriticalStarButton';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  Bell,
  Cctv,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleOff,
  HardDrive,
  Info,
  LineChart,
  Loader2,
  MonitorPlay,
  Network,
  Pencil,
  Plus,
  Radar,
  ScanSearch,
  Stethoscope,
  Trash2,
  Video,
  X,
  XCircle,
} from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { getAlarmRules, type AlarmRuleItem } from '@/modules/alarms/services/alarms-api.service';
import { getTrends, type TrendItem } from '@/modules/trends/services/trends-api.service';
import { PointConfigPanel } from '@/modules/trends/components/PointConfigPanel';
import type {
  Camera as CameraType,
  HealthMetric,
  ManagedSwitch,
  SnmpHealthTestOutcome,
} from '../services/cftv.service';
import { deleteSwitch, setCameraCritical, setCameraPointCritical } from '../services/cftv.service';
import PasswordConfirmDialog from '@/components/PasswordConfirmDialog';
import { useT } from '@/lib/i18n';
import { CameraLiveViewModal } from '../components/CameraLiveViewModal';
import { SnmpDiagnoseModal } from '../components/SnmpDiagnoseModal';
import { useBacnetTelemetry, deviceTagKey, type TelemetryMap } from '@/hooks/useBacnetTelemetry';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useTenantFilter } from '@/hooks/useTenantFilter';
import { useSiteFilter } from '@/hooks/useSiteFilter';
import { useGateways } from '@/modules/gateways/hooks/useGateways';
import { useSites } from '@/modules/sites/hooks/useSites';
import { useTenants } from '@/modules/tenants/hooks/useTenants';
import {
  type Camera,
  type CameraCapabilities,
  type CameraInput,
  type DiagMetric,
  type DiscoveredOnvifDevice,
  type MonitoringProfile,
  type SnmpDiagnoseOutcome,
  type SnmpDiagnoseProgress,
  type SnmpScanOutcome,
  type SnmpScanProgress,
  applySnmpOids,
  createCamera,
  deleteCamera,
  diagnoseCameraSnmp,
  getCameraCapabilities,
  getDiagnoseProgress,
  getMonitoringProfiles,
  getScanProgress,
  probeCameraCapabilities,
  scanOnvifNetwork,
  scanSnmpRange,
  testCameraSnmp,
  updateCamera,
} from '../services/cftv.service';
import { useCameras } from '../hooks/useCameras';
import { useSwitches } from '../hooks/useSwitches';
import { useNvrs } from '../hooks/useNvrs';
import { SwitchFormModal } from '../components/SwitchFormModal';
import { SwitchPanel } from '../components/SwitchPanel';
import { NvrFormModal } from '../components/NvrFormModal';
import { NvrPanel } from '../components/NvrPanel';
import {
  type ManagedNvr,
  deleteNvr,
} from '../services/cftv.service';
import {
  type CameraHealth,
  type CameraHealthInfo,
  cameraHealth,
  cameraHealthInfo,
  ESTIMATED_UPTIME_HINT,
  estimatedUptimeSeconds,
  formatUptime,
  formatPointLiveValue,
  formatReadTime,
  liveOrSeed,
  POINT_STATE_LABELS,
  TELEMETRY_TAG_ORDER,
  WAITING_EVENT_HINT,
} from '../utils/telemetry-format';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Métricas de saúde exibidas no card (ordem fixa). */
const HEALTH_METRICS: HealthMetric[] = ['cpu', 'memory', 'temperature', 'packet_loss'];

/** Métricas extras do card — só aparecem quando a câmera tem o ponto. */
const EXTRA_HEALTH_METRICS: Array<HealthMetric | 'ping_loss'> = [
  'ram_total',
  'storage',
  'ping_loss',
];

const HEALTH_LABELS: Record<HealthMetric | 'ping_loss', string> = {
  cpu: 'CPU',
  memory: 'Memória',
  ram_total: 'RAM total',
  storage: 'Armazen.',
  temperature: 'Temp.',
  packet_loss: 'Pacotes',
  // Perda de pacotes medida por ping ICMP no gateway (camada 3, sem OID).
  ping_loss: 'Perda ping',
};

/** Eventos ONVIF exibidos no card de câmeras sem canal SNMP de saúde. */
const ONVIF_EVENTS: Array<{ tag: string; label: string }> = [
  { tag: 'MOVIMENTO', label: 'Movimento' },
  { tag: 'TAMPER', label: 'Tamper' },
  { tag: 'PERDA_VIDEO', label: 'Perda de vídeo' },
];

/** Métricas com OID editável no cadastro (saúde + uptime). */
type OverrideMetric = HealthMetric | 'uptime';
const OVERRIDE_METRICS: OverrideMetric[] = [...HEALTH_METRICS, 'uptime'];
const OVERRIDE_LABELS: Record<OverrideMetric, string> = {
  ...HEALTH_LABELS,
  uptime: 'Uptime',
};

/** Tags de ponto de câmera com semântica digital (0/1) — define o tipo de alarme/trend. */
const CAMERA_DIGITAL_TAGS = ['STATUS', 'STREAM', 'MOVIMENTO', 'TAMPER', 'PERDA_VIDEO'];

// Cor do ícone de alarme conforme a severidade da regra configurada no ponto
// (mesma convenção do detalhe de dispositivo BMS).
const alarmSeverityColor: Record<string, string> = {
  HIGH: 'text-red-500',
  MEDIUM: 'text-amber-500',
  LOW: 'text-blue-500',
};

/** Formata o valor de uma métrica de saúde para o card. */
function formatHealthValue(
  metric: HealthMetric | 'ping_loss',
  value: number,
  unit: string,
): string {
  const v = metric === 'temperature' ? value.toFixed(1) : String(Math.round(value));
  return unit ? `${v} ${unit}` : v;
}


/** Unidade padrão por métrica do diagnóstico (quando o backend não informa). */
const DIAG_UNIT_DEFAULT: Record<DiagMetric, string> = {
  cpu: '%',
  memory: '%',
  ram_total: 'MB',
  storage: '%',
  temperature: '°C',
  packet_loss: '%',
  uptime: '',
};

/** Formata um valor de métrica do diagnóstico de forma amigável ("44%", "38.5 °C", "3d 4h"). */
function formatDiagValue(
  metric: DiagMetric,
  value: number | null,
  unit?: string | null,
): string | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (metric === 'uptime') return formatUptime(value);
  const v = metric === 'temperature' ? value.toFixed(1) : String(Math.round(value));
  const u = (unit && unit.trim()) || DIAG_UNIT_DEFAULT[metric] || '';
  if (!u) return v;
  return u === '%' || u.startsWith('°') ? `${v}${u}` : `${v} ${u}`;
}

// ─── Página ──────────────────────────────────────────────────────────────────

export default function CftvPage({ embedded = false }: { embedded?: boolean } = {}) {
  const user = useCurrentUser();
  const isAdmin = user.role === 'ADMIN' || user.role === 'CCO' || user.role === 'SUPERVISOR';
  const canDelete = user.role === 'ADMIN' || user.role === 'CCO';

  const t = useT();
  const { selectedTenantId } = useTenantFilter();
  const { selectedSiteId } = useSiteFilter();
  const effectiveTenantId = isAdmin
    ? (selectedTenantId ?? undefined)
    : (user.tenantId ?? undefined);

  const queryClient = useQueryClient();
  const { data: cameras = [], isLoading } = useCameras(effectiveTenantId);
  const { data: switches = [], isLoading: isLoadingSwitches } = useSwitches(effectiveTenantId);
  const { data: nvrs = [], isLoading: isLoadingNvrs } = useNvrs(effectiveTenantId);

  const refetchSwitches = () => queryClient.invalidateQueries({ queryKey: ['cftv-switches'] });
  const refetchNvrs = () => queryClient.invalidateQueries({ queryKey: ['cftv-nvrs'] });

  // Toggle de câmera crítica (estrela) — otimista, reverte em erro.
  const [criticalById, setCriticalById] = useState<Record<string, boolean>>({});
  const cameraCritical = (c: Camera) => criticalById[c.id] ?? !!c.critical;
  async function handleToggleCameraCritical(camera: Camera) {
    const current = cameraCritical(camera);
    const next = !current;
    setCriticalById((m) => ({ ...m, [camera.id]: next }));
    try {
      await setCameraCritical(camera.id, next);
      queryClient.invalidateQueries({ queryKey: ['cftv-cameras'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-critical-assets'] });
    } catch {
      setCriticalById((m) => ({ ...m, [camera.id]: current }));
    }
  }
  const { data: sites = [] } = useSites(effectiveTenantId);

  // Telemetria ao vivo: o ponto STATUS (instance 0) diz se a câmera responde ao
  // SNMP — a "recência" do device não serve aqui, porque o gateway publica
  // STATUS=0 mesmo com a câmera offline (o device continua "vivo").
  const { byDevice } = useBacnetTelemetry({ enabled: cameras.length > 0 });

  // Critério canônico compartilhado com o card CFTV do dashboard.
  // healthInfoOf() inclui o motivo (ex.: 'gateway_offline') para badge/tooltip.
  const healthInfoOf = (camera: Camera): CameraHealthInfo => cameraHealthInfo(camera, byDevice);
  const healthOf = (camera: Camera): CameraHealth => healthInfoOf(camera).health;

  const uptimeOf = (camera: Camera): number | null => {
    const entry = liveOrSeed(camera, 'UPTIME', byDevice);
    const v = entry?.value;
    // Uptime real do hardware — leituras 'estimated' (null do gateway) não contam.
    if (entry?.state === 'estimated') return null;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };

  /**
   * "Tempo online estimado" (camada 3): segundos desde que o backend viu a
   * câmera voltar a responder (transição do ponto STATUS). Só quando não há
   * uptime real e a câmera está online.
   */
  const estimatedUptimeOf = (camera: Camera): number | null =>
    estimatedUptimeSeconds(camera.estimatedOnlineSince, healthOf(camera) === 'online');

  const [search, setSearch] = useState('');
  const filtered = useMemo(
    () =>
      cameras.filter((c) => {
        if (search && !`${c.name} ${c.ip}`.toLowerCase().includes(search.toLowerCase())) {
          return false;
        }
        if (selectedSiteId && c.siteId !== selectedSiteId) return false;
        return true;
      }),
    [cameras, search, selectedSiteId],
  );

  const onlineCount = filtered.filter((c) => healthOf(c) === 'online').length;
  const offlineCount = filtered.filter((c) => healthOf(c) === 'offline').length;

  // Modais
  const [formOpen, setFormOpen] = useState(false);
  const [cameraToEdit, setCameraToEdit] = useState<Camera | null>(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [cameraToDelete, setCameraToDelete] = useState<Camera | null>(null);
  const [cameraForAlarm, setCameraForAlarm] = useState<Camera | null>(null);
  const [cameraForTelemetry, setCameraForTelemetry] = useState<Camera | null>(null);
  // Visualização ao vivo (ONVIF): um único modal/sessão por vez.
  const [cameraForLive, setCameraForLive] = useState<Camera | null>(null);
  const [cameraToDiagnose, setCameraToDiagnose] = useState<Camera | null>(null);
  const [prefillIp, setPrefillIp] = useState<string | null>(null);
  const [prefillProtocol, setPrefillProtocol] = useState<'snmp' | 'onvif' | null>(null);
  const [prefillPort, setPrefillPort] = useState<number | null>(null);
  // Aviso pós-salvamento (porta ajustada pelo fallback / validação pendente).
  const [saveNotice, setSaveNotice] = useState<string | null>(null);

  const refetch = () => queryClient.invalidateQueries({ queryKey: ['cftv-cameras'] });

  // Regras de alarme e trends existentes — indicadores por câmera/ponto (mesma
  // experiência do detalhe de dispositivo BMS).
  const { data: allAlarmRules = [] } = useQuery({
    queryKey: ['alarm-rules', 'cftv', effectiveTenantId ?? 'all'],
    queryFn: () => getAlarmRules(effectiveTenantId ? { tenantId: effectiveTenantId } : {}),
    enabled: cameras.length > 0,
  });
  const { data: allTrends = [] } = useQuery({
    queryKey: ['trends', 'cftv', effectiveTenantId ?? 'all'],
    queryFn: () => getTrends(effectiveTenantId ? { tenantId: effectiveTenantId } : {}),
    enabled: cameras.length > 0,
  });
  const alarmRuleByPoint = useMemo(
    () => new Map(allAlarmRules.map((r) => [r.pointId, r])),
    [allAlarmRules],
  );
  const trendByPoint = useMemo(
    () => new Map(allTrends.map((t) => [t.pointId, t])),
    [allTrends],
  );
  const refreshPointConfig = () => {
    void queryClient.invalidateQueries({ queryKey: ['alarm-rules'] });
    void queryClient.invalidateQueries({ queryKey: ['trends'] });
  };

  const deleteMutation = useMutation({
    mutationFn: ({ id, token }: { id: string; token: string }) => deleteCamera(id, token),
    onSuccess: () => {
      setCameraToDelete(null);
      void refetch();
    },
  });

  // ── Switch modal state ────────────────────────────────────────────────────
  const [switchFormOpen, setSwitchFormOpen] = useState(false);
  const [switchToEdit, setSwitchToEdit] = useState<ManagedSwitch | null>(null);
  const [switchToDelete, setSwitchToDelete] = useState<ManagedSwitch | null>(null);
  const [switchForPanel, setSwitchForPanel] = useState<ManagedSwitch | null>(null);

  const deleteSwitchMutation = useMutation({
    mutationFn: ({ id, token }: { id: string; token: string }) => deleteSwitch(id, token),
    onSuccess: () => {
      setSwitchToDelete(null);
      void refetchSwitches();
    },
  });

  const filteredSwitches = useMemo(
    () =>
      switches.filter((sw) => {
        if (search && !`${sw.name} ${sw.ip}`.toLowerCase().includes(search.toLowerCase())) {
          return false;
        }
        if (selectedSiteId && sw.siteId !== selectedSiteId) return false;
        return true;
      }),
    [switches, search, selectedSiteId],
  );

  // ── NVR modal state ───────────────────────────────────────────────────────
  const [nvrFormOpen, setNvrFormOpen] = useState(false);
  const [nvrToEdit, setNvrToEdit] = useState<ManagedNvr | null>(null);
  const [nvrToDelete, setNvrToDelete] = useState<ManagedNvr | null>(null);
  const [nvrForPanel, setNvrForPanel] = useState<ManagedNvr | null>(null);

  const deleteNvrMutation = useMutation({
    mutationFn: ({ id, token }: { id: string; token: string }) => deleteNvr(id, token),
    onSuccess: () => {
      setNvrToDelete(null);
      void refetchNvrs();
    },
  });

  const filteredNvrs = useMemo(
    () =>
      nvrs.filter((nvr) => {
        if (search && !`${nvr.name} ${nvr.ip}`.toLowerCase().includes(search.toLowerCase())) {
          return false;
        }
        if (selectedSiteId && nvr.siteId !== selectedSiteId) return false;
        return true;
      }),
    [nvrs, search, selectedSiteId],
  );

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          {embedded ? (
            <p className="text-sm text-muted-foreground mt-0.5">
              Monitoramento de câmeras via SNMP ou ONVIF — status, uptime e saúde de rede
            </p>
          ) : (
            <>
              <h1 className="text-xl font-semibold text-foreground">CFTV</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Monitoramento de câmeras via SNMP ou ONVIF — status, uptime e saúde de rede
              </p>
            </>
          )}
        </div>

        {isAdmin && (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setScanOpen(true)}
              className="flex items-center gap-2 h-9 px-4 text-sm rounded-md font-medium border border-border text-foreground hover:bg-muted transition-colors"
            >
              <ScanSearch className="h-4 w-4" />
              Escanear rede
            </button>
            <button
              onClick={() => { setPrefillIp(null); setPrefillProtocol(null); setPrefillPort(null); setFormOpen(true); }}
              className="flex items-center gap-2 h-9 px-4 text-sm rounded-md font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Adicionar câmera
            </button>
          </div>
        )}
      </div>

      {/* Aviso pós-salvamento (porta ajustada / validação pendente) */}
      {saveNotice && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
          <p>{saveNotice}</p>
          <button
            onClick={() => setSaveNotice(null)}
            title="Dispensar aviso"
            className="shrink-0 rounded p-0.5 hover:bg-amber-100 dark:hover:bg-amber-500/15"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Resumo + busca */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4 text-sm">
          <span className="text-muted-foreground">
            {filtered.length} câmera{filtered.length !== 1 ? 's' : ''}
          </span>
          <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
            <span className="h-2 w-2 rounded-full bg-emerald-500" /> {onlineCount} online
          </span>
          <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
            <span className="h-2 w-2 rounded-full bg-red-500" /> {offlineCount} offline
          </span>
        </div>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome ou IP…"
          className="h-9 w-full sm:w-64 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary"
        />
      </div>

      {/* Lista */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-[150px] rounded-lg bg-muted/50 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          <Cctv className="mx-auto mb-3 h-8 w-8 opacity-40" />
          Nenhuma câmera cadastrada.
          {isAdmin && ' Use "Escanear rede" para descobrir câmeras SNMP ou adicione manualmente.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((camera) => {
            const healthInfo = healthInfoOf(camera);
            const health = healthInfo.health;
            const uptime = uptimeOf(camera);
            const statusEntry = liveOrSeed(camera, 'STATUS', byDevice);
            const statusReadAt = formatReadTime(statusEntry?.timestamp ?? null);
            // Tooltip do badge de status: motivo quando disponível + "lido às" como contexto.
            const statusBadgeTooltip: string | undefined =
              healthInfo.reason === 'gateway_offline'
                ? `Gateway offline — STATUS congelado${statusReadAt ? ` (lido às ${statusReadAt})` : ''}`
                : health === 'unknown' && statusEntry
                  ? `Dados desatualizados${statusReadAt ? ` (lido às ${statusReadAt})` : ''}`
                  : undefined;
            return (
              <div
                key={camera.id}
                className="rounded-lg border border-border bg-card p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={[
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
                        health === 'online'
                          ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400'
                          : health === 'offline'
                            ? 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400'
                            : 'bg-muted text-muted-foreground',
                      ].join(' ')}
                    >
                      <Video className="h-4.5 w-4.5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{camera.name}</p>
                        <span className="shrink-0 rounded border border-border px-1 py-px text-[10px] font-medium uppercase text-muted-foreground">
                          {camera.monitoringProtocol === 'onvif' ? 'ONVIF' : 'SNMP'}
                        </span>
                        {camera.pendingValidation && (
                          <span
                            title="A câmera foi salva sem conexão ONVIF confirmada. O sistema re-tenta a validação automaticamente em segundo plano."
                            className="shrink-0 rounded border border-amber-300 bg-amber-50 px-1 py-px text-[10px] font-medium text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400"
                          >
                            Validação pendente
                          </span>
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {[
                          // IP:porta é informação de rede — só perfis administrativos veem.
                          isAdmin ? `${camera.ip}:${camera.port}` : null,
                          camera.site || null,
                          camera.monitoringProtocol === 'onvif' && camera.deviceInfo?.model
                            ? [camera.deviceInfo.manufacturer, camera.deviceInfo.model].filter(Boolean).join(' ')
                            : null,
                        ]
                          .filter(Boolean)
                          .join(' — ')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {/* Ver ao vivo — câmera com vídeo disponível (ONVIF sempre;
                        SNMP quando tem credenciais de vídeo/RTSP) e online. */}
                    {camera.liveViewAvailable && (
                      <button
                        onClick={() => setCameraForLive(camera)}
                        disabled={health !== 'online'}
                        title={
                          health === 'online'
                            ? t('Ver ao vivo')
                            : t('Disponível quando a câmera estiver online')
                        }
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                      >
                        <MonitorPlay className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {/* Detalhe de telemetria — visível para todos os perfis. */}
                    <button
                      onClick={() => setCameraForTelemetry(camera)}
                      title="Ver telemetria"
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <Activity className="h-3.5 w-3.5" />
                    </button>
                  {isAdmin && (
                    <div className="flex items-center gap-1 shrink-0">
                      {(camera.monitoringProtocol === 'snmp' || camera.snmpHealth?.enabled) && (
                        <button
                          onClick={() => setCameraToDiagnose(camera)}
                          title="Diagnosticar SNMP"
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <Stethoscope className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {(() => {
                        const cameraAlarmRule = camera.points
                          .map((p) => alarmRuleByPoint.get(p.id))
                          .find(Boolean);
                        return (
                          <button
                            onClick={() => setCameraForAlarm(camera)}
                            title={cameraAlarmRule ? 'Alarmes e trends (há alarme configurado)' : 'Alarmes e trends'}
                            className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <Bell
                              className={`h-3.5 w-3.5 ${
                                cameraAlarmRule
                                  ? `fill-current ${alarmSeverityColor[cameraAlarmRule.severity] ?? 'text-amber-500'}`
                                  : ''
                              }`}
                            />
                          </button>
                        );
                      })()}
                      <CriticalStarButton
                        critical={cameraCritical(camera)}
                        size={14}
                        onToggle={() => handleToggleCameraCritical(camera)}
                      />
                      <button
                        onClick={() => setCameraToEdit(camera)}
                        title="Editar"
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      {canDelete && (
                        <button
                          onClick={() => setCameraToDelete(camera)}
                          title="Excluir"
                          className="rounded-md p-1.5 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  )}
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span
                    title={statusBadgeTooltip}
                    className={[
                      'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium',
                      statusBadgeTooltip ? 'cursor-help' : '',
                      health === 'online'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                        : health === 'offline'
                          ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400'
                          : 'bg-muted text-muted-foreground',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'h-1.5 w-1.5 rounded-full',
                        health === 'online'
                          ? 'bg-emerald-500'
                          : health === 'offline'
                            ? 'bg-red-500'
                            : 'bg-slate-400',
                      ].join(' ')}
                    />
                    {health === 'online'
                      ? 'Online'
                      : health === 'offline'
                        ? healthInfo.reason === 'gateway_offline'
                          ? 'Sem comunicação'
                          : 'Offline'
                        : 'Sem dados'}
                  </span>
                  {/* "lido às" — preservado como info contextual; quando o tooltip
                      do badge já contém a hora (gateway_offline / desatualizado),
                      omitimos o texto duplicado para não poluir o card. */}
                  {statusReadAt && !statusBadgeTooltip && (
                    <span className="text-[11px] text-muted-foreground">
                      lido às {statusReadAt}
                    </span>
                  )}
                  {statusReadAt && statusBadgeTooltip && (
                    <span className="text-[11px] text-muted-foreground" title={statusBadgeTooltip}>
                      lido às {statusReadAt}
                    </span>
                  )}
                  <span className="text-muted-foreground">
                    {uptime !== null
                      ? `Ligada há ${formatUptime(uptime)}`
                      : estimatedUptimeOf(camera) !== null
                        ? (
                            <span title="A câmera não expõe o uptime real — tempo estimado desde que voltou a responder ao monitoramento.">
                              {`Tempo online estimado: ${formatUptime(estimatedUptimeOf(camera) as number)}`}
                            </span>
                          )
                        : camera.monitoringProtocol === 'onvif'
                          ? 'ONVIF'
                          : `SNMP v${camera.snmpVersion}`}
                  </span>
                </div>

                {camera.monitoringProtocol === 'snmp' || camera.snmpHealth?.enabled ? (
                  /* Métricas de saúde via SNMP — slots sempre visíveis; canal
                     com OID sem resposta = "sem dados" (neutro). */
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 border-t border-border pt-2 text-xs sm:grid-cols-4">
                    {HEALTH_METRICS.map((m) => {
                      const point = camera.points.find((p) => p.metric === m);
                      const entry = point
                        ? liveOrSeed(camera, point.tag, byDevice)
                        : undefined;
                      const v = entry?.value;
                      const has = typeof v === 'number' && Number.isFinite(v);
                      const unreliable = has && entry?.unreliable === true;
                      return (
                        <div key={m} className="min-w-0">
                          <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground/70">
                            {HEALTH_LABELS[m]}
                          </p>
                          <p
                            className={
                              unreliable
                                ? 'font-medium text-amber-600 dark:text-amber-400'
                                : has
                                  ? 'font-medium text-foreground'
                                  : 'text-muted-foreground'
                            }
                            title={
                              unreliable
                                ? 'Dado não confiável — o firmware responde um valor fixo neste OID.'
                                : !has && point?.unsupported
                                  ? 'OID não suportado pela câmera (último diagnóstico SNMP)'
                                  : undefined
                            }
                          >
                            {has && point
                              ? `${formatHealthValue(m, v as number, point.unit)}${unreliable ? ' ⚠' : ''}`
                              : point?.unsupported
                                ? 'não suportado'
                                : 'sem dados'}
                          </p>
                        </div>
                      );
                    })}
                    {/* Métricas extras (RAM total / armazenamento) — só quando o ponto existe */}
                    {EXTRA_HEALTH_METRICS.map((m) => {
                      const point = camera.points.find((p) => p.metric === m);
                      if (!point) return null;
                      const entry = liveOrSeed(camera, point.tag, byDevice);
                      const v = entry?.value;
                      const has = typeof v === 'number' && Number.isFinite(v);
                      const unreliable = has && entry?.unreliable === true;
                      return (
                        <div key={m} className="min-w-0">
                          <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground/70">
                            {HEALTH_LABELS[m]}
                          </p>
                          <p
                            className={
                              unreliable
                                ? 'font-medium text-amber-600 dark:text-amber-400'
                                : has
                                  ? 'font-medium text-foreground'
                                  : 'text-muted-foreground'
                            }
                            title={
                              unreliable
                                ? 'Dado não confiável — o firmware responde um valor fixo neste OID.'
                                : !has && point.unsupported
                                  ? 'OID não suportado pela câmera (último diagnóstico SNMP)'
                                  : undefined
                            }
                          >
                            {has
                              ? `${formatHealthValue(m, v as number, point.unit)}${unreliable ? ' ⚠' : ''}`
                              : point.unsupported
                                ? 'não suportado'
                                : 'sem dados'}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  /* ONVIF puro (sem canal SNMP de saúde): mostra o estado dos
                     eventos da câmera no lugar das métricas SNMP vazias. */
                  <div className="grid grid-cols-3 gap-x-3 gap-y-1 border-t border-border pt-2 text-xs">
                    {ONVIF_EVENTS.map((ev) => {
                      const point = camera.points.find((p) => p.tag === ev.tag);
                      const entry = point
                        ? liveOrSeed(camera, point.tag, byDevice)
                        : undefined;
                      const n = Number(entry?.value);
                      const has = entry !== undefined && entry.value !== null && Number.isFinite(n);
                      const active = has && n >= 1;
                      const stateLabel = entry?.state ? POINT_STATE_LABELS[entry.state] : undefined;
                      return (
                        <div key={ev.tag} className="min-w-0">
                          <p className="truncate text-[10px] uppercase tracking-wide text-muted-foreground/70">
                            {ev.label}
                          </p>
                          <p
                            className={[
                              'inline-flex items-center gap-1.5',
                              active
                                ? 'font-medium text-amber-600 dark:text-amber-400'
                                : has
                                  ? 'font-medium text-foreground'
                                  : 'text-muted-foreground',
                            ].join(' ')}
                            title={
                              !active && has && entry?.state === 'waiting_event'
                                ? WAITING_EVENT_HINT
                                : undefined
                            }
                          >
                            <span
                              className={[
                                'h-1.5 w-1.5 shrink-0 rounded-full',
                                active
                                  ? 'bg-amber-500'
                                  : has
                                    ? 'bg-emerald-500'
                                    : 'bg-slate-400',
                              ].join(' ')}
                            />
                            {/* waiting_event é saudável: assinatura ativa, nenhum
                                evento ainda — mesmo "Normal" do MOVIMENTO, com
                                tooltip explicando o monitoramento ativo. */}
                            {active ? 'Ativo' : has ? 'Normal' : (stateLabel ?? 'sem dados')}
                            {!active && has && entry?.state === 'waiting_event' && (
                              <Info className="h-3 w-3 shrink-0 text-muted-foreground/60" />
                            )}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de criação */}
      {formOpen && (
        <CameraFormModal
          prefillIp={prefillIp}
          prefillProtocol={prefillProtocol}
          prefillPort={prefillPort}
          onClose={() => setFormOpen(false)}
          onSaved={(notice) => { setFormOpen(false); setSaveNotice(notice ?? null); void refetch(); }}
        />
      )}

      {/* Modal de edição */}
      {cameraToEdit && (
        <CameraFormModal
          camera={cameraToEdit}
          onClose={() => setCameraToEdit(null)}
          onSaved={(notice) => { setCameraToEdit(null); setSaveNotice(notice ?? null); void refetch(); }}
        />
      )}

      {/* Modal de scan */}
      {scanOpen && (
        <ScanModal
          registeredIps={new Set(cameras.map((c) => c.ip))}
          onClose={() => setScanOpen(false)}
          onAdd={(ip, protocol, port) => {
            setScanOpen(false);
            setPrefillIp(ip);
            setPrefillProtocol(protocol);
            setPrefillPort(port ?? null);
            setFormOpen(true);
          }}
        />
      )}

      {/* Diagnóstico SNMP da câmera */}
      {cameraToDiagnose && (
        <SnmpDiagnoseModal
          device={{
            id: cameraToDiagnose.id,
            name: cameraToDiagnose.name,
            ip: cameraToDiagnose.ip as string,
            port: cameraToDiagnose.port,
            community: cameraToDiagnose.community,
          }}
          diagnoseFn={diagnoseCameraSnmp}
          getProgressFn={getDiagnoseProgress}
          applyFn={applySnmpOids}
          deviceLabel="câmera"
          onClose={() => setCameraToDiagnose(null)}
          onApplied={() => void refetch()}
        />
      )}

      {/* Detalhe de telemetria da câmera (todos os perfis) */}
      {cameraForTelemetry && (
        <CameraTelemetryModal
          camera={cameraForTelemetry}
          live={byDevice}
          showIp={isAdmin}
          isAdmin={isAdmin}
          onClose={() => setCameraForTelemetry(null)}
        />
      )}

      {/* Alarmes e trends por ponto da câmera (mesma experiência do BMS) */}
      {cameraForAlarm && (
        <CameraPointConfigModal
          camera={cameraForAlarm}
          live={byDevice}
          alarmRuleByPoint={alarmRuleByPoint}
          trendByPoint={trendByPoint}
          onChanged={refreshPointConfig}
          onClose={() => setCameraForAlarm(null)}
        />
      )}

      {/* Ver ao vivo (ONVIF) — fechar encerra a sessão imediatamente */}
      {cameraForLive && (
        <CameraLiveViewModal
          cameraId={cameraForLive.id}
          cameraName={cameraForLive.name}
          subtitle={
            [
              cameraForLive.site || null,
              cameraForLive.deviceInfo?.model
                ? [cameraForLive.deviceInfo.manufacturer, cameraForLive.deviceInfo.model]
                    .filter(Boolean)
                    .join(' ')
                : null,
            ]
              .filter(Boolean)
              .join(' — ') || null
          }
          tenantId={effectiveTenantId}
          onClose={() => setCameraForLive(null)}
        />
      )}

      {/* ── Seção de switches ─────────────────────────────────────────────── */}
      <div className="border-t border-border pt-6 space-y-4">
        {/* Cabeçalho da seção */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400">
              <Network className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Switches gerenciáveis</h2>
              <p className="text-[11px] text-muted-foreground">
                Monitoramento de portas via SNMP IF-MIB
              </p>
            </div>
            {switches.length > 0 && (
              <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {switches.length}
              </span>
            )}
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => { setSwitchToEdit(null); setSwitchFormOpen(true); }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              Adicionar switch
            </button>
          )}
        </div>

        {/* Lista de switches */}
        {isLoadingSwitches ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1, 2].map((i) => (
              <div key={i} className="h-[130px] rounded-lg bg-muted/50 animate-pulse" />
            ))}
          </div>
        ) : filteredSwitches.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            <Network className="mx-auto mb-3 h-8 w-8 opacity-40" />
            {switches.length === 0
              ? 'Nenhum switch cadastrado.'
              : 'Nenhum switch encontrado para os filtros atuais.'}
            {isAdmin && switches.length === 0 && (
              <p className="mt-1 text-xs">
                Clique em &quot;Adicionar switch&quot; para cadastrar o primeiro.
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredSwitches.map((sw) => {
              const statusPoint = sw.points.find((p) => p.tag === 'STATUS');
              const uptimePoint = sw.points.find((p) => p.tag === 'UPTIME');
              const cpuPoint = sw.points.find((p) => p.tag === 'CPU');
              const statusEntry = byDevice.get(deviceTagKey(sw.id, 'STATUS'));
              const uptimeEntry = byDevice.get(deviceTagKey(sw.id, 'UPTIME'));
              const cpuEntry = byDevice.get(deviceTagKey(sw.id, 'CPU'));

              const liveStatus = statusEntry?.value ?? statusPoint?.lastValue ?? null;
              const isOnline = typeof liveStatus === 'number' ? liveStatus >= 1 : sw.status === 'online';

              const liveUptime = typeof uptimeEntry?.value === 'number' ? uptimeEntry.value : uptimePoint?.lastValue ?? null;
              const liveCpu = typeof cpuEntry?.value === 'number' ? cpuEntry.value : cpuPoint?.lastValue ?? null;

              const portCount = sw.ports.length;

              return (
                <div
                  key={sw.id}
                  className="group rounded-lg border border-border bg-card p-4 space-y-3 cursor-pointer hover:border-primary/40 transition-colors"
                  onClick={() => setSwitchForPanel(sw)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={[
                          'flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
                          sw.gatewayOnline === false
                            ? 'bg-muted text-muted-foreground'
                            : isOnline
                              ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400'
                              : 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400',
                        ].join(' ')}
                      >
                        <Network className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{sw.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {sw.ip}:{sw.port} · SNMP v{sw.snmpVersion}
                        </p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span
                        className={[
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                          sw.gatewayOnline === false
                            ? 'bg-muted text-muted-foreground'
                            : isOnline
                              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                              : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
                        ].join(' ')}
                      >
                        <span
                          className={[
                            'h-1.5 w-1.5 rounded-full',
                            sw.gatewayOnline === false
                              ? 'bg-slate-400'
                              : isOnline ? 'bg-emerald-500' : 'bg-red-500',
                          ].join(' ')}
                        />
                        {sw.gatewayOnline === false ? 'GW offline' : isOnline ? 'Online' : 'Offline'}
                      </span>
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setSwitchToEdit(sw); setSwitchFormOpen(true); }}
                          className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-muted hover:text-foreground transition-opacity"
                          title="Editar switch"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setSwitchToDelete(sw); }}
                          className="rounded p-1 text-muted-foreground opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 transition-opacity"
                          title="Excluir switch"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Métricas escalares */}
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <p className="text-[10px] text-muted-foreground">Uptime</p>
                      <p className="font-medium text-foreground">
                        {uptimePoint?.unsupported
                          ? 'n/d'
                          : typeof liveUptime === 'number' && Number.isFinite(liveUptime)
                            ? formatUptime(liveUptime)
                            : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">CPU</p>
                      <p className="font-medium text-foreground">
                        {cpuPoint?.unsupported
                          ? 'n/d'
                          : typeof liveCpu === 'number' && Number.isFinite(liveCpu)
                            ? `${Math.round(liveCpu)}%`
                            : '—'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] text-muted-foreground">Portas</p>
                      <p className="font-medium text-foreground">
                        {portCount > 0 ? portCount : <span className="text-muted-foreground">sync</span>}
                      </p>
                    </div>
                  </div>

                  {/* Site/gateway */}
                  {(sw.site || sw.gatewayId) && (
                    <p className="text-[11px] text-muted-foreground truncate">
                      {[sw.site, sw.gatewayId ? `GW: ${sw.gatewayId.slice(0, 12)}…` : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Modais de switch ──────────────────────────────────────────────── */}
      {switchFormOpen && (
        <SwitchFormModal
          sw={switchToEdit ?? undefined}
          onClose={() => { setSwitchFormOpen(false); setSwitchToEdit(null); }}
          onSaved={() => {
            setSwitchFormOpen(false);
            setSwitchToEdit(null);
            void refetchSwitches();
          }}
        />
      )}

      {switchForPanel && (() => {
        // Re-read from up-to-date list in case ports were synced.
        const current = switches.find((s) => s.id === switchForPanel.id) ?? switchForPanel;
        return (
          <SwitchPanel
            sw={current}
            live={byDevice}
            isAdmin={isAdmin}
            onClose={() => setSwitchForPanel(null)}
            onRefresh={refetchSwitches}
          />
        );
      })()}

      {switchToDelete && (
        <PasswordConfirmDialog
          title={`Excluir o switch "${switchToDelete.name}"?`}
          description={
            <>
              O switch <strong>{switchToDelete.ip}</strong> e todos os seus pontos
              (incluindo portas sincronizadas) serão excluídos permanentemente.
            </>
          }
          isPending={deleteSwitchMutation.isPending}
          error={deleteSwitchMutation.error ? (deleteSwitchMutation.error as Error).message : null}
          onCancel={() => { setSwitchToDelete(null); deleteSwitchMutation.reset(); }}
          onConfirm={(token) => deleteSwitchMutation.mutate({ id: switchToDelete.id, token })}
        />
      )}

      {/* ── Seção de NVRs/DVRs ────────────────────────────────────────────── */}
      <div className="border-t border-border pt-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-orange-100 text-orange-600 dark:bg-orange-500/15 dark:text-orange-400">
              <HardDrive className="h-4 w-4" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">NVRs / DVRs</h2>
              <p className="text-[11px] text-muted-foreground">
                Monitoramento de gravadores via SNMP — discos e canais de gravação
              </p>
            </div>
            {nvrs.length > 0 && (
              <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {nvrs.length}
              </span>
            )}
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={() => { setNvrToEdit(null); setNvrFormOpen(true); }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" />
              Adicionar NVR
            </button>
          )}
        </div>

        {isLoadingNvrs ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1, 2].map((i) => (
              <div key={i} className="h-[130px] rounded-lg bg-muted/50 animate-pulse" />
            ))}
          </div>
        ) : filteredNvrs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
            <HardDrive className="mx-auto mb-3 h-8 w-8 opacity-40" />
            {nvrs.length === 0
              ? 'Nenhum NVR/DVR cadastrado.'
              : 'Nenhum NVR/DVR encontrado para os filtros atuais.'}
            {isAdmin && nvrs.length === 0 && (
              <p className="mt-1 text-xs">
                Clique em &quot;Adicionar NVR&quot; para cadastrar o primeiro.
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredNvrs.map((nvr) => {
              const statusPoint = nvr.points.find((p) => p.tag === 'STATUS');
              const uptimePoint = nvr.points.find((p) => p.tag === 'UPTIME');
              const cpuPoint = nvr.points.find((p) => p.tag === 'CPU');
              const statusEntry = byDevice.get(deviceTagKey(nvr.id, 'STATUS'));
              const uptimeEntry = byDevice.get(deviceTagKey(nvr.id, 'UPTIME'));
              const cpuEntry = byDevice.get(deviceTagKey(nvr.id, 'CPU'));

              const liveStatus = statusEntry?.value ?? statusPoint?.lastValue ?? null;
              const isOnline = typeof liveStatus === 'number' ? liveStatus >= 1 : nvr.status === 'online';
              const liveUptime = typeof uptimeEntry?.value === 'number' ? uptimeEntry.value : uptimePoint?.lastValue ?? null;
              const liveCpu = typeof cpuEntry?.value === 'number' ? cpuEntry.value : cpuPoint?.lastValue ?? null;

              return (
                <div
                  key={nvr.id}
                  className="rounded-lg border border-border bg-card p-4 space-y-3 cursor-pointer hover:border-primary/40 transition-colors"
                  onClick={() => setNvrForPanel(nvr)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={[
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-md',
                        isOnline
                          ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400'
                          : 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400',
                      ].join(' ')}>
                        <HardDrive className="h-4.5 w-4.5" />
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{nvr.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[
                            isAdmin ? `${nvr.ip}:${nvr.port}` : null,
                            nvr.site || null,
                            nvr.manufacturer || null,
                          ].filter(Boolean).join(' — ')}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {isAdmin && (
                        <>
                          <button
                            onClick={(e) => { e.stopPropagation(); setNvrToEdit(nvr); setNvrFormOpen(true); }}
                            title="Editar NVR"
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setNvrToDelete(nvr); }}
                            title="Excluir NVR"
                            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-red-600 dark:hover:text-red-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Status badge + métricas */}
                  <div className="flex items-center gap-3 text-xs">
                    <span className={[
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium',
                      isOnline
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                        : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
                    ].join(' ')}>
                      <span className={[
                        'h-1.5 w-1.5 rounded-full',
                        isOnline ? 'bg-emerald-500' : 'bg-red-500',
                      ].join(' ')} />
                      {isOnline ? 'Online' : 'Offline'}
                    </span>
                    {liveUptime !== null && (
                      <span className="text-muted-foreground font-mono">{formatUptime(liveUptime)}</span>
                    )}
                    {liveCpu !== null && (
                      <span className="text-muted-foreground font-mono">CPU {Math.round(liveCpu)}%</span>
                    )}
                  </div>

                  {/* Resumo de discos/canais */}
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{nvr.disks.length} disco{nvr.disks.length !== 1 ? 's' : ''}</span>
                    <span>·</span>
                    <span>{nvr.channels.length} canal{nvr.channels.length !== 1 ? 'is' : ''}</span>
                    <span>·</span>
                    <span className="truncate">{nvr.profileLabel}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Modais de NVR ─────────────────────────────────────────────────── */}
      {nvrFormOpen && (
        <NvrFormModal
          nvr={nvrToEdit ?? undefined}
          onClose={() => { setNvrFormOpen(false); setNvrToEdit(null); }}
          onSaved={() => {
            setNvrFormOpen(false);
            setNvrToEdit(null);
            void refetchNvrs();
          }}
        />
      )}

      {nvrForPanel && (() => {
        const current = nvrs.find((n) => n.id === nvrForPanel.id) ?? nvrForPanel;
        return (
          <NvrPanel
            nvr={current}
            live={byDevice}
            isAdmin={isAdmin}
            onClose={() => setNvrForPanel(null)}
            onRefresh={refetchNvrs}
          />
        );
      })()}

      {nvrToDelete && (
        <PasswordConfirmDialog
          title={`Excluir o NVR "${nvrToDelete.name}"?`}
          description={
            <>
              O NVR <strong>{nvrToDelete.ip}</strong> e todos os seus pontos
              (incluindo discos e canais sincronizados) serão excluídos permanentemente.
            </>
          }
          isPending={deleteNvrMutation.isPending}
          error={deleteNvrMutation.error ? (deleteNvrMutation.error as Error).message : null}
          onCancel={() => { setNvrToDelete(null); deleteNvrMutation.reset(); }}
          onConfirm={(token) => deleteNvrMutation.mutate({ id: nvrToDelete.id, token })}
        />
      )}

      {/* Confirmação de exclusão (senha) */}
      {cameraToDelete && (
        <PasswordConfirmDialog
          title={`Excluir a câmera "${cameraToDelete.name}"?`}
          description={
            <>
              A câmera <strong>{cameraToDelete.ip}</strong> deixará de ser monitorada e os
              pontos de saúde serão removidos. Esta ação não pode ser desfeita.
            </>
          }
          isPending={deleteMutation.isPending}
          error={deleteMutation.error ? (deleteMutation.error as Error).message : null}
          onCancel={() => { setCameraToDelete(null); deleteMutation.reset(); }}
          onConfirm={(token) => deleteMutation.mutate({ id: cameraToDelete.id, token })}
        />
      )}
    </div>
  );
}

// ─── Modal de formulário (criar/editar) ──────────────────────────────────────

function CameraFormModal({
  camera,
  prefillIp,
  prefillProtocol,
  prefillPort,
  onClose,
  onSaved,
}: {
  camera?: Camera;
  prefillIp?: string | null;
  prefillProtocol?: 'snmp' | 'onvif' | null;
  prefillPort?: number | null;
  onClose: () => void;
  /** `notice` = aviso pós-salvamento (porta ajustada / validação pendente). */
  onSaved: (notice?: string | null) => void;
}) {
  const user = useCurrentUser();
  const isGlobal = user.role === 'ADMIN' || user.role === 'CCO' || user.role === 'SUPERVISOR';
  const { selectedTenantId } = useTenantFilter();
  const { selectedSiteId } = useSiteFilter();
  const { data: tenants = [] } = useTenants();

  const [modalTenantId, setModalTenantId] = useState(
    camera?.tenantId ?? (isGlobal ? (selectedTenantId ?? '') : (user.tenantId ?? '')),
  );
  const tenantId = camera?.tenantId
    ?? (isGlobal ? (modalTenantId || undefined) : (user.tenantId ?? undefined));

  // Perfil global sem cliente escolhido: não busca sites/gateways (tenant
  // vazio no backend = "sem filtro") e mantém os selects travados.
  const tenantChosen = Boolean(tenantId);
  const { data: sites = [] } = useSites(tenantId, { enabled: tenantChosen });
  const { data: gateways = [] } = useGateways(tenantId, { enabled: tenantChosen });

  const [protocol, setProtocol] = useState<'snmp' | 'onvif'>(
    camera?.monitoringProtocol ?? prefillProtocol ?? 'snmp',
  );
  const [name, setName] = useState(camera?.name ?? '');
  const [ip, setIp] = useState(camera?.ip ?? prefillIp ?? '');
  const [port, setPort] = useState(
    camera?.port ?? prefillPort ?? ((prefillProtocol ?? 'snmp') === 'onvif' ? 80 : 161),
  );
  const [siteId, setSiteId] = useState(camera?.siteId ?? '');
  const [gatewayId, setGatewayId] = useState(camera?.gatewayId ?? '');

  // Pré-preenche com o filtro global da topbar (os hooks carregam do
  // localStorage num effect, então o valor só chega após o primeiro render).
  const prefillApplied = useRef(false);
  useEffect(() => {
    if (camera || prefillApplied.current) return;
    if (selectedTenantId === null && selectedSiteId === null) return;
    prefillApplied.current = true;
    if (isGlobal && selectedTenantId && !modalTenantId) {
      setModalTenantId(selectedTenantId);
      if (selectedSiteId && !siteId) setSiteId(selectedSiteId);
    } else if (!isGlobal && selectedSiteId && !siteId) {
      setSiteId(selectedSiteId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenantId, selectedSiteId]);

  function handleTenantChange(id: string) {
    setModalTenantId(id);
    setSiteId('');
    setGatewayId('');
  }
  const [snmpVersion, setSnmpVersion] = useState<'1' | '2c'>(camera?.snmpVersion ?? '2c');
  const [community, setCommunity] = useState(camera?.community ?? 'public');
  // SNMP: fabricante manual (identifica o provider de telemetria no gateway).
  const [manufacturer, setManufacturer] = useState(
    camera?.monitoringProtocol === 'snmp' ? (camera?.manufacturer ?? '') : '',
  );
  const [onvifUsername, setOnvifUsername] = useState(camera?.onvifUsername ?? '');
  const [onvifPassword, setOnvifPassword] = useState('');
  const [pollingInterval, setPollingInterval] = useState(camera?.pollingInterval ?? 30);
  const [rtspUrl, setRtspUrl] = useState(camera?.rtspUrl ?? '');
  // SNMP: porta do serviço ONVIF/vídeo (a porta principal é a do SNMP).
  const [onvifPort, setOnvifPort] = useState(camera?.onvifPort ?? 80);

  // Canal SNMP opcional de saúde (câmera ONVIF) + overrides de OID.
  const [healthEnabled, setHealthEnabled] = useState(camera?.snmpHealth?.enabled ?? false);
  const [healthCommunity, setHealthCommunity] = useState(camera?.snmpHealth?.community ?? 'public');
  const [healthPort, setHealthPort] = useState(camera?.snmpHealth?.port ?? 161);
  const [healthVersion, setHealthVersion] = useState<'1' | '2c'>(
    camera?.snmpHealth?.snmpVersion ?? '2c',
  );
  const [oidOverrides, setOidOverrides] = useState<Partial<Record<OverrideMetric, string>>>(() => {
    if (camera?.monitoringProtocol === 'onvif') return { ...(camera.snmpHealth?.oids ?? {}) };
    if (camera) {
      // Câmera SNMP: pré-preenche com os OIDs atuais dos pontos (saúde + uptime).
      const out: Partial<Record<OverrideMetric, string>> = {};
      for (const p of camera.points) {
        if (p.oid && (OVERRIDE_METRICS as string[]).includes(p.metric)) {
          out[p.metric as OverrideMetric] = p.oid;
        }
      }
      return out;
    }
    return {};
  });
  const [testResult, setTestResult] = useState<SnmpHealthTestOutcome | null>(null);

  function setOverride(metric: OverrideMetric, value: string) {
    setOidOverrides((prev) => ({ ...prev, [metric]: value }));
  }

  /** Só overrides preenchidos (string vazia = usar o perfil do fabricante). */
  function cleanOverrides(
    metrics: readonly OverrideMetric[] = HEALTH_METRICS,
  ): Partial<Record<OverrideMetric, string>> | undefined {
    const out: Partial<Record<OverrideMetric, string>> = {};
    for (const m of metrics) {
      const v = oidOverrides[m]?.trim();
      if (v) out[m] = v;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }

  const testGatewayId = camera?.gatewayId ?? gatewayId;
  const testTenantId = camera?.tenantId ?? tenantId;

  const snmpTest = useMutation({
    mutationFn: () =>
      testCameraSnmp({
        tenantId: testTenantId as string,
        gatewayId: testGatewayId as string,
        ip: ip.trim(),
        // ONVIF usa os campos do canal de saúde; SNMP usa os campos principais.
        port: protocol === 'onvif' ? Number(healthPort) || 161 : Number(port) || 161,
        snmpVersion: protocol === 'onvif' ? healthVersion : snmpVersion,
        community:
          (protocol === 'onvif' ? healthCommunity.trim() : community.trim()) || 'public',
        manufacturer:
          protocol === 'onvif'
            ? (camera?.deviceInfo?.manufacturer ?? null)
            : (manufacturer.trim() || null),
        oids: cleanOverrides() as Partial<Record<HealthMetric, string>> | undefined,
      }),
    onSuccess: setTestResult,
  });
  const canTest = Boolean(testTenantId && testGatewayId && ip.trim());

  // Troca do protocolo no cadastro ajusta a porta padrão (161 SNMP / 80 ONVIF).
  function handleProtocolChange(next: 'snmp' | 'onvif') {
    setProtocol(next);
    if (!camera && (port === 161 || port === 80)) {
      setPort(next === 'onvif' ? 80 : 161);
    }
  }

  const isOnvif = protocol === 'onvif';

  const save = useMutation({
    // `force` = "Cadastrar/Salvar mesmo assim" após falha do probe ONVIF.
    mutationFn: ({ force = false }: { force?: boolean } = {}) => {
      const payload: CameraInput = {
        ...(force && isOnvif ? { forceCreate: true } : {}),
        name: name.trim(),
        ip: ip.trim(),
        port: Number(port),
        siteId: siteId || undefined,
        pollingInterval: Number(pollingInterval),
        rtspUrl: rtspUrl.trim() || null,
        ...(isOnvif
          ? {
              monitoringProtocol: 'onvif' as const,
              onvifUsername: onvifUsername.trim(),
              // Edição: senha vazia = manter a atual (nunca reexibida).
              ...(onvifPassword ? { onvifPassword } : {}),
              // Canal SNMP opcional de saúde (híbrido).
              snmpHealth: healthEnabled
                ? {
                    enabled: true,
                    community: healthCommunity.trim() || 'public',
                    port: Number(healthPort) || 161,
                    snmpVersion: healthVersion,
                    ...(cleanOverrides()
                      ? { oids: cleanOverrides() as Partial<Record<HealthMetric, string>> }
                      : {}),
                  }
                : { enabled: false },
            }
          : {
              monitoringProtocol: 'snmp' as const,
              snmpVersion,
              community: community.trim(),
              manufacturer: manufacturer.trim() || null,
              // "Vídeo ao vivo" opcional: username vazio limpa as credenciais;
              // senha vazia na edição mantém a atual.
              onvifUsername: onvifUsername.trim(),
              ...(onvifPassword ? { onvifPassword } : {}),
              ...(onvifUsername.trim() ? { onvifPort: Number(onvifPort) || 80 } : {}),
              // Overrides manuais de OID por ponto — saúde + uptime (só edição).
              ...(camera && cleanOverrides(OVERRIDE_METRICS)
                ? { healthOids: cleanOverrides(OVERRIDE_METRICS) }
                : {}),
            }),
      };
      if (camera) return updateCamera(camera.id, payload);
      return createCamera({ ...payload, tenantId, gatewayId });
    },
    onSuccess: (saved) => {
      // Avisos pós-salvamento: porta ajustada pelo fallback automático do
      // gateway ou cadastro com validação ONVIF pendente.
      let notice: string | null = null;
      if (isOnvif && saved.pendingValidation) {
        notice =
          `A câmera "${saved.name}" foi salva com a validação ONVIF pendente. ` +
          'O sistema vai re-tentar a conexão automaticamente em segundo plano e ' +
          'preencher os dados da câmera assim que ela responder.';
      } else if (isOnvif && Number(port) && saved.port !== Number(port)) {
        notice =
          `A câmera "${saved.name}" não respondeu ONVIF na porta ${Number(port)}, ` +
          `mas respondeu na porta ${saved.port} — o cadastro foi salvo usando a porta ${saved.port}.`;
      }
      onSaved(notice);
    },
  });
  const probeFailed = (save.error as ApiError | null)?.code === 'ONVIF_PROBE_FAILED';

  const onvifValid = isOnvif
    ? Boolean(onvifUsername.trim() && (camera ? true : onvifPassword))
    : // SNMP: vídeo opcional — mas usuário preenchido exige senha (exceto
      // edição com senha já salva, que é mantida).
      !onvifUsername.trim() ||
      Boolean(onvifPassword || (camera?.hasOnvifPassword && camera.onvifUsername));
  const valid = name.trim() && ip.trim() && onvifValid && (camera || (tenantId && gatewayId));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form
        onSubmit={(e) => { e.preventDefault(); if (valid && !save.isPending) save.mutate({}); }}
        className="w-full max-w-lg rounded-xl border border-border bg-card p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            {camera ? 'Editar câmera' : 'Adicionar câmera'}
          </h3>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {isGlobal && !camera && (
          <Field label="Cliente *">
            <select value={modalTenantId} onChange={(e) => handleTenantChange(e.target.value)} className={inputCls}>
              <option value="">Selecione o cliente…</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Site">
          <select
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
            disabled={!tenantChosen}
            className={inputCls + (!tenantChosen ? ' opacity-60 cursor-not-allowed' : '')}
          >
            <option value="">{tenantChosen ? 'Sem site' : 'Selecione o cliente primeiro'}</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </Field>

        {!camera && (
          <Field label="Gateway (faz o polling) *">
            <select
              value={gatewayId}
              onChange={(e) => setGatewayId(e.target.value)}
              disabled={!tenantChosen}
              className={inputCls + (!tenantChosen ? ' opacity-60 cursor-not-allowed' : '')}
            >
              <option value="">{tenantChosen ? 'Selecione…' : 'Selecione o cliente primeiro'}</option>
              {gateways.map((g) => (
                <option key={g.id} value={g.id}>{g.id} ({g.status})</option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Nome *">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Câmera portaria" className={inputCls} />
        </Field>

        <Field label="Protocolo de monitoramento">
          <select
            value={protocol}
            onChange={(e) => handleProtocolChange(e.target.value as 'snmp' | 'onvif')}
            disabled={Boolean(camera)}
            className={inputCls + (camera ? ' opacity-60' : '')}
          >
            <option value="snmp">SNMP</option>
            <option value="onvif">ONVIF (usuário e senha)</option>
          </select>
        </Field>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Field label="Endereço IP *">
              <input value={ip} onChange={(e) => setIp(e.target.value)} placeholder="192.168.0.50" className={inputCls} />
            </Field>
          </div>
          <Field label={isOnvif ? 'Porta ONVIF' : 'Porta SNMP'}>
            <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} className={inputCls} />
          </Field>
        </div>

        {isOnvif ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Usuário ONVIF *">
                <input
                  value={onvifUsername}
                  onChange={(e) => setOnvifUsername(e.target.value)}
                  placeholder="admin"
                  autoComplete="off"
                  className={inputCls}
                />
              </Field>
              <Field label={camera ? 'Senha ONVIF' : 'Senha ONVIF *'}>
                <input
                  type="password"
                  value={onvifPassword}
                  onChange={(e) => setOnvifPassword(e.target.value)}
                  placeholder={camera?.hasOnvifPassword ? '••••• (manter atual)' : 'Senha'}
                  autoComplete="new-password"
                  className={inputCls}
                />
              </Field>
              <Field label="Polling (s)">
                <input type="number" min={5} value={pollingInterval} onChange={(e) => setPollingInterval(Number(e.target.value))} className={inputCls} />
              </Field>
            </div>

            {/* Canal SNMP opcional de saúde (CPU, memória, temperatura, rede) */}
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={healthEnabled}
                  onChange={(e) => setHealthEnabled(e.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
                Monitoramento de saúde via SNMP
              </label>
              <p className="text-[11px] text-muted-foreground -mt-1">
                Se a câmera também expõe SNMP, dá para acompanhar CPU, memória,
                temperatura e pacotes perdidos. Falha no SNMP nunca afeta o status
                ONVIF da câmera.
              </p>
              {healthEnabled && (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="Community">
                      <input value={healthCommunity} onChange={(e) => setHealthCommunity(e.target.value)} className={inputCls} />
                    </Field>
                    <Field label="Porta SNMP">
                      <input type="number" value={healthPort} onChange={(e) => setHealthPort(Number(e.target.value))} className={inputCls} />
                    </Field>
                    <Field label="Versão">
                      <select value={healthVersion} onChange={(e) => setHealthVersion(e.target.value as '1' | '2c')} className={inputCls}>
                        <option value="2c">v2c</option>
                        <option value="1">v1</option>
                      </select>
                    </Field>
                  </div>
                  <OidOverrideFields
                    overrides={oidOverrides}
                    onChange={setOverride}
                    hint={
                      camera?.deviceInfo?.manufacturer
                        ? `Vazio = perfil ${camera.deviceInfo.manufacturer}`
                        : 'Vazio = perfil do fabricante detectado no cadastro'
                    }
                  />
                  <SnmpTestBlock
                    canTest={canTest}
                    isPending={snmpTest.isPending}
                    error={snmpTest.error ? (snmpTest.error as Error).message : null}
                    result={testResult}
                    onTest={() => { setTestResult(null); snmpTest.mutate(); }}
                  />
                </>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Versão SNMP">
                <select value={snmpVersion} onChange={(e) => setSnmpVersion(e.target.value as '1' | '2c')} className={inputCls}>
                  <option value="2c">v2c</option>
                  <option value="1">v1</option>
                </select>
              </Field>
              <Field label="Community">
                <input value={community} onChange={(e) => setCommunity(e.target.value)} className={inputCls} />
              </Field>
              <Field label="Polling (s)">
                <input type="number" min={5} value={pollingInterval} onChange={(e) => setPollingInterval(Number(e.target.value))} className={inputCls} />
              </Field>
            </div>

            <Field label="Fabricante (opcional)">
              <input
                value={manufacturer}
                onChange={(e) => setManufacturer(e.target.value)}
                list="camera-manufacturers"
                placeholder="Ex.: Hikvision, Dahua, Intelbras…"
                className={inputCls}
                title="Identifica o perfil de telemetria proprietário da câmera (OIDs e uptime específicos do fabricante). Vazio = detecção automática."
              />
              <datalist id="camera-manufacturers">
                <option value="Hikvision" />
                <option value="Dahua" />
                <option value="Intelbras" />
                <option value="Axis" />
              </datalist>
            </Field>

            {/* Vídeo ao vivo opcional (câmera SNMP): credenciais ONVIF e/ou a
                URL RTSP (campo abaixo) habilitam o botão "Ver ao vivo". */}
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
              <p className="text-sm font-medium text-foreground">Vídeo ao vivo (opcional)</p>
              <p className="text-[11px] text-muted-foreground -mt-1">
                Para habilitar o botão &quot;Ver ao vivo&quot;, informe o usuário e a senha
                ONVIF da câmera e/ou uma URL RTSP (campo abaixo). O vídeo é
                independente do monitoramento SNMP — falha em um nunca afeta o outro.
              </p>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Usuário ONVIF">
                  <input
                    value={onvifUsername}
                    onChange={(e) => setOnvifUsername(e.target.value)}
                    placeholder="admin"
                    autoComplete="off"
                    className={inputCls}
                  />
                </Field>
                <Field label="Senha ONVIF">
                  <input
                    type="password"
                    value={onvifPassword}
                    onChange={(e) => setOnvifPassword(e.target.value)}
                    placeholder={camera?.hasOnvifPassword ? '••••• (manter atual)' : 'Senha'}
                    autoComplete="new-password"
                    className={inputCls}
                  />
                </Field>
                <Field label="Porta ONVIF">
                  <input
                    type="number"
                    value={onvifPort}
                    onChange={(e) => setOnvifPort(Number(e.target.value))}
                    className={inputCls}
                  />
                </Field>
              </div>
            </div>

            {/* Edição: OIDs das métricas de saúde (perfil genérico por padrão) */}
            {camera && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
                <p className="text-sm font-medium text-foreground">OIDs dos pontos monitorados</p>
                <OidOverrideFields
                  overrides={oidOverrides}
                  onChange={setOverride}
                  metrics={OVERRIDE_METRICS}
                  hint="Ajuste se o modelo da câmera usa OIDs diferentes do padrão"
                />
                <SnmpTestBlock
                  canTest={canTest}
                  isPending={snmpTest.isPending}
                  error={snmpTest.error ? (snmpTest.error as Error).message : null}
                  result={testResult}
                  onTest={() => { setTestResult(null); snmpTest.mutate(); }}
                />
              </div>
            )}
          </>
        )}

        <Field label="URL RTSP (opcional)">
          <input
            value={rtspUrl}
            onChange={(e) => setRtspUrl(e.target.value)}
            placeholder="rtsp://usuario:senha@192.168.0.50:554/stream"
            className={inputCls}
          />
        </Field>

        <p className="text-[11px] text-muted-foreground">
          {isOnvif
            ? 'Ao salvar, o gateway conecta na câmera para validar as credenciais e preencher fabricante, modelo, firmware e número de série. Os pontos (status, stream, movimento, tamper e perda de vídeo) são criados automaticamente e podem gerar alarmes como qualquer outro ponto.'
            : 'Os pontos de saúde (status, uptime, memória livre e pacotes perdidos) são criados automaticamente e podem gerar alarmes e trends como qualquer outro ponto.'}
        </p>

        {save.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400 space-y-2">
            <p>{(save.error as Error).message}</p>
            {probeFailed && (
              <div className="space-y-1.5">
                <p className="text-red-500/90 dark:text-red-400/80">
                  Se preferir, dá para salvar a câmera mesmo assim: ela fica com a
                  validação ONVIF pendente e o sistema re-tenta a conexão
                  automaticamente em segundo plano.
                </p>
                <button
                  type="button"
                  disabled={save.isPending}
                  onClick={() => save.mutate({ force: true })}
                  className="inline-flex items-center gap-2 rounded-md border border-red-300 px-3 py-1.5 font-medium text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/15"
                >
                  {camera ? 'Salvar mesmo assim' : 'Cadastrar mesmo assim'}
                </button>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!valid || save.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {camera ? 'Salvar' : 'Adicionar'}
          </button>
        </div>
      </form>
    </div>
  );
}

// ─── Modal de scan de rede ───────────────────────────────────────────────────

function ScanModal({
  registeredIps,
  onClose,
  onAdd,
}: {
  registeredIps: Set<string>;
  onClose: () => void;
  onAdd: (ip: string, protocol: 'snmp' | 'onvif', port?: number) => void;
}) {
  const user = useCurrentUser();
  const isGlobal = user.role === 'ADMIN' || user.role === 'CCO' || user.role === 'SUPERVISOR';
  const { selectedTenantId } = useTenantFilter();
  const { data: tenants = [] } = useTenants();

  const [modalTenantId, setModalTenantId] = useState(isGlobal ? '' : (user.tenantId ?? ''));
  const tenantId = isGlobal ? (modalTenantId || undefined) : (user.tenantId ?? undefined);
  const { data: gateways = [] } = useGateways(tenantId);

  const [gatewayId, setGatewayId] = useState('');

  // Pré-preenche o cliente com o filtro global da topbar (valor chega após o
  // primeiro render, pois o hook carrega do localStorage num effect).
  const prefillApplied = useRef(false);
  useEffect(() => {
    if (!isGlobal || prefillApplied.current || !selectedTenantId) return;
    prefillApplied.current = true;
    if (!modalTenantId) setModalTenantId(selectedTenantId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTenantId]);

  function handleTenantChange(id: string) {
    setModalTenantId(id);
    setGatewayId('');
  }
  const [mode, setMode] = useState<'snmp' | 'onvif'>('snmp');
  const [onvifTargets, setOnvifTargets] = useState('');
  const [ipStart, setIpStart] = useState('');
  const [ipEnd, setIpEnd] = useState('');
  const [snmpVersion, setSnmpVersion] = useState<'1' | '2c'>('2c');
  const [community, setCommunity] = useState('public');
  const [results, setResults] = useState<SnmpScanOutcome | null>(null);
  const [onvifResults, setOnvifResults] = useState<DiscoveredOnvifDevice[] | null>(null);
  const [progress, setProgress] = useState<SnmpScanProgress | null>(null);
  const scanIdRef = useRef<string | null>(null);

  const scan = useMutation({
    mutationFn: () => {
      const scanId = crypto.randomUUID();
      scanIdRef.current = scanId;
      return scanSnmpRange({
        tenantId: tenantId as string,
        gatewayId,
        ipStart: ipStart.trim(),
        ipEnd: ipEnd.trim(),
        snmpVersion,
        community: community.trim(),
        scanId,
      });
    },
    onSuccess: setResults,
    onSettled: () => {
      scanIdRef.current = null;
      setProgress(null);
    },
  });

  const onvifScan = useMutation({
    mutationFn: () =>
      scanOnvifNetwork({
        tenantId: tenantId as string,
        gatewayId,
        ...(onvifTargets.trim() ? { targets: onvifTargets.trim() } : {}),
      }),
    onSuccess: setOnvifResults,
  });

  // Polling do progresso enquanto o scan está em andamento.
  useEffect(() => {
    if (!scan.isPending) return;
    const interval = setInterval(async () => {
      const scanId = scanIdRef.current;
      if (!scanId) return;
      try {
        const p = await getScanProgress(scanId);
        if (p && scanIdRef.current === scanId) setProgress(p);
      } catch {
        // polling é best-effort — o resultado final chega pela mutation
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [scan.isPending]);

  const valid = tenantId && gatewayId && ipStart.trim() && ipEnd.trim();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-xl rounded-xl border border-border bg-card p-6 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Escanear rede</h3>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Abas: scan SNMP por range × descoberta automática ONVIF */}
        <div className="flex rounded-lg border border-border bg-muted/40 p-1 text-sm font-medium">
          {([['snmp', 'SNMP (range de IP)'], ['onvif', 'ONVIF (automático)']] as const).map(
            ([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={[
                  'flex-1 rounded-md px-3 py-1.5 transition-colors',
                  mode === value
                    ? 'bg-card text-foreground shadow-sm border border-border'
                    : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {label}
              </button>
            ),
          )}
        </div>

        {isGlobal && (
          <Field label="Cliente *">
            <select value={modalTenantId} onChange={(e) => handleTenantChange(e.target.value)} className={inputCls}>
              <option value="">Selecione o cliente…</option>
              {tenants.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Gateway *">
          <select value={gatewayId} onChange={(e) => setGatewayId(e.target.value)} className={inputCls}>
            <option value="">Selecione…</option>
            {gateways.map((g) => (
              <option key={g.id} value={g.id}>{g.id} ({g.status})</option>
            ))}
          </select>
        </Field>

        {mode === 'snmp' && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="IP inicial *">
                <input value={ipStart} onChange={(e) => setIpStart(e.target.value)} placeholder="192.168.0.1" className={inputCls} />
              </Field>
              <Field label="IP final *">
                <input value={ipEnd} onChange={(e) => setIpEnd(e.target.value)} placeholder="192.168.0.254" className={inputCls} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Versão SNMP">
                <select value={snmpVersion} onChange={(e) => setSnmpVersion(e.target.value as '1' | '2c')} className={inputCls}>
                  <option value="2c">v2c</option>
                  <option value="1">v1</option>
                </select>
              </Field>
              <Field label="Communities (separadas por vírgula)">
                <input
                  value={community}
                  onChange={(e) => setCommunity(e.target.value)}
                  placeholder="public, private"
                  className={inputCls}
                />
              </Field>
            </div>

            <p className="text-[11px] text-muted-foreground">
              O scan tenta automaticamente a outra versão SNMP e todas as communities
              informadas para cada host que não responder na combinação escolhida.
            </p>
          </>
        )}

        {mode === 'onvif' && (
          <>
            <Field label="IP ou faixa (opcional)">
              <input
                value={onvifTargets}
                onChange={(e) => setOnvifTargets(e.target.value)}
                placeholder="192.168.0.50, 192.168.0.0/24 ou 192.168.0.10-50"
                className={inputCls}
              />
            </Field>
            <p className="text-[11px] text-muted-foreground">
              O gateway envia o anúncio de descoberta ONVIF (WS-Discovery) por
              todas as redes do PC, repetindo o envio para maior confiabilidade.
              Se informar um IP ou faixa, ele também sonda esses endereços
              diretamente — útil quando o switch bloqueia multicast. Credenciais
              são pedidas apenas no cadastro.
            </p>
          </>
        )}

        {mode === 'snmp' && scan.error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            {(scan.error as Error).message}
          </p>
        )}
        {mode === 'onvif' && onvifScan.error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            {(onvifScan.error as Error).message}
          </p>
        )}

        {mode === 'snmp' ? (
          <button
            onClick={() => { setResults(null); scan.mutate(); }}
            disabled={!valid || scan.isPending}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {scan.isPending
              ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {progress && progress.total > 0
                    ? `Escaneando… ${progress.scanned}/${progress.total} IPs verificados` +
                      (progress.found > 0 ? ` · ${progress.found} encontrado${progress.found !== 1 ? 's' : ''}` : '')
                    : 'Escaneando… pode levar alguns minutos'}
                </>
              )
              : (<><ScanSearch className="h-4 w-4" /> Escanear</>)}
          </button>
        ) : (
          <button
            onClick={() => { setOnvifResults(null); onvifScan.mutate(); }}
            disabled={!tenantId || !gatewayId || onvifScan.isPending}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {onvifScan.isPending
              ? (<><Loader2 className="h-4 w-4 animate-spin" /> Descobrindo câmeras… (~10s)</>)
              : (<><ScanSearch className="h-4 w-4" /> Descobrir câmeras ONVIF</>)}
          </button>
        )}

        {mode === 'onvif' && onvifResults !== null && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              {onvifResults.length} câmera{onvifResults.length !== 1 ? 's' : ''} ONVIF encontrada{onvifResults.length !== 1 ? 's' : ''}
            </p>
            {onvifResults.length === 0 ? (
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-1">
                <p>Nenhuma câmera respondeu ao anúncio. Dicas:</p>
                <ul className="list-disc pl-4 space-y-0.5">
                  <li>
                    Informe o IP (ou a faixa) da câmera no campo acima — a sondagem
                    direta funciona mesmo quando o switch bloqueia multicast.
                  </li>
                  <li>
                    Verifique se o ONVIF/WS-Discovery está habilitado nas configurações
                    da câmera (em algumas, fica em &quot;Integração&quot; ou &quot;Protocolos&quot;).
                  </li>
                  <li>Confirme que a câmera está na mesma rede do gateway.</li>
                </ul>
              </div>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {onvifResults.map((d) => {
                  const already = registeredIps.has(d.ip);
                  return (
                    <li key={d.ip} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          {d.ip}:{d.port}
                          {d.name ? <span className="text-muted-foreground font-normal"> — {d.name}</span> : null}
                        </p>
                        {d.hardware && (
                          <p className="truncate text-xs text-muted-foreground max-w-md">{d.hardware}</p>
                        )}
                      </div>
                      {already ? (
                        <span className="shrink-0 text-xs text-muted-foreground">Já cadastrada</span>
                      ) : (
                        <button
                          onClick={() => onAdd(d.ip, 'onvif', d.port)}
                          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
                        >
                          Adicionar
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {mode === 'snmp' && scan.isPending && progress && progress.total > 0 && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.round((progress.scanned / progress.total) * 100)}%` }}
            />
          </div>
        )}

        {mode === 'snmp' && results !== null && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              {results.devices.length} dispositivo{results.devices.length !== 1 ? 's' : ''} respondeu{results.devices.length !== 1 ? 'ram' : ''} ao SNMP
            </p>
            {results.summary && (
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-1">
                <p>
                  {results.summary.probed} IP{results.summary.probed !== 1 ? 's' : ''} sondado{results.summary.probed !== 1 ? 's' : ''}
                  {' · '}{results.summary.responded} com SNMP
                  {' · '}{results.summary.timeouts} sem resposta (timeout)
                  {' · '}{Math.round(results.summary.durationMs / 1000)}s
                </p>
                {results.summary.aliveNoSnmp.length > 0 && (
                  <div className="space-y-1.5">
                    <p>
                      <span className="font-medium text-foreground">
                        {results.summary.aliveNoSnmp.length} host{results.summary.aliveNoSnmp.length !== 1 ? 's' : ''} vivo{results.summary.aliveNoSnmp.length !== 1 ? 's' : ''} na rede sem responder SNMP
                      </span>{' '}
                      — podem ser câmeras com ONVIF habilitado (usuário e senha) ou com o
                      SNMP desligado.
                    </p>
                    <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                      {results.summary.aliveNoSnmp.map((hostIp) => {
                        const already = registeredIps.has(hostIp);
                        return (
                          <li key={hostIp} className="flex items-center justify-between gap-3 px-3 py-2">
                            <span className="text-sm font-medium text-foreground">{hostIp}</span>
                            {already ? (
                              <span className="shrink-0 text-xs text-muted-foreground">Já cadastrada</span>
                            ) : (
                              <button
                                onClick={() => onAdd(hostIp, 'onvif')}
                                className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
                              >
                                Adicionar via ONVIF
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>
            )}
            {results.devices.length > 0 && (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {results.devices.map((d) => {
                  const already = registeredIps.has(d.ip);
                  return (
                    <li key={d.ip} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          {d.ip}
                          {d.sysName ? <span className="text-muted-foreground font-normal"> — {d.sysName}</span> : null}
                        </p>
                        {d.sysDescr && (
                          <p className="truncate text-xs text-muted-foreground max-w-md">{d.sysDescr}</p>
                        )}
                        {d.snmpVersion && (
                          <p className="text-[11px] text-muted-foreground/80">
                            Respondeu em v{d.snmpVersion} · community &quot;{d.community}&quot;
                          </p>
                        )}
                      </div>
                      {already ? (
                        <span className="shrink-0 text-xs text-muted-foreground">Já cadastrada</span>
                      ) : (
                        <button
                          onClick={() => onAdd(d.ip, 'snmp')}
                          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted"
                        >
                          Adicionar
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Detalhe de telemetria da câmera ─────────────────────────────────────────

/**
 * Modal com TODOS os pontos da câmera: valor formatado, unidade e horário da
 * última leitura. Atualiza em tempo real via socket (fallback: último valor
 * persistido no backend). Visível para qualquer perfil de usuário.
 */
// ─── MonitoringProfilePanel ───────────────────────────────────────────────────

/** Ícone e cor por estado de capacidade. */
const CAPABILITY_STATE_ICON: Record<
  string,
  { icon: React.ReactNode; label: string; cls: string }
> = {
  SUPPORTED: {
    icon: <CircleCheck className="h-3.5 w-3.5" />,
    label: 'Suportada',
    cls: 'text-emerald-600 dark:text-emerald-400',
  },
  UNSUPPORTED: {
    icon: <CircleOff className="h-3.5 w-3.5" />,
    label: 'Não suportada',
    cls: 'text-muted-foreground',
  },
  NO_PERMISSION: {
    icon: <CircleAlert className="h-3.5 w-3.5" />,
    label: 'Sem permissão SNMP',
    cls: 'text-orange-500',
  },
  TEMPORARY_ERROR: {
    icon: <CircleAlert className="h-3.5 w-3.5" />,
    label: 'Erro temporário',
    cls: 'text-amber-500',
  },
};

const METRIC_LABELS: Record<string, string> = {
  cpu: 'CPU',
  memory: 'Memória',
  ram_total: 'RAM Total',
  storage: 'Armazenamento',
  temperature: 'Temperatura',
  packet_loss: 'Perda de pacotes',
  uptime: 'Tempo ligado',
  status: 'Status',
  stream: 'Stream',
  motion: 'Movimento',
  tamper: 'Adulteração',
  video_loss: 'Perda de vídeo',
  latency: 'Latência',
  last_motion: 'Último movimento',
  ping_loss: 'Perda de ping',
};

const PROFILE_SOURCE_LABELS: Record<string, string> = {
  detected: 'Detectado',
  manual: 'Manual',
  generic: 'Genérico',
};

const PROFILE_SOURCE_CLS: Record<string, string> = {
  detected:
    'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800',
  manual:
    'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-800',
  generic:
    'bg-muted text-muted-foreground border-border',
};

/**
 * Secção colapsável "Perfil de monitoramento" dentro do CameraTelemetryModal.
 * Só visível para ADMIN/CCO. Permite:
 *   – Ver o perfil detectado / manual / genérico
 *   – Selecionar um perfil manualmente
 *   – Executar o probe de capacidades
 *   – Ver o mapa de capacidades por métrica
 */
function MonitoringProfilePanel({
  camera,
  isAdmin,
}: {
  camera: CameraType;
  isAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);

  const capQuery = useQuery({
    queryKey: ['camera-capabilities', camera.id],
    queryFn: () => getCameraCapabilities(camera.id),
    enabled: open,
    staleTime: 30_000,
  });

  const profilesQuery = useQuery({
    queryKey: ['monitoring-profiles', 'CAMERA'],
    queryFn: () => getMonitoringProfiles('CAMERA'),
    staleTime: 5 * 60_000,
  });

  const cap = capQuery.data;
  const profiles: MonitoringProfile[] = profilesQuery.data ?? [];

  // Perfil exibido: usa a resposta de capabilities quando disponível,
  // caso contrário cai no que veio no objeto Camera.
  const profileId = cap?.profileId ?? camera.profileId ?? null;
  const profileLabel = cap?.profileLabel ?? camera.profileLabel ?? t('Genérico');
  const profileSource = cap?.profileSource ?? camera.profileSource ?? 'generic';

  async function handleProbe() {
    setProbing(true);
    setProbeError(null);
    try {
      await probeCameraCapabilities(camera.id);
      await capQuery.refetch();
      queryClient.invalidateQueries({ queryKey: ['cftv-cameras'] });
    } catch (err) {
      setProbeError((err as Error).message);
    } finally {
      setProbing(false);
    }
  }

  async function handleProfileChange(newProfileId: string) {
    setSavingProfile(true);
    try {
      await updateCamera(camera.id, {
        profileId: newProfileId === '' ? null : newProfileId,
      });
      await capQuery.refetch();
      queryClient.invalidateQueries({ queryKey: ['cftv-cameras'] });
    } finally {
      setSavingProfile(false);
    }
  }

  // Câmeras ONVIF sem canal SNMP não têm OIDs para sondar.
  const isSnmp = camera.protocol === 'snmp' ||
    (camera.protocol === 'onvif' && camera.snmpHealth?.enabled === true);

  if (!isAdmin) return null;

  return (
    <div className="rounded-lg border border-border">
      {/* Cabeçalho colapsável */}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
      >
        <span className="flex items-center gap-1.5">
          <Radar className="h-3.5 w-3.5" />
          {t('Perfil de monitoramento')}
        </span>
        <span className="flex items-center gap-2">
          {/* Badge de perfil/fonte visível mesmo colapsado */}
          <span
            className={[
              'rounded border px-1.5 py-0.5 text-[10px] font-semibold leading-none',
              PROFILE_SOURCE_CLS[profileSource] ?? PROFILE_SOURCE_CLS.generic,
            ].join(' ')}
          >
            {PROFILE_SOURCE_LABELS[profileSource] ?? profileSource}
          </span>
          <span className="text-xs font-normal text-foreground">{profileLabel}</span>
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      {open && (
        <div className="border-t border-border px-3 pb-3 pt-2 space-y-3">
          {/* Dropdown de seleção manual + botão de probe */}
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={profileId ?? ''}
              disabled={savingProfile}
              onChange={(e) => handleProfileChange(e.target.value)}
              className="flex-1 min-w-0 rounded border border-border bg-background px-2 py-1 text-xs text-foreground"
            >
              <option value="">{t('Usar detecção automática')}</option>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
            {isSnmp && (
              <button
                type="button"
                onClick={handleProbe}
                disabled={probing || savingProfile}
                className="flex shrink-0 items-center gap-1 rounded border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-muted disabled:opacity-50"
              >
                {probing ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Radar className="h-3 w-3" />
                )}
                {probing ? t('Identificando…') : t('Identificar perfil')}
              </button>
            )}
          </div>

          {/* Erro do probe */}
          {probeError && (
            <p className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive">
              {t('Probe falhou')}: {probeError}
            </p>
          )}

          {/* Tabela de capacidades */}
          {capQuery.isLoading && (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}
          {cap && cap.capabilities.length > 0 && (
            <div className="overflow-hidden rounded border border-border">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-2 py-1 text-left text-[10px] font-medium text-muted-foreground">
                      {t('Capacidades')}
                    </th>
                    <th className="px-2 py-1 text-right text-[10px] font-medium text-muted-foreground">
                      Estado
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {cap.capabilities
                    // Mostra apenas as métricas relevantes para o protocolo
                    .filter((c) =>
                      isSnmp
                        ? ['cpu', 'memory', 'ram_total', 'storage', 'temperature', 'packet_loss', 'uptime'].includes(c.metricKey)
                        : ['status', 'stream', 'motion', 'tamper', 'video_loss'].includes(c.metricKey),
                    )
                    .map((c) => {
                      const meta = CAPABILITY_STATE_ICON[c.state] ?? CAPABILITY_STATE_ICON.TEMPORARY_ERROR;
                      return (
                        <tr key={c.metricKey} className="hover:bg-muted/30">
                          <td className="px-2 py-1 text-foreground">
                            {METRIC_LABELS[c.metricKey] ?? c.metricKey}
                          </td>
                          <td className={['px-2 py-1 text-right flex items-center justify-end gap-1', meta.cls].join(' ')}>
                            {meta.icon}
                            <span>{t(meta.label)}</span>
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}

          {cap && cap.capabilities.length === 0 && !capQuery.isLoading && (
            <p className="text-center text-xs text-muted-foreground py-2">
              Nenhum dado de probe — clique em &quot;{t('Identificar perfil')}&quot; para iniciar.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function CameraTelemetryModal({
  camera,
  live,
  showIp,
  isAdmin,
  onClose,
}: {
  camera: CameraType;
  live: TelemetryMap;
  /** IP:porta é informação de rede — só perfis administrativos veem. */
  showIp: boolean;
  isAdmin: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  // Toggle de ponto crítico (estrela) — otimista, reverte em erro (mesmo
  // padrão dos pontos das controladoras BACnet/Modbus/MQTT).
  const [pointCriticalById, setPointCriticalById] = useState<Record<string, boolean>>({});
  const isPointCritical = (p: { id: string; critical?: boolean }) =>
    pointCriticalById[p.id] ?? !!p.critical;
  async function handleTogglePointCritical(pointId: string) {
    const current = isPointCritical(
      camera.points.find((p) => p.id === pointId) ?? { id: pointId },
    );
    const next = !current;
    setPointCriticalById((m) => ({ ...m, [pointId]: next }));
    try {
      await setCameraPointCritical(camera.id, pointId, next);
      queryClient.invalidateQueries({ queryKey: ['cftv-cameras'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-critical-assets'] });
    } catch {
      setPointCriticalById((m) => ({ ...m, [pointId]: current }));
    }
  }

  const points = [...camera.points].sort((a, b) => {
    const ia = TELEMETRY_TAG_ORDER.indexOf(a.tag);
    const ib = TELEMETRY_TAG_ORDER.indexOf(b.tag);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });
  const info = camera.deviceInfo;
  // "Tempo ligada" estimado (mesma camada do card): só quando a câmera está
  // online e o ponto UPTIME não tem leitura real — dado real sempre prevalece.
  const statusEntry = liveOrSeed(camera, 'STATUS', live);
  const cameraOnline = statusEntry?.value !== null && statusEntry !== undefined
    ? Number(statusEntry.value) >= 1
    : false;
  const estUptime = estimatedUptimeSeconds(camera.estimatedOnlineSince, cameraOnline);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-xl space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            Telemetria — {camera.name}
          </h3>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          {[
            showIp ? `${camera.ip}:${camera.port}` : null,
            info?.model
              ? [info.manufacturer, info.model].filter(Boolean).join(' ')
              : null,
          ]
            .filter(Boolean)
            .join(' — ')}
          {info?.firmwareVersion ? ` · fw ${info.firmwareVersion}` : ''}
        </p>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {points.map((p) => {
            const entry = liveOrSeed(camera, p.tag, live);
            const value = formatPointLiveValue(p, entry?.value ?? null);
            const readAt = formatReadTime(entry?.timestamp ?? null);
            const unreliable = value !== null && entry?.unreliable === true;
            const stateLabel = entry?.state ? POINT_STATE_LABELS[entry.state] : undefined;
            // UPTIME sem leitura real: mostra o tempo estimado (transições do STATUS).
            const showEstimated = p.tag === 'UPTIME' && value === null && estUptime !== null;
            return (
              <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <span className="flex min-w-0 items-center gap-1">
                  <CriticalStarButton
                    critical={isPointCritical(p)}
                    size={14}
                    onToggle={() => handleTogglePointCritical(p.id)}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-foreground">{p.objectName}</span>
                    <span className="block text-xs text-muted-foreground">
                      {p.tag}{p.unit ? ` · ${p.unit}` : ''}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span
                    className={
                      unreliable
                        ? 'block text-sm font-medium text-amber-600 dark:text-amber-400'
                        : value !== null || showEstimated
                          ? 'block text-sm font-medium text-foreground'
                          : 'block text-xs text-muted-foreground'
                    }
                    title={
                      unreliable
                        ? 'Dado não confiável — o firmware responde um valor fixo neste OID.'
                        : showEstimated
                          ? ESTIMATED_UPTIME_HINT
                          : entry?.state === 'waiting_event'
                            ? WAITING_EVENT_HINT
                            : undefined
                    }
                  >
                    {value !== null
                      ? `${value}${unreliable ? ' ⚠' : ''}`
                      : showEstimated
                        ? (
                            <>
                              {formatUptime(estUptime as number)}
                              <span className="ml-1 text-[11px] font-normal text-muted-foreground">(estimado)</span>
                            </>
                          )
                        : p.unsupported
                          ? 'não suportado pela câmera'
                          : (stateLabel ?? 'sem dados')}
                  </span>
                  {readAt && (
                    <span className="block text-[11px] text-muted-foreground">
                      lido às {readAt}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>

        {/* Secção "Perfil de monitoramento" — só para ADMIN/CCO */}
        <MonitoringProfilePanel camera={camera} isAdmin={isAdmin} />
      </div>
    </div>
  );
}

// ─── Alarmes e trends por ponto da câmera ────────────────────────────────────

/**
 * Modal de configuração por ponto da câmera: lista os pontos de saúde com
 * indicadores de alarme/trend existentes e, ao expandir um ponto, reutiliza o
 * mesmo painel do BMS (PointConfigPanel) para ver/criar/remover alarme e trend.
 */
function CameraPointConfigModal({
  camera,
  live,
  alarmRuleByPoint,
  trendByPoint,
  onChanged,
  onClose,
}: {
  camera: CameraType;
  live: TelemetryMap;
  alarmRuleByPoint: Map<string, AlarmRuleItem>;
  trendByPoint: Map<string, TrendItem>;
  onChanged: () => void;
  onClose: () => void;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const points = [...camera.points].sort((a, b) => {
    const ia = TELEMETRY_TAG_ORDER.indexOf(a.tag);
    const ib = TELEMETRY_TAG_ORDER.indexOf(b.tag);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <h3 className="text-sm font-semibold text-foreground">
            Alarmes e trends — {camera.name}
          </h3>
          <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
          <p className="text-xs text-muted-foreground">
            Clique num ponto de saúde para ver e configurar o alarme e a trend
            (histórico) daquele ponto — mesma experiência do detalhe de dispositivo.
          </p>
          <ul className="divide-y divide-border rounded-lg border border-border">
            {points.map((p) => {
              const entry = liveOrSeed(camera, p.tag, live);
              const value = formatPointLiveValue(p, entry?.value ?? null);
              const pointAlarm = alarmRuleByPoint.get(p.id);
              const pointTrend = trendByPoint.get(p.id);
              const expanded = expandedId === p.id;
              return (
                <li key={p.id}>
                  <button
                    onClick={() => setExpandedId(expanded ? null : p.id)}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted ${expanded ? 'bg-muted/50' : ''}`}
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 min-w-0">
                        {pointTrend && (
                          <LineChart className="h-3.5 w-3.5 shrink-0 text-cyan-600" strokeWidth={2} aria-label="Trend ativa" />
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
                  {expanded && (
                    <PointConfigPanel
                      pointId={p.id}
                      pointLabel={`${camera.name} — ${p.objectName}`}
                      isDigital={CAMERA_DIGITAL_TAGS.includes(p.tag)}
                      unit={p.unit || null}
                      trend={pointTrend}
                      alarmRule={pointAlarm}
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

// ─── Canal SNMP de saúde: overrides de OID + teste ───────────────────────────

/** Inputs de override manual de OID por métrica (vazio = perfil). */
function OidOverrideFields({
  overrides,
  onChange,
  hint,
  metrics = HEALTH_METRICS,
}: {
  overrides: Partial<Record<OverrideMetric, string>>;
  onChange: (metric: OverrideMetric, value: string) => void;
  hint: string;
  metrics?: readonly OverrideMetric[];
}) {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {metrics.map((m) => (
          <Field key={m} label={`OID ${OVERRIDE_LABELS[m]}`}>
            <input
              value={overrides[m] ?? ''}
              onChange={(e) => onChange(m, e.target.value)}
              placeholder="1.3.6.1…"
              className={inputCls + ' font-mono text-xs'}
            />
          </Field>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

/** Botão "Testar SNMP" + pré-visualização dos valores lidos. */
function SnmpTestBlock({
  canTest,
  isPending,
  error,
  result,
  onTest,
}: {
  canTest: boolean;
  isPending: boolean;
  error: string | null;
  result: SnmpHealthTestOutcome | null;
  onTest: () => void;
}) {
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={onTest}
        disabled={!canTest || isPending}
        className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
      >
        {isPending
          ? (<><Loader2 className="h-3.5 w-3.5 animate-spin" /> Testando…</>)
          : (<><ScanSearch className="h-3.5 w-3.5" /> Testar SNMP</>)}
      </button>
      {!canTest && (
        <p className="text-[11px] text-muted-foreground">
          Preencha o IP e selecione o gateway para testar.
        </p>
      )}
      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </p>
      )}
      {result && (
        <div
          className={[
            'rounded-md border px-3 py-2 text-xs space-y-1',
            result.reachable
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400'
              : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400',
          ].join(' ')}
        >
          <p className="font-medium">
            {result.reachable
              ? 'Câmera respondeu ao SNMP'
              : 'Câmera não respondeu ao SNMP (verifique community, porta e se o SNMP está habilitado)'}
          </p>
          {result.reachable && (
            <ul className="space-y-0.5">
              {HEALTH_METRICS.map((m) => {
                const v = result.values[m];
                return (
                  <li key={m} className="flex justify-between gap-3">
                    <span>{HEALTH_LABELS[m]}</span>
                    <span className="font-mono">
                      {typeof v === 'number' && Number.isFinite(v) ? v : 'sem resposta'}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Micro-componentes ───────────────────────────────────────────────────────

const inputCls =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-foreground">{label}</span>
      {children}
    </label>
  );
}
