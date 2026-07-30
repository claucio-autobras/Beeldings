'use client';

import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  History,
  Loader2,
  Send,
  Terminal,
  XCircle,
} from 'lucide-react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useTenantFilter } from '@/hooks/useTenantFilter';
import { useDevices } from '@/modules/devices/hooks/useDevices';
import type { BACnetDevice, BACnetPoint, Device } from '@/modules/devices/types/device.types';
import {
  isDigitalType,
  isWritableType,
  objectTypeLabel,
  objectTypeToNum,
} from '../services/commands.service';
import { useSendCommand } from '../hooks/useSendCommand';
import CommandHistory from '../components/CommandHistory';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isBacnet(d: Device): d is BACnetDevice {
  return d.protocol === 'bacnet';
}

const OBJECT_TYPE_BADGE: Record<string, string> = {
  AO:  'bg-indigo-50 text-indigo-700 border-indigo-200',
  BO:  'bg-orange-50 text-orange-700 border-orange-200',
  AV:  'bg-purple-50 text-purple-700 border-purple-200',
  BV:  'bg-pink-50 text-pink-700 border-pink-200',
  MSO: 'bg-amber-50 text-amber-700 border-amber-200',
};

// ─── Página principal ────────────────────────────────────────────────────────

export default function CommandsPage() {
  const user = useCurrentUser();
  const isGlobal = user.role === 'ADMIN' || user.role === 'CCO';

  const { selectedTenantId } = useTenantFilter();
  const effectiveTenantId = isGlobal
    ? (selectedTenantId ?? undefined)
    : (user.tenantId ?? undefined);

  const [tab, setTab] = useState<'send' | 'history'>('send');

  const { data: devices = [], isLoading } = useDevices(effectiveTenantId);

  // Apenas dispositivos BACnet (único protocolo com escrita por enquanto).
  const bacnetDevices = useMemo(
    () => (devices as Device[]).filter(isBacnet),
    [devices],
  );

  const [deviceId, setDeviceId] = useState<string>('');
  const [pointId, setPointId] = useState<string>('');
  const [value, setValue] = useState<string>('');
  const [digitalValue, setDigitalValue] = useState<'1' | '0'>('1');
  const [priority, setPriority] = useState<string>('8');

  const selectedDevice = bacnetDevices.find((d) => d.id === deviceId) ?? null;

  // Pontos graváveis do dispositivo selecionado (saídas/valores).
  const writablePoints = useMemo<BACnetPoint[]>(() => {
    if (!selectedDevice) return [];
    return selectedDevice.points.filter((p) => isWritableType(p.objectType));
  }, [selectedDevice]);

  const selectedPoint = writablePoints.find((p) => p.id === pointId) ?? null;
  const digital = selectedPoint ? isDigitalType(selectedPoint.objectType) : false;

  const mutation = useSendCommand();

  function handleDeviceChange(id: string) {
    setDeviceId(id);
    setPointId('');
    setValue('');
    mutation.reset();
  }

  function handlePointChange(id: string) {
    setPointId(id);
    setValue('');
    mutation.reset();
  }

  const missingGateway = !!selectedDevice && !selectedDevice.gatewayId;

  const canSubmit =
    !!selectedDevice &&
    !!selectedPoint &&
    !missingGateway &&
    (digital || value.trim() !== '') &&
    !mutation.isPending;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedDevice || !selectedPoint || !selectedDevice.gatewayId) return;

    const numericValue = digital ? Number(digitalValue) : Number(value);
    if (!digital && Number.isNaN(numericValue)) return;

    const prio = Number(priority);

    mutation.mutate({
      tenantId: selectedDevice.tenantId,
      gatewayId: selectedDevice.gatewayId,
      ip: selectedDevice.ip,
      port: selectedDevice.port,
      objectType: objectTypeToNum(selectedPoint.objectType),
      objectInstance: selectedPoint.instance,
      value: numericValue,
      priority: Number.isFinite(prio) && prio >= 1 && prio <= 16 ? prio : 8,
      pointLabel: selectedPoint.objectName ?? selectedPoint.tag,
      deviceId: selectedDevice.id,
    });
  }

  return (
    <div className={`space-y-6 ${tab === 'send' ? 'max-w-3xl' : 'max-w-6xl'}`}>
      {/* Cabeçalho */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-50 border border-cyan-100 shrink-0">
          <Terminal className="h-5 w-5 text-cyan-700" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground">Comandos</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Centro de comandos BACnet — envie escritas ao gateway e consulte o histórico de comandos.
          </p>
        </div>
      </div>

      {/* Abas */}
      <div className="flex items-center gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setTab('send')}
          className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'send'
              ? 'border-cyan-600 text-cyan-700'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Send className="h-4 w-4" />
          Enviar comando
        </button>
        <button
          type="button"
          onClick={() => setTab('history')}
          className={`inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
            tab === 'history'
              ? 'border-cyan-600 text-cyan-700'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <History className="h-4 w-4" />
          Histórico
        </button>
      </div>

      {tab === 'history' && <CommandHistory tenantId={effectiveTenantId} />}

      {/* Loading */}
      {tab === 'send' && isLoading && (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded-lg bg-muted/40 animate-pulse" />
          ))}
        </div>
      )}

      {/* Sem dispositivos */}
      {tab === 'send' && !isLoading && bacnetDevices.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-border rounded-xl bg-card">
          <Cpu className="h-12 w-12 text-muted-foreground/25 mb-3" />
          <p className="text-sm text-muted-foreground">
            Nenhum dispositivo BACnet disponível para envio de comandos.
          </p>
          {isGlobal && !selectedTenantId && (
            <p className="text-xs text-muted-foreground/70 mt-1">
              Selecione um cliente no topo para filtrar os dispositivos.
            </p>
          )}
        </div>
      )}

      {/* Formulário */}
      {tab === 'send' && !isLoading && bacnetDevices.length > 0 && (
        <form onSubmit={handleSubmit} className="space-y-5 border border-border rounded-xl bg-card p-6">
          {/* Dispositivo */}
          <div className="space-y-1.5">
            <label htmlFor="cmd-device" className="text-sm font-medium text-foreground">
              Dispositivo
            </label>
            <select
              id="cmd-device"
              value={deviceId}
              onChange={(e) => handleDeviceChange(e.target.value)}
              className="w-full h-10 px-3 text-sm rounded-md border border-border bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
            >
              <option value="">Selecione um dispositivo…</option>
              {bacnetDevices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} — {d.ip}:{d.port}
                </option>
              ))}
            </select>
          </div>

          {/* Aviso: dispositivo sem gateway */}
          {missingGateway && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-px" />
              <span>
                Este dispositivo não tem um gateway associado. Não é possível enviar comandos até que um gateway seja vinculado.
              </span>
            </div>
          )}

          {/* Ponto */}
          <div className="space-y-1.5">
            <label htmlFor="cmd-point" className="text-sm font-medium text-foreground">
              Ponto (gravável)
            </label>
            <select
              id="cmd-point"
              value={pointId}
              onChange={(e) => handlePointChange(e.target.value)}
              disabled={!selectedDevice || missingGateway}
              className="w-full h-10 px-3 text-sm rounded-md border border-border bg-card text-foreground disabled:bg-muted/40 disabled:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
            >
              <option value="">
                {selectedDevice
                  ? writablePoints.length > 0
                    ? 'Selecione um ponto…'
                    : 'Nenhum ponto gravável neste dispositivo'
                  : 'Selecione um dispositivo primeiro'}
              </option>
              {writablePoints.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.objectName ?? p.tag} ({objectTypeLabel(p.objectType)} #{p.instance})
                </option>
              ))}
            </select>
            {selectedPoint && (
              <span
                className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium border ${
                  OBJECT_TYPE_BADGE[objectTypeLabel(selectedPoint.objectType)] ?? 'bg-gray-50 text-gray-600 border-gray-200'
                }`}
              >
                {objectTypeLabel(selectedPoint.objectType)} · instância {selectedPoint.instance}
                {selectedPoint.unit ? ` · ${selectedPoint.unit}` : ''}
              </span>
            )}
          </div>

          {/* Valor */}
          {selectedPoint && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Valor</label>
              {digital ? (
                <div className="flex gap-2">
                  {(['1', '0'] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setDigitalValue(v)}
                      className={`flex-1 h-10 rounded-md text-sm font-medium border transition-colors ${
                        digitalValue === v
                          ? v === '1'
                            ? 'bg-green-600 text-white border-green-600'
                            : 'bg-slate-700 text-white border-slate-700'
                          : 'bg-card text-foreground border-border hover:bg-muted/50'
                      }`}
                    >
                      {v === '1' ? 'ATIVO (1)' : 'INATIVO (0)'}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    step="any"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="Ex.: 22.5"
                    className="w-full h-10 px-3 text-sm rounded-md border border-border bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
                  />
                  {selectedPoint.unit && (
                    <span className="text-sm text-muted-foreground shrink-0">{selectedPoint.unit}</span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Prioridade */}
          {selectedPoint && (
            <div className="space-y-1.5">
              <label htmlFor="cmd-priority" className="text-sm font-medium text-foreground">
                Prioridade BACnet
              </label>
              <input
                id="cmd-priority"
                type="number"
                min={1}
                max={16}
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-32 h-10 px-3 text-sm rounded-md border border-border bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
              />
              <p className="text-xs text-muted-foreground">
                1 (mais alta) a 16 (mais baixa). Padrão: 8.
              </p>
            </div>
          )}

          {/* Resultado */}
          {mutation.isSuccess && (
            <div className="flex items-start gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2.5 text-sm text-green-700">
              <CheckCircle2 className="h-4 w-4 shrink-0 mt-px" />
              <span>
                Comando enviado e confirmado pelo gateway com sucesso.
                {mutation.data?.commandId ? (
                  <span className="block text-xs text-green-600/80 font-mono mt-0.5">
                    {mutation.data.commandId}
                  </span>
                ) : null}
              </span>
            </div>
          )}
          {mutation.isError && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
              <XCircle className="h-4 w-4 shrink-0 mt-px" />
              <span>
                Falha ao enviar o comando: {(mutation.error as Error).message}
              </span>
            </div>
          )}

          {/* Enviar */}
          <div className="pt-1">
            <button
              type="submit"
              disabled={!canSubmit}
              className="inline-flex items-center gap-2 h-10 px-5 text-sm rounded-md font-medium bg-cyan-700 text-white hover:bg-cyan-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {mutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {mutation.isPending ? 'Enviando…' : 'Enviar comando'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
