import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { dirname, resolve } from 'node:path';
import { BacnetModule } from './bacnet/bacnet.module';
import { ModbusModule } from './modbus/modbus.module';
import { SnmpModule } from './snmp/snmp.module';
import { OnvifModule } from './onvif/onvif.module';
import { MqttBridgeModule } from './mqtt-bridge/mqtt-bridge.module';
import { MqttModule } from './mqtt/mqtt.module';
import { CommandsModule } from './commands/commands.module';
import { ObservabilityModule } from './observability/observability.module';
import { OtaModule } from './ota/ota.module';

/**
 * Resolve o caminho do arquivo .env.
 *
 * Quando empacotado com pkg (bluebee-gateway.exe rodando como serviço do
 * Windows), o diretório de trabalho (cwd) é C:\Windows\System32 — então o .env
 * precisa ser lido ao lado do EXECUTÁVEL, não do cwd. Em desenvolvimento
 * (`node dist/main`), usa o cwd do projeto normalmente.
 */
const isPackaged = Boolean((process as unknown as { pkg?: unknown }).pkg);
const envFilePath = isPackaged
  ? resolve(dirname(process.execPath), '.env')
  : resolve(process.cwd(), '.env');

/**
 * AppModule — Gateway BlueBee IoT
 *
 * Módulos registrados:
 *   - ConfigModule: variáveis de ambiente (MQTT_BROKER_URL, GATEWAY_ID, etc.)
 *   - EventEmitterModule: barramento de eventos interno (MQTT → Commands → BACnet)
 *   - MqttModule: conexão com broker EMQX
 *   - CommandsModule: dispatcher de comandos recebidos via MQTT
 *   - BacnetModule: cliente BACnet/IP + discovery + futuros serviços
 *   - ModbusModule: polling Modbus TCP (config-driven, sem discovery)
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath,
    }),
    EventEmitterModule.forRoot({
      wildcard: false,
      delimiter: '.',
      maxListeners: 20,
    }),
    ObservabilityModule,
    MqttModule,
    CommandsModule,
    BacnetModule,
    ModbusModule,
    SnmpModule,
    OnvifModule,
    MqttBridgeModule,
    OtaModule,
  ],
})
export class AppModule {}
