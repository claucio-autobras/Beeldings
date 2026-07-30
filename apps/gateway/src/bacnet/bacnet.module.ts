import { Module } from '@nestjs/common';
import { NodeBacnetClient } from './infrastructure/node-bacnet.client';
import { BacnetDiscoveryService } from './application/bacnet-discovery.service';
import { BacnetNetworkDiscoveryService } from './application/bacnet-network-discovery.service';
import { BacnetPollingService } from './application/bacnet-polling.service';
import { BacnetCovService } from './application/bacnet-cov.service';
import { BacnetWriteService } from './application/bacnet-write.service';
import { MqttModule } from '../mqtt/mqtt.module';

/**
 * BacnetModule
 *
 * Agrega toda a infraestrutura BACnet do gateway:
 *   - NodeBacnetClient: wrapper UDP node-bacnet
 *   - BacnetDiscoveryService: discovery de objetos via ReadProperty
 *   - BacnetNetworkDiscoveryService: scan de rede via Who-Is broadcast
 *   - BacnetPollingService: polling periódico de objetos (ReadPropertySafe)
 *   - BacnetCovService: subscriptions COV (evento) + renovação + fallback polling
 *   - BacnetWriteService: escrita via WriteProperty com Priority Array
 *
 * Futuros serviços a registrar aqui:
 *   - BacnetMapperService (objeto BACnet → tag BlueBee)
 */
@Module({
  imports: [MqttModule],
  providers: [
    NodeBacnetClient,
    BacnetDiscoveryService,
    BacnetNetworkDiscoveryService,
    BacnetPollingService,
    BacnetCovService,
    BacnetWriteService,
  ],
  exports: [
    NodeBacnetClient,
    BacnetDiscoveryService,
    BacnetNetworkDiscoveryService,
    BacnetPollingService,
    BacnetCovService,
    BacnetWriteService,
  ],
})
export class BacnetModule {}
