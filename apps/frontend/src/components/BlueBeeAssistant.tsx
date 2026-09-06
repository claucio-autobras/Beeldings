'use client';

import Image from 'next/image';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowUpRight,
  Bot,
  ChevronRight,
  Loader2,
  MessageSquare,
  Send,
  X,
} from 'lucide-react';
import { apiGet, apiPost } from '@/lib/api-client';

interface ChatSource {
  docId: string;
  title: string;
  source: string | null;
}

interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
}

interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

interface ChatStartResponse {
  pending?: boolean;
  conversationId: string;
  userMessageId?: string;
  reply?: string;
  sources?: ChatSource[];
}

type ChatPollResponse =
  | { status: 'pending' }
  | { status: 'done'; reply: string; sources: ChatSource[] }
  | { status: 'error'; message: string };

const CHAT_POLL_INTERVAL_MS = 2500;
const CHAT_POLL_TIMEOUT_MS = 4 * 60_000;

const CONTEXTUAL_SUGGESTIONS: Record<string, string[]> = {
  alarms: [
    'Resuma os alarmes ativos',
    'Quais alarmes precisam de atenção primeiro?',
    'Explique este estado de alarme',
  ],
  dashboard: [
    'O que precisa de atenção agora?',
    'Faça um diagnóstico do estado atual',
    'Quais equipamentos estão offline?',
  ],
  scada: [
    'Analise esta tela SCADA',
    'Quais pontos estão fora do esperado?',
    'Explique os estados deste painel',
  ],
  devices: [
    'Analise este equipamento',
    'O que pode causar esta falha?',
    'Quais dados devo verificar?',
  ],
  default: [
    'O que a BlueBee pode analisar?',
    'Quais equipamentos estão offline?',
    'Faça um resumo da operação',
  ],
};

const INVITATION_MESSAGES = [
  'Posso resumir o que precisa de atenção nesta tela.',
  'Quer ajuda para entender algum alarme ou equipamento?',
  'Posso analisar a operação e explicar os próximos passos.',
  'Precisa investigar uma queda de comunicação?',
];

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function getContextKey(pathname: string) {
  if (pathname.includes('/alarms')) return 'alarms';
  if (pathname === '/dashboard') return 'dashboard';
  if (pathname.includes('/scada')) return 'scada';
  if (pathname.includes('/devices') || pathname.includes('/cftv')) return 'devices';
  return 'default';
}

function getContextLabel(pathname: string) {
  const labels: Record<string, string> = {
    alarms: 'Contexto: alarmes',
    dashboard: 'Contexto: dashboard',
    scada: 'Contexto: SCADA',
    devices: 'Contexto: equipamentos',
    default: 'Assistente operacional',
  };
  return labels[getContextKey(pathname)];
}

