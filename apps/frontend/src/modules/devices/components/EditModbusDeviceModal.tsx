'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, Loader2, Network, Trash2, X } from 'lucide-react';
import { type EquipmentType, type ModbusDevice, type ModbusSerialConfig } from '@/mocks/data/devices.mock';
import { useSites } from '@/modules/sites/hooks/useSites';
import { deleteDevice, updateModbusDevice } from '../services/devices.service';
import PasswordConfirmDialog from '@/components/PasswordConfirmDialog';
import { translateDeviceError } from '../utils/device-errors';

interface Props {
  device: ModbusDevice | null;
  onClose: () => void;
  onUpdated: (device: ModbusDevice) => void;
  onDeleted: (deviceId: string) => void;
}

const inputCls  = 'w-full h-9 px-3 text-sm border border-border rounded-md bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';
const labelCls  = 'block text-xs font-medium text-foreground mb-1';
const selectCls = `${inputCls} cursor-pointer`;

const equipmentTypes: EquipmentType[] = ['Multimedidor', 'Gerador', 'Chiller', 'Bomba', 'Ventilador', 'Outro'];
/** Baud rates usuais em barramentos RS485. */
const BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];

export default function EditModbusDeviceModal({ device, onClose, onUpdated, onDeleted }: Props) {
  const [saving, setSaving]               = useState(false);
  const [errorMsg, setErrorMsg]           = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  const [name, setName]                         = useState('');
  const [equipmentType, setEquipmentType]       = useState<EquipmentType | ''>('');
  const [siteId, setSiteId]                     = useState('');
  const [siteName, setSiteName]                 = useState('');
  const [siteOpen, setSiteOpen]                 = useState(false);
  const [ip, setIp]                             = useState('');
  const [port, setPort]                         = useState('');
  // Parâmetros seriais (modo RTU)
  const [serialPath, setSerialPath]             = useState('');
  const [baudRate, setBaudRate]                 = useState('9600');
  const [parity, setParity]                     = useState<'none' | 'even' | 'odd'>('none');
  const [dataBits, setDataBits]                 = useState<'8' | '7'>('8');
  const [stopBits, setStopBits]                 = useState<'1' | '2'>('1');
  const [unitId, setUnitId]                     = useState('');
  const [pollingInterval, setPollingInterval]   = useState('');

  useEffect(() => {
    if (device) {
      setName(device.name);
      setEquipmentType(device.equipmentType);
      setSiteId(device.siteId);
      setSiteName(device.site);
      setIp(device.ip);
      setPort(String(device.port));
      setSerialPath(device.serial?.path ?? device.ip);
      setBaudRate(String(device.serial?.baudRate ?? 9600));
      setParity(device.serial?.parity ?? 'none');
      setDataBits(String(device.serial?.dataBits ?? 8) as '8' | '7');
      setStopBits(String(device.serial?.stopBits ?? 1) as '1' | '2');
      setUnitId(String(device.unitId));
      setPollingInterval(String(device.pollingInterval));
      setConfirmDelete(false);
      setErrorMsg('');
    }
  }, [device]);

  // O modo de conexão não muda na edição — só os parâmetros do modo atual.
  const isRtu = device?.connectionType === 'rtu';

  const { data: allSites = [] } = useSites(device?.tenantId ?? undefined);

  if (!device) return null;

  const filteredSites = allSites.filter((s) =>
    s.name.toLowerCase().includes(siteName.toLowerCase()),
  );

  const formValid = !!(
    name.trim() && equipmentType && siteName.trim() && unitId && pollingInterval &&
    (isRtu ? serialPath.trim() : ip.trim() && port)
  );

  async function handleSave() {
    if (!formValid || saving || !device) return;
    setSaving(true);
    setErrorMsg('');
    try {
      const selectedSite = allSites.find((s) => s.id === siteId);
      const serial: ModbusSerialConfig | undefined = isRtu
        ? {
            path: serialPath.trim(),
            baudRate: Number(baudRate),
            parity,
            dataBits: Number(dataBits) as 8 | 7,
            stopBits: Number(stopBits) as 1 | 2,
          }
        : undefined;
      const updated = await updateModbusDevice(device.id, {
        name,
        equipmentType: equipmentType as EquipmentType,
        site: selectedSite?.name ?? siteName,
        siteId,
        ip: isRtu ? serialPath.trim() : ip,
        port: isRtu ? 0 : Number(port),
        ...(serial ? { serial } : {}),
        unitId: Number(unitId),
        pollingInterval: Number(pollingInterval),
      });
      onUpdated(updated);
      onClose();
    } catch (err: unknown) {
      setErrorMsg(translateDeviceError(err, {
        ip,
        port,
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
            <Network className="h-4 w-4 text-violet-600" />
            Editar Dispositivo Modbus
          </h2>
          <button onClick={onClose} disabled={saving} className="text-muted-foreground hover:text-foreground disabled:opacity-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* Nome do equipamento */}
            <div className="sm:col-span-2">
              <label className={labelCls}>Nome do equipamento</label>
              <input
                className={inputCls}
                placeholder="Ex: Multimedidor PowerLogic"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            {/* Tipo do equipamento */}
            <div>
              <label className={labelCls}>Tipo do equipamento</label>
              <select
                className={selectCls}
                value={equipmentType}
                onChange={(e) => setEquipmentType(e.target.value as EquipmentType)}
              >
                <option value="">Selecionar tipo</option>
                {equipmentTypes.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>

            {/* Campo Local — Combobox */}
            <div className="relative">
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

            {!isRtu && (
              <>
                {/* Endereço IP */}
                <div>
                  <label className={labelCls}>Endereço IP</label>
                  <input
                    className={inputCls}
                    placeholder="192.168.1.50"
                    value={ip}
                    onChange={(e) => setIp(e.target.value)}
                  />
                </div>

                {/* Porta Modbus TCP */}
                <div>
                  <label className={labelCls}>Porta Modbus TCP</label>
                  <input
                    className={inputCls}
                    type="number"
                    placeholder="502"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                  />
                </div>
              </>
            )}

            {isRtu && (
              <>
                {/* Porta serial (RS485) */}
                <div>
                  <label className={labelCls}>Porta serial (RS485)</label>
                  <input
                    className={inputCls}
                    placeholder="COM3 ou /dev/ttyUSB0"
                    value={serialPath}
                    onChange={(e) => setSerialPath(e.target.value)}
                  />
                </div>

                <div>
                  <label className={labelCls}>Baud rate</label>
                  <select className={selectCls} value={baudRate} onChange={(e) => setBaudRate(e.target.value)}>
                    {BAUD_RATES.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>

                <div>
                  <label className={labelCls}>Paridade</label>
                  <select className={selectCls} value={parity} onChange={(e) => setParity(e.target.value as 'none' | 'even' | 'odd')}>
                    <option value="none">Nenhuma (none)</option>
                    <option value="even">Par (even)</option>
                    <option value="odd">Ímpar (odd)</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Data bits</label>
                    <select className={selectCls} value={dataBits} onChange={(e) => setDataBits(e.target.value as '8' | '7')}>
                      <option value="8">8</option>
                      <option value="7">7</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Stop bits</label>
                    <select className={selectCls} value={stopBits} onChange={(e) => setStopBits(e.target.value as '1' | '2')}>
                      <option value="1">1</option>
                      <option value="2">2</option>
                    </select>
                  </div>
                </div>
              </>
            )}

            {/* Unit ID */}
            <div>
              <label className={labelCls}>Unit ID</label>
              <input
                className={inputCls}
                type="number"
                placeholder="1"
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
              />
            </div>

            {/* Intervalo de polling */}
            <div>
              <label className={labelCls}>Intervalo de polling (min)</label>
              <input
                className={inputCls}
                type="number"
                placeholder="1"
                min={1}
                value={pollingInterval}
                onChange={(e) => setPollingInterval(e.target.value)}
              />
            </div>
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
              className="h-9 px-4 text-sm rounded-md font-medium bg-violet-700 hover:bg-violet-800 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
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
