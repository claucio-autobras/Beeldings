'use client';

import { useState } from 'react';
import { Loader2, Plus, X } from 'lucide-react';
import type { ModbusDataType, ModbusDevice, ModbusRegisterType } from '@/mocks/data/devices.mock';
import { addModbusPoint } from '../services/devices.service';
import { translateDeviceError } from '../utils/device-errors';

interface Props {
  deviceId: string;
  open: boolean;
  onClose: () => void;
  onAdded: (device: ModbusDevice) => void;
}

const inputCls  = 'w-full h-9 px-3 text-sm border border-border rounded-md bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';
const labelCls  = 'block text-xs font-medium text-foreground mb-1';
const selectCls = `${inputCls} cursor-pointer`;

export default function AddModbusPointModal({ deviceId, open, onClose, onAdded }: Props) {
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [tag, setTag] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [register, setRegister] = useState('');
  const [registerType, setRegisterType] = useState<ModbusRegisterType | ''>('');
  const [dataType, setDataType] = useState<ModbusDataType | ''>('');
  const [scale, setScale] = useState('1');
  const [offset, setOffset] = useState('0');
  const [unit, setUnit] = useState('');
  const [minExpected, setMinExpected] = useState('');
  const [maxExpected, setMaxExpected] = useState('');

  if (!open) return null;

  function resetAndClose() {
    setTag(''); setDisplayName(''); setRegister(''); setRegisterType(''); setDataType('');
    setScale('1'); setOffset('0'); setUnit(''); setMinExpected(''); setMaxExpected('');
    setErrorMsg('');
    onClose();
  }

  async function handleSave() {
    if (!formValid) return;
    setSaving(true);
    setErrorMsg('');
    try {
      const device = await addModbusPoint(deviceId, {
        tag, displayName, register: Number(register),
        registerType: registerType as ModbusRegisterType,
        dataType: dataType as ModbusDataType,
        scale: Number(scale), offset: Number(offset), unit,
        ...(minExpected !== '' && { minExpected: Number(minExpected) }),
        ...(maxExpected !== '' && { maxExpected: Number(maxExpected) }),
      });
      onAdded(device);
      resetAndClose();
    } catch (err: unknown) {
      setErrorMsg(translateDeviceError(err, { fallback: 'Não foi possível adicionar o ponto. Tente novamente.' }));
    } finally { setSaving(false); }
  }

  const formValid = tag && displayName && register && registerType && dataType;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-hidden bg-card rounded-xl border border-border shadow-xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4 shrink-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Plus className="h-4 w-4 text-violet-600" />
            Adicionar Ponto Modbus
          </h2>
          <button onClick={resetAndClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 px-5 py-4 overflow-y-auto">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            <div>
              <label className={labelCls}>Tag</label>
              <input className={`${inputCls} font-mono`} placeholder="Ex: temp_saida" value={tag} onChange={(e) => setTag(e.target.value)} />
              <p className="text-xs text-muted-foreground mt-1">Identificador único (sem espaços)</p>
            </div>

            <div>
              <label className={labelCls}>Nome de exibição</label>
              <input className={inputCls} placeholder="Ex: Temperatura de Saída" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            </div>

            <div>
              <label className={labelCls}>Registrador</label>
              <input className={inputCls} type="number" placeholder="Ex: 40001" value={register} onChange={(e) => setRegister(e.target.value)} />
            </div>

            <div>
              <label className={labelCls}>Tipo do registrador</label>
              <select className={selectCls} value={registerType} onChange={(e) => setRegisterType(e.target.value as ModbusRegisterType)}>
                <option value="">Selecionar</option>
                <option value="holding">Holding Register</option>
                <option value="input">Input Register</option>
                <option value="coil">Coil</option>
                <option value="discrete">Discrete Input</option>
              </select>
            </div>

            <div>
              <label className={labelCls}>Tipo de dado</label>
              <select className={selectCls} value={dataType} onChange={(e) => setDataType(e.target.value as ModbusDataType)}>
                <option value="">Selecionar</option>
                <option value="uint16">UInt16</option>
                <option value="int16">Int16</option>
                <option value="float32">Float32</option>
                <option value="boolean">Boolean</option>
              </select>
            </div>

            <div>
              <label className={labelCls}>Unidade</label>
              <input className={inputCls} placeholder="Ex: °C, bar, A, V" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>

            <div>
              <label className={labelCls}>Escala (fator multiplicador)</label>
              <input className={inputCls} type="number" step="0.01" value={scale} onChange={(e) => setScale(e.target.value)} />
            </div>

            <div>
              <label className={labelCls}>Offset</label>
              <input className={inputCls} type="number" value={offset} onChange={(e) => setOffset(e.target.value)} />
            </div>

            <div>
              <label className={labelCls}>Valor mínimo esperado</label>
              <input className={inputCls} type="number" placeholder="Opcional" value={minExpected} onChange={(e) => setMinExpected(e.target.value)} />
            </div>

            <div>
              <label className={labelCls}>Valor máximo esperado</label>
              <input className={inputCls} type="number" placeholder="Opcional" value={maxExpected} onChange={(e) => setMaxExpected(e.target.value)} />
            </div>

          </div>

          {errorMsg && (
            <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4 shrink-0">
          <button onClick={resetAndClose} className="h-9 px-4 text-sm border border-border rounded-md text-foreground hover:bg-muted/50 transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={!formValid || saving}
            className="h-9 px-4 text-sm rounded-md font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Adicionar Ponto
          </button>
        </div>
      </div>
    </div>
  );
}
