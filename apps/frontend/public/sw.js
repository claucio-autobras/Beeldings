/*
 * Service worker mínimo do PWA BlueBee.
 *
 * Objetivo: habilitar a instalação ("Adicionar à tela inicial") sem interferir
 * no app. Não fazemos cache de API/telemetria — o BlueBee é tempo real e dados
 * velhos seriam piores do que uma tela de erro. Estratégia: rede sempre;
 * apenas os ícones/manifest ficam num cache pequeno para o splash funcionar.
 */
const CACHE = 'bluebee-static-v1';
const STATIC_ASSETS = [
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const isStaticIcon = url.origin === self.location.origin && url.pathname.startsWith('/icons/');

  if (isStaticIcon) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request)),
    );
    return;
  }
  // Todo o resto vai direto à rede (sem cache) — app é tempo real.
});
