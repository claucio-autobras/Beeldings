/**
 * Configuração estática de um dispositivo BACnet no gateway.
 * Usada pelo polling e COV — distinta da descoberta dinâmica.
 */
export interface BACnetObjectConfig {
  /** Identificador amigável do ponto (ex: 'NTC_01', 'BI_05') */
  tag: string;
  /** Código numérico do tipo de objeto BACnet (0=AI, 1=AO, 3=BI, 4=BO, etc.) */
  objectType: number;
  objectInstance: number;
  /** Propriedade a ler — normalmente 85 (presentValue) */
  property: number;
  /** Unidade de engenharia textual — null para digitais */
  unit: string | null;
  /** true = usar COV subscription; false = polling periódico */
  useCov: boolean;
  /** Incremento mínimo para disparo de COV — apenas quando useCov=true */
  covIncrement?: number;
}

export interface BACnetDeviceConfig {
  id: string;
  name: string;
  deviceInstance: number;
  ipAddress: string;
  /** Porta UDP BACnet — padrão 47808 */
  port: number;
  /**
   * Rede BACnet remota — presente quando o device é MS/TP atrás de um roteador
   * BACnet: `ipAddress` é o IP do ROTEADOR e net/adr endereçam o device na
   * rede remota (NPDU DNET/DADR). null/omitido para BACnet/IP direto.
   */
  net?: number | null;
  /** MAC do device na rede remota (ex: [12] em MS/TP) */
  adr?: number[] | null;
  pollingIntervalMs: number;
  objects: BACnetObjectConfig[];
  /** Tags que devem ter COV subscription ativa */
  covSubscriptions: string[];
}
