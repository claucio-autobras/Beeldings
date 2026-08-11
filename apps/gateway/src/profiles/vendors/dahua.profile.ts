/**
 * Perfil Dahua — câmeras IP e NVRs Dahua.
 *
 * Enterprise OID: 1.3.6.1.4.1.1004849 (Zhejiang Dahua Technology).
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
  mappings: [
    // ── CPU (percentual de uso, 0..100) ───────────────────────────────────────
    { metricKey: 'cpu', oid: '1.3.6.1.4.1.1004849.2.1.3.1.1.1', scale: 1 },

    // ── Memória livre (kB) ───────────────────────────────────────────────────
    { metricKey: 'memory', oid: '1.3.6.1.4.1.1004849.2.1.3.2.1.1', scale: 1 },

    // ── Temperatura (°C) ─────────────────────────────────────────────────────
    { metricKey: 'temperature', oid: '1.3.6.1.4.1.1004849.2.1.3.3.1.1', scale: 1 },
  ],
};
