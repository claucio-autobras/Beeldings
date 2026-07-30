'use client';

import { Search } from 'lucide-react';
import type { DeviceStatus } from '@/mocks/data/devices.mock';

export type StatusFilter   = 'all' | DeviceStatus;
export type ProtocolFilter = 'all' | 'bacnet' | 'modbus' | 'mqtt';

interface SiteOption {
  id: string;
  name: string;
}

interface Props {
  search: string;
  status: StatusFilter;
  protocol: ProtocolFilter;
  siteId: string;
  sites: SiteOption[];
  onSearch: (v: string) => void;
  onStatus: (v: StatusFilter) => void;
  onProtocol: (v: ProtocolFilter) => void;
  onSite: (v: string) => void;
}

const selectCls = 'h-9 px-3 text-sm border border-border rounded-md bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer';

export default function DeviceFilters({ search, status, protocol, siteId, sites, onSearch, onStatus, onProtocol, onSite }: Props) {
  return (
    <div className="flex flex-wrap gap-3 items-center">
      {/* Busca */}
      <div className="relative flex-1 min-w-48">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          placeholder="Buscar dispositivo..."
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          className="w-full h-9 pl-9 pr-3 text-sm border border-border rounded-md bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
        />
      </div>

      {/* Status */}
      <select value={status} onChange={(e) => onStatus(e.target.value as StatusFilter)} className={selectCls}>
        <option value="all">Todos os status</option>
        <option value="online">Online</option>
        <option value="offline">Offline</option>
      </select>

      {/* Protocolo */}
      <select value={protocol} onChange={(e) => onProtocol(e.target.value as ProtocolFilter)} className={selectCls}>
        <option value="all">Todos os protocolos</option>
        <option value="bacnet">BACnet</option>
        <option value="modbus">Modbus</option>
        <option value="mqtt">MQTT</option>
      </select>

      {/* Local */}
      <select value={siteId} onChange={(e) => onSite(e.target.value)} className={selectCls}>
        <option value="all">Todos os sites</option>
        {sites.map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>
    </div>
  );
}
