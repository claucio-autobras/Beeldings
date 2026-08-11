'use client';

import Link from 'next/link';
import { Cpu, ChevronRight } from 'lucide-react';
import { useT } from '@/lib/i18n';
import type { Device } from '@/modules/devices/types/device.types';
import type { Alarm } from '@/modules/alarms/types/alarm.types';

interface DeviceAreaTableProps {
  devices: Device[];
  /** Alarmes ativos (status ALARME) do escopo, para a coluna "Alarme". */
  activeAlarms: Alarm[];
  isLoading?: boolean;
}

interface AreaRow {
  area: string;
  online: number;
  offline: number;
  alarm: number;
  total: number;
}

/**
 * "Status dos Dispositivos" (visão Cliente): distribuição online/alarme/offline
 * agrupada por site/área — o agrupamento real disponível no cadastro (não há
 * taxonomia de tipo HVAC/Energia). Linhas clicáveis levam à tela de Dispositivos.
 */
export function DeviceAreaTable({ devices, activeAlarms, isLoading }: DeviceAreaTableProps) {
  const t = useT();
  const alarmedDeviceIds = new Set(activeAlarms.map((a) => a.deviceId));

  const rowsByArea = new Map<string, AreaRow>();
  for (const d of devices) {
    const area = d.site || t('Sem site');
    let row = rowsByArea.get(area);
    if (!row) {
      row = { area, online: 0, offline: 0, alarm: 0, total: 0 };
      rowsByArea.set(area, row);
    }
    row.total += 1;
    if (d.status === 'online') row.online += 1;
    else row.offline += 1;
    if (alarmedDeviceIds.has(d.id)) row.alarm += 1;
  }
  const rows = [...rowsByArea.values()].sort((a, b) => b.total - a.total);

  return (
    <div className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center justify-between gap-2 p-4 pb-2">
        <div>
          <h2 className="text-sm font-medium text-foreground">{t('Status dos Dispositivos')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('Distribuição por Site em tempo real')}</p>
        </div>
        <Link
          href="/devices"
          className="inline-flex items-center gap-0.5 text-xs font-medium text-cyan-700 transition-colors hover:text-cyan-800"
        >
          {t('Ver todos')} <ChevronRight size={14} />
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-2 p-4 animate-pulse">
          <div className="h-9 rounded bg-muted" />
          <div className="h-9 rounded bg-muted" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 p-8 text-center">
          <Cpu size={26} strokeWidth={1.5} className="text-muted-foreground/50" />
          <p className="text-sm font-medium text-foreground">{t('Nenhum dispositivo cadastrado')}</p>
          <p className="text-xs text-muted-foreground">{t('Cadastre dispositivos na tela de Dispositivos')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-y border-border bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">{t('Site')}</th>
                <th className="w-[220px] px-4 py-2.5 font-medium">{t('Distribuição')}</th>
                <th className="px-4 py-2.5 text-center font-medium">{t('Online')}</th>
                <th className="px-4 py-2.5 text-center font-medium">{t('Offline')}</th>
                <th className="px-4 py-2.5 text-center font-medium">{t('Alarme')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((row) => (
                <tr key={row.area} className="transition-colors hover:bg-muted/40">
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2 font-medium text-foreground">
                      <Cpu size={15} className="shrink-0 text-muted-foreground" />
                      <span className="truncate">{row.area}</span>
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-emerald-500"
                        style={{ width: `${(row.online / row.total) * 100}%` }}
                      />
                      <div
                        className="h-full bg-red-500"
                        style={{ width: `${(row.offline / row.total) * 100}%` }}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-xs tabular-nums text-emerald-600">{row.online}</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`text-xs tabular-nums ${
                        row.offline > 0 ? 'text-red-600' : 'text-muted-foreground/60'
                      }`}
                    >
                      {row.offline}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`text-xs tabular-nums ${
                        row.alarm > 0 ? 'text-orange-600' : 'text-muted-foreground/60'
                      }`}
                    >
                      {row.alarm}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
