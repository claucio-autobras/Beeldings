import { Module } from '@nestjs/common';
import { GatewayMqttService } from './gateway-mqtt.service';
import { StoreAndForwardService } from './store-and-forward.service';

@Module({
  providers: [GatewayMqttService, StoreAndForwardService],
  exports: [GatewayMqttService, StoreAndForwardService],
})
export class MqttModule {}
