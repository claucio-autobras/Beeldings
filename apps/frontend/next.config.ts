import type { NextConfig } from "next";

const replitDomains = (process.env.REPLIT_DOMAINS ?? '')
  .split(',')
  .map((d) => d.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  devIndicators: false,
  allowedDevOrigins: replitDomains,
  transpilePackages: ['nanoid'],
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
