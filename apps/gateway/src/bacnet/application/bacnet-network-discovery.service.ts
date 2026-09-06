import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NodeBacnetClient } from '../infrastructure/node-bacnet.client';
import { GatewayMqttService } from '../../mqtt/gateway-mqtt.service';
import {
  BacnetScanCommand,
  BacnetScanResult,
  DiscoveredBacnetDevice,
} from '../domain/interfaces/bacnet-discovery.interface';

/**
 * BacnetNetworkDiscoveryService
 *
 * Responsável pelo "scan de rede" BACnet: descobre todas as controladoras
 * acessíveis pelo gateway sem que o usuário precise informar o IP de cada uma.
 *
 * Combina DUAS técnicas complementares:
 *
 *   1. Who-Is BROADCAST — única forma de descobrir controladoras MS/TP atrás
 *      de roteadores BACnet: elas respondem I-Am com o IP do ROTEADOR e o
 *      NPDU carrega source net/adr identificando o device na rede remota.
 *      Também acha controladoras BACnet/IP que respondem a Who-Is.
 *
 *   2. Varredura UNICAST — sonda o Device Object (instância coringa) de cada
 *      IP das subredes locais. Necessária porque controladoras comuns no
 *      parque (ex: MCP46D/Climate) NÃO respondem a Who-Is, mas respondem a
 *      readProperty unicast.
 *
 * Os resultados são mesclados com dedupe por instance+endereço+rota.
 *
 * Diferente do BacnetDiscoveryService (que descobre os OBJETOS de UMA
 * controladora já conhecida), este serviço descobre as PRÓPRIAS controladoras —
 * o resultado é usado pelo frontend para listar opções e, em seguida, disparar
 * o discovery de objetos para a controladora escolhida.
 *
 * Fluxo:
 *   1. Backend publica comando em bluebee/{tenantId}/gateway/{gatewayId}/commands (action=scan)
 *   2. CommandDispatcherService recebe, parseia e emite evento 'command.bacnet.scan'
 *   3. Este serviço captura o evento via @OnEvent
 *   4. Who-Is broadcast + varredura unicast em paralelo
 *   5. Mescla, deduplica e enriquece (vendor/model/name via readDeviceInfo)
 *   6. Publica resultado em bluebee/{tenantId}/gateway/{gatewayId}/discovery/scan-result
 */
@Injectable()
export class BacnetNetworkDiscoveryService {
  private readonly logger = new Logger(BacnetNetworkDiscoveryService.name);

  /**
   * Quantidade de IPs sondados em paralelo. Como cada sonda vai para um IP
   * diferente (não sobrecarrega um único dispositivo), um lote maior acelera
   * bastante a varredura — a maioria só atinge o timeout.
   */
  private static readonly PROBE_BATCH_SIZE = 48;

  /** Janela de captura das respostas I-Am do Who-Is broadcast. */
  private static readonly BROADCAST_WINDOW_MS = 8000;

  /**
   * Timeout por sonda unicast (BACNET_SCAN_PROBE_TIMEOUT_MS — padrão 700ms).
   * Curto porque a maioria dos IPs varridos não responde (host inexistente) —
   * 700ms acomoda controladoras lentas sem arrastar a varredura inteira.
   */
  private get probeTimeoutMs(): number {
    const v = Number(process.env.BACNET_SCAN_PROBE_TIMEOUT_MS?.trim() || '');
    return Number.isFinite(v) && v >= 100 && v <= 30000 ? v : 700;
  }

  /**
   * Passadas extra de varredura unicast sobre os IPs que NÃO responderam
   * (BACNET_SCAN_RETRY_PASSES — padrão 1). Cada passada dobra o timeout da
   * anterior — recupera controladoras lentas ou "frias" (ARP inicial) que
   * perderam a primeira sonda.
   */
  private get retryPasses(): number {
    const v = Number(process.env.BACNET_SCAN_RETRY_PASSES?.trim() || '');
    return Number.isInteger(v) && v >= 0 && v <= 3 ? v : 1;
  }

  /**
   * Lock de concorrência por-tipo: impede que dois scans de rede rodem ao mesmo
   * tempo disputando o mesmo socket UDP BACnet (duplo clique, retry do backend,
   * dois usuários). É apenas por tipo de operação — NÃO há lock cruzado entre
   * scan e discovery (eles vivem em serviços distintos), nem com o polling, que
   * continua rodando em paralelo normalmente.
   */
  private scanInProgress = false;

  constructor(
    private readonly bacnetClient: NodeBacnetClient,
    private readonly mqttService: GatewayMqttService,
  ) {}

  @OnEvent('command.bacnet.scan')
  async handleScanCommand(command: BacnetScanCommand): Promise<void> {
    this.logger.log(
      `Scan de rede BACnet iniciado — command_id=${command.command_id}`,
    );

    const topic = `bluebee/${command.tenant_id}/gateway/${command.gateway_id}/discovery/scan-result`;

    if (this.scanInProgress) {
      this.logger.warn(
        `Scan de rede ignorado — já há um scan em andamento (command_id=${command.command_id})`,
      );
      const busyResult: BacnetScanResult = {
        command_id: command.command_id,
        tenant_id: command.tenant_id,
        success: false,
        devices: [],
        error: 'Scan de rede já em andamento — aguarde o anterior finalizar.',
      };
      this.mqttService.publish(topic, busyResult);
      return;
    }

    this.scanInProgress = true;
    try {
      const result = await this.executeScan(command);

      this.mqttService.publish(topic, result);

      this.logger.log(
        `Scan de rede concluído — ${
          result.success
            ? `${result.devices.length} controladora(s) encontrada(s)`
            : `falhou: ${result.error}`
        }`,
      );
    } finally {
      this.scanInProgress = false;
    }
  }

