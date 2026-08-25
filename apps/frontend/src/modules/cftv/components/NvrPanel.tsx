'use client';

import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  HardDrive,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { deviceTagKey, type TelemetryMap } from '@/hooks/useBacnetTelemetry';
import {
  type ManagedNvr,
  type NvrSyncResult,
  syncNvrDisks,
  getNvrCapabilities,
  type MetricCapability,
} from '../services/cftv.service';
import { formatUptime } from '../utils/telemetry-format';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Lê um valor ao vivo do NVR (com fallback para lastValue do ponto). */
function nvrLive(
  live: TelemetryMap,
  deviceId: string,
  tag: string,
  lastValue: number | null,
  lastValueAt: string | null,
): { value: number | null; ts: string | null } {
  const entry = live.get(deviceTagKey(deviceId, tag));
  if (entry) {
    return { value: typeof entry.value === 'number' ? entry.value : null, ts: entry.timestamp };
  }
  return { value: lastValue, ts: lastValueAt };
}

const DISK_STATUS_LABELS: Record<number, string> = {
  0: 'Sem disco',
  1: 'Normal',
  2: 'Erro',
  3: 'Não formatado',
  4: 'Inicializando',
};

const CHANNEL_STATUS_LABELS: Record<number, string> = {
  0: 'Offline',
  1: 'Idle',
  2: 'Gravando',
  3: 'Alarme',
};

function diskStatusColor(status: number | null): string {
  if (status === 1) return 'text-emerald-600 dark:text-emerald-400';
  if (status === 2) return 'text-red-600 dark:text-red-400';
  if (status === null) return 'text-muted-foreground';
  return 'text-amber-600 dark:text-amber-400';
}

function channelStatusColor(status: number | null): string {
  if (status === 1 || status === 2) return 'text-emerald-600 dark:text-emerald-400';
  if (status === 0) return 'text-red-600 dark:text-red-400';
  if (status === 3) return 'text-amber-600 dark:text-amber-400';
  return 'text-muted-foreground';
}

// ─── Componente ───────────────────────────────────────────────────────────────

interface Props {
  nvr: ManagedNvr;
  live: TelemetryMap;
  isAdmin: boolean;
  onClose: () => void;
  onRefresh: () => void;
}

