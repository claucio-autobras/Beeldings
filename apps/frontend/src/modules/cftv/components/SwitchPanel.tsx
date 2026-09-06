'use client';

import { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { deviceTagKey, type TelemetryMap } from '@/hooks/useBacnetTelemetry';
import PasswordConfirmDialog from '@/components/PasswordConfirmDialog';
import {
  type DiscoveredPort,
  type ManagedSwitch,
  type SwitchSyncResult,
  deleteSwitchPort,
  syncSwitchPorts,
} from '../services/cftv.service';
import { formatUptime } from '../utils/telemetry-format';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Converte bytes/s para exibição amigável em Kbps ou Mbps. */
function formatBytesPerSec(bytesPerSec: number): string {
  const bits = bytesPerSec * 8;
  if (bits >= 1_000_000) return `${(bits / 1_000_000).toFixed(1)} Mbps`;
  if (bits >= 1_000) return `${Math.round(bits / 1_000)} Kbps`;
  if (bits > 0) return `${Math.round(bits)} bps`;
  return '0 bps';
}

/** Lê um valor ao vivo do switch (com fallback para o lastValue do ponto). */
function swLive(
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

/** Rótulo curto do estado SNMP operacional da porta. */
function operStatusLabel(status: number): string {
  if (status === 1) return 'Up';
  if (status === 2) return 'Down';
  return 'Desconhecido';
}

// ─── Componente ──────────────────────────────────────────────────────────────

interface Props {
  sw: ManagedSwitch;
  live: TelemetryMap;
  isAdmin: boolean;
  onClose: () => void;
  onRefresh: () => void;
}

export function SwitchPanel({ sw, live, isAdmin, onClose, onRefresh }: Props) {
  const queryClient = useQueryClient();
  const [syncResult, setSyncResult] = useState<SwitchSyncResult | null>(null);
  const [portToDelete, setPortToDelete] = useState<{ ifIndex: number; name: string } | null>(null);
  const [capOpen, setCapOpen] = useState(false);

  // ── Scalar live values ────────────────────────────────────────────────────

  const statusPoint = sw.points.find((p) => p.tag === 'STATUS');
  const uptimePoint = sw.points.find((p) => p.tag === 'UPTIME');
  const cpuPoint = sw.points.find((p) => p.tag === 'CPU');

  const statusLive = swLive(live, sw.id, 'STATUS', statusPoint?.lastValue ?? null, statusPoint?.lastValueAt ?? null);
  const uptimeLive = swLive(live, sw.id, 'UPTIME', uptimePoint?.lastValue ?? null, uptimePoint?.lastValueAt ?? null);
  const cpuLive = swLive(live, sw.id, 'CPU', cpuPoint?.lastValue ?? null, cpuPoint?.lastValueAt ?? null);

  const isOnline = typeof statusLive.value === 'number' ? statusLive.value >= 1 : sw.status === 'online';

  // ── Sync ports ────────────────────────────────────────────────────────────

  const syncMutation = useMutation({
    mutationFn: () => syncSwitchPorts(sw.id),
    onSuccess: (result) => {
      setSyncResult(result);
      queryClient.invalidateQueries({ queryKey: ['cftv-switches'] });
      onRefresh();
    },
  });

  // ── Delete port ───────────────────────────────────────────────────────────

  const deletePortMutation = useMutation({
    mutationFn: ({ ifIndex, token }: { ifIndex: number; token: string }) =>
      deleteSwitchPort(sw.id, ifIndex, token),
    onSuccess: () => {
      setPortToDelete(null);
      queryClient.invalidateQueries({ queryKey: ['cftv-switches'] });
      onRefresh();
    },
  });

  // ── Port rows (merged: DB ports + discovered-but-not-yet-synced) ──────────

  // If we have a sync result, use discovered ports for the table (they're richer).
  // Otherwise use the ports embedded in the switch object.
  const discoveredMap = new Map<number, DiscoveredPort>(
    (syncResult?.ports ?? []).map((p) => [p.ifIndex, p]),
  );
  const dbPorts = sw.ports; // from API (ifIndex + 3 point refs)

  // Combine: all DB ports (by ifIndex) + any discovered-only ports from last sync.
  const allIfIndexes = new Set<number>([
    ...dbPorts.map((p) => p.ifIndex),
    ...discoveredMap.keys(),
  ]);
  const sortedIndexes = [...allIfIndexes].sort((a, b) => a - b);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-xl">

        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-sm font-semibold text-foreground">{sw.name}</h3>
            <p className="text-xs text-muted-foreground">
              {sw.ip}:{sw.port} · SNMP v{sw.snmpVersion} · community &quot;{sw.community}&quot;
              {sw.site ? ` · ${sw.site}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Status badge */}
            <span
              className={[
                'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
                isOnline
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                  : 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400',
              ].join(' ')}
            >
              <span
                className={[
                  'h-1.5 w-1.5 rounded-full',
                  isOnline ? 'bg-emerald-500' : 'bg-red-500',
                ].join(' ')}
              />
              {isOnline ? 'Online' : 'Offline'}
            </span>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground hover:bg-muted"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">

          {/* Scalar metrics */}
          <div className="grid grid-cols-3 gap-3">
            {/* Uptime */}
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Uptime</p>
              {uptimePoint?.unsupported ? (
                <p className="text-sm text-muted-foreground">não suportado</p>
              ) : typeof uptimeLive.value === 'number' && Number.isFinite(uptimeLive.value) ? (
                <p className="text-sm font-medium text-foreground">{formatUptime(uptimeLive.value)}</p>
              ) : (
                <p className="text-sm text-muted-foreground">sem dados</p>
              )}
            </div>

            {/* CPU */}
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">CPU</p>
              {cpuPoint?.unsupported ? (
                <p className="text-sm text-muted-foreground">não suportado</p>
              ) : typeof cpuLive.value === 'number' && Number.isFinite(cpuLive.value) ? (
                <p className="text-sm font-medium text-foreground">{Math.round(cpuLive.value)}%</p>
              ) : (
                <p className="text-sm text-muted-foreground">sem dados</p>
              )}
            </div>

            {/* Port count */}
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Portas</p>
              <p className="text-sm font-medium text-foreground">
                {dbPorts.length > 0 ? dbPorts.length : '—'}
              </p>
              {dbPorts.length === 0 && (
                <p className="text-[10px] text-muted-foreground">sincronizar para listar</p>
              )}
            </div>
          </div>

          {/* Sync result banner */}
          {syncResult && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400 space-y-0.5">
              <p className="font-medium">Sincronização concluída</p>
              <p>
                {syncResult.added > 0 && `+${syncResult.added} porta${syncResult.added !== 1 ? 's' : ''} adicionada${syncResult.added !== 1 ? 's' : ''}  `}
                {syncResult.updated > 0 && `${syncResult.updated} atualizada${syncResult.updated !== 1 ? 's' : ''}  `}
                {syncResult.removed.length > 0 && `${syncResult.removed.length} removível${syncResult.removed.length !== 1 ? 's' : ''} (excluir manualmente se desejar)`}
                {syncResult.added === 0 && syncResult.updated === 0 && syncResult.removed.length === 0 && 'Nenhuma alteração.'}
              </p>
              {syncResult.sysDescr && (
                <p className="text-emerald-600/80 dark:text-emerald-400/70 text-[11px] font-mono truncate">
                  {syncResult.sysDescr}
                </p>
              )}
            </div>
          )}

          {syncMutation.error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
              {(syncMutation.error as Error).message}
            </div>
          )}

          {/* Ports table */}
          {sortedIndexes.length > 0 ? (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium text-foreground">
                  Portas ({sortedIndexes.length})
                </p>
              </div>
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground">#</th>
                      <th className="px-3 py-2 text-left text-[10px] font-medium text-muted-foreground">Interface</th>
                      <th className="px-2 py-2 text-center text-[10px] font-medium text-muted-foreground">Estado</th>
                      <th className="px-2 py-2 text-right text-[10px] font-medium text-muted-foreground">Vel.</th>
                      <th className="px-2 py-2 text-right text-[10px] font-medium text-muted-foreground">
                        <ArrowDown className="inline h-3 w-3" /> Entrada
                      </th>
                      <th className="px-2 py-2 text-right text-[10px] font-medium text-muted-foreground">
                        <ArrowUp className="inline h-3 w-3" /> Saída
                      </th>
                      {isAdmin && (
                        <th className="w-8 px-2 py-2" />
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {sortedIndexes.map((ifIndex) => {
                      const dbPort = dbPorts.find((p) => p.ifIndex === ifIndex);
                      const disc = discoveredMap.get(ifIndex);
                      const portName = disc
                        ? (disc.ifAlias?.trim() || disc.ifDescr?.trim() || `Porta ${ifIndex}`)
                        : (dbPort?.statePoint?.objectName?.replace(' — Status', '').replace(/ \(\d+Mbps\)/, '') ?? `Porta ${ifIndex}`);
                      const speedMbps = disc?.ifHighSpeed ?? null;
                      const existsInDb = disc ? disc.existsInDb : Boolean(dbPort);

                      // Live port state
                      const stateTag = dbPort?.statePoint?.tag ?? `PORT_${ifIndex}_STATUS`;
                      const inTag = dbPort?.inPoint?.tag ?? `PORT_${ifIndex}_IN`;
                      const outTag = dbPort?.outPoint?.tag ?? `PORT_${ifIndex}_OUT`;

                      const stateLive = swLive(
                        live, sw.id, stateTag,
                        dbPort?.statePoint?.lastValue ?? null,
                        dbPort?.statePoint?.lastValueAt ?? null,
                      );
                      const inLive = swLive(
                        live, sw.id, inTag,
                        dbPort?.inPoint?.lastValue ?? null,
                        dbPort?.inPoint?.lastValueAt ?? null,
                      );
                      const outLive = swLive(
                        live, sw.id, outTag,
                        dbPort?.outPoint?.lastValue ?? null,
                        dbPort?.outPoint?.lastValueAt ?? null,
                      );

                      // Oper status: from live or discovery
                      const operStatus =
                        typeof stateLive.value === 'number'
                          ? stateLive.value >= 1 ? 1 : 2
                          : (disc?.ifOperStatus ?? null);

                      const isUp = operStatus === 1;
                      const isDown = operStatus === 2;

                      return (
                        <tr key={ifIndex} className="hover:bg-muted/30">
                          <td className="px-3 py-2 text-muted-foreground tabular-nums">{ifIndex}</td>
                          <td className="max-w-[160px] px-3 py-2">
                            <span className="block truncate text-foreground">{portName}</span>
                            {!existsInDb && disc && (
                              <span className="text-[10px] text-amber-500">descoberta — sync necessário</span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-center">
                            <span
                              className={[
                                'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                                isUp
                                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400'
                                  : isDown
                                    ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-400'
                                    : 'bg-muted text-muted-foreground',
                              ].join(' ')}
                            >
                              <span
                                className={[
                                  'h-1.5 w-1.5 rounded-full',
                                  isUp ? 'bg-emerald-500' : isDown ? 'bg-red-500' : 'bg-slate-400',
                                ].join(' ')}
                              />
                              {operStatus !== null ? operStatusLabel(operStatus) : '—'}
                            </span>
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                            {speedMbps != null ? `${speedMbps}M` : '—'}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums text-foreground">
                            {typeof inLive.value === 'number' && Number.isFinite(inLive.value)
                              ? formatBytesPerSec(inLive.value)
                              : existsInDb ? <span className="text-muted-foreground">sem dados</span> : '—'}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums text-foreground">
                            {typeof outLive.value === 'number' && Number.isFinite(outLive.value)
                              ? formatBytesPerSec(outLive.value)
                              : existsInDb ? <span className="text-muted-foreground">sem dados</span> : '—'}
                          </td>
                          {isAdmin && (
                            <td className="px-2 py-2 text-center">
                              {existsInDb && (
                                <button
                                  type="button"
                                  onClick={() => setPortToDelete({ ifIndex, name: portName })}
                                  title="Remover porta"
                                  className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
              Nenhuma porta sincronizada. Use &quot;Sincronizar portas&quot; para descobrir as
              interfaces do switch via IF-MIB.
            </div>
          )}

          {/* Capabilities (collapsible) */}
          {isAdmin && (
            <div className="rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setCapOpen((o) => !o)}
                className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                <span>Capacidades monitoradas (base-switch)</span>
                {capOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              </button>
              {capOpen && (
                <div className="border-t border-border px-3 pb-3 pt-2">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    {[
                      { key: 'uptime', label: 'Uptime (sysUpTime)', point: uptimePoint },
                      { key: 'cpu', label: 'CPU (hrProcessorLoad)', point: cpuPoint },
                      { key: 'if_oper_status', label: 'Estado das portas (IF-MIB)', point: null },
                      { key: 'if_in_octets', label: 'Tráfego entrada (ifInOctets)', point: null },
                      { key: 'if_out_octets', label: 'Tráfego saída (ifOutOctets)', point: null },
                    ].map(({ key, label, point }) => (
                      <div key={key} className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">{label}</span>
                        <span
                          className={
                            point?.unsupported
                              ? 'text-muted-foreground'
                              : 'text-emerald-600 dark:text-emerald-400'
                          }
                        >
                          {point?.unsupported ? 'Não suportado' : 'IF-MIB'}
                        </span>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Use &quot;Sonde Capacidades&quot; na lista de switches para atualizar.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {isAdmin && (
          <div className="shrink-0 border-t border-border px-5 py-3 flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted-foreground">
              Sincronizar descobre novas portas via IF-MIB e atualiza nomes de portas existentes.
            </p>
            <button
              type="button"
              onClick={() => { setSyncResult(null); syncMutation.mutate(); }}
              disabled={syncMutation.isPending}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
            >
              {syncMutation.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RefreshCw className="h-3.5 w-3.5" />}
              {syncMutation.isPending ? 'Sincronizando…' : 'Sincronizar portas'}
            </button>
          </div>
        )}
      </div>

      {/* Porta: confirmação de remoção */}
      {portToDelete && (
        <PasswordConfirmDialog
          title={`Remover porta "${portToDelete.name}" (ifIndex ${portToDelete.ifIndex})?`}
          description={
            <>
              Os 3 pontos desta porta (estado, tráfego entrada e saída) serão
              excluídos permanentemente. Tendências e alarmes configurados nesses
              pontos também serão removidos.
            </>
          }
          isPending={deletePortMutation.isPending}
          error={
            deletePortMutation.error ? (deletePortMutation.error as Error).message : null
          }
          onCancel={() => { setPortToDelete(null); deletePortMutation.reset(); }}
          onConfirm={(token) =>
            deletePortMutation.mutate({ ifIndex: portToDelete.ifIndex, token })
          }
        />
      )}
    </div>
  );
}
