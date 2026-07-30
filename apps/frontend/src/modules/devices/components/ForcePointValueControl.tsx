'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2, X } from 'lucide-react';
import type { BACnetDevice, BACnetPoint } from '@/mocks/data/devices.mock';
import { useBacnetWrite } from '../hooks/useBacnetWrite';
import { isDigital, isMultiState, objectTypeToNum } from '../utils/bacnet-object-types';

interface Props {
  device: Pick<BACnetDevice, 'id' | 'tenantId' | 'gatewayId' | 'ip' | 'port'>;
  point: Pick<BACnetPoint, 'objectType' | 'instance' | 'unit' | 'objectName' | 'tag'>;
  onClose: () => void;
}

/**
 * Controle inline de "Forçar valor" para um ponto BACnet comandável.
 *
 * - Digitais (BV/BO): alternância ATIVO/INATIVO (1/0).
 * - Analógicos (AO/AV): campo numérico com a unidade do ponto.
 * - Multi-state (MSO): campo numérico do estado.
 *
 * Permite escolher a prioridade (padrão 8 = manual do operador) e liberar o
 * override (relinquish = escrever null naquela prioridade) para não deixar a
 * saída travada após o teste. O envio reutiliza o hook `useBacnetWrite`; a
 * telemetria em tempo real reflete o novo valor em segundos.
 */
export function ForcePointValueControl({ device, point, onClose }: Props) {
  const digital = isDigital(point.objectType);
  const multiState = isMultiState(point.objectType);
  const { loading, error, write } = useBacnetWrite();

  const [digitalValue, setDigitalValue] = useState<0 | 1>(1);
  const [numericValue, setNumericValue] = useState('');
  const [priority, setPriority] = useState(8);
  const [success, setSuccess] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const noGateway = !device.gatewayId;

  async function send(value: number | null, successMessage: string) {
    setSuccess(null);
    setLocalError(null);

    if (noGateway) {
      setLocalError('Esta controladora não tem um gateway associado — não é possível enviar comandos.');
      return;
    }

    const ok = await write({
      tenantId: device.tenantId,
      gatewayId: device.gatewayId!,
      ip: device.ip,
      port: device.port,
      objectType: objectTypeToNum(point.objectType),
      objectInstance: point.instance,
      value,
      priority,
      pointLabel: point.objectName ?? point.tag,
      deviceId: device.id,
    });

    if (ok) setSuccess(successMessage);
  }

  function handleForce() {
    if (digital) {
      void send(
        digitalValue,
        digitalValue === 1 ? 'Comando enviado: ponto forçado para ATIVO.' : 'Comando enviado: ponto forçado para INATIVO.',
      );
      return;
    }

    if (numericValue.trim() === '') {
      setLocalError('Informe um valor numérico.');
      return;
    }
    const parsed = Number(numericValue);
    if (!Number.isFinite(parsed)) {
      setLocalError('Informe um valor numérico válido.');
      return;
    }
    if (multiState && !Number.isInteger(parsed)) {
      setLocalError('O estado deve ser um número inteiro.');
      return;
    }

    const label = multiState
      ? `Comando enviado: estado ${parsed}.`
      : `Comando enviado: ${parsed}${point.unit ? ` ${point.unit}` : ''}.`;
    void send(parsed, label);
  }

  function handleRelinquish() {
    void send(null, `Override liberado na prioridade ${priority}.`);
  }

  return (
    <div className="rounded-lg border border-cyan-200 bg-cyan-50/50 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">
          Forçar valor — <span className="font-mono">{point.objectName ?? point.tag}</span>
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Fechar"
          className="rounded p-1 text-muted-foreground hover:bg-muted/50 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {noGateway && (
        <p className="text-xs font-medium text-amber-700">
          Esta controladora não tem um gateway associado — não é possível enviar comandos.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        {/* Valor */}
        {digital ? (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Valor</span>
            <div className="inline-flex overflow-hidden rounded-md border border-border">
              <button
                type="button"
                onClick={() => setDigitalValue(1)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  digitalValue === 1
                    ? 'bg-emerald-600 text-white'
                    : 'bg-background text-muted-foreground hover:bg-muted/50'
                }`}
              >
                ATIVO
              </button>
              <button
                type="button"
                onClick={() => setDigitalValue(0)}
                className={`px-3 py-1.5 text-xs font-medium border-l border-border transition-colors ${
                  digitalValue === 0
                    ? 'bg-slate-600 text-white'
                    : 'bg-background text-muted-foreground hover:bg-muted/50'
                }`}
              >
                INATIVO
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">{multiState ? 'Estado' : 'Valor'}</span>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={numericValue}
                step={multiState ? 1 : 'any'}
                onChange={(e) => setNumericValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleForce(); } }}
                placeholder={multiState ? 'Ex.: 2' : 'Ex.: 22.5'}
                className="w-28 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400"
              />
              {!multiState && point.unit && (
                <span className="text-sm text-muted-foreground">{point.unit}</span>
              )}
            </div>
          </div>
        )}

        {/* Prioridade */}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Prioridade</span>
          <input
            type="number"
            min={1}
            max={16}
            value={priority}
            onChange={(e) => {
              const n = Number(e.target.value);
              setPriority(Number.isFinite(n) ? Math.min(16, Math.max(1, Math.round(n))) : 8);
            }}
            className="w-20 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400"
          />
        </div>

        {/* Ações */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={loading || noGateway}
            onClick={handleForce}
            className="flex items-center gap-1.5 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Forçar
          </button>
          <button
            type="button"
            disabled={loading || noGateway}
            onClick={handleRelinquish}
            title="Liberar o override desta prioridade (relinquish) e devolver o controle automático"
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-cyan-300 hover:text-cyan-700 disabled:opacity-50 transition-colors"
          >
            Liberar
          </button>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Prioridade padrão 8 (manual do operador). Use &quot;Liberar&quot; para devolver o controle automático e não deixar a saída travada após o teste.
      </p>

      {success && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          {success}
        </p>
      )}
      {(localError ?? error) && (
        <p className="text-xs font-medium text-red-700">{localError ?? error}</p>
      )}
    </div>
  );
}
