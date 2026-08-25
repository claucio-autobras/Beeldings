/**
 * Perfil Hikvision — câmeras IP e NVRs.
 *
 * Enterprise OID: 1.3.6.1.4.1.39165 (Hangzhou Hikvision Digital Technology).
 * Suporta coleta SNMP proprietária + fallback ISAPI para uptime real.
 *
 * priority=10: sobrescreve o perfil base campo a campo.
 */

import type { DeviceProfile } from '../types';

export const HIKVISION_PROFILE: DeviceProfile = {
  id: 'hikvision',
  label: 'Hikvision',
  // Hikvision DS-K access controllers share the same enterprise OID tree (39165)
  // and expose CPU/memory/uptime via the same MIB as cameras.
  deviceTypes: ['CAMERA', 'ACCESS_CONTROLLER'],
  priority: 10,
  match: {
    manufacturerContains: ['hikvision'],
    sysDescrContains: ['hikvision'],
    enterpriseNumbers: [39165],
  },
  discovery: {
    // 39165 = árvore confirmada em campo (escalares de saúde);
    // 50001 = HIKVISION-MIB oficial (hikEntity: tipo de produto, hikOnline,
    // memória %, status do dispositivo, hikDiskTable).
    walkRoots: ['1.3.6.1.4.1.39165.1', '1.3.6.1.4.1.50001.1'],
  },
  mappings: [
    // ── CPU ──────────────────────────────────────────────────────────────────
    // hikDeviceCPUUsageRate — responde percentual direto (0..100).
    { metricKey: 'cpu', oid: '1.3.6.1.4.1.39165.1.7.0', scale: 1 },

    // ── Memória ───────────────────────────────────────────────────────────────
    // hikDeviceMemUsedRate (usage %) — sobrescreve UCD memAvailReal do base.
    // Hikvision reporta uso, não livre: o ponto deve ter isso documentado na
    // tag (ex. MEM_USED_PCT). Mantemos a chave 'memory' para compatibilidade.
    { metricKey: 'memory', oid: '1.3.6.1.4.1.39165.1.11.0', scale: 1 },

    // ── RAM total ─────────────────────────────────────────────────────────────
    // hikDeviceMemTotalSize — RAM total em MB.
    { metricKey: 'ram_total', oid: '1.3.6.1.4.1.39165.1.10.0', scale: 1 },

    // ── Armazenamento ─────────────────────────────────────────────────────────
    // hikDeviceHdUsageRate — taxa de uso do HD primário (%).
    { metricKey: 'storage', oid: '1.3.6.1.4.1.39165.1.9.0', scale: 1 },

    // ── Uptime real via ISAPI ─────────────────────────────────────────────────
    // ISAPI: GET /ISAPI/System/status → <DeviceInfo><uptime>. Mais preciso que
    // sysUpTime (que reseta a cada reinicialização do agent, não do sistema).
    // httpKind='isapi' → excluído do batch SNMP, lido separadamente.
    { metricKey: 'uptime', httpKind: 'isapi' },
  ],
};
