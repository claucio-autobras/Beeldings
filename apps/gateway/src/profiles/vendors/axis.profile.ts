/**
 * Perfil Axis Communications — câmeras IP Axis.
 *
 * Axis usa OIDs genéricos (MIB-II/HOST-RESOURCES) para a maioria das métricas,
 * mas tem MIB proprietária para temperatura (AXIS-VIDEO-MIB).
 *
 * Nota: Axis reporta temperatura em °C direto (inteiro), sem escala.
 *
 * priority=10.
 */

import type { DeviceProfile } from '../types';

export const AXIS_PROFILE: DeviceProfile = {
  id: 'axis',
  label: 'Axis',
  deviceTypes: ['CAMERA'],
  priority: 10,
  match: {
    manufacturerContains: ['axis'],
    sysDescrContains: ['axis', 'axis communications'],
  },
  mappings: [
    // ── Temperatura via AXIS-VIDEO-MIB ────────────────────────────────────────
    // axisTemperatureSensorValue (.1.3.6.1.4.1.368.4.1.3.1.4.1) — °C inteiro.
    // Sobrescreve o lm-sensors genérico do perfil base (que raramente está
    // disponível em Axis).
    { metricKey: 'temperature', oid: '1.3.6.1.4.1.368.4.1.3.1.4.1', scale: 1 },
  ],
};
