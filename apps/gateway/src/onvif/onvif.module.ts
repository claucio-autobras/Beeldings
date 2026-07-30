import { Module } from '@nestjs/common';
import { MqttModule } from '../mqtt/mqtt.module';
import { ObservabilityModule } from '../observability/observability.module';
import { OnvifDiscoveryService } from './onvif-discovery.service';
import { OnvifPollingService } from './onvif-polling.service';
import { OnvifProbeService } from './onvif-probe.service';

/**
 * OnvifModule — monitoramento de câmeras CFTV via ONVIF (sem SNMP).
 *
 *   - OnvifPollingService: polling config-driven (STATUS via GetDeviceInformation,
 *     STREAM via GetStreamUri) + assinatura de eventos (motion/tamper/video_loss),
 *     telemetria no tópico canônico (sem resposta = STATUS 0/offline).
 *   - OnvifProbeService: conexão sob demanda para validar credenciais e ler
 *     fabricante/modelo/firmware/série no cadastro
 *     (comando 'command.onvif.probe' roteado pelo CommandDispatcher).
 *   - OnvifDiscoveryService: WS-Discovery multicast (comando
 *     'command.onvif.scan') — descobre câmeras ONVIF na rede sem credenciais.
 */
@Module({
  imports: [MqttModule, ObservabilityModule],
  providers: [OnvifPollingService, OnvifProbeService, OnvifDiscoveryService],
})
export class OnvifModule {}
