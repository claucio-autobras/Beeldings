'use client';

import { useState } from 'react';
import { FlaskConical, ChevronDown, ChevronUp } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { setVirtualPointValue } from '../services/simulator.service';
import { VirtualPointControl } from './VirtualPointControl';
import type { ScreenDevice, VirtualDevice, VirtualPoint } from '../types/virtual.types';

interface Props {
  devices: ScreenDevice[];
  projectId?: string;
  /** Posição do painel flutuante (ex.: 'bottom-3 right-3' / 'bottom-10 right-3'). */
  positionClassName?: string;
}

const EDITOR_ROLES = new Set(['ADMIN', 'CCO', 'SUPERVISOR']);

function isVirtual(d: ScreenDevice): d is VirtualDevice {
  return d.protocol === 'virtual';
}

/**
 * Painel flutuante (tema escuro) da bancada, exibido no preview/viewer apenas
 * para operadores (ADMIN/CCO/SUPERVISOR). Lista os pontos virtuais do projeto e
 * permite alterar valores ao vivo. Só renderiza se houver ao menos um ponto.
 */
export function ViewerBenchPanel({ devices, projectId, positionClassName = 'bottom-3 right-3' }: Props) {
  const user = useCurrentUser();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const virtualDevices = devices.filter(isVirtual);
  const entries: { device: VirtualDevice; point: VirtualPoint }[] = virtualDevices
    .flatMap((device) => device.points.map((point) => ({ device, point })))
    .sort((a, b) => a.point.tag.localeCompare(b.point.tag));

  const setValue = useMutation({
    mutationFn: ({ deviceId, pointId, value }: { deviceId: string; pointId: string; value: number | boolean }) =>
      setVirtualPointValue(deviceId, pointId, value),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['scada-virtual-devices', projectId] });
    },
  });

  if (!EDITOR_ROLES.has(user.role)) return null;
  if (entries.length === 0) return null;

  return (
    <div className={`scada-dark-chrome absolute z-40 ${positionClassName}`}>
      {open ? (
        <div className="w-64 rounded-lg border border-slate-700 bg-slate-900/95 shadow-xl backdrop-blur">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex w-full items-center justify-between rounded-t-lg border-b border-slate-700 px-3 py-2 text-left"
          >
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-cyan-400">
              <FlaskConical className="h-3.5 w-3.5" /> Bancada
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          </button>
          <ul className="max-h-72 overflow-y-auto p-2">
            {entries.map(({ device, point }) => (
              <li key={point.id} className="flex items-center justify-between gap-2 py-1.5">
                <div className="min-w-0">
                  <p className="truncate text-xs text-slate-200">{point.tag}</p>
                  <p className="text-[9px] text-slate-500">{point.objectType}</p>
                </div>
                <VirtualPointControl
                  point={point}
                  dark
                  disabled={setValue.isPending}
                  onChange={(value) => setValue.mutate({ deviceId: device.id, pointId: point.id, value })}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-900/95 px-3 py-1.5 text-[11px] font-medium text-cyan-400 shadow-xl backdrop-blur hover:bg-slate-800"
        >
          <FlaskConical className="h-3.5 w-3.5" /> Bancada
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
