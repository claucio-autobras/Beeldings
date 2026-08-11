/**
 * Perfil Hikvision NVR/DVR.
 *
 * Enterprise OID: 1.3.6.1.4.1.39165 (Hangzhou Hikvision Digital Technology).
 * Mesmo enterprise das câmeras Hikvision — separado pelo deviceTypes:['NVR'].
 *
 * Escalares: reutilizam a mesma sub-árvore .1.X das câmeras (CPU, RAM uso,
 * RAM total, temperatura via UCD). A árvore de armazenamento SD das câmeras
 * (.1.9.0) é substituída pela tabela de discos HDD do NVR.
 *
 * Tabelas (MIB HIKVISION-NVR / hikHddTable e hikChannelTable):
 *   hikHddTable        → 1.3.6.1.4.1.39165.1.4.1   (linha por slot de HD)
 *     col 1 hikHddStatus     → disk_status    (0=sem disco, 1=normal, 2=erro,
 *                                              3=não formatado, 4=inicializando)
 *     col 2 hikHddCapacity   → disk_capacity  (GB, INTEGER)
 *     col 3 hikHddFreeSpace  → disk_used       (espaço LIVRE em GB;
 *                                               backend calcula %: usado=cap-free)
 *
 *   hikChannelTable    → 1.3.6.1.4.1.39165.1.5.1   (linha por canal de vídeo)
 *     col 1 hikChannelStatus → channel_status (0=offline, 1=idle/normal,
 *                                              2=gravando, 3=teste)
 *
 * NOTA DE RISCO: os prefixos de tabela foram extraídos da HIKVISION-NVR-MIB
 * publicada em documentação DS-7xxx/DS-9xxx. Firmwares mais antigos ou modelos
 * DVR podem usar sub-árvore diferente (.1.6.1 / .1.7.1). Manter bestEffort no
 * nível do perfil; o capability map marcará UNSUPPORTED quando o walk não retornar
 * linhas — nunca erro na UI.
 *
 * priority=10: sobrescreve o perfil base campo a campo.
 */

import type { DeviceProfile } from '../types';

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
  mappings: [
    // ── Escalares Hikvision (idênticos ao perfil de câmera) ──────────────────
    // hikDeviceCPUUsageRate — uso de CPU (0..100 %)
    { metricKey: 'cpu', oid: '1.3.6.1.4.1.39165.1.7.0', scale: 1 },

    // hikDeviceMemUsedRate — uso de RAM (0..100 %)
    // Uso de memória (%) — métrica canônica de RAM para NVR.
    { metricKey: 'memory', oid: '1.3.6.1.4.1.39165.1.11.0', scale: 1 },

    // Temperatura: NVR Hikvision raramente expõe via SNMP; fallback UCD
    { metricKey: 'temperature', oid: '1.3.6.1.4.1.2021.13.16.2.1.3.1', scale: 0.001 },

    // sysUpTime padrão MIB-II
    { metricKey: 'uptime', oid: '1.3.6.1.2.1.1.3.0', scale: 0.01 },

    // ── Tabela de discos (hikHddTable) ───────────────────────────────────────
    // Prefixo: 1.3.6.1.4.1.39165.1.4.1.<coluna>.<slotIndex>
    { metricKey: 'disk_status',   tableOidPrefix: '1.3.6.1.4.1.39165.1.4.1.1' },
    { metricKey: 'disk_capacity', tableOidPrefix: '1.3.6.1.4.1.39165.1.4.1.2' },
    // col 3 = hikHddFreeSpace → espaço LIVRE (GB), não usado.
    // Métrica disk_free captura o valor bruto; o driver deriva
    // disk_used = disk_capacity - disk_free para cada slot.
    // disk_used não tem OID próprio na Hikvision-NVR-MIB.
    { metricKey: 'disk_free',     tableOidPrefix: '1.3.6.1.4.1.39165.1.4.1.3' },

    // ── Tabela de canais (hikChannelTable) ───────────────────────────────────
    // Prefixo: 1.3.6.1.4.1.39165.1.5.1.<coluna>.<channelIndex>
    { metricKey: 'channel_status', tableOidPrefix: '1.3.6.1.4.1.39165.1.5.1.1' },
  ],
};
