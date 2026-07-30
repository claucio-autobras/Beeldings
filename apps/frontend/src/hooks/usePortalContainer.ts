'use client';

import { useEffect, useState } from 'react';

/**
 * Resolve o container correto para portais (modais, toasts, popups globais).
 *
 * Quando alguma tela está em fullscreen (via requestFullscreen num container,
 * ex.: o viewer SCADA), o navegador só renderiza conteúdo que esteja DENTRO do
 * elemento em fullscreen. Portais montados em document.body ficariam
 * invisíveis. Este hook devolve document.fullscreenElement quando existe,
 * senão document.body, e reage ao evento `fullscreenchange` para o portal não
 * sumir se o usuário entrar/sair da tela cheia com o modal aberto.
 *
 * Reutilizável fora do módulo SCADA (ex.: NewAlarmModal montado no Topbar).
 */
export function usePortalContainer(): HTMLElement | null {
  const [container, setContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    function resolve() {
      const fs = document.fullscreenElement;
      setContainer(fs instanceof HTMLElement ? fs : document.body);
    }
    resolve();
    document.addEventListener('fullscreenchange', resolve);
    return () => document.removeEventListener('fullscreenchange', resolve);
  }, []);

  return container;
}