  private async executeScan(command: BacnetScanCommand): Promise<BacnetScanResult> {
    const { command_id, tenant_id } = command;

    try {
      // Who-Is broadcast e varredura unicast em PARALELO — técnicas
      // complementares (ver doc da classe).
      const [broadcastDevices, probedDevices] = await Promise.all([
        this.runBroadcastDiscovery(),
        this.runUnicastSweep(),
      ]);

      // Mescla com dedupe por instance+endereço+rota. Broadcast entra primeiro
      // — carrega net/adr (devices roteados) que a sonda unicast não tem.
      const merged = new Map<string, DiscoveredBacnetDevice>();
      for (const device of [...broadcastDevices, ...probedDevices]) {
        const routeKey = device.net ? `${device.net}/${(device.adr ?? []).join('.')}` : '';
        const key = `${device.instance}@${device.ip}#${routeKey}`;
        if (!merged.has(key)) {
          merged.set(key, device);
        }
      }

      // Um device BACnet/IP direto pode aparecer duas vezes: via broadcast e
      // via sonda unicast (mesma instance+ip, ambos sem rota) — o Map já cobre.
      const devices = Array.from(merged.values());

      this.logger.log(
        `Scan concluído — ${devices.length} controladora(s): ` +
          `${broadcastDevices.length} via broadcast, ${probedDevices.length} via sonda unicast`,
      );

      return { command_id, tenant_id, success: true, devices };
    } catch (err) {
      const errorMessage = (err as Error).message ?? String(err);
      this.logger.error(`Falha na varredura de rede BACnet: ${errorMessage}`);
      return { command_id, tenant_id, success: false, devices: [], error: errorMessage };
    }
  }

  /**
   * Who-Is broadcast + enriquecimento: para cada I-Am, lê vendorName/modelName/
   * objectName do Device Object usando o MESMO endereçamento da resposta
   * (incluindo net/adr para devices roteados).
   */
  private async runBroadcastDiscovery(): Promise<DiscoveredBacnetDevice[]> {
    const iAms = await this.bacnetClient.whoIsBroadcast(
      BacnetNetworkDiscoveryService.BROADCAST_WINDOW_MS,
    );

    const devices: DiscoveredBacnetDevice[] = [];
    for (const found of iAms) {
      const info = await this.bacnetClient.readDeviceInfo(
        { address: found.address, net: found.net, adr: found.adr },
        found.instance,
        2000,
      );
      devices.push({
        instance: found.instance,
        ip: found.address,
        vendorId: found.vendorId,
        vendorName: info.vendorName,
        modelName: info.modelName,
        objectName: info.objectName,
        net: found.net,
        adr: found.adr,
      });
      this.logger.log(
        `Controladora (broadcast) — instance=${found.instance} ip=${found.address}` +
          (found.net ? ` net=${found.net} adr=[${(found.adr ?? []).join(',')}]` : '') +
          ` modelo=${info.modelName ?? '?'} fabricante=${info.vendorName ?? '?'}`,
      );
    }
    return devices;
  }

  /**
   * Varredura unicast das subredes locais com passadas de retry configuráveis:
   * IPs sem resposta na passada anterior são re-sondados com timeout dobrado.
   */
  private async runUnicastSweep(): Promise<DiscoveredBacnetDevice[]> {
    const targets = this.bacnetClient.getScanTargets();

    if (targets.length === 0) {
      this.logger.warn(
        'Nenhum IP candidato para varredura unicast — verifique as interfaces de ' +
          'rede do host ou defina BACNET_SCAN_SUBNETS (ex: 10.201.10.0/23).',
      );
      return [];
    }

    const totalPasses = 1 + this.retryPasses;
    this.logger.log(
      `Varredura unicast iniciada — ${targets.length} IP(s), lotes de ` +
        `${BacnetNetworkDiscoveryService.PROBE_BATCH_SIZE}, timeout ${this.probeTimeoutMs}ms, ` +
        `${totalPasses} passada(s)`,
    );

    const devices: DiscoveredBacnetDevice[] = [];
    let pending = targets;
    let timeout = this.probeTimeoutMs;

    for (let pass = 1; pass <= totalPasses && pending.length > 0; pass++) {
      if (pass > 1) {
        this.logger.log(
          `Passada ${pass}/${totalPasses} — re-sondando ${pending.length} IP(s) ` +
            `sem resposta (timeout ${timeout}ms)`,
        );
      }

      const unanswered: string[] = [];
      const batchSize = BacnetNetworkDiscoveryService.PROBE_BATCH_SIZE;

      for (let i = 0; i < pending.length; i += batchSize) {
        const batch = pending.slice(i, i + batchSize);

        const batchResults = await Promise.all(
          batch.map(async (ip) => ({
            ip,
            result: await this.bacnetClient.probeDeviceObject(ip, timeout),
          })),
        );

        for (const { ip, result } of batchResults) {
          if (!result) {
            unanswered.push(ip);
            continue;
          }
          devices.push({
            instance: result.instance,
            ip: result.address,
            vendorId: result.vendorId,
            vendorName: result.vendorName,
            modelName: result.modelName,
            objectName: result.objectName,
            net: null,
            adr: null,
          });
          this.logger.log(
            `Controladora (sonda unicast) — instance=${result.instance} ip=${result.address} ` +
              `modelo=${result.modelName ?? '?'} fabricante=${result.vendorName ?? '?'}`,
          );
        }
      }

      pending = unanswered;
      timeout *= 2;
    }

    this.logger.log(
      `Varredura unicast concluída — ${devices.length} controladora(s) em ${targets.length} IP(s)`,
    );
    return devices;
  }
}
