/**
 * Protocolo reservado aos pontos virtuais da Bancada de Testes (módulo SCADA).
 * Esses dispositivos existem APENAS como ferramenta de teste dentro do SCADA e
 * NÃO devem ser tratados como equipamento real (não são listados nem contados
 * em dashboards, listas de dispositivos, publicação para gateways ou IA).
 */
export const VIRTUAL_PROTOCOL = 'virtual';

/**
 * Fragmento de `where` do Prisma para EXCLUIR os dispositivos virtuais das
 * consultas que representam equipamento real. Mescle com o `where` existente:
 *   where: { ...outrosFiltros, ...EXCLUDE_VIRTUAL_DEVICES }
 */
export const EXCLUDE_VIRTUAL_DEVICES = {
  protocol: { not: VIRTUAL_PROTOCOL },
} as const;

/**
 * Protocolos dos dispositivos de CFTV (câmeras monitoradas via SNMP ou ONVIF).
 * Mantidos como constantes para uso em locais pontuais que ainda os referenciam.
 * O filtro canônico de câmeras passou a ser baseado em `monitoredDeviceType`
 * (veja ONLY_CAMERA_DEVICES abaixo).
 */
export const SNMP_PROTOCOL = 'snmp';
export const ONVIF_PROTOCOL = 'onvif';
export const CFTV_PROTOCOLS = [SNMP_PROTOCOL, ONVIF_PROTOCOL] as const;

/**
 * Fragmento de `where` que seleciona SOMENTE as câmeras CFTV.
 *
 * Usa `monitoredDeviceType = 'CAMERA'` — critério canônico após a migração
 * que backfillou todas as câmeras existentes (protocol snmp/onvif). Isso
 * garante que switches futuros (protocol='snmp', type='SWITCH') não apareçam
 * na lista de câmeras.
 */
export const ONLY_CAMERA_DEVICES = {
  monitoredDeviceType: 'CAMERA',
} as const;

/**
 * Alias retrocompatível — todo código existente que importava ONLY_CFTV_DEVICES
 * continua funcionando sem modificação.
 */
export const ONLY_CFTV_DEVICES = ONLY_CAMERA_DEVICES;

/**
 * Fragmento de `where` que seleciona TODOS os dispositivos monitorados
 * (câmeras, switches, NVRs — qualquer monitoredDeviceType não-null).
 */
export const ONLY_MONITORED_DEVICES = {
  monitoredDeviceType: { not: null },
} as const;

/**
 * Fragmento de `where` do Prisma para consultas do universo BMS: exclui os
 * dispositivos virtuais (Bancada) E os dispositivos monitorados (câmeras CFTV,
 * switches, NVRs). Use nas listagens, contagens, dashboards e IA.
 * NÃO use no config publisher — o gateway precisa da config de TODOS os devices.
 */
export const EXCLUDE_NON_BMS_DEVICES = {
  protocol: { not: VIRTUAL_PROTOCOL },
  monitoredDeviceType: null,
} as const;

/**
 * Fragmento de `where` que seleciona SOMENTE as controladoras de acesso (SCA).
 *
 * Usa `monitoredDeviceType = 'ACCESS_CONTROLLER'` — critério canônico para
 * garantir que dispositivos SNMP do BMS não apareçam na lista de controladoras.
 */
export const ONLY_ACCESS_CONTROLLER_DEVICES = {
  monitoredDeviceType: 'ACCESS_CONTROLLER',
} as const;
