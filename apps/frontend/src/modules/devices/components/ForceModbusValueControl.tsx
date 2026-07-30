'use client';

import { useState } from 'react';
import { CheckCircle2, Loader2, X } from 'lucide-react';
import type { ModbusDevice, ModbusPoint } from '@/mocks/data/devices.mock';
import { writeModbusPoint } from '../services/devices.service';

interface Props {
  device: Pick<ModbusDevice, 'id' | 'gatewayId'>;
  point: Pick<ModbusPoint, 'id' | 'tag' | 'displayName' | 'registerType' | 'dataType' | 'unit'>;
  onClose: () => void;
}

/**
 * Controle inline de "Forçar valor" para um ponto Modbus comandável.
 *
 * - Coils: alternância LIGADO/DESLIGADO (1/0).
 * - Holding registers: campo numérico com a unidade do ponto (o gateway
 *   reverte escala/offset e codifica conforme o tipo de dado do cadastro).
 *
 * Sem prioridade nem "Liberar" — Modbus não tem priority array/relinquish
 * (isso é conceito BACnet). A telemetria em tempo real reflete o novo valor
 * em segundos (o gateway publica a releitura confirmada pós-escrita).
 */
export function ForceModbusValueControl({ device, point, onClose }: Props) {
  const isCoil = String(point.registerType).toLowerCase().includes('coil');
  const integerType = ['int16', 'uint16', 'int32', 'uint32'].includes(String(point.dataType));

  const [loading, setLoading] = useState(false);
  const [digitalValue, setDigitalValue] = useState<0 | 1>(1);
  const [numericValue, setNumericValue] = useState('');
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const noGateway = !device.gatewayId;

  async function send(value: number, successMessage: string) {
    setSuccess(null);
    setError(null);

    if (noGateway) {
      setError('Este equipamento não tem um gateway associado — não é possível enviar comandos.');
      return;
    }

    setLoading(true);
    try {
      const result = await writeModbusPoint({
        deviceId: device.id,
        pointId: point.id,
        value,
        pointLabel: point.displayName || point.tag,
      });
      if (result.ok) {
        setSuccess(successMessage);
      } else {
        setError(result.error ?? 'Não foi possível enviar o comando.');
      }
    } finally {
      setLoading(false);
    }
  }

  function handleForce() {
    if (isCoil) {
      void send(
        digitalValue,
        digitalValue === 1 ? 'Comando enviado: coil LIGADO.' : 'Comando enviado: coil DESLIGADO.',
      );
      return;
    }

    if (numericValue.trim() === '') {
      setError('Informe um valor numérico.');
      return;
    }
    const parsed = Number(numericValue);
    if (!Number.isFinite(parsed)) {
      setError('Informe um valor numérico válido.');
      return;
    }

    void send(parsed, `Comando enviado: ${parsed}${point.unit ? ` ${point.unit}` : ''}.`);
  }

  return (
    <div className="rounded-lg border border-cyan-200 bg-cyan-50/50 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-foreground">
          Forçar valor — <span className="font-mono">{point.displayName || point.tag}</span>
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
          Este equipamento não tem um gateway associado — não é possível enviar comandos.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        {/* Valor */}
        {isCoil ? (
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
                LIGADO
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
                DESLIGADO
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <span className="text-xs text-muted-foreground">Valor</span>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={numericValue}
                step="any"
                onChange={(e) => setNumericValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleForce(); } }}
                placeholder="Ex.: 22.5"
                className="w-28 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground focus:border-cyan-400 focus:outline-none focus:ring-1 focus:ring-cyan-400"
              />
              {point.unit && <span className="text-sm text-muted-foreground">{point.unit}</span>}
            </div>
          </div>
        )}

        {/* Ações */}
        <button
          type="button"
          disabled={loading || noGateway}
          onClick={handleForce}
          className="flex items-center gap-1.5 rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-700 disabled:opacity-50"
        >
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Enviar comando
        </button>
      </div>

      <p className="text-[11px] text-muted-foreground">
        {isCoil
          ? 'Escreve o estado no coil do equipamento (função Modbus FC05).'
          : `Escreve no holding register do equipamento respeitando a escala do cadastro${integerType ? ' (valor cru arredondado para inteiro)' : ''}.`}
      </p>

      {success && (
        <p className="flex items-center gap-1.5 text-xs font-medium text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          {success}
        </p>
      )}
      {error && <p className="text-xs font-medium text-red-700">{error}</p>}
    </div>
  );
}
