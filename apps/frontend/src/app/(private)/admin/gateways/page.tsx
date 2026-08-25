'use client';

import { Fragment, useState } from 'react';
import { XCircle } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  DownloadCloud,
  Loader2,
  Router,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { apiGet, apiDelete, sensitiveActionHeaders } from '@/lib/api-client';
import PasswordConfirmDialog from '@/components/PasswordConfirmDialog';
import {
  cancelGatewayUpdate,
  compareVersions,
  triggerGatewayUpdate,
} from '@/modules/gateways/services/gateways.service';
import type {
  GatewayHealthSummary,
  GatewayItem,
  GatewayOtaProgress,
  GatewayPollingHealth,
} from '@/modules/gateways/services/gateways.service';

interface TenantItem { id: string; name: string; }

/** Considera o resumo de saúde "recente" se recebido nos últimos 90s. */
const HEALTH_FRESH_MS = 90_000;

function formatRelative(iso?: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  return `há ${Math.floor(h / 24)}d`;
}

/** Retorna o resumo de saúde só se ele for recente; senão null ("sem dados"). */
function freshHealth(health?: GatewayHealthSummary | null): GatewayHealthSummary | null {
  if (!health?.receivedAt) return null;
  const age = Date.now() - new Date(health.receivedAt).getTime();
  return age <= HEALTH_FRESH_MS ? health : null;
}

/** Maior latência de polling entre os devices (indicador simples de lentidão). */
function maxPollingLatency(health: GatewayHealthSummary): number | null {
  const active = health.polling.filter((p) => p.protocol !== 'mqtt');
  if (!active.length) return null;
  return Math.max(...active.map((p) => p.lastLatencyMs));
}

/** MQTT (passivo): silêncio acima disso conta como "sem resposta". */
const MQTT_SILENCE_MS = 10 * 60_000;

/**
 * Deriva o status de um device a partir das métricas de leitura: OK quando a
 * última leitura funcionou (>0 pontos); para MQTT, quando chegou mensagem
 * recentemente. Caso contrário, "Sem resposta".
 */
function deviceHealthOk(p: GatewayPollingHealth): boolean {
  if (p.protocol === 'mqtt') {
    if (!p.lastMessageAt) return false;
    return Date.now() - new Date(p.lastMessageAt).getTime() <= MQTT_SILENCE_MS;
  }
  return !!p.lastPollAt && p.lastPointsRead > 0;
}

/**
 * Device "furando" o intervalo de polling com frequência: mais de 20% dos
 * ciclos estouraram o intervalo configurado (e pelo menos 3 estouros) —
 * sinal de que o intervalo é curto demais para o device (ex.: BACnet sem RPM).
 */
function isFrequentOverrunner(p: GatewayPollingHealth): boolean {
  const overruns = p.intervalOverruns ?? 0;
  const skipped = p.skippedCycles ?? 0;
  const cycles = p.totalCycles + skipped;
  if (cycles === 0) return false;
  return (overruns + skipped) >= 3 && (overruns + skipped) / cycles > 0.2;
}

/** Soma de devices com problemas de ciclo (pulados ou estourando o intervalo). */
function cycleIssueCount(health: GatewayHealthSummary): number {
  return health.polling.filter(
    (p) => p.protocol !== 'mqtt' && ((p.skippedCycles ?? 0) > 0 || (p.intervalOverruns ?? 0) > 0),
  ).length;
}

