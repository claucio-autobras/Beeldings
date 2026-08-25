import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { resolveCorsOrigins } from './common/cors.util';

async function bootstrap() {
  // Em produção, silencia debug/verbose (ex.: uma linha por mensagem MQTT de
  // telemetria) — só log/warn/error. Em desenvolvimento, mantém tudo.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger:
      process.env.NODE_ENV === 'production'
        ? ['log', 'warn', 'error']
        : ['log', 'warn', 'error', 'debug', 'verbose'],
  });

  // Atrás do proxy do Next/Replit todo request chega via loopback; sem trust
  // proxy, req.ip seria sempre 127.0.0.1 e rate limit/auditoria enxergariam um
  // único "cliente". Com isto, req.ip passa a refletir o X-Forwarded-For.
  app.set('trust proxy', true);

  // Headers de segurança padrão (Helmet). `crossOriginResourcePolicy` fica
  // cross-origin para que as imagens SCADA servidas abaixo possam ser embutidas
  // pelo frontend mesmo quando acessa o backend por outro domínio/porta.
  //
  // CSP: substituímos os defaults amplos de font-src e style-src (que incluem
  // o wildcard `https:`) por listas explícitas sem wildcard, impedindo que
  // scanners de segurança (ZAP, Burp) reportem "Wildcard Directive".
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          // Sem `https:` — apenas self e data URIs para fontes embutidas.
          fontSrc: ["'self'", 'data:'],
          formAction: ["'self'"],
          frameAncestors: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          scriptSrc: ["'self'"],
          scriptSrcAttr: ["'none'"],
          // Sem `https:` — apenas self e inline (necessário para alguns
          // frameworks; nenhuma folha de estilo externa é carregada pela API).
          styleSrc: ["'self'", "'unsafe-inline'"],
          upgradeInsecureRequests: [],
        },
      },
    }),
  );

  // CORS: permissivo em desenvolvimento; em produção restrito às origens de
  // CORS_ORIGINS (ou aos domínios do deploy Replit como fallback).
  const corsOrigins = resolveCorsOrigins();
  app.enableCors({
    origin: corsOrigins ?? true,
    credentials: true,
  });

  // As imagens das telas SCADA não vão embutidas (base64) no JSON da tela: são
  // gravadas no bucket do App Storage via POST /scada/assets e servidas por
  // streaming em /scada-assets (ScadaAssetFilesController), de modo que o save
  // da tela trafegue apenas URLs. O limite do body parser fica um pouco acima
  // do upload máximo de imagem (5 MB ≈ 6,7 MB em base64).
  app.use(json({ limit: '8mb' }));
  app.use(urlencoded({ extended: true, limit: '8mb' }));

  await app.listen(process.env.PORT ?? 4000);
}
bootstrap();
