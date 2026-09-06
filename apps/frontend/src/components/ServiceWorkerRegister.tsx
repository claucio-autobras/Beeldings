'use client';

import { useEffect } from 'react';

/**
 * Registra o service worker do PWA. O registro é best-effort: qualquer falha é
 * ignorada para nunca quebrar o app. Fica restrito a produção — em
 * desenvolvimento o service worker poderia interferir no Fast Refresh/HMR do
 * Next, então não registramos no dev server.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;

    const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');
    const swUrl = `${basePath}/sw.js`;

    const register = () => {
      navigator.serviceWorker.register(swUrl).catch(() => {
        /* registro do SW é opcional; ignorar falhas */
      });
    };

    if (document.readyState === 'complete') {
      register();
    } else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }
  }, []);

  return null;
}