export function BlueBeeAssistant() {
  const pathname = usePathname();
  const router = useRouter();
  const contextKey = getContextKey(pathname);
  const contextLabel = getContextLabel(pathname);
  const suggestions = CONTEXTUAL_SUGGESTIONS[contextKey];
  const invitation = useMemo(() => {
    const seed = Array.from(pathname).reduce((total, char) => total + char.charCodeAt(0), 0);
    return INVITATION_MESSAGES[seed % INVITATION_MESSAGES.length];
  }, [pathname]);

  const [open, setOpen] = useState(false);
  const [inviteVisible, setInviteVisible] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const historyLoadedRef = useRef(false);
  const mountedRef = useRef(true);
  const cancelPollingRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (
        window.sessionStorage.getItem('bluebee-assistant-invite-shown') ||
        window.sessionStorage.getItem('bluebee-assistant-invite-dismissed')
      ) {
        return;
      }
      window.sessionStorage.setItem('bluebee-assistant-invite-shown', '1');
      setInviteVisible(true);
    }, 6500);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, loading]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeAssistant();
        return;
      }

      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), [href]',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  async function pollChatResult(id: string, userMessageId: string) {
    const startedAt = Date.now();
    let done = false;

    while (
      mountedRef.current &&
      !cancelPollingRef.current &&
      Date.now() - startedAt < CHAT_POLL_TIMEOUT_MS
    ) {
      await sleep(CHAT_POLL_INTERVAL_MS);
      if (!mountedRef.current || cancelPollingRef.current) return;

      let poll: ChatPollResponse;
      try {
        poll = await apiGet<ChatPollResponse>(
          `/ai/chat/result?conversationId=${encodeURIComponent(id)}&after=${encodeURIComponent(userMessageId)}`,
        );
      } catch {
        continue;
      }

      if (poll.status === 'pending') continue;
      if (poll.status === 'error') {
        if (mountedRef.current) setError(poll.message || 'Não foi possível concluir a análise.');
      } else if (mountedRef.current) {
        setMessages((previous) => [
          ...previous,
          {
            role: 'assistant',
            content: poll.reply || '(sem resposta)',
            sources: poll.sources ?? [],
          },
        ]);
      }
      done = true;
      break;
    }

    if (!done && mountedRef.current && !cancelPollingRef.current) {
      setError('A resposta está demorando mais que o esperado. Ela ficará salva na conversa completa.');
    }
  }

  async function loadLatestConversation() {
    if (historyLoadedRef.current || loadingHistory) return;

    setLoadingHistory(true);
    setError(null);
    try {
      const conversations = await apiGet<ConversationSummary[]>('/ai/conversations');
      const latest = conversations[0];
      if (latest) {
        const detail = await apiGet<{ messages: ChatMessage[] }>(
          `/ai/conversations/${encodeURIComponent(latest.id)}`,
        );
        if (!mountedRef.current) return;
        setConversationId(latest.id);
        setMessages(detail.messages ?? []);

        const last = detail.messages?.[detail.messages.length - 1];
        if (last?.role === 'user' && last.id) {
          setLoading(true);
          try {
            await pollChatResult(latest.id, last.id);
          } finally {
            if (mountedRef.current) setLoading(false);
          }
        }
      }
      historyLoadedRef.current = true;
    } catch (requestError) {
      if (mountedRef.current) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Não foi possível carregar a conversa.',
        );
      }
    } finally {
      if (mountedRef.current) setLoadingHistory(false);
    }
  }

  function openAssistant() {
    cancelPollingRef.current = false;
    setInviteVisible(false);
    setOpen(true);
    void loadLatestConversation();
  }

  function dismissInvitation() {
    window.sessionStorage.setItem('bluebee-assistant-invite-dismissed', '1');
    setInviteVisible(false);
  }

  function closeAssistant() {
    setOpen(false);
    window.setTimeout(() => launcherRef.current?.focus(), 0);
  }

  function openFullChat() {
    cancelPollingRef.current = true;
    setOpen(false);
    router.push(conversationId ? `/ai?conversationId=${encodeURIComponent(conversationId)}` : '/ai');
  }

  async function sendMessage(text: string) {
    const content = text.trim();
    if (!content || loading) return;

    cancelPollingRef.current = false;
    setError(null);
    setMessages((previous) => [...previous, { role: 'user', content }]);
    setInput('');
    setLoading(true);

    try {
      const response = await apiPost<ChatStartResponse>('/ai/chat', {
        conversationId,
        content,
      });
      if (!mountedRef.current) return;

      setConversationId(response.conversationId);
      if (response.reply) {
        setMessages((previous) => [
          ...previous,
          {
            role: 'assistant',
            content: response.reply ?? '(sem resposta)',
            sources: response.sources ?? [],
          },
        ]);
      } else if (response.userMessageId) {
        await pollChatResult(response.conversationId, response.userMessageId);
      } else {
        throw new Error('A resposta do assistente não trouxe um turno válido.');
      }
      historyLoadedRef.current = true;
    } catch (requestError) {
      if (mountedRef.current) {
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'Não foi possível falar com o assistente.',
        );
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage(input);
    }
  }

  return (
    <>
      {!open && (
        <div className="pointer-events-none fixed bottom-8 right-8 z-30 flex flex-col items-end gap-3 md:bottom-10 md:right-10">
          {inviteVisible && (
            <div className="pointer-events-auto flex max-w-[300px] items-start gap-2 rounded-[4px] border border-cyan-200 bg-card px-3 py-2.5 text-sm text-foreground shadow-[0_12px_30px_rgba(15,23,42,0.16)] dark:border-cyan-900/70 dark:bg-slate-900 dark:text-[#E6EDF7]">
              <button type="button" onClick={openAssistant} className="flex-1 text-left leading-relaxed">
                {invitation}
              </button>
              <button
                type="button"
                onClick={dismissInvitation}
                className="shrink-0 rounded p-0.5 text-muted-foreground transition hover:bg-muted hover:text-foreground"
                aria-label="Dispensar mensagem da BlueBee"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <button
            ref={launcherRef}
            type="button"
            onClick={openAssistant}
            aria-expanded={false}
            aria-controls="bluebee-assistant-panel"
            aria-label="Abrir assistente BlueBee"
            className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full border border-cyan-500/75 bg-[#EDF3F7] text-slate-950 shadow-[0_10px_25px_rgba(8,145,178,0.24)] transition duration-200 hover:-translate-y-0.5 hover:bg-[#E3EDF2] hover:shadow-[0_14px_30px_rgba(8,145,178,0.32)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Image
              src="/bluebee-avatar.png"
              alt=""
              aria-hidden="true"
              width={38}
              height={38}
              className="h-10 w-10 object-contain"
            />
          </button>
        </div>
      )}

      {open && (
        <div
          ref={panelRef}
          id="bluebee-assistant-panel"
          role="dialog"
          aria-modal="true"
          aria-labelledby="bluebee-assistant-title"
           className="bluebee-assistant-panel fixed bottom-8 right-8 z-30 flex h-[min(560px,calc(100dvh-2rem))] w-[min(390px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-cyan-300/25 bg-[#0F172A] text-[#E6EDF7] shadow-[0_24px_70px_rgba(15,23,42,0.38)] max-md:bottom-0 max-md:right-0 max-md:h-[min(78dvh,640px)] max-md:w-full max-md:rounded-b-none max-md:rounded-t-2xl md:bottom-10 md:right-10"
        >
          <header className="flex shrink-0 items-center gap-3 border-b border-cyan-300/15 bg-slate-950/45 px-4 py-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-cyan-300/30 bg-cyan-400/10">
              <Image
                src="/bluebee-avatar.png"
                alt="BlueBee"
                width={31}
                height={31}
                className="h-8 w-8 object-contain"
              />
            </div>
            <div className="min-w-0 flex-1">
              <h2 id="bluebee-assistant-title" className="text-sm font-semibold text-white">
                Assistente BlueBee
              </h2>
              <p className="mt-0.5 truncate font-mono text-[10px] uppercase tracking-[0.12em] text-[#A5F3FC]/75">
                {contextLabel}
              </p>
            </div>
            <button
              type="button"
              onClick={closeAssistant}
              className="rounded-md p-1.5 text-[#94A3B8] transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              aria-label="Fechar assistente BlueBee"
            >
              <X className="h-4 w-4" />
            </button>
          </header>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {loadingHistory ? (
              <div className="space-y-3" aria-label="Carregando conversa">
                <div className="h-14 animate-pulse rounded-lg bg-white/10" />
                <div className="ml-8 h-10 animate-pulse rounded-lg bg-cyan-400/10" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex min-h-full flex-col justify-center gap-4">
                <div className="flex gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-400/10 text-[#A5F3FC]">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="rounded-lg rounded-tl-sm bg-white/8 px-3 py-2.5 text-sm leading-relaxed text-[#E2E8F0]">
                    Olá. Sou a BlueBee. Posso ajudar a entender alarmes, equipamentos e a operação desta tela.
                  </div>
                </div>
                <div className="space-y-2">
                    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-[#A5F3FC]/75">
                    Sugestões rápidas
                  </p>
                  {suggestions.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => void sendMessage(suggestion)}
                      className="flex w-full items-center justify-between gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-left text-xs text-[#E2E8F0] transition hover:border-cyan-300/40 hover:bg-cyan-400/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                    >
                      <span>{suggestion}</span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message, index) => (
                <div
                  key={message.id ?? `${message.role}-${index}`}
                  className={`flex gap-2.5 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}
                >
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                      message.role === 'user'
                        ? 'bg-cyan-600 text-white'
                        : 'bg-cyan-400/10 text-cyan-200'
                    }`}
                  >
                    {message.role === 'user' ? (
                      <MessageSquare className="h-4 w-4" />
                    ) : (
                      <Image
                        src="/bluebee-avatar.png"
                        alt="BlueBee"
                        width={25}
                        height={25}
                        className="h-6 w-6 object-contain"
                      />
                    )}
                  </div>
                  <div
                    className={`flex max-w-[82%] flex-col gap-1.5 ${
                      message.role === 'user' ? 'items-end' : 'items-start'
                    }`}
                  >
                    <div
                      className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed ${
                        message.role === 'user'
                          ? 'rounded-tr-sm bg-cyan-600 text-white'
                        : 'rounded-tl-sm bg-white/8 text-[#E2E8F0]'
                      }`}
                    >
                      {message.content}
                    </div>
                    {message.role === 'assistant' && message.sources && message.sources.length > 0 && (
                      <details className="text-[10px] text-[#A5F3FC]/75">
                        <summary className="cursor-pointer list-none hover:text-[#CFFAFE]">
                          Fontes da análise ({message.sources.length})
                        </summary>
                        <div className="mt-1 space-y-1">
                          {message.sources.map((source) => (
                            <div key={source.docId} className="truncate" title={source.source ?? undefined}>
                              {source.title}
                            </div>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                </div>
              ))
            )}

            {loading && (
              <div className="flex gap-2.5" aria-live="polite">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cyan-400/10">
                  <Image
                    src="/bluebee-avatar.png"
                    alt="BlueBee"
                    width={25}
                    height={25}
                    className="h-6 w-6 object-contain"
                  />
                </div>
                <div className="flex items-center gap-2 rounded-lg rounded-tl-sm bg-white/8 px-3 py-2 text-xs text-[#CBD5E1]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-300" />
                  Analisando a operação...
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="shrink-0 border-t border-red-300/20 bg-red-400/10 px-4 py-2 text-xs leading-relaxed text-red-200">
              {error}
            </div>
          )}

          <div className="shrink-0 border-t border-cyan-300/15 bg-slate-950/35 p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                autoFocus
                placeholder="Pergunte à BlueBee..."
                aria-label="Mensagem para a BlueBee"
                className="max-h-28 min-h-10 flex-1 resize-none rounded-md border border-white/15 bg-white/8 px-3 py-2.5 text-sm text-white outline-none placeholder:text-[#94A3B8] focus:border-cyan-300/70 focus:ring-1 focus:ring-cyan-300/30"
              />
              <button
                type="button"
                onClick={() => void sendMessage(input)}
                disabled={loading || input.trim().length === 0}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-cyan-600 text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                aria-label="Enviar mensagem"
              >
                <Send className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={openFullChat}
              className="mt-2 flex items-center gap-1 text-[10px] font-medium text-[#A5F3FC]/75 transition hover:text-[#CFFAFE] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cyan-300"
            >
              Abrir conversa completa
              <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}