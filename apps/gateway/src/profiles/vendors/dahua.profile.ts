/**
 * Perfil Dahua — câmeras IP e NVRs Dahua.
 *
 * Enterprise OID: 1.3.6.1.4.1.1004849 (Zhejiang Dahua Technology).
 * Fonte oficial: "Dahua Product Management Information Library" —
 * root 1.3.6.1.4.1.1004849.2 (a sub-árvore …1004849.1 é do ipSAN, NÃO de
 * câmeras/NVRs):
 *   cpuUsage     → 2.1.3.0    (escalar INTEGER 0–100)
 *   memoryUsage  → 2.1.9.2.0  (INTEGER 0–100 %)
 * A doc oficial NÃO define objeto de temperatura — o fallback UCD do perfil
 * base cobre firmwares que o exponham.
 *
 * NOTE: Intelbras (OEM Dahua) usa a MESMA árvore de OIDs mas está no perfil
 * intelbras.profile.ts com bestEffort=true por bug de firmware.
 *
 * priority=10.
 */

import type { DeviceProfile } from '../types';

export const DAHUA_PROFILE: DeviceProfile = {
  id: 'dahua',
  label: 'Dahua',
  deviceTypes: ['CAMERA'],
  priority: 10,
  match: {
    manufacturerContains: ['dahua'],
    sysDescrContains: ['dahua'],
    enterpriseNumbers: [1004849],
  },
  discovery: {
    // Árvore oficial de produto (systemInfo/networkInfo/storageInfo/products).
    walkRoots: ['1.3.6.1.4.1.1004849.2'],
  },
  mappings: [
    // ── CPU — cpuUsage oficial (escalar, 0..100 %) ────────────────────────────
    { metricKey: 'cpu', oid: '1.3.6.1.4.1.1004849.2.1.3.0', scale: 1 },

    // ── Memória — memoryInfo.memoryUsage oficial (0..100 %) ──────────────────
    { metricKey: 'memory', oid: '1.3.6.1.4.1.1004849.2.1.9.2.0', scale: 1 },

    // Temperatura: SEM objeto na doc oficial Dahua — o fallback UCD do perfil
    // base (1.3.6.1.4.1.2021.13.16.2.1.3.1) permanece ativo por herança.
  ],
};
