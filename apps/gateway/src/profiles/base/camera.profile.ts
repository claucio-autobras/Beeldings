/**
 * Perfil BASE para câmeras IP.
 *
 * Baseado em MIB-II, UCD-SNMP e HOST-RESOURCES-MIB — padrões suportados pela
 * maioria dos dispositivos com agent SNMP embutido. Garante coleta mínima em
 * qualquer câmera sem perfil de fabricante reconhecido.
 *
 * priority=0: sempre fundido primeiro; perfis de fabricante (priority=10)
 * sobrescrevem campo a campo.
 */

import type { DeviceProfile } from '../types';

export const BASE_CAMERA_PROFILE: DeviceProfile = {
  id: 'base-camera',
  label: 'Padrão universal (MIB-II / UCD)',
  deviceTypes: ['CAMERA'],
  priority: 0,
  mappings: [
    // ── MIB-II sysUpTime ────────────────────────────────────────────────────
    // 1.3.6.1.2.1.1.3.0 — TimeTicks (centésimos de segundo → scale 0.01 → s).
    { metricKey: 'uptime', oid: '1.3.6.1.2.1.1.3.0', scale: 0.01 },

    // ── MIB-II IF-MIB descartes e erros (interface 1) ───────────────────────
    // Usado como proxy de congestionamento / perda de pacote na camada Ethernet.
    // Interface/índice são resolvidos na descoberta e persistidos no binding.
    { metricKey: 'packet_loss' },

    // ── HOST-RESOURCES-MIB hrProcessorLoad (primeira CPU, índice .1) ────────
    // Percentual de uso de CPU conforme RFC 2790. Nem todo firmware suporta.
    { metricKey: 'cpu', tableOidPrefix: '1.3.6.1.2.1.25.3.3.1.2', scale: 1 },

    // ── UCD-SNMP memAvailReal (kB de RAM disponível) ─────────────────────────
    // Enterprise 2021 = UCD-SNMP (Net-SNMP). Largamente suportado em Linux
    // embarcado. Onde presente, costuma ser mais preciso que OIDs de fabricante.
    { metricKey: 'ram_total', oid: '1.3.6.1.2.1.25.2.2.0', scale: 1024, },
    // UCD memAvailReal (kB de RAM disponível), quando exposto pelo firmware.
    { metricKey: 'memory', oid: '1.3.6.1.4.1.2021.4.6.0', scale: 1 },

    // ── UCD lm-sensors temperatura (mili-°C → scale 0.001 → °C) ─────────────
    // Nem todo firmware compila suporte a lm-sensors; o OID simplesmente
    // não responde nesses casos → ponto publicado como null (sem erro).
    { metricKey: 'temperature', oid: '1.3.6.1.4.1.2021.13.16.2.1.3.1', scale: 0.001 },
  ],
};
