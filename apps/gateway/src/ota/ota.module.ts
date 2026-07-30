import { Module } from '@nestjs/common';
import { MqttModule } from '../mqtt/mqtt.module';
import { OtaUpdateService } from './ota-update.service';

/**
 * OtaModule — atualização remota (OTA) do gateway via MQTT.
 * Recebe o comando 'command.ota.update' do CommandDispatcherService.
 */
@Module({
  imports: [MqttModule],
  providers: [OtaUpdateService],
})
export class OtaModule {}
