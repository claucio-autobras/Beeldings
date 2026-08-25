'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, Loader2, Network, Plug, Plus, Trash2, X } from 'lucide-react';
import {
  type EquipmentType,
  type ModbusConnectionType,
  type ModbusDevice,
  type ModbusDataType,
  type ModbusRegisterType,
} from '../types/device.types';
import { createModbusDeviceWithPoints, testModbusConnection } from '../services/devices.service';
import { translateDeviceError } from '../utils/device-errors';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useSites } from '@/modules/sites/hooks/useSites';
import { useTenants } from '@/modules/tenants/hooks/useTenants';
import { getProjects } from '@/modules/projects/services/projects.service';

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (device: ModbusDevice) => void;
}

/** Linha editável da tabela manual de registradores. */
interface RegisterRow {
  tag: string;
  displayName: string;
  register: string;
  registerType: ModbusRegisterType;
  dataType: ModbusDataType;
  scale: string;
  offset: string;
  unit: string;
}

const equipmentTypes: EquipmentType[] = ['Multimedidor', 'Gerador', 'Chiller', 'Bomba', 'Ventilador', 'Outro'];
const registerTypes: ModbusRegisterType[] = ['holding', 'input', 'coil', 'discrete'];
const dataTypes: ModbusDataType[] = ['uint16', 'int16', 'float32', 'boolean'];
/** Baud rates usuais em barramentos RS485. */
export const BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];

const inputCls  = 'w-full h-9 px-3 text-sm border border-border rounded-md bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring';
const labelCls  = 'block text-xs font-medium text-foreground mb-1';
const selectCls = `${inputCls} cursor-pointer`;
const cellInputCls = 'h-7 w-full min-w-[80px] px-2 text-xs border border-border rounded bg-card text-foreground focus:outline-none focus:ring-1 focus:ring-violet-600';
const cellSelectCls = `${cellInputCls} cursor-pointer`;

function emptyRow(): RegisterRow {
  return { tag: '', displayName: '', register: '', registerType: 'holding', dataType: 'float32', scale: '1', offset: '0', unit: '' };
}

