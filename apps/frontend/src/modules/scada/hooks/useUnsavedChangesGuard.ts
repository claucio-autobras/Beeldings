import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Bloqueia a saída da tela enquanto houver alterações não salvas.
 *
 * Cobre os dois caminhos reais de saída do editor:
 *  - Recarregar / fechar a aba / navegação "dura" → diálogo nativo do navegador.
 *  - Clique em qualquer link interno (sidebar, topbar, breadcrumb) → diálogo da app.
 *
 * Enquanto `when` for `true` e o usuário tentar sair por um link, a navegação é
 * interceptada e `pendingHref` passa a apontar para o destino pretendido. Cabe ao
 * componente exibir a confirmação e chamar `proceed()` (sair) ou `cancel()` (ficar).
 */
export function useUnsavedChangesGuard(when: boolean): {
  pendingHref: string | null;
  proceed: () => void;
  cancel: () => void;
} {
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  // Recarregar / fechar a aba / sair do site — diálogo nativo do navegador.
  useEffect(() => {
    if (!when) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [when]);

  // Navegação interna por clique em link (sidebar, topbar, etc.).
  useEffect(() => {
    if (!when) return;
    function onClick(e: MouseEvent) {
      // Respeita ações já tratadas, cliques não-primários e abrir em nova aba.
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as HTMLElement | null)?.closest('a');
      if (!anchor) return;
      const href = anchor.getAttribute('href');
      const target = anchor.getAttribute('target');
      // Ignora âncoras, esquemas externos (mailto:, http:), novas abas e a própria URL.
      if (!href || href.startsWith('#') || target === '_blank' || /^[a-z]+:/i.test(href)) return;
      if (href === window.location.pathname + window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setPendingHref(href);
    }
    // Captura na fase de captura para interceptar antes do handler do Next/Link.
    document.addEventListener('click', onClick, true);
    return () => document.removeEventListener('click', onClick, true);
  }, [when]);

  const proceed = useCallback(() => {
    const href = pendingHref;
    setPendingHref(null);
    if (href) router.push(href);
  }, [pendingHref, router]);

  const cancel = useCallback(() => setPendingHref(null), []);

  return { pendingHref, proceed, cancel };
}
