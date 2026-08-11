/**
 * Perfil BASE para switches gerenciáveis.
 *
 * Cobre métricas escalares universais (MIB-II / HOST-RESOURCES-MIB) e
 * métricas de tabela IF-MIB (uma entrada por porta física/lógica).
 *
 * Scalars:
 *   - uptime   → sysUpTime (TimeTicks, scale 0.01 → s)
 *   - cpu      → hrProcessorLoad (primeira CPU, % de uso)
 *   memory_used_pct: sem OID universal — perfis de fabricante fornecem.
 *
 * Tabela (collectionType:'table' via tableOidPrefix):
 *   - if_oper_status → ifOperStatus (1=up, 2=down)
 *   - if_in_octets   → ifInOctets  (Counter32 — gateway converte em B/s)
 *   - if_out_octets  → ifOutOctets (Counter32 — gateway converte em B/s)
 *
 * Colunas usadas apenas na descoberta de portas (sync-ports) — não publicadas
 * como telemetria, apenas lidas uma vez pelo comando de descob. de portas:
 *   - if_descr      → ifDescr     (nome da interface)
 *   - if_alias      → ifAlias     (alias configurado pelo operador)
 *   - if_high_speed → ifHighSpeed (velocidade em Mbps)
 *   - if_type       → ifType      (tipo de interface — ethernetCsmacd=6)
 *
 * priority=0: sempre fundido primeiro; perfis de fabricante (priority=10)
 * sobrescrevem campo a campo.
 */

import type { DeviceProfile } from '../types';

export const BASE_SWITCH_PROFILE: DeviceProfile = {
  id: 'base-switch',
  label: 'Padrão universal (MIB-II / IF-MIB)',
  deviceTypes: ['SWITCH'],
  priority: 0,
  mappings: [
    // ── MIB-II sysUpTime ────────────────────────────────────────────────────
    { metricKey: 'uptime', oid: '1.3.6.1.2.1.1.3.0', scale: 0.01 },

    // ── HOST-RESOURCES-MIB hrProcessorLoad (primeira CPU) ───────────────────
    { metricKey: 'cpu', oid: '1.3.6.1.2.1.25.3.3.1.2.1', scale: 1 },

    // ── IF-MIB — métricas de tabela (uma entrada por porta) ─────────────────
    // Lidas por subtree walk (tableOidPrefix); o ifIndex final é o índice.
    { metricKey: 'if_oper_status', tableOidPrefix: '1.3.6.1.2.1.2.2.1.8' },
    { metricKey: 'if_in_octets',   tableOidPrefix: '1.3.6.1.2.1.2.2.1.10' },
    { metricKey: 'if_out_octets',  tableOidPrefix: '1.3.6.1.2.1.2.2.1.16' },

    // ── IF-MIB — colunas de descoberta de portas (sync-ports) ───────────────
    // Não usadas no polling de telemetria; lidas uma vez pelo comando MQTT.
    { metricKey: 'if_descr',       tableOidPrefix: '1.3.6.1.2.1.2.2.1.2' },
    { metricKey: 'if_alias',       tableOidPrefix: '1.3.6.1.2.1.31.1.1.1.18' },
    { metricKey: 'if_high_speed',  tableOidPrefix: '1.3.6.1.2.1.31.1.1.1.15' },
    { metricKey: 'if_type',        tableOidPrefix: '1.3.6.1.2.1.2.2.1.3' },
  ],
};
