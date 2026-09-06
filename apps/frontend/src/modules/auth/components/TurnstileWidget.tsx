'use client';

import { useEffect, useRef, useState } from 'react';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

declare global {
  interface Window {
    turnstile?: {
      render: (
        el: HTMLElement,
        opts: {
          sitekey: string;
          callback: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: () => void;
          theme?: 'light' | 'dark' | 'auto';
          language?: string;
        },
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

/** Carrega o script do Turnstile uma única vez (compartilhado entre montagens). */
let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SCRIPT_SRC;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scriptPromise = null;
        reject(new Error('Falha ao carregar o Cloudflare Turnstile'));
      };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

interface Props {
  siteKey: string;
  /** Recebe o token quando o desafio é concluído; null quando expira/é limpo. */
  onToken: (token: string | null) => void;
  /** Incrementar força um reset do desafio (tokens são de uso único). */
  resetSignal?: number;
}

/**
 * Widget anti-robô do Cloudflare Turnstile (renderização explícita).
 * Se o script não carregar (bloqueador/rede), não quebra o formulário — o
 * backend decide se exige ou não o token.
 */
export function TurnstileWidget({ siteKey, onToken, resetSignal = 0 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;
  const widgetIdRef = useRef<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Tokens do Turnstile são de uso único: após um login que falhou, o pai
  // incrementa resetSignal para re-desafiar e emitir um token novo.
  useEffect(() => {
    if (resetSignal > 0 && widgetIdRef.current && window.turnstile) {
      onTokenRef.current(null);
      window.turnstile.reset(widgetIdRef.current);
    }
  }, [resetSignal]);

  useEffect(() => {
    let widgetId: string | null = null;
    let cancelled = false;

    loadScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        widgetId = widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'light',
          language: 'pt-br',
          callback: (token) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
        });
      })
      .catch(() => setFailed(true));

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
      if (widgetIdRef.current === widgetId) widgetIdRef.current = null;
    };
  }, [siteKey]);

  if (failed) {
    return (
      <p className="text-xs text-slate-500">
        Não foi possível carregar a verificação de segurança. Verifique bloqueadores e recarregue a
        página.
      </p>
    );
  }

  return <div ref={containerRef} className="min-h-[65px]" />;
}
