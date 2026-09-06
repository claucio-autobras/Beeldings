export class ScanBacnetDto {
  tenantId!: string;
  gatewayId!: string;
}

/**
 * Controladora BACnet encontrada via Who-Is broadcast/varredura unicast.
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

export interface BacnetScanSuccess {
  success: true;
  command_id: string;
  devices: DiscoveredBacnetDevice[];
}

export interface BacnetScanError {
  success: false;
  error: string;
}

export type BacnetScanResult = BacnetScanSuccess | BacnetScanError;
