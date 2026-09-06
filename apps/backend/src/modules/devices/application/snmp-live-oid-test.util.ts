/**
 * Teste de OID ao vivo (descoberta/diagnóstico): lê o valor ATUAL de um OID
 * pelo gateway antes de aplicá-lo, mostrando tipo ASN.1, valor bruto e valor
 * normalizado (com a escala da semântica quando conhecida).
 *
 * Compartilhado entre SCA (controladoras) e CFTV (câmeras/NVRs). Reusa o
 * canal de teste SNMP do gateway (command 'test' + resultado por MQTT) — sem
 * nenhum ramo por fabricante: interpretação 100% via snmp-oid-semantics.
 */

import { BadRequestException } from '@nestjs/common';
import type { DeviceStatusService } from '../../mqtt/device-status.service.js';
import type { SnmpHealthTestService } from './snmp-health-test.service.js';
import { checkSnmpPlausibility, classifySnmpOid } from './snmp-oid-semantics.js';

const OID_PATTERN = /^\d+(\.\d+)+$/;
const DEFAULT_SNMP_PORT = 161;

interface DeviceLike {
  id: string;
  tenantId: string;
  gatewayId: string | null;
  ip: string | null;
  port: number | null;
  config: unknown;
}

export interface LiveOidTestResult {
  success: true;
  /** O equipamento respondeu ao SNMP. */
  reachable: boolean;
  /** O OID testado respondeu com valor. */
  responded: boolean;
  oid: string;
  /** Valor bruto textual (gateway ≥1.22; null em gateways antigos). */
  raw: string | null;
  /** Tipo ASN.1 ('OctetString', 'Gauge32', …; null em gateways antigos). */
  type: string | null;
  /** Valor numérico como o gateway normaliza ("23.436" → 23.436). */
  value: number | null;
  /** Valor após a escala da semântica (ex.: 91991 × 0.001 → 91.99). */
  normalized: number | null;
  /** Interpretação conhecida do OID (null = OID desconhecido). */
  semantic: {
    label: string;
    category: string;
    unit: string | null;
    scale: number;
    /** false = valor real incompatível com o esperado (não confirmado). */
    confirmed: boolean;
  } | null;
}

export async function runLiveOidTest(
  snmpHealthTest: SnmpHealthTestService,
  deviceStatus: DeviceStatusService,
  device: DeviceLike,
  rawOid: string | undefined,
): Promise<LiveOidTestResult | { success: false; error: string }> {
  const oid = rawOid?.trim() ?? '';
  if (!OID_PATTERN.test(oid)) {
    throw new BadRequestException('OID inválido (esperado formato numérico x.y.z…)');
  }
  if (!device.gatewayId) {
    throw new BadRequestException('Equipamento sem gateway associado');
  }
  if (deviceStatus.getStatus(device.gatewayId) === 'offline') {
    throw new BadRequestException(
      'Gateway offline — o teste ao vivo precisa do gateway para falar com o equipamento.',
    );
  }
  if (!device.ip) {
    throw new BadRequestException('Equipamento sem IP configurado');
  }

  const cfg = (device.config ?? {}) as {
    snmpVersion?: '1' | '2c';
    community?: string;
    snmpCommunity?: string;
    snmpPort?: number;
  };

  const result = await snmpHealthTest.test({
    tenantId: device.tenantId,
    gatewayId: device.gatewayId,
    ip: device.ip,
    port: cfg.snmpPort || device.port || DEFAULT_SNMP_PORT,
    snmpVersion: cfg.snmpVersion === '1' ? '1' : '2c',
    community: (cfg.community ?? cfg.snmpCommunity ?? 'public').trim() || 'public',
    oids: { probe: oid },
  });

  if (!result.success) {
    return { success: false as const, error: result.error };
  }

  const detail = result.details?.probe ?? null;
  const value = detail?.value ?? result.values.probe ?? null;
  const raw = detail?.raw ?? (value !== null ? String(value) : null);
  const type = detail?.type ?? null;
  const responded = value !== null || (raw !== null && raw !== '');

  const semantic = classifySnmpOid(oid);
  const scale = semantic?.scale ?? 1;
  const confirmed = semantic
    ? checkSnmpPlausibility(semantic, type ?? undefined, raw ?? '')
    : true;

  return {
    success: true as const,
    reachable: result.reachable,
    responded,
    oid,
    raw,
    type,
    value,
    normalized: value !== null ? value * scale : null,
    semantic: semantic
      ? {
          label: semantic.name,
          category: semantic.category,
          unit: semantic.unit ?? null,
          scale,
          confirmed,
        }
      : null,
  };
}
