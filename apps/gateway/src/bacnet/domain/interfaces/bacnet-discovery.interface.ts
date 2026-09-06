/**
 * Interfaces para o fluxo de discovery BACnet.
 *
 * Fluxo:
 *   Backend → MQTT → bluebee/{tenantId}/gateway/{gatewayId}/commands
 *   Gateway → executa discovery
 *   Gateway → MQTT → bluebee/{tenantId}/gateway/{gatewayId}/discovery/result
 */

export interface BacnetDiscoveryCommand {
  command_id: string;
  tenant_id: string;
  gateway_id: string;
  /** IP do dispositivo — ou do ROTEADOR BACnet quando net/adr presentes. Aceita "ip" ou "ip:porta". */
  ip: string;
  /** Porta UDP BACnet — padrão 47808 */
  port: number;
  /** Instância BACnet do dispositivo — se 0 ou omitido, será descoberta via Who-Is */
  deviceInstance?: number;
  /** Rede BACnet remota (dispositivo MS/TP atrás de roteador) — null/omitido para BACnet/IP direto */
  net?: number | null;
  /** MAC do dispositivo na rede remota (ex: [12] em MS/TP) */
  adr?: number[] | null;
}

/**
 * Origem da enumeração de objetos no discovery:
 *   - objectList: leitura completa da property 76 (lista exata do device);
 *   - objectListIndex: fallback índice-a-índice da property 76 (lista exata,
 *     para devices cujo objectList completo estoura o APDU);
 *   - scan: varredura SCAN_MAP (heurística — pode não cobrir instâncias altas).
 */
export type DiscoverySource = 'objectList' | 'objectListIndex' | 'scan';

/**
 * Objeto BACnet descoberto no controlador.
 *
 * Tipos suportados:
 *   0=AI, 1=AO, 2=AV, 3=BI, 4=BO, 5=BV, 13=MSI, 14=MSO, 19=MSV,
 *   23=ACC (accumulator), 24=PC (pulse-converter), 40=CSV (characterstring-value),
 *   45=IV (integer-value), 46=LAV (large-analog-value), 48=PIV (positive-integer-value)
 */
export interface DiscoveredObject {
  /** Código numérico do tipo BACnet */
  objectType: number;
  objectInstance: number;
  /**
   * Nome do objeto (property 77) quando configurado no controlador; para
   * objetos sem nome, um nome padrão "TIPO-instância" (ex: "AI-3") é gerado
   * e `unnamed` fica true — o objeto NÃO é descartado.
   */
  objectName: string;
  /** true quando o objeto não tinha nome no controlador e recebeu nome padrão */
  unnamed?: boolean;
  /** Unidade de engenharia textual — null para objetos digitais e multi-state */
  unit: string | null;
  /** Código numérico BACnet da unidade (62=°C, 55=%, 84=A, 116=V, 48=W) — null para digitais */
  unitCode: number | null;
}

export interface BacnetDiscoveryResult {
  command_id: string;
  tenant_id: string;
  success: boolean;
  objects: DiscoveredObject[];
  /** Como os objetos foram enumerados — exibido na UI para indicar confiabilidade */
  discoverySource?: DiscoverySource;
  /** Instância do device efetivamente usada (descoberta via Who-Is quando não fornecida) */
  deviceInstance?: number | null;
  /** Rota BACnet descoberta no I-Am (device MS/TP atrás de roteador) — para persistência */
  net?: number | null;
  adr?: number[] | null;
  error?: string;
}

/**
 * Interfaces para o fluxo de scan de rede BACnet (Who-Is broadcast).
 *
 * Fluxo:
 *   Backend → MQTT → bluebee/{tenantId}/gateway/{gatewayId}/commands (action=scan)
 *   Gateway → Who-Is broadcast, aguarda I-Am por SCAN_TIMEOUT_MS
 *   Gateway → MQTT → bluebee/{tenantId}/gateway/{gatewayId}/discovery/scan-result
 */
export interface BacnetScanCommand {
  command_id: string;
  tenant_id: string;
  gateway_id: string;
}

/**
 * Controladora BACnet encontrada via Who-Is broadcast ou varredura unicast.
 *
 * vendorName/modelName/objectName são lidos do Device Object (type=8) após o
 * I-Am — podem ser null se o dispositivo não responder a tempo.
 *
 * net/adr presentes indicam controladora MS/TP atrás de um roteador BACnet:
 * `ip` é o IP do ROTEADOR e net/adr endereçam o device na rede remota.
 */
export interface DiscoveredBacnetDevice {
  instance: number;
  /** IP (ou "ip:porta" quando porta não-padrão) do device ou do roteador BACnet */
  ip: string;
  vendorId: number | null;
  vendorName: string | null;
  modelName: string | null;
  objectName: string | null;
  /** Rede BACnet remota — null para BACnet/IP direto */
  net?: number | null;
  /** MAC na rede remota (ex: [12] em MS/TP) — null para BACnet/IP direto */
  adr?: number[] | null;
}

export interface BacnetScanResult {
  command_id: string;
  tenant_id: string;
  success: boolean;
  devices: DiscoveredBacnetDevice[];
  error?: string;
}
