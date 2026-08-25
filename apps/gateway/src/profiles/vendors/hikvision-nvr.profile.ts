/**
 * Perfil Hikvision NVR/DVR.
 *
 * Enterprise OIDs:
 *   39165 — Hangzhou Hikvision Digital Technology (árvore de saúde confirmada
 *           em campo: CPU/uso; mesma sub-árvore .1.X das câmeras).
 *   50001 — HIKVISION-MIB OFICIAL (hikEntity = 1.3.6.1.4.1.50001.1): fornecida
 *           pelo fabricante, cobre tipo de produto, hikOnline, memória,
 *           status do dispositivo e a tabela de discos hikDiskTable.
 *
 * Escalares:
 *   cpu       → 39165.1.7.0 (confirmado em campo; a MIB oficial 50001 NÃO tem
 *               objeto de uso de CPU — só nº de CPUs e frequência).
 *   memory    → 50001.1.221.0 hikMemoryUsage (OFICIAL, 0–100 %).
 *   ram_total → 50001.1.220.0 hikMemoryCapability (OFICIAL, MB).
 *   temperature → fallback UCD (NVR Hikvision raramente expõe via SNMP).
 *
 * Tabela de discos OFICIAL (hikDiskTable) → 1.3.6.1.4.1.50001.1.241.1.<col>.<idx>
 *   col 1 hikDiskIndex     → índice (não coletado)
 *   col 2 hikDiskVolume    → nome do volume (DisplayString, só semântica/walk)
 *   col 3 hikDiskStatus    → disk_status — enum oficial:
 *         0=Normal, 1=Unformatted, 2=Abnormal, 3=Smartfailed, 4=Mismatch,
 *         5=Idle, 6=NotOnline, 10=Repairing, 11=Formatting
 *         → normalizado p/ enum canônico (0=sem disco, 1=normal, 2=erro,
 *           3=não formatado, 4=inicializando) via enumNormalize.
 *   col 4 hikDiskFreeSpace → disk_free (MB → scale 0.001 → GB)
 *   col 5 hikDiskCapability→ disk_capacity (MB → scale 0.001 → GB)
 *   disk_used não tem OID próprio: o driver deriva usado = capacidade − livre.
 *
 * Tabela de canais (hikChannelTable) → 1.3.6.1.4.1.39165.1.5.1 — NÃO consta na
 * MIB oficial 50001 mas também não é contradita por ela; mantida como
 * bestEffort (capability map marca UNSUPPORTED sem linhas — nunca erro na UI).
 *
 * priority=10: sobrescreve o perfil base campo a campo.
 */

import type { DeviceProfile } from '../types';

/**
 * Enum oficial hikDiskStatus → enum canônico de disk_status.
 * 0=Normal→1, 1=Unformatted→3, 2=Abnormal→2, 3=Smartfailed→2, 4=Mismatch→2,
 * 5=Idle→1, 6=NotOnline→0, 10=Repairing→4, 11=Formatting→4.
 */
export const HIK_DISK_STATUS_MAP: Record<number, number> = {
  0: 1,
  1: 3,
  2: 2,
  3: 2,
  4: 2,
  5: 1,
  6: 0,
  10: 4,
  11: 4,
};

export const HIKVISION_NVR_PROFILE: DeviceProfile = {
  id: 'hikvision-nvr',
  label: 'Hikvision NVR/DVR',
  deviceTypes: ['NVR'],
  priority: 10,
  bestEffort: true,
  match: {
    manufacturerContains: ['hikvision'],
    sysDescrContains: ['hikvision'],
    enterpriseNumbers: [39165],
  },
  discovery: {
    // 39165 = árvore de saúde confirmada em campo; 50001 = MIB oficial.
    walkRoots: ['1.3.6.1.4.1.39165.1', '1.3.6.1.4.1.50001.1'],
  },
  mappings: [
    // ── Escalares ─────────────────────────────────────────────────────────────
    // hikDeviceCPUUsageRate — uso de CPU (0..100 %); confirmado em campo.
    // (A MIB oficial 50001 não tem objeto de USO de CPU.)
    { metricKey: 'cpu', oid: '1.3.6.1.4.1.39165.1.7.0', scale: 1 },

    // hikMemoryUsage — OFICIAL (HIKVISION-MIB 50001), uso de RAM 0..100 %.
    { metricKey: 'memory', oid: '1.3.6.1.4.1.50001.1.221.0', scale: 1 },

    // hikMemoryCapability — OFICIAL, RAM total (MB).
    { metricKey: 'ram_total', oid: '1.3.6.1.4.1.50001.1.220.0', scale: 1 },

    // Temperatura: NVR Hikvision raramente expõe via SNMP; fallback UCD
    { metricKey: 'temperature', oid: '1.3.6.1.4.1.2021.13.16.2.1.3.1', scale: 0.001 },

    // sysUpTime padrão MIB-II
    { metricKey: 'uptime', oid: '1.3.6.1.2.1.1.3.0', scale: 0.01 },

    // ── Tabela de discos OFICIAL (hikDiskTable, 50001.1.241.1) ───────────────
    // col 3 = hikDiskStatus (enum oficial → canônico via enumNormalize).
    {
      metricKey: 'disk_status',
      tableOidPrefix: '1.3.6.1.4.1.50001.1.241.1.3',
      enumNormalize: HIK_DISK_STATUS_MAP,
    },
    // col 5 = hikDiskCapability em MB → scale 0.001 → GB.
    { metricKey: 'disk_capacity', tableOidPrefix: '1.3.6.1.4.1.50001.1.241.1.5', scale: 0.001 },
    // col 4 = hikDiskFreeSpace em MB → scale 0.001 → GB; o driver deriva
    // disk_used = disk_capacity − disk_free por slot (disk_used sem OID próprio).
    { metricKey: 'disk_free', tableOidPrefix: '1.3.6.1.4.1.50001.1.241.1.4', scale: 0.001 },

    // ── Tabela de canais (hikChannelTable, não-oficial, bestEffort) ──────────
    // Prefixo: 1.3.6.1.4.1.39165.1.5.1.<coluna>.<channelIndex>
    { metricKey: 'channel_status', tableOidPrefix: '1.3.6.1.4.1.39165.1.5.1.1' },
  ],
};
