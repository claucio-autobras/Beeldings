/**
 * Perfil BASE para controladoras de acesso IP.
 *
 * Baseado em MIB-II, UCD-SNMP e HOST-RESOURCES-MIB — padrão amplamente
 * suportado em dispositivos com firmware Linux embarcado. Garante coleta
 * mínima em qualquer controladora sem perfil de fabricante reconhecido.
 *
 * Os mesmos OIDs do BASE_CAMERA_PROFILE se aplicam aqui porque a maioria
 * das controladoras industriais corre um kernel Linux e expõe o Net-SNMP
 * com as mesmas MIBs genéricas.
 *
 * priority=0: sempre fundido primeiro; perfis de fabricante (priority=10)
 * sobrescrevem campo a campo.
 */

import type { DeviceProfile } from '../types';

export const BASE_ACCESS_CONTROLLER_PROFILE: DeviceProfile = {
  id: 'base-access-controller',
  label: 'Padrão universal (MIB-II / UCD)',
  deviceTypes: ['ACCESS_CONTROLLER'],
  priority: 0,
  mappings: [
    // ── MIB-II sysUpTime ────────────────────────────────────────────────────
    // TimeTicks (centésimos de segundo → scale 0.01 → s).
    { metricKey: 'uptime', oid: '1.3.6.1.2.1.1.3.0', scale: 0.01 },

    // ── MIB-II IF-MIB descartes (interface 1) ───────────────────────────────
    { metricKey: 'packet_loss', oid: '1.3.6.1.2.1.2.2.1.13.1', scale: 1 },

    // ── HOST-RESOURCES-MIB hrProcessorLoad (primeira CPU) ───────────────────
    { metricKey: 'cpu', oid: '1.3.6.1.2.1.25.3.3.1.2.1', scale: 1 },

    // ── UCD-SNMP memAvailReal (kB de RAM disponível) ─────────────────────────
    { metricKey: 'memory', oid: '1.3.6.1.4.1.2021.4.6.0', scale: 1 },

    // ── UCD lm-sensors temperatura (mili-°C → scale 0.001 → °C) ─────────────
    { metricKey: 'temperature', oid: '1.3.6.1.4.1.2021.13.16.2.1.3.1', scale: 0.001 },
  ],
};