export function NvrPanel({ nvr, live, isAdmin, onClose, onRefresh }: Props) {
  const queryClient = useQueryClient();
  const [syncResult, setSyncResult] = useState<NvrSyncResult | null>(null);
  const [capOpen, setCapOpen] = useState(false);

  // ── Scalar live values ────────────────────────────────────────────────────

  const statusPoint = nvr.points.find((p) => p.tag === 'STATUS');
  const uptimePoint = nvr.points.find((p) => p.tag === 'UPTIME');
  const cpuPoint = nvr.points.find((p) => p.tag === 'CPU');
  const memoriaPoint = nvr.points.find((p) => p.tag === 'MEMORIA');
  const temperaturaPoint = nvr.points.find((p) => p.tag === 'TEMPERATURA');

  const statusLive = nvrLive(live, nvr.id, 'STATUS', statusPoint?.lastValue ?? null, statusPoint?.lastValueAt ?? null);
  const uptimeLive = nvrLive(live, nvr.id, 'UPTIME', uptimePoint?.lastValue ?? null, uptimePoint?.lastValueAt ?? null);
  const cpuLive = nvrLive(live, nvr.id, 'CPU', cpuPoint?.lastValue ?? null, cpuPoint?.lastValueAt ?? null);
  const memoriaLive = nvrLive(live, nvr.id, 'MEMORIA', memoriaPoint?.lastValue ?? null, memoriaPoint?.lastValueAt ?? null);
  const temperaturaLive = nvrLive(live, nvr.id, 'TEMPERATURA', temperaturaPoint?.lastValue ?? null, temperaturaPoint?.lastValueAt ?? null);

  const isOnline = typeof statusLive.value === 'number' ? statusLive.value >= 1 : nvr.status === 'online';

  // ── Sync disks ────────────────────────────────────────────────────────────

  const syncMutation = useMutation({
    mutationFn: () => syncNvrDisks(nvr.id),
    onSuccess: (result) => {
      setSyncResult(result);
      queryClient.invalidateQueries({ queryKey: ['cftv-nvrs'] });
      onRefresh();
    },
  });

  // ── Capabilities ──────────────────────────────────────────────────────────

  const { data: capabilities = [] } = useQuery<MetricCapability[]>({
    queryKey: ['nvr-capabilities', nvr.id],
    queryFn: () => getNvrCapabilities(nvr.id),
    enabled: capOpen,
  });

  const capByKey = new Map(capabilities.map((c) => [c.metricKey, c]));

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/30 p-4">
      <div className="flex h-full w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-xl overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <div className={[
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-md',
              isOnline
                ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400'
                : 'bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400',
            ].join(' ')}>
              <HardDrive className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{nvr.name}</p>
              <p className="text-xs text-muted-foreground">{nvr.ip}:{nvr.port} — {nvr.profileLabel}</p>
            </div>
          </div>
          <button onClick={onClose} className="ml-2 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5">

          {/* Métricas escalares */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Saúde do equipamento
            </p>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg border border-border bg-background px-3 py-2">
                <p className="text-[11px] text-muted-foreground mb-0.5">Status</p>
                <p className={isOnline ? 'font-medium text-emerald-600 dark:text-emerald-400' : 'font-medium text-red-600 dark:text-red-400'}>
                  {isOnline ? 'Online' : 'Offline'}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-background px-3 py-2">
                <p className="text-[11px] text-muted-foreground mb-0.5">Uptime</p>
                <p className="font-medium text-foreground font-mono text-xs">
                  {uptimeLive.value !== null ? formatUptime(uptimeLive.value) : '—'}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-background px-3 py-2">
                <p className="text-[11px] text-muted-foreground mb-0.5">CPU</p>
                <p className="font-medium text-foreground font-mono text-xs">
                  {cpuLive.value !== null ? `${Math.round(cpuLive.value)}%` : '—'}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-background px-3 py-2">
                <p className="text-[11px] text-muted-foreground mb-0.5">Memória RAM</p>
                <p className="font-medium text-foreground font-mono text-xs">
                  {memoriaLive.value !== null ? `${Math.round(memoriaLive.value)} kB` : '—'}
                </p>
              </div>
              {temperaturaLive.value !== null && (
                <div className="rounded-lg border border-border bg-background px-3 py-2">
                  <p className="text-[11px] text-muted-foreground mb-0.5">Temperatura</p>
                  <p className="font-medium text-foreground font-mono text-xs">
                    {temperaturaLive.value.toFixed(1)} °C
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Discos */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Discos ({nvr.disks.length})
              </p>
              {isAdmin && (
                <button
                  onClick={() => { if (!syncMutation.isPending) syncMutation.mutate(); }}
                  disabled={syncMutation.isPending || !nvr.gatewayId}
                  title={!nvr.gatewayId ? 'NVR sem gateway associado' : 'Sincronizar discos e canais via SNMP'}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                >
                  {syncMutation.isPending
                    ? <><Loader2 className="h-3 w-3 animate-spin" /> Sincronizando…</>
                    : <><RefreshCw className="h-3 w-3" /> Sync discos/canais</>
                  }
                </button>
              )}
            </div>

            {syncMutation.error && (
              <p className="mb-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
                {(syncMutation.error as Error).message}
              </p>
            )}

            {syncResult && (
              <p className="mb-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
                Sync concluído: {syncResult.added} novos pontos, {syncResult.updatedDisks} discos atualizados, {syncResult.updatedChannels} canais atualizados.
                {syncResult.sysDescr && (
                  <span className="block mt-0.5 text-muted-foreground">{syncResult.sysDescr}</span>
                )}
              </p>
            )}

            {nvr.disks.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                Nenhum disco sincronizado.
                {isAdmin && ' Use "Sync discos/canais" para descobrir via SNMP.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="py-1 pr-3 text-left font-medium text-muted-foreground">Slot</th>
                      <th className="py-1 pr-3 text-left font-medium text-muted-foreground">Status</th>
                      <th className="py-1 pr-3 text-right font-medium text-muted-foreground">Cap. (GB)</th>
                      <th className="py-1 text-right font-medium text-muted-foreground">Usado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nvr.disks.map((disk) => {
                      const statusValue = disk.statusPoint?.lastValue ?? null;
                      const statusNum = typeof statusValue === 'number' ? statusValue : null;
                      return (
                        <tr key={disk.slotIndex} className="border-b border-border/50 last:border-0">
                          <td className="py-1.5 pr-3 font-mono">{disk.slotIndex}</td>
                          <td className={`py-1.5 pr-3 ${diskStatusColor(statusNum)}`}>
                            {statusNum !== null
                              ? (DISK_STATUS_LABELS[statusNum] ?? String(statusNum))
                              : '—'}
                          </td>
                          <td className="py-1.5 pr-3 text-right font-mono">
                            {disk.capPoint?.lastValue !== null && disk.capPoint?.lastValue !== undefined
                              ? disk.capPoint.lastValue.toFixed(0)
                              : '—'}
                          </td>
                          <td className="py-1.5 text-right font-mono">
                            {disk.usedPoint?.lastValue !== null && disk.usedPoint?.lastValue !== undefined
                              ? `${disk.usedPoint.lastValue.toFixed(0)} ${disk.usedPoint.unit ?? 'GB'}`
                              : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Canais de gravação */}
          <div>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Canais de gravação ({nvr.channels.length})
            </p>
            {nvr.channels.length === 0 ? (
              <p className="text-xs text-muted-foreground py-2">
                Nenhum canal sincronizado.
                {isAdmin && ' Use "Sync discos/canais" para descobrir via SNMP.'}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="py-1 pr-3 text-left font-medium text-muted-foreground">Canal</th>
                      <th className="py-1 text-left font-medium text-muted-foreground">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nvr.channels.map((chan) => {
                      const chanNum = typeof chan.lastValue === 'number' ? chan.lastValue : null;
                      return (
                        <tr key={chan.channelIndex} className="border-b border-border/50 last:border-0">
                          <td className="py-1.5 pr-3 font-mono">{chan.channelIndex}</td>
                          <td className={`py-1.5 ${channelStatusColor(chanNum)}`}>
                            {chanNum !== null
                              ? (CHANNEL_STATUS_LABELS[chanNum] ?? String(chanNum))
                              : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Capacidades */}
          <div>
            <button
              onClick={() => setCapOpen((v) => !v)}
              className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2 text-xs font-medium text-foreground hover:bg-muted"
            >
              <span>Capacidades detectadas</span>
              {capOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
            {capOpen && (
              <div className="mt-2 space-y-1">
                {capabilities.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-1">
                    Nenhuma capacidade registrada. Use &quot;Probe capabilities&quot; para detectar.
                  </p>
                ) : (
                  capabilities.map((c) => (
                    <div key={c.metricKey} className="flex items-center justify-between gap-3 px-1 text-xs">
                      <span className="text-muted-foreground">{c.metricKey}</span>
                      <span className={[
                        'rounded px-1.5 py-0.5 font-medium',
                        c.state === 'SUPPORTED'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                          : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
                      ].join(' ')}>
                        {c.state === 'SUPPORTED' ? 'Suportado' : 'Não suportado'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
