export class DiscoverBacnetDto {
  tenantId!: string;
  gatewayId!: string;
  /** IP do device — ou do ROTEADOR BACnet quando net/adr presentes. Aceita "ip" ou "ip:porta". */
  ip!: string;
  port!: number;
  /** Opcional — se omitido, o gateway descobre automaticamente via Who-Is */
  deviceInstance?: number;
  /** Rede BACnet remota (device MS/TP atrás de roteador) — omitido para BACnet/IP direto */
  net?: number | null;
  /** MAC do device na rede remota (ex: [12] em MS/TP) */
  adr?: number[] | null;
}

/**
 * Origem da enumeração de objetos no discovery (indicada na UI):
 *   - objectList: leitura completa da property 76 (lista exata do device);
 *   - objectListIndex: fallback índice-a-índice da property 76 (lista exata);
 *   - scan: varredura heurística SCAN_MAP (pode não cobrir instâncias altas).
 */
export type BacnetDiscoverySource = 'objectList' | 'objectListIndex' | 'scan';

export interface BacnetDiscoveredObject {
  objectType: number;
  objectInstance: number;
  objectName: string;
  /** true quando o objeto não tinha nome no controlador e recebeu nome padrão "TIPO-instância" */
  unnamed?: boolean;
  unit: string | null;
  unitCode: number | null;
}

export interface BacnetDiscoverySuccess {
  success: true;
  command_id: string;
  objects: BacnetDiscoveredObject[];
  /** Como os objetos foram enumerados — exibido na UI para indicar confiabilidade */
  discoverySource?: BacnetDiscoverySource;
  /** Instância do device efetivamente usada (descoberta via Who-Is quando não informada) */
  deviceInstance?: number | null;
  /** Rota BACnet descoberta no I-Am — persistir junto ao device para polling/write */
  net?: number | null;
  adr?: number[] | null;
}

export interface BacnetDiscoveryError {
  success: false;
  error: string;
}

export type BacnetDiscoveryResult = BacnetDiscoverySuccess | BacnetDiscoveryError;
