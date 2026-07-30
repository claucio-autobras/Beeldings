'use client';

import { ArrowRight, CheckCircle2, Network, Pencil, Radio, Wifi, XCircle, type LucideIcon } from 'lucide-react';
import type { Device, DeviceStatus } from '@/mocks/data/devices.mock';
import { CriticalStarButton } from '@/components/CriticalStarButton';
import { formatLastCommunication } from '../utils/formatters';

// ─── Metadados visuais por protocolo ────────────────────────────────────────────

interface ProtocolMeta {
  label: string;
  badge: string;
  iconWrap: string;
  icon: LucideIcon;
}

const protocolMetaMap: Record<Device['protocol'], ProtocolMeta> = {
  bacnet: { label: 'BACnet', badge: 'bg-cyan-50 text-cyan-700 border-cyan-200',   iconWrap: 'bg-cyan-50 border-cyan-200 text-cyan-700',   icon: Wifi },
  modbus: { label: 'Modbus', badge: 'bg-violet-50 text-violet-700 border-violet-200', iconWrap: 'bg-violet-50 border-violet-200 text-violet-600', icon: Network },
  mqtt:   { label: 'MQTT',   badge: 'bg-sky-50 text-sky-700 border-sky-200',       iconWrap: 'bg-sky-50 border-sky-200 text-sky-600',     icon: Radio },
};

// ─── Status config ─────────────────────────────────────────────────────────────

const statusConfig: Record<DeviceStatus, { dot: string; label: string }> = {
  online:  { dot: 'bg-emerald-500', label: 'Online'  },
  offline: { dot: 'bg-red-500',     label: 'Offline' },
};

// Borda colorida por status — modo cliente
const statusBorder: Record<DeviceStatus, string> = {
  online:  'border-emerald-400',
  offline: 'border-red-400',
};

// Ícone de status — modo cliente
function StatusIcon({ status }: { status: DeviceStatus }) {
  if (status === 'online') {
    return <CheckCircle2 className="h-10 w-10 text-emerald-500" />;
  }
  return <XCircle className="h-10 w-10 text-red-500" />;
}

// Label amigável — modo cliente
const statusFriendly: Record<DeviceStatus, { text: string; cls: string }> = {
  online:  { text: 'Conectado',    cls: 'text-emerald-600' },
  offline: { text: 'Desconectado', cls: 'text-red-600'     },
};

// ─── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  device: Device;
  onSelect: (device: Device) => void;
  onEdit: (device: Device) => void;
  /** Marca/desmarca o dispositivo como ativo crítico (dashboard). */
  onToggleCritical?: (device: Device) => void;
  togglingCritical?: boolean;
  isClientView: boolean;
}

// ─── Componente ────────────────────────────────────────────────────────────────

export default function DeviceListCard({ device, onSelect, onEdit, onToggleCritical, togglingCritical, isClientView }: Props) {
  const status = statusConfig[device.status] ?? statusConfig.offline;
  const meta   = protocolMetaMap[device.protocol] ?? protocolMetaMap.bacnet;
  const Icon   = meta.icon;

  // ── Modo cliente ──────────────────────────────────────────────────────────
  if (isClientView) {
    const friendly = statusFriendly[device.status] ?? statusFriendly.offline;
    return (
      <div className={`bg-card border-2 ${statusBorder[device.status] ?? statusBorder.offline} rounded-xl p-5 flex flex-col gap-4 transition-all duration-200 hover:shadow-lg hover:-translate-y-0.5`}>
        {/* Topo: ícone + nome + local */}
        <div className="flex items-center gap-4">
          <div className="shrink-0">
            <StatusIcon status={device.status} />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground text-base leading-tight truncate">
              {device.name}
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5 truncate">{device.site}</p>
          </div>
        </div>

        {/* Rodapé: badge protocolo + status amigável */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${meta.badge}`}>
            {meta.label}
          </span>
          <span className={`text-xs font-medium ${friendly.cls}`}>
            {friendly.text}
          </span>
        </div>
      </div>
    );
  }

  // ── Modo admin/técnico ────────────────────────────────────────────────────
  return (
    <div
      className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3 hover:shadow-md transition-shadow cursor-pointer group min-h-[140px]"
      onClick={() => onSelect(device)}
    >
      {/* Header: ícone + nome + badges */}
      <div className="flex items-start gap-3">
        <div className={`rounded-lg p-2.5 border shrink-0 ${meta.iconWrap}`}>
          <Icon className="h-5 w-5" />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-foreground text-sm break-words min-w-0">{device.name}</h3>

            {/* Badge protocolo */}
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${meta.badge}`}>
              {meta.label}
            </span>

            {/* Badge tipo — Modbus */}
            {device.protocol === 'modbus' && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border border-border text-muted-foreground">
                {device.equipmentType}
              </span>
            )}
          </div>

          <p className="text-xs text-muted-foreground mt-0.5 truncate">{device.site}</p>
        </div>
      </div>

      {/* Body: status + IP + última comunicação + pontos */}
      <div className="flex items-center gap-4 flex-wrap text-xs text-muted-foreground pl-0.5">
        {/* Status */}
        <span className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${status.dot}`} />
          {status.label}
        </span>

        {/* IP — apenas protocolos com endereço de rede (MQTT não tem) */}
        {device.protocol !== 'mqtt' && (
          <span className="font-mono break-all">
            {device.protocol === 'modbus' && device.connectionType === 'rtu'
              ? `${device.serial?.path ?? device.ip} (RS485)`
              : `${device.ip}:${device.port}`}
          </span>
        )}

        {/* Última comunicação */}
        <span>{formatLastCommunication(device.lastCommunication)}</span>

        {/* Contagem de pontos */}
        <span>
          {device.points?.length ?? 0} ponto{(device.points?.length ?? 0) !== 1 ? 's' : ''}{' '}
          {meta.label}
        </span>
      </div>

      {/* Footer: botões */}
      <div className="flex items-center gap-2 mt-auto">
        <button
          className="flex items-center gap-1 text-xs font-medium text-primary opacity-60 group-hover:opacity-100 transition-opacity hover:underline"
          onClick={(e) => { e.stopPropagation(); onSelect(device); }}
        >
          Ver pontos
          <ArrowRight className="h-3.5 w-3.5" />
        </button>

        <button
          className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors opacity-60 group-hover:opacity-100"
          onClick={(e) => { e.stopPropagation(); onEdit(device); }}
          title="Editar dispositivo"
        >
          <Pencil className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Editar</span>
        </button>

        {onToggleCritical && (
          <span className="ml-auto opacity-60 group-hover:opacity-100 transition-opacity">
            <CriticalStarButton
              critical={!!device.critical}
              busy={togglingCritical}
              size={15}
              onToggle={() => onToggleCritical(device)}
            />
          </span>
        )}
      </div>
    </div>
  );
}
