'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, Loader2, Trash2, Wifi, X } from 'lucide-react';
import { type BACnetDevice } from '@/mocks/data/devices.mock';
import { useSites } from '@/modules/sites/hooks/useSites';
import { deleteDevice, updateBACnetDevice } from '../services/devices.service';
import PasswordConfirmDialog from '@/components/PasswordConfirmDialog';
import { translateDeviceError } from '../utils/device-errors';

interface Props {
  device: BACnetDevice | null;
  onClose: () => void;
  onUpdated: (device: BACnetDevice) => void;
  onDeleted: (deviceId: string) => void;
}

const inputCls = 'w-full h-9 px-3 text-sm border border-border rounded-md bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';
const labelCls = 'block text-xs font-medium text-foreground mb-1';

export default function EditBACnetDeviceModal({ device, onClose, onUpdated, onDeleted }: Props) {
  const [saving, setSaving]           = useState(false);
  const [errorMsg, setErrorMsg]       = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const [name, setName]                         = useState('');
  const [siteId, setSiteId]                     = useState('');
  const [siteName, setSiteName]                 = useState('');
  const [siteOpen, setSiteOpen]                 = useState(false);
  const [ip, setIp]                             = useState('');
  const [port, setPort]                         = useState('');
  const [deviceInstance, setDeviceInstance]     = useState('');

  useEffect(() => {
    if (device) {
      setName(device.name ?? '');
      setSiteId(device.siteId ?? '');
      setSiteName(device.site ?? '');
      setIp(device.ip ?? '');
      setPort(device.port != null ? String(device.port) : '');
      setDeviceInstance(device.deviceInstance != null ? String(device.deviceInstance) : '');
      setConfirmDelete(false);
      setErrorMsg('');
    }
  }, [device]);

  const { data: allSites = [] } = useSites(device?.tenantId ?? undefined);

  if (!device) return null;

  const filteredSites = allSites.filter((s) =>
    (s.name ?? '').toLowerCase().includes((siteName ?? '').toLowerCase()),
  );

  // deviceInstance não entra na validação — o campo não é exibido, mas o valor
  // é mantido internamente (carregado do dispositivo e reenviado ao salvar).
  const formValid = !!(name.trim() && siteName.trim() && ip.trim() && port);

  async function handleSave() {
    if (!formValid || saving || !device) return;
    setSaving(true);
    setErrorMsg('');
    try {
      const selectedSite = allSites.find((s) => s.id === siteId);
      const updated = await updateBACnetDevice(device.id, {
        name,
        site: selectedSite?.name ?? siteName,
        siteId,
        ip,
        port: Number(port),
        deviceInstance: Number(deviceInstance),
      });
      onUpdated(updated);
      onClose();
    } catch (err: unknown) {
      setErrorMsg(translateDeviceError(err, {
        ip: device.ip,
        port: device.port,
        fallback: 'Não foi possível salvar as alterações. Tente novamente.',
      }));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(confirmationToken: string) {
    if (saving || !device) return;
    setSaving(true);
    setDeleteError('');
    try {
      await deleteDevice(device.id, confirmationToken);
      onDeleted(device.id);
      onClose();
    } catch (err: unknown) {
      setDeleteError(translateDeviceError(err, { fallback: 'Não foi possível remover o dispositivo. Tente novamente.' }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg bg-card rounded-xl border border-border shadow-xl flex flex-col max-h-[90vh] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4 shrink-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Wifi className="h-4 w-4 text-cyan-600" />
            Editar Dispositivo BACnet
          </h2>
          <button onClick={onClose} disabled={saving} className="text-muted-foreground hover:text-foreground disabled:opacity-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* Nome da controladora */}
            <div className="sm:col-span-2">
              <label className={labelCls}>Nome da controladora</label>
              <input
                className={inputCls}
                placeholder="Ex: Johnson Controls FX-PCG"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {/* Campo Local — Combobox */}
            <div className="relative sm:col-span-2">
              <label className={labelCls}>Local</label>
              <div className="relative">
                <input
                  className={inputCls}
                  placeholder="Selecione ou digite um local"
                  value={siteName}
                  onChange={(e) => {
                    setSiteName(e.target.value);
                    setSiteId('');
                    setSiteOpen(true);
                  }}
                  onFocus={() => setSiteOpen(true)}
                  onBlur={() => setTimeout(() => setSiteOpen(false), 150)}
                  autoComplete="off"
                />
                <div className="absolute inset-y-0 right-2 flex items-center gap-1 pointer-events-none">
                  {siteName && (
                    <button
                      type="button"
                      className="pointer-events-auto text-muted-foreground hover:text-foreground"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setSiteId('');
                        setSiteName('');
                        setSiteOpen(false);
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              </div>

              {siteOpen && (
                <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-card border border-border rounded-md shadow-lg overflow-y-auto max-h-40">
                  {filteredSites.length > 0 ? (
                    filteredSites.map((s) => (
                      <div
                        key={s.id}
                        className="px-3 py-2 text-sm cursor-pointer hover:bg-muted/50"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setSiteId(s.id);
                          setSiteName(s.name);
                          setSiteOpen(false);
                        }}
                      >
                        {s.name}
                      </div>
                    ))
                  ) : siteName.trim() ? (
                    <div
                      className="px-3 py-2 text-sm cursor-pointer hover:bg-muted/50 text-primary"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setSiteId('');
                        setSiteOpen(false);
                      }}
                    >
                      Criar local: <span className="font-medium">{siteName}</span>
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {/* Endereço IP */}
            <div>
              <label className={labelCls}>Endereço IP</label>
              <input
                className={inputCls}
                placeholder="192.168.1.100"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
              />
            </div>

            {/* Porta BACnet */}
            <div>
              <label className={labelCls}>Porta BACnet</label>
              <input
                className={inputCls}
                type="number"
                placeholder="47808"
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </div>

            {/* Device Instance — não exibido; o valor é mantido internamente
                (carregado do dispositivo e reenviado ao salvar). */}
          </div>

          {errorMsg && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-border px-5 py-4 shrink-0">
          {/* Lado esquerdo — remover */}
          <button
            onClick={() => { setDeleteError(''); setConfirmDelete(true); }}
            disabled={saving}
            className="h-9 px-3 text-sm border border-red-200 rounded-md text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            <Trash2 className="h-4 w-4" />
            Remover dispositivo
          </button>

          {/* Lado direito — cancelar + salvar */}
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="h-9 px-4 text-sm border border-border rounded-md text-foreground hover:bg-muted/50 transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={!formValid || saving}
              className="h-9 px-4 text-sm rounded-md font-medium bg-cyan-700 hover:bg-cyan-800 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Salvar alterações
            </button>
          </div>
        </div>
      </div>

      {/* Exclusão crítica: exige a senha do operador */}
      {confirmDelete && (
        <PasswordConfirmDialog
          title="Remover dispositivo?"
          description={
            <>
              O dispositivo <span className="font-medium text-foreground">{device?.name}</span> e todos os
              seus pontos, históricos e alarmes serão excluídos permanentemente. Esta ação não pode ser desfeita.
            </>
          }
          confirmLabel="Remover"
          isPending={saving}
          error={deleteError || null}
          onCancel={() => { setConfirmDelete(false); setDeleteError(''); }}
          onConfirm={(token) => void handleDelete(token)}
        />
      )}
    </div>
  );
}
