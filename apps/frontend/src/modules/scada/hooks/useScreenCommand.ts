'use client';

import { useCallback } from 'react';
import { writeBacnetPoint, writeModbusPoint, writeMqttPoint } from '@/modules/devices/services/devices.service';
import type { ModbusPoint, MqttPoint } from '@/modules/devices/types/device.types';
import { setVirtualPointValue } from '../services/simulator.service';
import { setPendingCommand, clearPendingCommand } from '../store/pending-commands.store';
import type { ScreenDevice, VirtualPoint } from '../types/virtual.types';

/** BACnet objectType (string nos pontos) → número usado na escrita. */
const OBJECT_TYPE_NUM: Record<string, number> = {
  AI: 0, AO: 1, AV: 2, BI: 3, BO: 4, BV: 5, MSI: 13, MSO: 14,
};

/** Tipos de objeto BACnet que aceitam escrita (saídas/valores comandáveis). */
const WRITABLE_TYPES = new Set(['AO', 'AV', 'BO', 'BV', 'MSO']);

/** Modbus: só holding registers e coils aceitam escrita (input/discrete são somente leitura). */
function isModbusWritableType(registerType: string | undefined): boolean {
  const t = String(registerType ?? '').toLowerCase();
  return t.includes('holding') || t.includes('coil');
}

export interface SendCommandResult {
  ok: boolean;
  error?: string;
  /**
   * Aviso brando (não é falha): comando publicado mas sem confirmação do
   * dispositivo (ex.: resposta RPC do Shelly não casou/atrasou). A telemetria
   * de readback ou o TTL do pendente reconciliam o estado visual.
   */
  warning?: string;
}

export type SendCommand = (
  deviceId: string,
  tag: string,
  value: number,
  priority?: number,
) => Promise<SendCommandResult>;

/**
 * true se o ponto (do cadastro) é comandável:
 * - BACnet: tipos de saída/valor (AO/AV/BO/BV/MSO);
 * - MQTT-nativo: pontos com binding de escrita configurado (ex.: relé Shelly);
 * - Modbus: holding registers e coils;
 * - Virtual (bancada de teste): pontos digitais e analógicos (o simulador aceita escrita).
 */
export function isWritablePoint(device: ScreenDevice | undefined, tag: string): boolean {
  if (!device) return false;
  if (device.protocol === 'bacnet') {
    const point = device.points.find((p) => p.tag === tag);
    return Boolean(point && WRITABLE_TYPES.has(point.objectType));
  }
  if (device.protocol === 'modbus') {
    const point = (device.points as unknown as ModbusPoint[]).find((p) => p.tag === tag);
    return Boolean(point && isModbusWritableType(point.registerType));
  }
  if (device.protocol === 'mqtt') {
    const point = (device.points as MqttPoint[]).find((p) => p.tag === tag);
    return Boolean(point?.write?.commandTopic && point.write.payloadTemplate);
  }
  if (device.protocol === 'virtual') {
    const point = (device.points as VirtualPoint[]).find((p) => p.tag === tag);
    return Boolean(point && (point.kind === 'digital' || point.kind === 'analog'));
  }
  return false;
}

/**
 * true se o ponto é analógico comandável (para o slider):
 * - BACnet: AO/AV;
 * - MQTT: binding de escrita + valueType numérico;
 * - Modbus: holding register (coil é digital);
 * - Virtual: ponto analógico da bancada.
 */
export function isWritableAnalogPoint(device: ScreenDevice | undefined, tag: string): boolean {
  if (!device || !isWritablePoint(device, tag)) return false;
  const point = device.points.find((p) => p.tag === tag);
  if (!point) return false;
  if (device.protocol === 'bacnet') {
    return ['AO', 'AV'].includes((point as { objectType: string }).objectType);
  }
  if (device.protocol === 'modbus') {
    const t = String((point as unknown as ModbusPoint).registerType ?? '').toLowerCase();
    return t.includes('holding');
  }
  if (device.protocol === 'mqtt') {
    return (point as MqttPoint).valueType === 'number';
  }
  if (device.protocol === 'virtual') {
    return (point as VirtualPoint).kind === 'analog';
  }
  return false;
}

/**
 * Resolve a função de envio de comandos para um conjunto de controladoras.
 * Caminhos de escrita: BACnet (write-property), MQTT-nativo (binding de
 * escrita, ex.: relé Shelly Gen4) e Modbus (holding register/coil).
 * Pontos SNMP retornam erro amigável.
 */
