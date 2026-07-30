import { Module } from '@nestjs/common';
import { MqttBridgeService } from './mqtt-bridge.service';
import { MqttModule } from '../mqtt/mqtt.module';

/**
 * MqttBridgeModule
 *
 * Bridge de equipamentos MQTT-nativos: conexão dedicada que assina os tópicos
 * dos equipamentos e republica no tópico canônico de telemetria. Consome a
 * config publicada pelo backend (blocos `protocol: 'mqtt'`).
 */
@Module({
  imports: [MqttModule],
  providers: [MqttBridgeService],
  exports: [MqttBridgeService],
})
export class MqttBridgeModule {}
