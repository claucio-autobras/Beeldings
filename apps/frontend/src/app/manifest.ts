import type { MetadataRoute } from 'next';

// Prefixo de caminho (sub-path). Vazio em dev/prod atual; mantido para
// compatibilidade futura com deploy sob sub-path (ver lib/routes.ts).
const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');
const p = (path: string) => `${BASE_PATH}${path}`;

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: p('/'),
    name: 'BlueBee IoT — Plataforma Supervisória',
    short_name: 'BlueBee',
    description: 'Monitoramento remoto de sistemas BMS — Autobras BlueBee',
    start_url: p('/'),
    scope: p('/'),
    display: 'standalone',
    orientation: 'any',
    background_color: '#F8FAFC',
    theme_color: '#0E7490',
    lang: 'pt-BR',
    dir: 'ltr',
    categories: ['business', 'productivity', 'utilities'],
    icons: [
      { src: p('/icons/icon-192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: p('/icons/icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: p('/icons/icon-maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
