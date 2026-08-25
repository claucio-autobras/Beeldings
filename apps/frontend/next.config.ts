import type { NextConfig } from "next";

const replitDomains = (process.env.REPLIT_DOMAINS ?? '')
  .split(',')
  .map((d) => d.trim())
  .filter(Boolean);

// O proxy interno do preview usa 127.0.0.1 para o canal de atualização do
// Next. Sem essa origem, o navegador recusa o HMR e pode permanecer preso na
// tela de indisponibilidade que viu durante um reinício.
const devOrigins = [...new Set([...replitDomains, '127.0.0.1'])];

// Proteções anti-iframe só em produção: em desenvolvimento o preview do
// Replit carrega o app dentro de um iframe de outra origem — X-Frame-Options
// ou frame-ancestors quebrariam o preview.
const isProd = process.env.NODE_ENV === 'production';

const SECURITY_HEADERS = [
  // Impede o browser de "adivinhar" tipo de conteúdo (mitiga XSS via upload)
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // Não vaza URLs internas completas para sites externos
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  // O app não usa câmera/microfone/geolocalização do browser (o vídeo das
  // câmeras chega por socket, não por getUserMedia)
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  ...(isProd
    ? [
        // Anti-clickjacking: ninguém pode embutir o app em iframe de terceiros.
        // A CSP completa (incluindo frame-ancestors 'self') é emitida por
        // requisição no middleware (src/middleware.ts) com nonce — aqui só o
        // fallback legado para navegadores antigos.
        { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      ]
    : []),
];

const nextConfig: NextConfig = {
  devIndicators: false,
  allowedDevOrigins: devOrigins,
  transpilePackages: ['nanoid'],
  // Remove o header "x-powered-by: Next.js" (vazamento de tecnologia — ZAP)
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
  // O handshake do Socket.IO chega como `/api/socket.io/?EIO=4...` (com barra
  // final). Sem isto o Next responde 308 removendo a barra, e o cliente Socket.IO
  // não segue o redirect — a conexão de telemetria nunca abre. Deixar o rewrite
  // encaminhar a URL como veio.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      // Socket.IO (telemetria/alarmes): o engine.io escuta exatamente em
      // `/socket.io/` (com barra final). O rewrite genérico abaixo perde essa
      // barra (`:path*` não a captura), gerando 404. Por isso encaminhamos o
      // handshake de forma explícita preservando a barra.
      {
        source: '/api/socket.io/',
        destination: 'http://localhost:4000/socket.io/',
      },
      {
        source: '/api/:path*',
        destination: 'http://localhost:4000/:path*',
      },
    ];
  },
};

export default nextConfig;
