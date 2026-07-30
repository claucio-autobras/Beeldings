import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Gateway');

  const app = await NestFactory.create(AppModule, {
    logger: ['log', 'warn', 'error', 'debug'],
  });

  const port = process.env.PORT ?? 3001;
  await app.listen(port);

  logger.log(`Gateway BlueBee IoT rodando na porta ${port}`);
  logger.log(`Broker MQTT: ${process.env.MQTT_BROKER_URL ?? 'mqtt://localhost:1883'}`);
  logger.log(`Gateway ID: ${process.env.GATEWAY_ID ?? 'gw-01'}`);
  logger.log(`Tenant ID: ${process.env.GATEWAY_TENANT_ID ?? 'default'}`);
}

bootstrap().catch((err: Error) => {
  console.error('Falha ao inicializar o gateway:', err.message);
  process.exit(1);
});
