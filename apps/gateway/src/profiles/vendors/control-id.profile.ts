/**
 * Perfil Control iD — controladoras de acesso IP (marca brasileira).
 *
 * Enterprise OIDs:
 *   - 49617 → usada pelo firmware em campo (iDFlex V2 fw 5.13.9 responde
 *     sysObjectID e árvore proprietária sob 1.3.6.1.4.1.49617.1);
 *   - 34475 → registro IANA da Control iD (mantida para firmwares que a usem).
 *
 * Mapeamentos confirmados contra a MIB oficial (CONTROLID-MIB) + a árvore
 * REAL do firmware 5.13.9 (walk de campo). ATENÇÃO: o fw 5.13.9 NÃO expõe
 * hasProVersion e desloca a subárvore cidSystem em UM índice vs a doc:
 *
 *   1.1.1.0 firmware ("5.13.9")          1.1.2.0 serial ("0G0300/00062F")
 *   1.1.3.0 load average (string 1/5/15) 1.1.4.0 USO DE CPU ("23.436" = %)
 *   1.1.5.0 não é um sensor de temperatura disponível no firmware validado
 *   1.1.6.0 data/hora                    1.1.7.0 NTP habilitado (INTEGER 1/2)
 *   1.1.8.0 servidores NTP               1.4.1.0 DHCP habilitado (INTEGER 1/2)
 *   1.4.2.N duplex por interface ("Full")
 *
 * A CPU canônica deste perfil é a tabela HOST-RESOURCES hrProcessorLoad:
 * o valor proprietário acima é uma leitura divergente e não substitui a média.
 * Objetos não mapeados continuam descobertos pelo walk como "OID
 * desconhecido"/classificados pela semântica do backend.
 *
 * priority=10.
 */

import type { DeviceProfile } from '../types';

export const CONTROL_ID_PROFILE: DeviceProfile = {
  id: 'control-id',
  label: 'Control iD',
  deviceTypes: ['ACCESS_CONTROLLER'],
  priority: 10,
  match: {
    manufacturerContains: ['control id', 'controlid', 'control-id'],
    sysDescrContains: ['controlid', 'control-id', 'idflex'],
    enterpriseNumbers: [49617, 34475],
  },
  discovery: {
    // Subárvore proprietária confirmada em campo (iDFlex V2 fw 5.13.9).
    walkRoots: ['1.3.6.1.4.1.49617.1'],
  },
  mappings: [
    // HOST-RESOURCES-MIB hrMemorySize (KBytes → bytes) is exposed by iDFlex.
    { metricKey: 'ram_total', oid: '1.3.6.1.2.1.25.2.2.0', scale: 1024 },
    // Todos os núcleos são persistidos pelo diagnóstico e agregados no polling.
    // Não usar o OID proprietário cidCpuUsage como fonte canônica.
    { metricKey: 'cpu', tableOidPrefix: '1.3.6.1.2.1.25.3.3.1.2', scale: 1 },
    // O firmware iDFlex validado não expõe temperatura. Intencionalmente sem
    // mapping efetivo: o OID vazio sobrescreve o mapping genérico da camada
    // base, deixando o ponto "não suportado/sem dados".
    { metricKey: 'temperature', oid: '' },
  ],
};
