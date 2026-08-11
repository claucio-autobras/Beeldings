/**
 * Perfil Intelbras — linha de controle de acesso IP.
 *
 * IMPORTANTE: a linha de CÂMERAS Intelbras usa o firmware Dahua (OEM) com
 * enterprise 1004849 e está no perfil intelbras.profile.ts (bestEffort).
 * A linha de CONTROLE DE ACESSO (iDAccess, iDBox, iDFace) usa firmware
 * próprio e possivelmente um enterprise diferente — levantamento pendente.
 *
 * Por ora o perfil garante o match por fabricante e usa os OIDs genéricos
 * MIB-II/UCD herdados do perfil base ACCESS_CONTROLLER. Quando os OIDs
 * proprietários da linha de acesso forem levantados em campo, adicionar
 * os mapeamentos aqui.
 *
 * priority=10.
 */

import type { DeviceProfile } from '../types';

export const INTELBRAS_AC_PROFILE: DeviceProfile = {
  id: 'intelbras-ac',
  /**
   * Label exibido na UI e no catálogo. O sufixo explicita que o monitoramento
   * é genérico MIB-II — OIDs proprietários da linha de acesso Intelbras ainda
   * não foram levantados em campo. Atualizar label quando o suporte proprietário
   * for adicionado.
   */
  label: 'Intelbras Controle de Acesso (monitoramento genérico MIB-II)',
  deviceTypes: ['ACCESS_CONTROLLER'],
  priority: 10,
  match: {
    // Intelbras pode anunciar "intelbras" no sysDescr mesmo na linha de acesso.
    manufacturerContains: ['intelbras'],
    sysDescrContains: ['intelbras'],
    // TODO(field): adicionar enterprise number da linha de acesso Intelbras
    // quando levantado (≠ 1004849 que é da linha de câmeras Dahua OEM).
  },
  mappings: [
    // TODO(field): levantar OIDs proprietários da linha de acesso Intelbras.
    // Enquanto isso o perfil base MIB-II é o fallback.
    //
    // Exemplo de como adicionar quando disponíveis:
    // { metricKey: 'cpu', oid: '1.3.6.1.4.1.XXXXX.Y.Z', scale: 1 },
  ],
};
