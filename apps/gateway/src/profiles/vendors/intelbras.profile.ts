/**
 * Perfil Intelbras — câmeras IP fabricadas no Brasil pela Intelbras.
 *
 * Firmware derivado de Dahua: usa a MESMA árvore de OIDs (enterprise 1004849),
 * porém com um bug de firmware documentado onde vários campos respondem
 * o valor fixo 0 mesmo com o sistema saudável.
 *
 * Por isso: bestEffort=true + sentinelas=[0] em todos os campos proprietários.
 * O motor marcará o ponto como `unreliable: true` quando o valor for 0, mas
 * NÃO omitirá os demais campos da câmera.
 *
 * Sem o ID de fabricante 'intelbras' cadastrado manualmente, o motor pode
 * detectar Intelbras via enterprise 1004849 — nesse caso aplica este perfil
 * (mais conservador que Dahua) por ser o mais comum no mercado brasileiro.
 *
 * priority=10.
 */

import type { DeviceProfile } from '../types';

export const INTELBRAS_PROFILE: DeviceProfile = {
  id: 'intelbras',
  label: 'Intelbras',
  deviceTypes: ['CAMERA'],
  priority: 10,
  bestEffort: true,
  match: {
    manufacturerContains: ['intelbras'],
    sysDescrContains: ['intelbras'],
    // enterprise 1004849 é ambíguo (Dahua/Intelbras): sem cadastro manual
    // → gateway escolhe Intelbras (bestEffort conservador).
    enterpriseNumbers: [1004849],
  },
  discovery: {
    // Árvore oficial Dahua (OEM) — systemInfo/networkInfo/storageInfo/products.
    walkRoots: ['1.3.6.1.4.1.1004849.2'],
  },
  mappings: [
    // OIDs oficiais Dahua (doc "Product Management Information Library"):
    // cpuUsage 2.1.3.0 (escalar 0..100), memoryUsage 2.1.9.2.0 (0..100 %).
    // ── CPU ────────────────────────────────────────────────────────────────────
    { metricKey: 'cpu', oid: '1.3.6.1.4.1.1004849.2.1.3.0', scale: 1, sentinels: [0] },

    // ── Memória ────────────────────────────────────────────────────────────────
    { metricKey: 'memory', oid: '1.3.6.1.4.1.1004849.2.1.9.2.0', scale: 1, sentinels: [0] },

    // Temperatura: SEM objeto na doc oficial Dahua — fallback UCD do perfil
    // base permanece ativo por herança.
  ],
};
