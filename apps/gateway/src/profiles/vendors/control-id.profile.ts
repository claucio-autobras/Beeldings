/**
 * Perfil Control iD — controladoras de acesso IP (marca brasileira).
 *
 * Enterprise OID: 1.3.6.1.4.1.34475 (Control iD Soluções em Tecnologia).
 *
 * NOTE: OIDs proprietários da CONTROL-ID-MIB ainda não foram levantados em
 * campo. O perfil atualmente apenas garante o match por fabricante e usa os
 * OIDs genéricos (MIB-II/UCD) herdados do perfil base. Quando os OIDs
 * proprietários forem levantados, adicionar os mapeamentos aqui e substituir
 * os OIDs do perfil base — o motor fundirá automaticamente.
 *
 * priority=10.
 */

import type { DeviceProfile } from '../types';

export const CONTROL_ID_PROFILE: DeviceProfile = {
  id: 'control-id',
  /**
   * Label exibido na UI e no catálogo. O sufixo explicita que o monitoramento
   * é genérico MIB-II — OIDs proprietários da CONTROL-ID-MIB ainda não foram
   * levantados em campo. Atualizar label quando o suporte proprietário for adicionado.
   */
  label: 'Control iD (monitoramento genérico MIB-II)',
  deviceTypes: ['ACCESS_CONTROLLER'],
  priority: 10,
  match: {
    manufacturerContains: ['control id', 'controlid', 'control-id'],
    sysDescrContains: ['controlid', 'control-id'],
    enterpriseNumbers: [34475],
  },
  mappings: [
    // TODO(field): levantar OIDs proprietários da CONTROL-ID-MIB.
    // Enquanto isso o perfil base MIB-II é o fallback (herdado automaticamente).
    //
    // Exemplo de como adicionar quando disponíveis:
    // { metricKey: 'cpu',  oid: '1.3.6.1.4.1.34475.X.Y.Z', scale: 1 },
  ],
};
