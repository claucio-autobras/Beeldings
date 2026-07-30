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
 * Câmeras são equipamento REAL (o gateway faz polling e a config é publicada),
 * mas NÃO pertencem ao universo BMS: não aparecem em listagens/contagens de
 * dispositivos BMS, dashboards nem na IA — têm área própria (/cftv).
 */
export const SNMP_PROTOCOL = 'snmp';
export const ONVIF_PROTOCOL = 'onvif';
export const CFTV_PROTOCOLS = [SNMP_PROTOCOL, ONVIF_PROTOCOL] as const;

/**
 * Fragmento de `where` do Prisma para consultas do universo BMS: exclui os
 * dispositivos virtuais (Bancada) E as câmeras CFTV (snmp/onvif). Use nas
 * listagens, contagens, dashboards e IA. NÃO use no config publisher — o
 * gateway precisa da config das câmeras para fazer o polling.
 */
export const EXCLUDE_NON_BMS_DEVICES = {
  protocol: { notIn: [VIRTUAL_PROTOCOL, ...CFTV_PROTOCOLS] as string[] },
} as const;

/** Fragmento de `where` que seleciona SOMENTE as câmeras CFTV (SNMP + ONVIF). */
export const ONLY_CFTV_DEVICES = {
  protocol: { in: [...CFTV_PROTOCOLS] as string[] },
} as const;
