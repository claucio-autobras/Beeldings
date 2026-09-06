'use client';

import { useState } from 'react';

import { authHeaders } from '@/lib/api-client';
import { translateDeviceError } from '@/modules/devices/utils/device-errors';

interface WriteBacnetParams {
  tenantId: string;
  gatewayId: string;
  ip: string;
  port: number;
  objectType: number;
  objectInstance: number;
  /** Valor a forçar. `null` = liberar o override (relinquish) na prioridade informada. */
  value: number | null;
  priority?: number;
  /** Rótulo legível do ponto — usado na trilha de auditoria/dashboard. */
  pointLabel?: string;
  /** Id do Device comandado — usado só pela trilha de auditoria (site no dashboard). */
  deviceId?: string;
}

interface WriteBacnetResult {
  loading: boolean;
  error: string | null;
  write: (params: WriteBacnetParams) => Promise<boolean>;
}

/**
 * useBacnetWrite
 *
 * Envia um comando de escrita BACnet para o backend.
 * O backend publica via MQTT para o gateway, que executa WriteProperty.
 *
 * @returns loading, error, write(params) → true se sucesso
 */
export function useBacnetWrite(): WriteBacnetResult {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function write(params: WriteBacnetParams): Promise<boolean> {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/devices/bacnet/write', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(params),
      });

      const data = await res.json() as { success?: boolean; error?: string; message?: string };

      if (!res.ok || !data.success) {
        const raw = data.error ?? data.message ?? `Erro HTTP ${res.status}`;
        setError(
          translateDeviceError(raw, {
            ip: params.ip,
            port: params.port,
            fallback: 'Não foi possível enviar o comando ao dispositivo. Tente novamente.',
          }),
        );
        return false;
      }

      return true;
    } catch (err) {
      setError(
        translateDeviceError(err, {
          ip: params.ip,
          port: params.port,
          fallback: 'Não foi possível enviar o comando ao dispositivo. Tente novamente.',
        }),
      );
      return false;
    } finally {
      setLoading(false);
    }
  }

  return { loading, error, write };
}
