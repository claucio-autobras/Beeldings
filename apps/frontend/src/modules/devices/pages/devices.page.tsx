'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Network, Plus, Radio, Wifi } from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useTenantFilter } from '@/hooks/useTenantFilter';
import { useSiteFilter } from '@/hooks/useSiteFilter';
import type { BACnetDevice, Device, ModbusDevice, MqttDevice } from '@/mocks/data/devices.mock';
import { useSites } from '@/modules/sites/hooks/useSites';
import {
  AddBACnetDeviceModal,
  AddModbusDeviceModal,
  AddMqttDeviceModal,
  BACnetDeviceDetail,
  DeviceFilters,
  DeviceListCard,
  EditBACnetDeviceModal,
  EditModbusDeviceModal,
  EditMqttDeviceModal,
  FallbackDeviceDeleteDialog,
  ModbusDeviceDetail,
  MqttDeviceDetail,
  type ProtocolFilter,
  type StatusFilter,
} from '../components/devices.component';
import { useDevices } from '../hooks/useDevices';
import { setDeviceCritical } from '../services/devices.service';

// ─── Página principal ────────────────────────────────────────────────────────

export default function DevicesPage() {
  const user = useCurrentUser();
  const isAdmin = user.role === 'ADMIN' || user.role === 'CCO' || user.role === 'SUPERVISOR';

  const { selectedTenantId } = useTenantFilter();
  const { selectedSiteId, setSite } = useSiteFilter();

  const effectiveTenantId = isAdmin
    ? (selectedTenantId ?? undefined)
    : (user.tenantId ?? undefined);

  // O filtro de site da página é o filtro global (single source of truth).
  const siteFilter = selectedSiteId ?? 'all';

  const queryClient = useQueryClient();
  const { data, isLoading } = useDevices(effectiveTenantId);
  const { data: sites = [] } = useSites(effectiveTenantId);

  // Devices locais adicionados sem refetch
  const [localDevices, setLocalDevices] = useState<Device[]>([]);
  const allDevices = useMemo(() => {
    const base = data ?? [];
    const baseIds = new Set(base.map((d) => d.id));
    // Exclui locais que já foram retornados pelo refetch (evita duplicate key)
    const locals = localDevices.filter(
      (d) => !baseIds.has(d.id) && (!effectiveTenantId || d.tenantId === effectiveTenantId),
    );
    return [...base, ...locals];
  }, [data, localDevices, effectiveTenantId]);

  // Detalhe selecionado
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);

  // Deep-link do card Ativos Críticos (perfil técnico): ?deviceId=…&pointId=…
  // abre direto o detalhe do dispositivo com o ponto em destaque.
  const searchParams = useSearchParams();
  const deepLinkDeviceId = searchParams.get('deviceId');
  const deepLinkPointId = searchParams.get('pointId');
  const [highlightPointId, setHighlightPointId] = useState<string | null>(null);
  const deepLinkConsumed = useRef(false);
  useEffect(() => {
    // Detalhe técnico é do perfil técnico — cliente ignora o deep-link.
    if (!isAdmin || deepLinkConsumed.current || !deepLinkDeviceId || !data) return;
    const target = data.find((d) => d.id === deepLinkDeviceId);
    if (!target) return;
    deepLinkConsumed.current = true;
    setHighlightPointId(deepLinkPointId);
    setSelectedDevice(target);
  }, [isAdmin, data, deepLinkDeviceId, deepLinkPointId]);

  // Toggle de ativo crítico (estrela) — reflete imediatamente no cache.
  const [togglingCriticalId, setTogglingCriticalId] = useState<string | null>(null);
  async function handleToggleCritical(device: Device) {
    const next = !device.critical;
    setTogglingCriticalId(device.id);
    try {
      await setDeviceCritical(device.id, next);
      setLocalDevices((prev) => prev.map((d) => (d.id === device.id ? { ...d, critical: next } : d)));
      queryClient.setQueriesData<Device[]>({ queryKey: ['devices'] }, (old) =>
        old?.map((d) => (d.id === device.id ? { ...d, critical: next } : d)),
      );
      // Refetch do servidor: evita que um refetch em voo (iniciado antes do
      // PATCH) sobrescreva o cache com o estado antigo da estrela.
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-critical-assets'] });
    } catch {
      // Sem toast dedicado aqui: a estrela simplesmente não muda.
    } finally {
      setTogglingCriticalId(null);
    }
  }

  // Filtros
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [protocolFilter, setProtocolFilter] = useState<ProtocolFilter>('all');

  const filtered = useMemo(() => allDevices.filter((d) => {
    if (search && !d.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== 'all' && d.status !== statusFilter) return false;
    if (protocolFilter !== 'all' && d.protocol !== protocolFilter) return false;
    if (siteFilter !== 'all' && d.siteId !== siteFilter) return false;
    return true;
  }), [allDevices, search, statusFilter, protocolFilter, siteFilter]);

  const selectedSiteName = siteFilter !== 'all'
    ? (sites.find((s) => s.id === siteFilter)?.name ?? 'Site')
    : null;

  // Dropdown adicionar
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [bacnetModalOpen, setBacnetModalOpen] = useState(false);
  const [modbusModalOpen, setModbusModalOpen] = useState(false);
  const [mqttModalOpen, setMqttModalOpen] = useState(false);

  // Edição
  const [deviceToEdit, setDeviceToEdit] = useState<Device | null>(null);

  function handleDeviceCreated(device: Device) {
    setLocalDevices((prev) => [...prev, device]);
  }

  function handleDeviceUpdated(updated: BACnetDevice | ModbusDevice | MqttDevice) {
    setLocalDevices((prev) =>
      prev.map((d) => d.id === updated.id ? (updated as Device) : d),
    );
    if (selectedDevice?.id === updated.id) setSelectedDevice(updated as Device);
    setDeviceToEdit(null);
    // O device editado vive nos dados do servidor — invalida para refletir já.
    void queryClient.invalidateQueries({ queryKey: ['devices'] });
  }

  function handleDeviceDeleted(deviceId: string) {
    setLocalDevices((prev) => prev.filter((d) => d.id !== deviceId));
    if (selectedDevice?.id === deviceId) setSelectedDevice(null);
    setDeviceToEdit(null);
    void queryClient.invalidateQueries({ queryKey: ['devices'] });
  }

  // ── Tela de detalhe ──────────────────────────────────────────────────────
  if (selectedDevice) {
    const closeDetail = () => {
      setSelectedDevice(null);
      setHighlightPointId(null);
    };
    if (selectedDevice.protocol === 'bacnet') {
      return (
        <BACnetDeviceDetail
          device={selectedDevice as BACnetDevice}
          onBack={closeDetail}
          highlightPointId={highlightPointId ?? undefined}
        />
      );
    }
    if (selectedDevice.protocol === 'mqtt') {
      return (
        <MqttDeviceDetail
          device={selectedDevice as MqttDevice}
          onBack={closeDetail}
          highlightPointId={highlightPointId ?? undefined}
        />
      );
    }
    return (
      <ModbusDeviceDetail
        device={selectedDevice as ModbusDevice}
        onBack={closeDetail}
        highlightPointId={highlightPointId ?? undefined}
      />
    );
  }

  // ── Tela de lista ────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Dispositivos</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isAdmin
              ? `Gestão de dispositivos — ${selectedSiteName ?? 'Todos os Sites'}`
              : selectedSiteName
                ? `Todos os Dispositivos — ${selectedSiteName}`
                : 'Todos os Dispositivos'}
          </p>
        </div>

        {/* Lado direito: botão adicionar — apenas admin */}
        {isAdmin && (
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative">
              <button
                onClick={() => setDropdownOpen((v) => !v)}
                className="flex items-center gap-2 h-9 px-4 text-sm rounded-md font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Adicionar Dispositivo
                <ChevronDown className="h-4 w-4" />
              </button>

              {dropdownOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setDropdownOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-20 w-52 bg-card border border-border rounded-lg shadow-lg py-1 overflow-hidden">
                    <button
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
                      onClick={() => { setBacnetModalOpen(true); setDropdownOpen(false); }}
                    >
                      <Wifi className="h-4 w-4 text-cyan-600" />
                      Dispositivo BACnet
                    </button>
                    <button
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
                      onClick={() => { setModbusModalOpen(true); setDropdownOpen(false); }}
                    >
                      <Network className="h-4 w-4 text-violet-600" />
                      Dispositivo Modbus
                    </button>
                    <button
                      className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground hover:bg-muted/50 transition-colors"
                      onClick={() => { setMqttModalOpen(true); setDropdownOpen(false); }}
                    >
                      <Radio className="h-4 w-4 text-sky-600" />
                      Dispositivo MQTT
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Contagem de dispositivos */}
      <p className="text-sm text-muted-foreground -mt-2">
        {allDevices.length} dispositivo{allDevices.length !== 1 ? 's' : ''} cadastrado{allDevices.length !== 1 ? 's' : ''}
        {isAdmin && selectedTenantId && ' neste cliente'}
        {isAdmin && !selectedTenantId && ' no total'}
      </p>

      {/* Filtros */}
      <DeviceFilters
        search={search}
        status={statusFilter}
        protocol={protocolFilter}
        siteId={siteFilter}
        sites={sites}
        onSearch={setSearch}
        onStatus={setStatusFilter}
        onProtocol={setProtocolFilter}
        onSite={(v) => setSite(v === 'all' ? null : v)}
      />

      {/* Lista */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-[140px] rounded-lg bg-muted/50 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground text-sm">
          Nenhum dispositivo encontrado.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((device) => (
            <DeviceListCard
              key={device.id}
              device={device}
              onSelect={setSelectedDevice}
              onEdit={setDeviceToEdit}
              onToggleCritical={isAdmin ? handleToggleCritical : undefined}
              togglingCritical={togglingCriticalId === device.id}
              isClientView={!isAdmin}
            />
          ))}
        </div>
      )}

      {/* Modais de criação */}
      <AddBACnetDeviceModal
        open={bacnetModalOpen}
        onClose={() => setBacnetModalOpen(false)}
        onCreated={handleDeviceCreated}
      />
      <AddModbusDeviceModal
        open={modbusModalOpen}
        onClose={() => setModbusModalOpen(false)}
        onCreated={handleDeviceCreated}
      />
      <AddMqttDeviceModal
        open={mqttModalOpen}
        onClose={() => setMqttModalOpen(false)}
        onCreated={handleDeviceCreated}
      />

      {/* Modais de edição */}
      {deviceToEdit?.protocol === 'bacnet' && (
        <EditBACnetDeviceModal
          device={deviceToEdit as BACnetDevice}
          onClose={() => setDeviceToEdit(null)}
          onUpdated={handleDeviceUpdated}
          onDeleted={handleDeviceDeleted}
        />
      )}
      {deviceToEdit?.protocol === 'mqtt' && (
        <EditMqttDeviceModal
          device={deviceToEdit as MqttDevice}
          onClose={() => setDeviceToEdit(null)}
          onUpdated={handleDeviceUpdated}
          onDeleted={handleDeviceDeleted}
        />
      )}
      {deviceToEdit?.protocol === 'modbus' && (
        <EditModbusDeviceModal
          device={deviceToEdit as ModbusDevice}
          onClose={() => setDeviceToEdit(null)}
          onUpdated={handleDeviceUpdated}
          onDeleted={handleDeviceDeleted}
        />
      )}

      {/* Fallback: protocolos sem modal dedicado (ex.: onvif, snmp) */}
      {deviceToEdit &&
        deviceToEdit.protocol !== 'bacnet' &&
        deviceToEdit.protocol !== 'mqtt' &&
        deviceToEdit.protocol !== 'modbus' && (
          <FallbackDeviceDeleteDialog
            device={deviceToEdit}
            onClose={() => setDeviceToEdit(null)}
            onDeleted={handleDeviceDeleted}
          />
        )}
    </div>
  );
}
