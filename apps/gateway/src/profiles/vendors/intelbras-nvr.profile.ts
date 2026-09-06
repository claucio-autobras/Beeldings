/**
 * Perfil Intelbras NVR/DVR.
 *
 * Firmware derivado de Dahua: usa a MESMA árvore de OIDs (enterprise 1004849),
 * porém com bug de firmware documentado onde campos respondem valor 0 fixo.
 * bestEffort=true + sentinelas=[0] nos escalares proprietários.
 *
 * Este perfil é escolhido como fallback conservador quando o enterprise 1004849
 * é detectado sem fabricante manual definido (maior prioridade que dahua-nvr).
 *
 * OIDs oficiais Dahua ("Product Management Information Library", root
 * 1.3.6.1.4.1.1004849.2 — a sub-árvore …1004849.1 é do ipSAN):
 *   cpuUsage 2.1.3.0 (%), memoryUsage 2.1.9.2.0 (%),
 *   physicalVolumeInfoTable 2.4.1.1 (col 5 status texto, col 6 uso %,
 *   col 7 total GB), videoChannelStatusTable 2.10.1.1.1 (col 2, 1=online/0=offline).
 * Detalhes/comentários completos: dahua-nvr.profile.ts.
 *
 * priority=11 (um acima do dahua-nvr=10, garante escolha automática via
 * enterprise 1004849 sem necessidade de case especial no motor).
 */

import type { DeviceProfile } from '../types';

export const INTELBRAS_NVR_PROFILE: DeviceProfile = {
  id: 'intelbras-nvr',
  label: 'Intelbras NVR/DVR',
  deviceTypes: ['NVR'],
  priority: 11,
  bestEffort: true,
  match: {
    manufacturerContains: ['intelbras'],
    sysDescrContains: ['intelbras'],
    // enterprise 1004849 ambíguo: este perfil tem priority=11 > dahua-nvr=10,
    // garantindo a escolha conservadora (bestEffort + sentinelas) sem cadastro
    // manual de fabricante.
    enterpriseNumbers: [1004849],
  },
  discovery: {
    // Árvore oficial Dahua (OEM) — systemInfo/networkInfo/storageInfo/products.
    walkRoots: ['1.3.6.1.4.1.1004849.2'],
  },
  mappings: [
    // ── Escalares oficiais (Dahua OEM — sentinelas=[0] por bug de firmware) ──
    { metricKey: 'cpu',    oid: '1.3.6.1.4.1.1004849.2.1.3.0',   scale: 1, sentinels: [0] },
    { metricKey: 'memory', oid: '1.3.6.1.4.1.1004849.2.1.9.2.0', scale: 1, sentinels: [0] },
    { metricKey: 'uptime', oid: '1.3.6.1.2.1.1.3.0', scale: 0.01 },
    // temperature: sem objeto oficial Dahua — fallback UCD por herança.

    // ── Tabelas oficiais (idênticas ao dahua-nvr) ────────────────────────────
    // col 5 = status DisplayString → leitura numérica devolve null (honesto);
    // mantida para enumerar slots e para a semântica do walk.
    { metricKey: 'disk_status', tableOidPrefix: '1.3.6.1.4.1.1004849.2.4.1.1.5' },
    // col 7 = physicalVolumeTotal em GB NATIVO — scale 1.
    { metricKey: 'disk_capacity', tableOidPrefix: '1.3.6.1.4.1.1004849.2.4.1.1.7', scale: 1 },
    // col 6 = physicalVolumeUsage (0–100 %) — disk_used publica USO em %.
    { metricKey: 'disk_used', tableOidPrefix: '1.3.6.1.4.1.1004849.2.4.1.1.6', scale: 1 },
    // videoChannelStatusTable: online(1)/offline(0) = enum canônico direto.
    { metricKey: 'channel_status', tableOidPrefix: '1.3.6.1.4.1.1004849.2.10.1.1.1.1.2' },
  ],
};