export function useScreenCommand(devices: ScreenDevice[]): SendCommand {
  return useCallback<SendCommand>(
    async (deviceId, tag, value, priority) => {
      const device = devices.find((d) => d.id === deviceId);
      if (!device) return { ok: false, error: 'Controladora não encontrada' };

      if (device.protocol === 'mqtt') {
        const point = (device.points as MqttPoint[]).find((p) => p.tag === tag);
        if (!point) {
          return { ok: false, error: 'Ponto não encontrado na controladora' };
        }
        if (!point.write?.commandTopic || !point.write.payloadTemplate) {
          return { ok: false, error: 'Ponto MQTT sem comando configurado (somente leitura)' };
        }
        // Feedback otimista compartilhado: todos os widgets do ponto refletem o
        // valor comandado na hora; descartado se o comando falhar.
        setPendingCommand(deviceId, tag, value);
        const mqttResult = await writeMqttPoint({
          deviceId: device.id,
          pointId: point.id,
          value: point.valueType === 'boolean' ? Boolean(value) : value,
          pointLabel: point.displayName || point.tag,
        });
        if (!mqttResult.ok) {
          clearPendingCommand(deviceId, tag);
          return mqttResult;
        }
        // Sucesso "enviado, sem confirmação" (confirmed=false): não é falha —
        // o pendente otimista segue até a telemetria confirmar ou o TTL expirar.
        if (mqttResult.confirmed === false) {
          return { ok: true, warning: 'Comando enviado — aguardando confirmação do dispositivo' };
        }
        return mqttResult;
      }

      if (device.protocol === 'modbus') {
        const point = (device.points as unknown as ModbusPoint[]).find((p) => p.tag === tag);
        if (!point) {
          return { ok: false, error: 'Ponto não encontrado na controladora' };
        }
        if (!isModbusWritableType(point.registerType)) {
          return { ok: false, error: 'Registrador Modbus somente leitura (apenas holding e coil aceitam escrita)' };
        }
        if (!device.gatewayId) {
          return { ok: false, error: 'Controladora sem gateway associado' };
        }
        // Feedback otimista compartilhado: todos os widgets do ponto refletem o
        // valor comandado na hora; descartado se o comando falhar.
        setPendingCommand(deviceId, tag, value);
        const modbusResult = await writeModbusPoint({
          deviceId: device.id,
          pointId: point.id,
          value,
          pointLabel: point.displayName || point.tag,
        });
        if (!modbusResult.ok) clearPendingCommand(deviceId, tag);
        return modbusResult;
      }

      if (device.protocol === 'virtual') {
        const point = (device.points as VirtualPoint[]).find((p) => p.tag === tag);
        if (!point) {
          return { ok: false, error: 'Ponto não encontrado na controladora' };
        }
        if (point.kind !== 'digital' && point.kind !== 'analog') {
          return { ok: false, error: 'Ponto virtual multistate não é comandável por aqui' };
        }
        // Feedback otimista compartilhado: todos os widgets do ponto refletem o
        // valor comandado na hora; descartado se o comando falhar.
        setPendingCommand(deviceId, tag, value);
        try {
          await setVirtualPointValue(device.id, point.id, point.kind === 'digital' ? Boolean(value) : value);
          return { ok: true };
        } catch (err) {
          clearPendingCommand(deviceId, tag);
          return { ok: false, error: err instanceof Error ? err.message : 'Falha ao escrever no ponto virtual' };
        }
      }

      if (device.protocol !== 'bacnet') {
        return { ok: false, error: 'Comando disponível apenas para pontos BACnet ou MQTT' };
      }
      const point = device.points.find((p) => p.tag === tag);
      if (!point) {
        return { ok: false, error: 'Ponto não encontrado na controladora' };
      }
      if (!WRITABLE_TYPES.has(point.objectType)) {
        return { ok: false, error: `Ponto ${point.objectType} não é comandável (somente leitura)` };
      }
      if (!device.gatewayId) {
        return { ok: false, error: 'Controladora sem gateway associado' };
      }
      const objectType = OBJECT_TYPE_NUM[point.objectType];
      if (objectType === undefined) {
        return { ok: false, error: `Tipo de objeto desconhecido: ${point.objectType}` };
      }
      // Feedback otimista compartilhado: todos os widgets do ponto refletem o
      // valor comandado na hora; descartado se o comando falhar.
      setPendingCommand(deviceId, tag, value);
      const result = await writeBacnetPoint({
        tenantId: device.tenantId,
        gatewayId: device.gatewayId,
        ip: device.ip,
        port: device.port,
        objectType,
        objectInstance: point.instance,
        value,
        priority,
        pointLabel: ('objectName' in point && point.objectName) || point.tag,
        deviceId: device.id,
      });
      if (!result.ok) clearPendingCommand(deviceId, tag);
      return result;
    },
    [devices],
  );
}