export default function AddModbusDeviceModal({ open, onClose, onCreated }: Props) {
  const user         = useCurrentUser();
  const isGlobalRole = user.role === 'ADMIN' || user.role === 'CCO' || user.role === 'SUPERVISOR';

  const [saving, setSaving]                     = useState(false);
  const [errorMsg, setErrorMsg]                 = useState('');
  // Gate de conexão: registradores só liberam após teste OK com o equipamento.
  const [connState, setConnState]               = useState<'untested' | 'testing' | 'ok' | 'failed'>('untested');
  const [name, setName]                         = useState('');
  const [equipmentType, setEquipmentType]       = useState<EquipmentType | ''>('');
  const [selectedClientId, setSelectedClientId] = useState('');

  // Site / projeto / gateway
  const [siteId, setSiteId]               = useState('');
  const [siteName, setSiteName]           = useState('');
  const [siteOpen, setSiteOpen]           = useState(false);
  const [projectId, setProjectId]         = useState('');
  const [siteGatewayId, setSiteGatewayId] = useState('');

  // Modo de conexão: TCP (rede) ou RTU (serial RS485)
  const [connectionType, setConnectionType]   = useState<ModbusConnectionType>('tcp');
  const [ip, setIp]                           = useState('');
  const [port, setPort]                       = useState('502');
  // Parâmetros seriais (modo RTU)
  const [serialPath, setSerialPath]           = useState('');
  const [baudRate, setBaudRate]               = useState('9600');
  const [parity, setParity]                   = useState<'none' | 'even' | 'odd'>('none');
  const [dataBits, setDataBits]               = useState<'8' | '7'>('8');
  const [stopBits, setStopBits]               = useState<'1' | '2'>('1');
  const [unitId, setUnitId]                   = useState('1');
  const [pollingInterval, setPollingInterval] = useState('1');

  // Registradores cadastrados manualmente (Modbus não tem discovery)
  const [rows, setRows] = useState<RegisterRow[]>([emptyRow()]);

  // Dados reais do backend. Perfil global sem cliente escolhido: não busca
  // sites (tenant vazio no backend = "sem filtro") e trava o seletor de Site.
  const effectiveTenantId = isGlobalRole ? selectedClientId : (user.tenantId ?? '');
  const tenantChosen = Boolean(effectiveTenantId);
  const { data: tenants = [] } = useTenants();
  const { data: allSites = [] } = useSites(effectiveTenantId || undefined, { enabled: tenantChosen });
  const { data: siteProjects = [] } = useQuery({
    queryKey: ['projects', siteId || null, effectiveTenantId || null],
    queryFn: () => getProjects(siteId || undefined, effectiveTenantId || undefined),
    enabled: !!siteId,
  });

  if (!open) return null;

  const filteredSites = allSites.filter((s) =>
    s.name.toLowerCase().includes(siteName.toLowerCase()),
  );

  /** Qualquer alteração nos dados de conexão invalida um teste anterior. */
  function invalidateConnection() {
    setConnState('untested');
    setErrorMsg('');
  }

  function resetAndClose() {
    setSaving(false);
    setErrorMsg('');
    setConnState('untested');
    setName('');
    setEquipmentType('');
    setSelectedClientId('');
    setSiteId('');
    setSiteName('');
    setSiteOpen(false);
    setProjectId('');
    setSiteGatewayId('');
    setConnectionType('tcp');
    setIp('');
    setPort('502');
    setSerialPath('');
    setBaudRate('9600');
    setParity('none');
    setDataBits('8');
    setStopBits('1');
    setUnitId('1');
    setPollingInterval('1');
    setRows([emptyRow()]);
    onClose();
  }

  function handleClientChange(clientId: string) {
    setSelectedClientId(clientId);
    setSiteId('');
    setSiteName('');
    setProjectId('');
    setSiteGatewayId('');
    invalidateConnection();
  }

  function handleProjectChange(id: string) {
    setProjectId(id);
    const proj = siteProjects.find((p) => p.id === id);
    setSiteGatewayId(proj?.gateway?.id ?? '');
    invalidateConnection();
  }

  const isRtu = connectionType === 'rtu';

  /** Payload dos parâmetros seriais (modo RTU). */
  const serialConfig = {
    path: serialPath.trim(),
    baudRate: Number(baudRate),
    parity,
    dataBits: Number(dataBits) as 8 | 7,
    stopBits: Number(stopBits) as 1 | 2,
  };

  /** Campos mínimos para testar a conexão (não exigem nome/tipo/registradores). */
  const connFieldsValid = !!(
    effectiveTenantId &&
    siteGatewayId &&
    unitId &&
    (isRtu ? serialPath.trim() : ip && port)
  );

  async function handleTestConnection() {
    if (!connFieldsValid) return;
    setConnState('testing');
    setErrorMsg('');
    try {
      await testModbusConnection({
        tenantId: effectiveTenantId,
        gatewayId: siteGatewayId,
        connectionType,
        ...(isRtu ? { serial: serialConfig } : { ip, port: Number(port) }),
        unitId: Number(unitId),
      });
      setConnState('ok');
    } catch (err: unknown) {
      setConnState('failed');
      setErrorMsg(
        translateDeviceError(err, {
          ip: isRtu ? serialPath : ip,
          port: isRtu ? undefined : port,
          fallback: isRtu
            ? 'Não foi possível comunicar com o escravo na porta serial.'
            : 'Não foi possível conectar ao equipamento.',
        }),
      );
    }
  }

  function updateRow(idx: number, patch: Partial<RegisterRow>) {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function addRow() {
    setRows((prev) => [...prev, emptyRow()]);
  }

  function removeRow(idx: number) {
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  /** Linhas válidas = tag + registrador preenchidos. */
  const validRows = rows.filter((r) => r.tag.trim() && r.register.trim() !== '');

  const clientSelected = isGlobalRole ? !!selectedClientId : true;
  const formValid =
    !!(name && equipmentType && siteId && projectId && siteGatewayId && unitId && pollingInterval && clientSelected) &&
    (isRtu ? !!serialPath.trim() : !!(ip && port)) &&
    connState === 'ok' &&
    validRows.length > 0;

  async function handleSave() {
    if (!formValid) return;
    setSaving(true);
    setErrorMsg('');
    try {
      const selectedSite = allSites.find((s) => s.id === siteId);
      const device = await createModbusDeviceWithPoints({
        name,
        protocol:        'modbus',
        equipmentType:   equipmentType as EquipmentType,
        site:            selectedSite?.name ?? siteName,
        siteId,
        tenantId:        effectiveTenantId,
        gatewayId:       siteGatewayId,
        connectionType,
        ...(isRtu
          ? { ip: serialPath.trim(), port: 0, serial: serialConfig }
          : { ip, port: Number(port) }),
        unitId:          Number(unitId),
        pollingInterval: Number(pollingInterval),
        selectedPoints:  validRows.map((r) => ({
          tag:          r.tag.trim(),
          displayName:  r.displayName.trim() || r.tag.trim(),
          register:     Number(r.register),
          registerType: r.registerType,
          dataType:     r.dataType,
          scale:        Number(r.scale) || 1,
          offset:       Number(r.offset) || 0,
          unit:         r.unit.trim(),
        })),
      });
      onCreated(device);
      resetAndClose();
    } catch (err: unknown) {
      setErrorMsg(translateDeviceError(err, { ip, port, fallback: 'Erro ao salvar dispositivo.' }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-4xl max-h-[90vh] overflow-hidden bg-card rounded-xl border border-border shadow-xl flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4 shrink-0">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Network className="h-4 w-4 text-violet-600" />
            Adicionar Dispositivo Modbus
          </h2>
          <button onClick={resetAndClose} aria-label="Fechar modal" className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 px-5 py-4 overflow-y-auto space-y-5">

          {/* Dados de conexão */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {isGlobalRole && (
              <div className="sm:col-span-2">
                <label className={labelCls}>Cliente <span className="text-red-500">*</span></label>
                <select className={selectCls} value={selectedClientId} onChange={(e) => handleClientChange(e.target.value)}>
                  <option value="">Selecione o cliente</option>
                  {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            )}

            <div className="sm:col-span-2">
              <label className={labelCls}>Nome do equipamento <span className="text-red-500">*</span></label>
              <input className={inputCls} placeholder="Ex: Multimedidor PowerLogic" value={name} onChange={(e) => setName(e.target.value)} />
            </div>

            <div>
              <label className={labelCls}>Tipo do equipamento <span className="text-red-500">*</span></label>
              <select className={selectCls} value={equipmentType} onChange={(e) => setEquipmentType(e.target.value as EquipmentType)}>
                <option value="">Selecionar tipo</option>
                {equipmentTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {/* Site — combobox */}
            <div className="relative">
              <label className={labelCls}>Site <span className="text-red-500">*</span></label>
              <div className="relative">
                <input
                  className={inputCls + (!tenantChosen ? ' opacity-60 cursor-not-allowed' : '')}
                  placeholder={tenantChosen ? 'Selecione ou digite um local' : 'Selecione o cliente primeiro'}
                  value={siteName}
                  disabled={!tenantChosen}
                  onChange={(e) => { setSiteName(e.target.value); setSiteId(''); setProjectId(''); setSiteGatewayId(''); setSiteOpen(true); invalidateConnection(); }}
                  onFocus={() => setSiteOpen(true)}
                  onBlur={() => setTimeout(() => setSiteOpen(false), 150)}
                  autoComplete="off"
                />
                <div className="absolute inset-y-0 right-2 flex items-center gap-1 pointer-events-none">
                  {siteName && (
                    <button
                      type="button"
                      className="pointer-events-auto text-muted-foreground hover:text-foreground"
                      onMouseDown={(e) => { e.preventDefault(); setSiteId(''); setSiteName(''); setProjectId(''); setSiteGatewayId(''); setSiteOpen(false); invalidateConnection(); }}
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
                        onMouseDown={(e) => { e.preventDefault(); setSiteId(s.id); setSiteName(s.name); setProjectId(''); setSiteGatewayId(''); setSiteOpen(false); invalidateConnection(); }}
                      >
                        {s.name}
                      </div>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      {allSites.length === 0 ? 'Nenhum local cadastrado' : 'Digite para filtrar'}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Gateway — define o gateway do dispositivo */}
            <div>
              <label className={labelCls}>Gateway <span className="text-red-500">*</span></label>
              <select className={selectCls} value={projectId} onChange={(e) => handleProjectChange(e.target.value)} disabled={!siteId}>
                <option value="">
                  {!siteId ? 'Selecione um local primeiro' : siteProjects.length === 0 ? 'Nenhum gateway neste local' : 'Selecione o gateway'}
                </option>
                {siteProjects.map((p) => (
                  <option key={p.id} value={p.id} disabled={!p.gateway}>
                    {p.name}{!p.gateway ? ' (sem gateway)' : ''}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-muted-foreground mt-1">O dispositivo será vinculado a este gateway.</p>
            </div>

            {/* Modo de conexão */}
            <div className="sm:col-span-2">
              <label className={labelCls}>Modo de conexão <span className="text-red-500">*</span></label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setConnectionType('tcp'); invalidateConnection(); }}
                  className={`h-9 px-4 text-sm rounded-md font-medium border transition-colors ${!isRtu ? 'border-violet-600 bg-violet-50 text-violet-800' : 'border-border bg-card text-muted-foreground hover:bg-muted/50'}`}
                >
                  TCP (rede)
                </button>
                <button
                  type="button"
                  onClick={() => { setConnectionType('rtu'); invalidateConnection(); }}
                  className={`h-9 px-4 text-sm rounded-md font-medium border transition-colors ${isRtu ? 'border-violet-600 bg-violet-50 text-violet-800' : 'border-border bg-card text-muted-foreground hover:bg-muted/50'}`}
                >
                  Serial RS485 (RTU)
                </button>
              </div>
            </div>

            {!isRtu && (
              <>
                <div>
                  <label className={labelCls}>Endereço IP <span className="text-red-500">*</span></label>
                  <input className={inputCls} placeholder="192.168.1.50" value={ip} onChange={(e) => { setIp(e.target.value); invalidateConnection(); }} />
                </div>

                <div>
                  <label className={labelCls}>Porta Modbus TCP <span className="text-red-500">*</span></label>
                  <input className={inputCls} type="number" placeholder="502" value={port} onChange={(e) => { setPort(e.target.value); invalidateConnection(); }} />
                </div>
              </>
            )}

            {isRtu && (
              <>
                <div>
                  <label className={labelCls}>Porta serial <span className="text-red-500">*</span></label>
                  <input className={inputCls} placeholder="COM3 ou /dev/ttyUSB0" value={serialPath} onChange={(e) => { setSerialPath(e.target.value); invalidateConnection(); }} />
                  <p className="text-[11px] text-muted-foreground mt-1">Porta do conversor USB→RS485 no computador do gateway.</p>
                </div>

                <div>
                  <label className={labelCls}>Baud rate <span className="text-red-500">*</span></label>
                  <select className={selectCls} value={baudRate} onChange={(e) => { setBaudRate(e.target.value); invalidateConnection(); }}>
                    {BAUD_RATES.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </div>

                <div>
                  <label className={labelCls}>Paridade</label>
                  <select className={selectCls} value={parity} onChange={(e) => { setParity(e.target.value as 'none' | 'even' | 'odd'); invalidateConnection(); }}>
                    <option value="none">Nenhuma (none)</option>
                    <option value="even">Par (even)</option>
                    <option value="odd">Ímpar (odd)</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Data bits</label>
                    <select className={selectCls} value={dataBits} onChange={(e) => { setDataBits(e.target.value as '8' | '7'); invalidateConnection(); }}>
                      <option value="8">8</option>
                      <option value="7">7</option>
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Stop bits</label>
                    <select className={selectCls} value={stopBits} onChange={(e) => { setStopBits(e.target.value as '1' | '2'); invalidateConnection(); }}>
                      <option value="1">1</option>
                      <option value="2">2</option>
                    </select>
                  </div>
                </div>
              </>
            )}

            <div>
              <label className={labelCls}>Unit ID (Slave ID) <span className="text-red-500">*</span></label>
              <input className={inputCls} type="number" placeholder="1" value={unitId} onChange={(e) => { setUnitId(e.target.value); invalidateConnection(); }} />
            </div>

            <div>
              <label className={labelCls}>Intervalo de polling (min) <span className="text-red-500">*</span></label>
              <input className={inputCls} type="number" min={1} placeholder="1" value={pollingInterval} onChange={(e) => setPollingInterval(e.target.value)} />
            </div>
          </div>

          {/* Teste de conexão — obrigatório antes de cadastrar registradores */}
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={handleTestConnection}
              disabled={!connFieldsValid || connState === 'testing'}
              className="h-9 px-4 text-sm rounded-md font-medium border border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
            >
              {connState === 'testing' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
              {connState === 'testing' ? 'Testando conexão…' : connState === 'ok' ? 'Testar novamente' : 'Testar conexão'}
            </button>

            {connState === 'ok' && (
              <span className="flex items-center gap-1.5 text-sm font-medium text-green-700">
                <CheckCircle2 className="h-4 w-4" />
                Conectado ao equipamento
              </span>
            )}
            {connState === 'untested' && (
              <span className="text-xs text-muted-foreground">
                Teste a conexão para liberar o cadastro de registradores.
              </span>
            )}
          </div>

          {connState === 'failed' && errorMsg && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
              {errorMsg}
            </div>
          )}

          {/* Registradores — entrada manual (Modbus não tem discovery), liberados após conexão OK */}
          {connState === 'ok' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Registradores</h3>
                <p className="text-[11px] text-muted-foreground">
                  Modbus não tem descoberta automática — informe os registradores manualmente a partir do mapa do fabricante.
                </p>
              </div>
              <button
                type="button"
                onClick={addRow}
                className="h-8 px-3 text-xs rounded-md font-medium border border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100 transition-colors flex items-center gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                Adicionar registrador
              </button>
            </div>

            <div className="border border-border rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 border-b border-border">
                  <tr>
                    <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">Tag *</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">Nome</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">Registrador *</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">Tipo reg.</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">Dado</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">Escala</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">Offset</th>
                    <th className="px-2 py-2 text-left text-xs font-medium text-muted-foreground">Unidade</th>
                    <th className="w-8 px-2 py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((r, i) => (
                    <tr key={i} className="hover:bg-muted/20">
                      <td className="px-2 py-1.5">
                        <input
                          className={`${cellInputCls} font-mono`}
                          placeholder="TEMP_AGUA"
                          value={r.tag}
                          onChange={(e) => updateRow(i, { tag: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })}
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input className={cellInputCls} placeholder="Temperatura água" value={r.displayName} onChange={(e) => updateRow(i, { displayName: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <input className={`${cellInputCls} min-w-[70px]`} type="number" placeholder="40001" value={r.register} onChange={(e) => updateRow(i, { register: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <select className={cellSelectCls} value={r.registerType} onChange={(e) => updateRow(i, { registerType: e.target.value as ModbusRegisterType })}>
                          {registerTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <select className={cellSelectCls} value={r.dataType} onChange={(e) => updateRow(i, { dataType: e.target.value as ModbusDataType })}>
                          {dataTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                      </td>
                      <td className="px-2 py-1.5">
                        <input className={`${cellInputCls} min-w-[56px]`} type="number" step="any" value={r.scale} onChange={(e) => updateRow(i, { scale: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <input className={`${cellInputCls} min-w-[56px]`} type="number" step="any" value={r.offset} onChange={(e) => updateRow(i, { offset: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5">
                        <input className={`${cellInputCls} min-w-[60px]`} placeholder="°C" value={r.unit} onChange={(e) => updateRow(i, { unit: e.target.value })} />
                      </td>
                      <td className="px-2 py-1.5 text-center">
                        <button
                          type="button"
                          onClick={() => removeRow(i)}
                          disabled={rows.length === 1}
                          aria-label="Remover registrador"
                          className="text-muted-foreground hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              {validRows.length} registrador{validRows.length !== 1 ? 'es' : ''} válido{validRows.length !== 1 ? 's' : ''} (tag + registrador preenchidos).
            </p>
          </div>
          )}

          {/* Erro de salvamento (conexão já validada) */}
          {connState === 'ok' && errorMsg && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
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
            className="h-9 px-4 text-sm rounded-md font-medium bg-violet-700 text-white hover:bg-violet-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? 'Salvando...' : `Salvar Dispositivo (${validRows.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
