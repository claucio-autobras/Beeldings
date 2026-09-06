import { Module } from '@nestjs/common';
import { ModbusPollingService } from './modbus-polling.service';
import { ModbusConnectionService } from './modbus-connection.service';
import { ModbusWriteService } from './modbus-write.service';
import { SerialPortManager } from './serial-port-manager';
import { MqttModule } from '../mqtt/mqtt.module';

/**
 * ModbusModule
 *
 * Polling Modbus TCP do gateway. Consome a config publicada pelo backend
 * (tópico .../config, blocos `protocol: 'modbus'`) e publica a telemetria
 * normalizada no mesmo tópico canônico do BACnet. Sem discovery — registradores
 * cadastrados manualmente no backend.
 */
@Module({
  imports: [MqttModule],
  providers: [ModbusPollingService, ModbusConnectionService, ModbusWriteService, SerialPortManager],
  exports: [ModbusPollingService, ModbusConnectionService, SerialPortManager],
})
export class ModbusModule {}
