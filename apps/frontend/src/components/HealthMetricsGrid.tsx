'use client';

import { useState } from 'react';
import {
  Cpu,
  Gauge,
  HardDrive,
  MemoryStick,
  Network,
  Thermometer,
  Trash2,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import type { HealthTile } from './health-metrics';
import { isHealthTileRemovable } from './health-metrics';

const TILE_ICONS: Record<string, LucideIcon> = {
  cpu: Cpu,
  memory_used: Gauge,
  memory_avail: MemoryStick,
  ram_total: MemoryStick,
  temperature: Thermometer,
  packet_loss: Network,
  ping_loss: Wifi,
  storage: HardDrive,
};

function barColor(pct: number): string {
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 75) return 'bg-amber-500';
  return 'bg-primary';
}

export function HealthMetricsGrid({
  tiles,
  canRemove = false,
  onRemovePoint,
}: {
  tiles: HealthTile[];
  canRemove?: boolean;
  onRemovePoint?: (pointId: string, pointLabel: string) => void;
}) {
  const [pendingRemove, setPendingRemove] = useState<HealthTile | null>(null);
  if (tiles.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-2">
      {tiles.map((tile) => {
        const Icon = TILE_ICONS[tile.key] ?? Gauge;
        const hasValue = tile.text !== null;
        return (
          <div
            key={tile.key}
            className="min-w-0 rounded-lg border border-border bg-muted/30 px-2.5 py-2"
            title={
              tile.unreliable
                ? 'Dado não confiável — o firmware responde um valor fixo neste OID.'
                : tile.emptyState === 'não suportado'
                  ? 'O equipamento não expõe esta métrica via SNMP (último diagnóstico).'
                  : tile.title
            }
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <Icon
                className={`h-3.5 w-3.5 shrink-0 ${hasValue ? 'text-primary' : 'text-muted-foreground/60'}`}
              />
              <p className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {tile.label}
              </p>
              {canRemove && onRemovePoint && isHealthTileRemovable(tile) && (
                <button
                  type="button"
                  className="ml-auto shrink-0 rounded p-0.5 text-muted-foreground/60 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10"
                  title={`Remover ponto ${tile.label}`}
                  aria-label={`Remover ponto ${tile.label}`}
                  onClick={() => setPendingRemove(tile)}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
            <p
              className={[
                'mt-0.5 truncate text-sm font-semibold',
                tile.unreliable
                  ? 'text-amber-600 dark:text-amber-400'
                  : hasValue
                    ? 'text-foreground'
                    : 'text-muted-foreground text-xs font-normal',
              ].join(' ')}
            >
              {hasValue ? `${tile.text}${tile.unreliable ? ' ⚠' : ''}` : tile.emptyState}
            </p>
            {tile.pct !== null && (
              <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className={`h-full rounded-full transition-all ${barColor(tile.pct)}`}
                  style={{ width: `${tile.pct}%` }}
                />
              </div>
            )}
          </div>
        );
      })}
      {pendingRemove && (
        <div className="col-span-2 space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
          <p className="font-medium">Remover “{pendingRemove.label}”?</p>
          <p>Alarmes e histórico deste ponto serão apagados permanentemente.</p>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-md bg-red-600 px-2.5 py-1 font-medium text-white hover:bg-red-700"
              onClick={() => {
                onRemovePoint?.(pendingRemove.pointId as string, pendingRemove.label);
                setPendingRemove(null);
              }}
            >
              Remover
            </button>
            <button
              type="button"
              className="rounded-md border border-border px-2.5 py-1 font-medium text-muted-foreground hover:bg-muted"
              onClick={() => setPendingRemove(null)}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}