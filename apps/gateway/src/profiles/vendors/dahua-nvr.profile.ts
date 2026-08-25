/**
 * Perfil Dahua NVR/DVR.
 *
 * Enterprise OID: 1.3.6.1.4.1.1004849 (Zhejiang Dahua Technology).
 * Mesmo enterprise das câmeras Dahua — separado pelo deviceTypes:['NVR'].
 *
 * Fonte oficial: "Dahua Product Management Information Library" —
 * root 1.3.6.1.4.1.1004849.2 (a sub-árvore …1004849.1 é do ipSAN e NÃO
 * responde em NVR/DVR — os OIDs antigos dskTable/chnTable vinham de dumps
 * comunitários dessa árvore errada e foram substituídos):
 *
 *   Escalares:
 *     cpuUsage     → 2.1.3.0    (INTEGER 0–100 %)
 *     memoryUsage  → 2.1.9.2.0  (INTEGER 0–100 %)
 *     (temperatura NÃO existe na doc oficial — fallback UCD por herança)
 *
 *   physicalVolumeInfoTable (discos) → 2.4.1.1.<coluna>.<physicNo>
 *     col 4 physicalVolumeName   → nome (DisplayString, só semântica/walk)
 *     col 5 physicalVolumeStatus → DisplayString ("Error"/"Offline"/"Running")
 *                                  ⚠ coluna TEXTO: a leitura numérica de tabela
 *                                  devolve null — mapeada para enumeração de
 *                                  slots e semântica; valor contínuo fica
 *                                  "sem dados" até haver suporte a enums-texto.
 *     col 6 physicalVolumeUsage  → disk_used como USO em % (0–100)
 *     col 7 physicalVolumeTotal  → disk_capacity em GB (nativo, scale 1)
 *
 *   videoChannelStatusTable (canais, nó dvr) → 2.10.1.1.1.1.2
 *     videoChannelStatus INTEGER online(1)/offline(0) — já coincide com o
 *     enum canônico (0=offline, 1=idle/normal).
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
  discovery: {
    // Árvore oficial de produto (systemInfo/networkInfo/storageInfo/products).
    walkRoots: ['1.3.6.1.4.1.1004849.2'],
  },
  mappings: [
    // ── Escalares oficiais (idênticos ao perfil de câmera Dahua) ─────────────
    { metricKey: 'cpu',    oid: '1.3.6.1.4.1.1004849.2.1.3.0',   scale: 1 },
    { metricKey: 'memory', oid: '1.3.6.1.4.1.1004849.2.1.9.2.0', scale: 1 },
    { metricKey: 'uptime', oid: '1.3.6.1.2.1.1.3.0', scale: 0.01 },
    // temperature: sem objeto oficial Dahua — fallback UCD por herança.

    // ── Tabela de discos oficial (physicalVolumeInfoTable) ───────────────────
    // Prefixo: 1.3.6.1.4.1.1004849.2.4.1.1.<coluna>.<physicNo>
    // col 5 = status DisplayString → leitura numérica devolve null (honesto:
    // "sem dados" em vez de enum inventado); mantida para enumerar slots.
    { metricKey: 'disk_status', tableOidPrefix: '1.3.6.1.4.1.1004849.2.4.1.1.5' },
    // col 7 = physicalVolumeTotal em GB NATIVO (doc oficial) — scale 1.
    { metricKey: 'disk_capacity', tableOidPrefix: '1.3.6.1.4.1.1004849.2.4.1.1.7', scale: 1 },
    // col 6 = physicalVolumeUsage (0–100 %). A doc oficial NÃO expõe espaço
    // usado em GB; disk_used publica o USO EM % (unit '%' no ponto criado
    // pelo sync-disks) — dado real > estimativa derivada.
    { metricKey: 'disk_used', tableOidPrefix: '1.3.6.1.4.1.1004849.2.4.1.1.6', scale: 1 },

    // ── Tabela de canais oficial (videoChannelStatusTable, nó dvr) ───────────
    // Prefixo: 1.3.6.1.4.1.1004849.2.10.1.1.1.1.2.<channelIndex>
    // online(1)/offline(0) já coincide com o enum canônico.
    { metricKey: 'channel_status', tableOidPrefix: '1.3.6.1.4.1.1004849.2.10.1.1.1.1.2' },
  ],
};
