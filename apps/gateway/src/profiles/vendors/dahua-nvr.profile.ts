/**
 * Perfil Dahua NVR/DVR.
 *
 * Enterprise OID: 1.3.6.1.4.1.1004849 (Zhejiang Dahua Technology).
 * Mesmo enterprise das câmeras Dahua — separado pelo deviceTypes:['NVR'].
 *
 * Escalares: reutilizam a sub-árvore de sistema das câmeras (2.1.3.*).
 *
 * Tabelas (DAHUA-NVR-MIB):
 *   dskTable (discos)    → 1.3.6.1.4.1.1004849.1.1.1   (linha por slot de HD)
 *     col 1 dskIndex    → (índice, não coletado)
 *     col 2 dskStatus   → disk_status    (0=normal, 1=erro, 2=sem disco,
 *                                         3=não formatado, 4=formatando)
 *     col 3 dskCapacity → disk_capacity  (MB — scale 0.001 → GB na UI;
 *                                         NOTA: Dahua usa MB, não GB)
 *     col 4 dskUsed     → disk_used      (MB)
 *
 *   chnTable (canais)    → 1.3.6.1.4.1.1004849.1.2.1   (linha por canal)
 *     col 2 chnStatus   → channel_status (0=offline, 1=idle, 2=gravando,
 *                                         3=motion, 4=alarme)
 *
 * NOTA DE RISCO: a sub-árvore 1.3.6.1.4.1.1004849.1.X é específica de NVR/DVR
 * Dahua e pouco documentada publicamente. OIDs foram levantados de dumps de MIB
 * disponíveis na comunidade. Manter bestEffort=true; o capability map marcará
 * UNSUPPORTED quando o walk não retornar linhas.
 *
 * Intelbras NVR: usa a mesma árvore Dahua (OEM). O perfil intelbras-nvr.profile.ts
 * herda estes OIDs com bestEffort=true e sentinelas=[0].
 *
 * priority=10.
 */

import type { DeviceProfile } from '../types';

export const DAHUA_NVR_PROFILE: DeviceProfile = {
  id: 'dahua-nvr',
  label: 'Dahua NVR/DVR',
  deviceTypes: ['NVR'],
  priority: 10,
  bestEffort: true,
  match: {
    manufacturerContains: ['dahua'],
    sysDescrContains: ['dahua'],
    // enterprise 1004849 é ambíguo Dahua/Intelbras — sem cadastro manual o
    // motor escolhe Intelbras (perfil conservador, priority=11). Dahua só é
    // selecionado com cadastro manual de fabricante.
  },
  mappings: [
    // ── Escalares (idênticos ao perfil de câmera Dahua) ──────────────────────
    { metricKey: 'cpu',         oid: '1.3.6.1.4.1.1004849.2.1.3.1.1.1', scale: 1 },
    { metricKey: 'memory',      oid: '1.3.6.1.4.1.1004849.2.1.3.2.1.1', scale: 1 },
    { metricKey: 'temperature', oid: '1.3.6.1.4.1.1004849.2.1.3.3.1.1', scale: 1 },
    { metricKey: 'uptime',      oid: '1.3.6.1.2.1.1.3.0', scale: 0.01 },

    // ── Tabela de discos (dskTable) ──────────────────────────────────────────
    // Prefixo: 1.3.6.1.4.1.1004849.1.1.1.<coluna>.<slotIndex>
    // NOTA: col 1 = dskIndex (auto-incremento, ignorado); status na col 2.
    // UNIDADE: col 3/4 reportam MB (não GB). scale: 0.001 → GB.
    // disk_status Dahua raw: 0=normal, 1=erro, 2=sem disco, 3=não formatado, 4=formatando
    // Enum canônico (Hikvision):  0=sem disco, 1=normal, 2=erro, 3=não formatado, 4=inicializando
    // enumNormalize transforma raw→canônico; chaves ausentes passam inalteradas.
    {
      metricKey: 'disk_status',
      tableOidPrefix: '1.3.6.1.4.1.1004849.1.1.1.2',
      enumNormalize: { 0: 1, 1: 2, 2: 0 },
    },
    { metricKey: 'disk_capacity', tableOidPrefix: '1.3.6.1.4.1.1004849.1.1.1.3', scale: 0.001 },
    { metricKey: 'disk_used',     tableOidPrefix: '1.3.6.1.4.1.1004849.1.1.1.4', scale: 0.001 },

    // ── Tabela de canais (chnTable) ──────────────────────────────────────────
    // Prefixo: 1.3.6.1.4.1.1004849.1.2.1.<coluna>.<channelIndex>
    // col 2 = chnStatus
    { metricKey: 'channel_status', tableOidPrefix: '1.3.6.1.4.1.1004849.1.2.1.2' },
  ],
};
