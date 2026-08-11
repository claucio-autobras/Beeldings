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
 * Tabelas de disco e canal: idênticas ao dahua-nvr (mesma árvore OEM).
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
    // então é selecionado primeiro quando só o enterprise number casa.
    enterpriseNumbers: [1004849],
  },
  mappings: [
    // ── Escalares (Dahua OEM — sentinelas=[0] por bug de firmware) ───────────
    { metricKey: 'cpu',         oid: '1.3.6.1.4.1.1004849.2.1.3.1.1.1', scale: 1, sentinels: [0] },
    { metricKey: 'memory',      oid: '1.3.6.1.4.1.1004849.2.1.3.2.1.1', scale: 1, sentinels: [0] },
    { metricKey: 'temperature', oid: '1.3.6.1.4.1.1004849.2.1.3.3.1.1', scale: 1, sentinels: [0] },
    { metricKey: 'uptime',      oid: '1.3.6.1.2.1.1.3.0', scale: 0.01 },

    // ── Tabelas (idênticas ao Dahua) ─────────────────────────────────────────
    // UNIDADE: col 3/4 reportam MB (não GB). scale: 0.001 → GB.
    // disk_status Intelbras (OEM Dahua): mesmo enum invertido — raw 0=normal,1=erro,2=sem disco
    // Enum canônico: 0=sem disco, 1=normal, 2=erro, 3=não formatado, 4=inicializando
    {
      metricKey: 'disk_status',
      tableOidPrefix: '1.3.6.1.4.1.1004849.1.1.1.2',
      enumNormalize: { 0: 1, 1: 2, 2: 0 },
    },
    { metricKey: 'disk_capacity', tableOidPrefix: '1.3.6.1.4.1.1004849.1.1.1.3', scale: 0.001 },
    { metricKey: 'disk_used',     tableOidPrefix: '1.3.6.1.4.1.1004849.1.1.1.4', scale: 0.001 },
    { metricKey: 'channel_status', tableOidPrefix: '1.3.6.1.4.1.1004849.1.2.1.2' },
  ],
};
