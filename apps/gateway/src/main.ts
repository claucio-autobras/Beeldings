import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger } from '@nestjs/common';

// ── Última linha de defesa contra quedas em campo ────────────────────────────
// Cada loop de polling já captura e loga suas próprias exceções; estes handlers
// garantem que uma rejeição/exceção que escape por qualquer outro caminho seja
// LOGADA sem derrubar o processo do gateway (rede instável, driver com bug,
// callback de lib nativa que lança fora do ciclo). O gateway é um serviço de
// campo: ficar vivo e seguir coletando vale mais do que morrer "limpo".
const crashGuardLogger = new Logger('CrashGuard');

process.on('unhandledRejection', (reason) => {
  const detail =
    reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
  crashGuardLogger.error(
    `Unhandled rejection capturada — gateway mantido vivo: ${detail}`,
  );
});

process.on('uncaughtException', (err: Error) => {
  crashGuardLogger.error(
    `Uncaught exception capturada — gateway mantido vivo: ${err.stack ?? err.message}`,
  );
});

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