/** Selo visual de status por device (OK / Sem resposta). */
function DeviceStatusBadge({ ok }: { ok: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium border ${
        ok
          ? 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-900'
          : 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900'
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? 'bg-green-500' : 'bg-red-500'}`} />
      {ok ? 'OK' : 'Sem resposta'}
    </span>
  );
}

/**
 * Janela de expiração no cliente — alinhada ao backend (15 min). O backend já
 * transiciona para `expired` sozinho; este corte só cobre dados em cache.
 */
const OTA_EXPIRE_MS = 15 * 60_000;

/** True enquanto a atualização OTA está em andamento (estágios não-finais). */
function otaInFlight(ota?: GatewayOtaProgress | null): boolean {
  if (!ota) return false;
  if (!['downloading', 'applying', 'restarting'].includes(ota.stage)) return false;
  // Sem estágio final há mais de 15min = expirada (backend confirma no refetch).
  return Date.now() - new Date(ota.receivedAt).getTime() < OTA_EXPIRE_MS;
}

const OTA_STAGE_LABEL: Record<string, string> = {
  downloading: 'Baixando pacote…',
  applying: 'Aplicando atualização…',
  restarting: 'Reiniciando gateway…',
  completed: 'Atualização concluída',
  failed: 'Falha na atualização',
  rolled_back: 'Falhou — versão anterior restaurada',
  expired: 'Atualização não confirmada — o gateway não voltou após o restart',
};

/** Estágios terminais de falha (inclui o `expired` gerado pelo backend). */
const OTA_FAILURE_STAGES = ['failed', 'rolled_back', 'expired'];

type StatusFilter = 'all' | 'online' | 'offline';

export default function GatewaysPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const deleteMutation = useMutation({
    mutationFn: ({ id, token }: { id: string; token: string }) =>
      apiDelete(`/gateways/${id}`, { headers: sensitiveActionHeaders(token) }),
    onSuccess: () => {
      setConfirmDeleteId(null);
      void qc.invalidateQueries({ queryKey: ['gateways'] });
    },
  });

  const { data: gateways = [], isLoading, error } = useQuery<GatewayItem[]>({
    queryKey: ['gateways'],
    queryFn: () => apiGet('/gateways'),
    // Durante uma atualização OTA, acompanha o progresso mais de perto.
    refetchInterval: (query) =>
      (query.state.data ?? []).some((g) => otaInFlight(g.ota)) ? 4_000 : 30_000,
  });

  const updateMutation = useMutation({
    mutationFn: (id: string) => triggerGatewayUpdate(id),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['gateways'] }),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelGatewayUpdate(id),
    onSettled: () => void qc.invalidateQueries({ queryKey: ['gateways'] }),
  });

  const { data: tenants = [] } = useQuery<TenantItem[]>({
    queryKey: ['tenants'],
    queryFn: () => apiGet('/tenants'),
  });

  const tenantMap = Object.fromEntries(tenants.map((t) => [t.id, t.name]));

  const filtered = gateways.filter((g) => {
    if (statusFilter === 'online')  return g.status === 'online';
    if (statusFilter === 'offline') return g.status !== 'online';
    return true;
  });

  const onlineCount  = gateways.filter((g) => g.status === 'online').length;
  const offlineCount = gateways.filter((g) => g.status !== 'online').length;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {/* Header */}
      <header className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10">
          <Router className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Gateways</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Status e saúde em tempo real dos gateways instalados nos clientes
          </p>
        </div>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Total',   value: gateways.length, color: 'text-foreground' },
          { label: 'Online',  value: onlineCount,      color: 'text-green-600 dark:text-green-400' },
          { label: 'Offline', value: offlineCount,     color: 'text-muted-foreground' },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl border border-border bg-card px-4 py-3 text-center shadow-sm">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-border">
        {(['all', 'online', 'offline'] as StatusFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`flex-1 sm:flex-none px-4 py-2.5 sm:py-2 text-sm font-medium border-b-2 transition-colors ${
              statusFilter === f
                ? 'border-cyan-600 text-cyan-700'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {f === 'all' ? 'Todos' : f === 'online' ? 'Online' : 'Offline'}
          </button>
        ))}
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-lg bg-muted/40 animate-pulse" />)}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
          Erro ao carregar gateways: {(error as Error).message}
        </div>
      )}

      {/* Empty */}
      {!isLoading && !error && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border bg-card px-6 py-16 text-center shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-500/10">
            <Router className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
          </div>
          <p className="text-sm text-muted-foreground">
            {gateways.length === 0 ? 'Nenhum gateway cadastrado ainda.' : 'Nenhum gateway neste filtro.'}
          </p>
        </div>
      )}

      {/* List — cards empilhados no mobile */}
      {!isLoading && !error && filtered.length > 0 && (
        <div className="space-y-3 md:hidden">
          {filtered.map((gw) => {
            const online = gw.status === 'online';
            const health = freshHealth(gw.health);
            const expanded = expandedId === gw.id;
            return (
              <div key={gw.id} className="rounded-xl border border-border bg-card shadow-sm">
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : gw.id)}
                  className="w-full px-4 py-3 text-left"
                >
                  <div className="flex items-center gap-2">
                    {online
                      ? <Wifi className="h-4 w-4 text-green-500 shrink-0" />
                      : <WifiOff className="h-4 w-4 text-muted-foreground/60 shrink-0" />}
                    <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-foreground">{gw.id}</span>
                    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${online ? 'bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-900' : 'bg-muted text-muted-foreground border border-border'}`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/50'}`} />
                      {online ? 'Online' : 'Offline'}
                    </span>
                    {expanded
                      ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span className="truncate">{tenantMap[gw.tenantId] ?? gw.tenantId}</span>
                    <span aria-hidden>·</span>
                    <span>{formatRelative(gw.lastSeen)}</span>
                  </div>
                  <div className="mt-2">
                    <HealthBadges health={health} />
                  </div>
                </button>
                {expanded && (
                  <div className="border-t border-border bg-muted/10 px-4 py-4">
                    <div className="mb-3">
                      <VersionPanel
                        gw={gw}
                        online={online}
                        pending={updateMutation.isPending && updateMutation.variables === gw.id}
                        error={
                          updateMutation.variables === gw.id && updateMutation.error
                            ? (updateMutation.error as Error).message
                            : null
                        }
                        onUpdate={() => updateMutation.mutate(gw.id)}
                        cancelPending={cancelMutation.isPending && cancelMutation.variables === gw.id}
                        cancelError={
                          cancelMutation.variables === gw.id && cancelMutation.error
                            ? (cancelMutation.error as Error).message
                            : null
                        }
                        onCancel={() => cancelMutation.mutate(gw.id)}
                      />
                    </div>
                    <HealthDetail health={health} />
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(gw.id)}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-red-300 hover:text-red-600 transition-colors"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Excluir gateway
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* List — tabela no desktop/tablet */}
      {!isLoading && !error && filtered.length > 0 && (
        <div className="hidden md:block overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow duration-200 hover:shadow-md">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Gateway ID</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hidden sm:table-cell">Cliente</th>
                <th className="text-center px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Status</th>
                <th className="text-center px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Saúde</th>
                <th className="text-center px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Versão</th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Última comunicação</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((gw) => {
                const online = gw.status === 'online';
                const health = freshHealth(gw.health);
                const expanded = expandedId === gw.id;
                return (
                  <Fragment key={gw.id}>
                    <tr
                      className="transition-colors duration-150 hover:bg-muted/30 cursor-pointer"
                      onClick={() => setExpandedId(expanded ? null : gw.id)}
                    >
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          {expanded
                            ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
                          {online
                            ? <Wifi className="h-4 w-4 text-green-500 shrink-0" />
                            : <WifiOff className="h-4 w-4 text-muted-foreground/60 shrink-0" />}
                          <span className="font-mono text-xs text-foreground font-medium">{gw.id}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell text-sm text-foreground">
                        {tenantMap[gw.tenantId] ?? gw.tenantId}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full ${online ? 'bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-900' : 'bg-muted text-muted-foreground border border-border'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${online ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/50'}`} />
                          {online ? 'Online' : 'Offline'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center hidden md:table-cell">
                        <HealthBadges health={health} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <VersionBadge gw={gw} />
                      </td>
                      <td className="px-4 py-3 text-right text-xs text-muted-foreground">
                        {formatRelative(gw.lastSeen)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(gw.id); }}
                          title="Excluir gateway"
                          className="inline-flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 dark:hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="bg-muted/10">
                        <td colSpan={7} className="px-4 py-4">
                          <div className="mb-3">
                            <VersionPanel
                              gw={gw}
                              online={online}
                              pending={updateMutation.isPending && updateMutation.variables === gw.id}
                              error={
                                updateMutation.variables === gw.id && updateMutation.error
                                  ? (updateMutation.error as Error).message
                                  : null
                              }
                              onUpdate={() => updateMutation.mutate(gw.id)}
                              cancelPending={cancelMutation.isPending && cancelMutation.variables === gw.id}
                              cancelError={
                                cancelMutation.variables === gw.id && cancelMutation.error
                                  ? (cancelMutation.error as Error).message
                                  : null
                              }
                              onCancel={() => cancelMutation.mutate(gw.id)}
                            />
                          </div>
                          <HealthDetail health={health} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          </div>
          <div className="border-t border-border bg-muted/20 px-5 py-2.5 text-xs text-muted-foreground">
            {filtered.length} gateway{filtered.length !== 1 ? 's' : ''}
            {statusFilter !== 'all' ? ' neste filtro' : ''}
          </div>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Atualiza automaticamente a cada 30 segundos. Clique em um gateway para ver os detalhes de saúde.
      </p>

      {confirmDeleteId && (
        <PasswordConfirmDialog
          title="Excluir gateway?"
          description="O gateway será removido do sistema. Esta ação não pode ser desfeita."
          isPending={deleteMutation.isPending}
          error={deleteMutation.error ? (deleteMutation.error as Error).message : null}
          onCancel={() => {
            setConfirmDeleteId(null);
            deleteMutation.reset();
          }}
          onConfirm={(token) => deleteMutation.mutate({ id: confirmDeleteId, token })}
        />
      )}
    </div>
  );
}

/** Badge compacto da versão na linha da tabela (com aviso quando desatualizado). */
function VersionBadge({ gw }: { gw: GatewayItem }) {
  const inFlight = otaInFlight(gw.ota);
  const online = gw.status === 'online';
  if (inFlight) {
    return (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-cyan-50 text-cyan-700 border border-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-300 dark:border-cyan-800">
        <Loader2 className="h-3 w-3 animate-spin" />
        {online
          ? OTA_STAGE_LABEL[gw.ota!.stage] ?? 'Atualizando…'
          : 'Gateway offline durante a atualização…'}
      </span>
    );
  }

  // Expirada em memória OU persistida (sobrevive a restart do backend).
  if (gw.ota?.stage === 'expired' || (!gw.ota && gw.otaState === 'expired')) {
    return (
      <span
        title={OTA_STAGE_LABEL.expired}
        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900"
      >
        <AlertTriangle className="h-3 w-3" />
        Não confirmada
        {gw.reportedVersion ? (
          <span className="font-mono">· v{gw.reportedVersion}</span>
        ) : null}
      </span>
    );
  }

  const version = gw.reportedVersion ?? null;
  if (!version) {
    return <span className="text-xs text-muted-foreground/70">—</span>;
  }

  const outdated = compareVersions(gw.latestVersion, version) > 0;
  return (
    <span
      title={outdated ? `Nova versão disponível: v${gw.latestVersion}` : 'Atualizado'}
      className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-mono ${
        outdated
          ? 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
          : 'bg-muted/40 text-muted-foreground'
      }`}
    >
      v{version}
      {outdated && <AlertTriangle className="h-3 w-3" />}
    </span>
  );
}

/** Painel de versão/atualização remota exibido ao expandir o gateway. */
function VersionPanel({
  gw,
  online,
  pending,
  error,
  onUpdate,
  cancelPending,
  cancelError,
  onCancel,
}: {
  gw: GatewayItem;
  online: boolean;
  pending: boolean;
  error: string | null;
  onUpdate: () => void;
  cancelPending: boolean;
  cancelError: string | null;
  onCancel: () => void;
}) {
  const [confirmCancel, setConfirmCancel] = useState(false);
  const inFlight = otaInFlight(gw.ota);
  const version = gw.reportedVersion ?? null;
  const outdated = version !== null && compareVersions(gw.latestVersion, version) > 0;
  const legacy = online && !gw.otaSupported;

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div>
          <p className="text-[11px] text-muted-foreground">Versão instalada</p>
          <p className="text-sm font-semibold font-mono text-foreground">
            {version ? `v${version}` : 'desconhecida'}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-muted-foreground">Versão disponível</p>
          <p className="text-sm font-semibold font-mono text-foreground">
            v{gw.latestVersion ?? '—'}
          </p>
        </div>

        {inFlight ? (
          online ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-cyan-50 text-cyan-700 border border-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-300 dark:border-cyan-800">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {OTA_STAGE_LABEL[gw.ota!.stage] ?? 'Atualizando…'}
              {gw.ota?.version ? ` (v${gw.ota.version})` : ''}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Gateway offline durante a atualização
              {gw.ota?.version ? ` (v${gw.ota.version})` : ''} — aguardando reconexão…
            </span>
          )
        ) : gw.ota?.stage === 'expired' || (!gw.ota && gw.otaState === 'expired') ? (
          gw.otaSupported && online ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onUpdate(); }}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-700 disabled:opacity-60 transition-colors"
            >
              {pending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <DownloadCloud className="h-3.5 w-3.5" />}
              Tentar atualizar novamente para v{gw.latestVersion}
            </button>
          ) : null
        ) : outdated && gw.otaSupported && online ? (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onUpdate(); }}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-700 disabled:opacity-60 transition-colors"
          >
            {pending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <DownloadCloud className="h-3.5 w-3.5" />}
            Atualizar gateway para v{gw.latestVersion}
          </button>
        ) : outdated && gw.otaSupported && !online ? (
          <span className="text-xs text-muted-foreground">
            Nova versão disponível — o gateway precisa estar online para atualizar.
          </span>
        ) : version && !outdated ? (
          <span className="text-xs text-green-700 dark:text-green-400">Gateway atualizado.</span>
        ) : null}

        {inFlight && (
          confirmCancel ? (
            <span className="inline-flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Cancelar a atualização travada?</span>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setConfirmCancel(false); onCancel(); }}
                disabled={cancelPending}
                className="inline-flex items-center gap-1 rounded-md bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-60 transition-colors"
              >
                {cancelPending
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <XCircle className="h-3 w-3" />}
                Sim, cancelar
              </button>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setConfirmCancel(false); }}
                className="rounded-md border border-border px-2.5 py-1 font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Voltar
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setConfirmCancel(true); }}
              disabled={cancelPending}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:border-red-300 hover:text-red-600 disabled:opacity-60 transition-colors"
            >
              {cancelPending
                ? <Loader2 className="h-3 w-3 animate-spin" />
                : <XCircle className="h-3 w-3" />}
              Cancelar atualização travada
            </button>
          )
        )}
      </div>

      {legacy && (
        <div className="flex items-start gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:border-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Este gateway foi instalado com uma versão antiga e não suporta atualização
            remota. Baixe o pacote do agente em Configurações e faça uma última
            reinstalação manual — as próximas atualizações poderão ser feitas por aqui.
          </span>
        </div>
      )}

      {!inFlight && gw.ota && OTA_FAILURE_STAGES.includes(gw.ota.stage) && (
        <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:border-red-800 dark:text-red-400">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            {gw.ota.stage === 'expired'
              ? `${gw.ota.error ?? OTA_STAGE_LABEL.expired}. Versão instalada: ${version ? `v${version}` : 'desconhecida'}. Verifique o gateway no local e, quando ele voltar a ficar online, dispare a atualização novamente. Se ele não voltar sozinho, reinstale o agente no local — o pacote atual inclui o launcher corrigido, que se recupera de atualizações falhadas.`
              : `${OTA_STAGE_LABEL[gw.ota.stage]}${gw.ota.error ? ` — ${gw.ota.error}` : ''}`}
          </span>
        </div>
      )}

      {/* Resultado persistido (sobrevive a restart do backend) quando não há progresso em memória. */}
      {!inFlight && !gw.ota && gw.otaState && OTA_FAILURE_STAGES.includes(gw.otaState) && (
        <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:border-red-800 dark:text-red-400">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            {gw.otaMessage ?? OTA_STAGE_LABEL[gw.otaState] ?? 'Falha na atualização'}
            {gw.otaState === 'expired'
              ? ` Versão instalada: ${version ? `v${version}` : 'desconhecida'}. Verifique o gateway no local e, quando ele voltar a ficar online, dispare a atualização novamente. Se ele não voltar sozinho, reinstale o agente no local — o pacote atual inclui o launcher corrigido, que se recupera de atualizações falhadas.`
              : ''}
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:border-red-800 dark:text-red-400">
          {error}
        </div>
      )}

      {cancelError && (
        <div className="rounded-md bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700 dark:bg-red-950/40 dark:border-red-800 dark:text-red-400">
          {cancelError}
        </div>
      )}
    </div>
  );
}

/** Badges compactos de saúde na linha (fila / reconexões). Neutro quando sem dados. */
function HealthBadges({ health }: { health: GatewayHealthSummary | null }) {
  if (!health) {
    return <span className="text-xs text-muted-foreground/70">sem dados de saúde</span>;
  }

  const pending = health.storeAndForward.pending;
  const dropped = health.storeAndForward.dropped;
  const reconnects = health.mqtt.reconnectCount ?? 0;

  return (
    <div className="inline-flex items-center gap-1.5">
      <span
        title="Fila offline (pendentes)"
        className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${
          pending > 0 ? 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800' : 'bg-muted/40 text-muted-foreground'
        }`}
      >
        fila {pending}
      </span>
      {dropped > 0 && (
        <span
          title="Mensagens descartadas (fila cheia)"
          className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-red-50 text-red-700 border border-red-200"
        >
          −{dropped}
        </span>
      )}
      <span
        title="Reconexões MQTT desde o boot"
        className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${
          reconnects > 0 ? 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800' : 'bg-muted/40 text-muted-foreground'
        }`}
      >
        rec {reconnects}
      </span>
    </div>
  );
}

/** Painel de detalhes de saúde exibido ao expandir a linha do gateway. */
function HealthDetail({ health }: { health: GatewayHealthSummary | null }) {
  if (!health) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Activity className="h-4 w-4 text-muted-foreground/50" />
        Sem dados de saúde recentes. O gateway precisa estar online
        para publicar o resumo (conexão MQTT, fila offline e latência de polling).
      </div>
    );
  }

  const latency = maxPollingLatency(health);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <HealthMetric
          label="Conexão MQTT"
          value={health.mqtt.connected ? 'Conectado' : 'Desconectado'}
          tone={health.mqtt.connected ? 'ok' : 'bad'}
        />
        <HealthMetric
          label="Reconexões MQTT"
          value={String(health.mqtt.reconnectCount ?? 0)}
          tone={(health.mqtt.reconnectCount ?? 0) > 0 ? 'warn' : 'ok'}
        />
        <HealthMetric
          label="Fila offline (pendentes)"
          value={String(health.storeAndForward.pending)}
          tone={health.storeAndForward.pending > 0 ? 'warn' : 'ok'}
        />
        <HealthMetric
          label="Descartadas (fila cheia)"
          value={String(health.storeAndForward.dropped)}
          tone={health.storeAndForward.dropped > 0 ? 'bad' : 'ok'}
        />
        <HealthMetric
          label="Latência de polling (máx.)"
          value={latency !== null ? `${latency} ms` : '—'}
          tone={latency !== null && latency > 2000 ? 'warn' : 'ok'}
        />
        <HealthMetric
          label="Devices com ciclos pulados/estourados"
          value={String(cycleIssueCount(health))}
          tone={cycleIssueCount(health) > 0 ? 'warn' : 'ok'}
        />
        <HealthMetric
          label="Devices monitorados"
          value={String(health.polling.length)}
          tone="neutral"
        />
        <HealthMetric
          label="Resumo recebido"
          value={formatRelative(health.receivedAt)}
          tone="neutral"
        />
      </div>

      {health.polling.length > 0 && (
        <div className="rounded-lg border border-border bg-card overflow-x-auto">
          <table className="w-full min-w-[640px] text-xs">
            <thead>
              <tr className="bg-muted/30 text-muted-foreground">
                <th className="text-left px-3 py-2 font-medium">Device</th>
                <th className="text-left px-3 py-2 font-medium">Protocolo</th>
                <th className="text-left px-3 py-2 font-medium">Status</th>
                <th className="text-right px-3 py-2 font-medium">Latência</th>
                <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">Leituras</th>
                <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">Ciclos</th>
                <th
                  className="text-right px-3 py-2 font-medium"
                  title="Ciclos pulados porque o anterior ainda estava em andamento"
                >
                  Pulados
                </th>
                <th
                  className="text-right px-3 py-2 font-medium"
                  title="Ciclos que demoraram mais que o intervalo configurado"
                >
                  Estouros
                </th>
                <th className="text-right px-3 py-2 font-medium">Última leitura OK</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {health.polling.map((p) => {
                const isMqtt = p.protocol === 'mqtt';
                const ok = deviceHealthOk(p);
                const overrunning = !isMqtt && isFrequentOverrunner(p);
                const skipped = p.skippedCycles ?? 0;
                const overruns = p.intervalOverruns ?? 0;
                return (
                  <tr
                    key={`${p.protocol}:${p.deviceId}`}
                    className={overrunning ? 'bg-amber-50/60 dark:bg-amber-950/20' : undefined}
                  >
                    <td className="px-3 py-2 text-foreground">
                      {p.deviceName ?? '—'}
                      {overrunning && (
                        <span
                          className="ml-2 inline-flex items-center text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800"
                          title={`Este device está furando o intervalo de polling com frequência${
                            p.intervalMs ? ` (intervalo configurado: ${Math.round(p.intervalMs / 1000)}s)` : ''
                          } — considere aumentar o intervalo.`}
                        >
                          fura intervalo
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 uppercase text-muted-foreground">{p.protocol}</td>
                    <td className="px-3 py-2">
                      <DeviceStatusBadge ok={ok} />
                    </td>
                    <td className={`px-3 py-2 text-right ${!isMqtt && p.lastLatencyMs > 2000 ? 'text-amber-700 dark:text-amber-500' : 'text-foreground'}`}>
                      {isMqtt ? '—' : `${p.lastLatencyMs} ms`}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground hidden sm:table-cell">
                      {isMqtt
                        ? `${p.messagesReceived ?? 0} msg`
                        : `${p.lastPointsRead}/${p.lastPointsAttempted}`}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground hidden sm:table-cell">
                      {isMqtt ? '—' : p.totalCycles}
                    </td>
                    <td
                      className={`px-3 py-2 text-right ${
                        !isMqtt && skipped > 0 ? 'text-amber-700 dark:text-amber-500 font-medium' : 'text-muted-foreground'
                      }`}
                      title="Ciclos pulados porque o anterior ainda estava em andamento"
                    >
                      {isMqtt ? '—' : skipped}
                    </td>
                    <td
                      className={`px-3 py-2 text-right ${
                        !isMqtt && overruns > 0 ? 'text-amber-700 dark:text-amber-500 font-medium' : 'text-muted-foreground'
                      }`}
                      title="Ciclos que demoraram mais que o intervalo configurado"
                    >
                      {isMqtt ? '—' : overruns}
                    </td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {formatRelative(isMqtt ? p.lastMessageAt : p.lastSuccessAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function HealthMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'ok' | 'warn' | 'bad' | 'neutral';
}) {
  const toneColor =
    tone === 'bad' ? 'text-red-600'
    : tone === 'warn' ? 'text-amber-600'
    : tone === 'ok' ? 'text-foreground'
    : 'text-muted-foreground';
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2">
      <p className={`text-sm font-semibold ${toneColor}`}>{value}</p>
      <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
    </div>
  );
}
