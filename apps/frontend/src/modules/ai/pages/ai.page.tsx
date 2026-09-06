'use client';

import Image from 'next/image';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  FileText,
  Lightbulb,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  Send,
  Sparkles,
  Trash2,
  User,
  X,
} from 'lucide-react';
import { apiDelete, apiGet, apiPost } from '@/lib/api-client';
import { getDevices } from '@/modules/devices/services/devices.service';
import type { Device } from '@/modules/devices/types/device.types';
import {
  SimilarCasesList,
  type SimilarCaseView,
} from '../components/SimilarCasesList';
import InsightsPanel from '../components/InsightsPanel';

interface ChatSource {
  docId: string;
  title: string;
  type: string;
  source: string | null;
}

interface ChatMessage {
  /** Id persistido — presente nas mensagens vindas do histórico. */
  id?: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSource[];
  /** Casos anônimos da memória operacional usados como fonte pela IA. */
  similarCases?: SimilarCaseView[];
}

interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

// O POST /ai/chat responde na hora (o proxy de produção corta requests >30s):
// a resposta da IA é gerada em segundo plano e buscada via polling.
interface ChatStartResponse {
  pending: true;
  conversationId: string;
  title: string;
  userMessageId: string;
}

type ChatPollResponse =
  | { status: 'pending' }
  | {
      status: 'done';
      reply: string;
      sources: ChatSource[];
      similarCases?: SimilarCaseView[];
    }
  | { status: 'error'; message: string };

/** Intervalo entre polls do resultado do turno. */
const CHAT_POLL_INTERVAL_MS = 2500;
/** Teto do polling — bem acima do pior caso observado (30–45s com RAG). */
const CHAT_POLL_TIMEOUT_MS = 4 * 60_000;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

interface SuggestionAlarm {
  name: string;
  message: string;
  severity: string;
  state: string;
  activatedAt: string;
}

interface SuggestionResponse {
  deviceId: string;
  deviceName: string;
  alarms: SuggestionAlarm[];
  suggestion: string;
  sources: ChatSource[];
  similarCases?: SimilarCaseView[];
}

const QUICK_ACTIONS = [
  'O que está offline agora?',
  'Faça um diagnóstico do estado atual do sistema',
  'Há algum alarme ativo? Há quanto tempo?',
  'Como funciona o reconhecimento de alarmes na Beeldings?',
] as const;

export default function AiPage() {
  const searchParams = useSearchParams();
  const requestedConversationId = searchParams.get('conversationId');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Abas: sugestões por equipamento e insights periódicos
  const [tab, setTab] = useState<'chat' | 'suggest' | 'insights'>('chat');
  const [devices, setDevices] = useState<Device[]>([]);
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState('');
  const [symptom, setSymptom] = useState('');
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<SuggestionResponse | null>(null);

  // Ao abrir a página, carrega o histórico e seleciona a conversa mais recente.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await apiGet<ConversationSummary[]>('/ai/conversations');
        if (cancelled) return;
        setConversations(list);
        const requestedConversation = requestedConversationId
          ? list.find((conversation) => conversation.id === requestedConversationId)
          : undefined;
        const initialConversation = requestedConversation ?? list[0];
        if (initialConversation) {
          await openConversation(initialConversation.id);
        }
      } catch {
        // Falha ao carregar histórico não deve impedir iniciar nova conversa.
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedConversationId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, loading]);

  async function refreshConversations() {
    try {
      const list = await apiGet<ConversationSummary[]>('/ai/conversations');
      setConversations(list);
    } catch {
      // silencioso — a lista será atualizada na próxima interação
    }
  }

  async function openConversation(id: string) {
    if (loading) return;
    setError(null);
    setActiveId(id);
    try {
      const detail = await apiGet<{ messages: ChatMessage[] }>(`/ai/conversations/${id}`);
      setMessages(detail.messages);
      // Turno pendente: o último registro é do usuário (a resposta ainda está
      // sendo gerada em segundo plano). Retoma o "Pensando…" e o polling para
      // não perder a resposta ao navegar/recarregar.
      const last = detail.messages[detail.messages.length - 1];
      if (last && last.role === 'user' && last.id) {
        setLoading(true);
        try {
          await pollChatResult(id, last.id);
        } finally {
          setLoading(false);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar a conversa.');
      setMessages([]);
    }
  }

  function startNewConversation() {
    if (loading) return;
    setActiveId(null);
    setMessages([]);
    setError(null);
    setInput('');
  }

  async function removeConversation(id: string) {
    try {
      await apiDelete(`/ai/conversations/${id}`);
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (id === activeId) startNewConversation();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao excluir a conversa.');
    }
  }

  /**
   * Busca por polling o turno do assistente gerado em segundo plano após a
   * mensagem `userMessageId`. Falhas de rede pontuais não desistem: o backend
   * persiste o resultado, então a próxima tentativa o encontra.
   */
  async function pollChatResult(conversationId: string, userMessageId: string) {
    const startedAt = Date.now();
    let done = false;
    while (Date.now() - startedAt < CHAT_POLL_TIMEOUT_MS) {
      await sleep(CHAT_POLL_INTERVAL_MS);
      let poll: ChatPollResponse;
      try {
        poll = await apiGet<ChatPollResponse>(
          `/ai/chat/result?conversationId=${encodeURIComponent(conversationId)}&after=${encodeURIComponent(userMessageId)}`,
        );
      } catch {
        continue;
      }
      if (poll.status === 'pending') continue;
      if (poll.status === 'error') {
        setError(poll.message || 'Erro ao falar com o assistente.');
      } else {
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: poll.reply || '(sem resposta)',
            sources: poll.sources ?? [],
            similarCases: poll.similarCases ?? [],
          },
        ]);
        void refreshConversations();
      }
      done = true;
      break;
    }
    if (!done) {
      setError(
        'A resposta está demorando mais que o esperado. Ela ficará salva nesta conversa — reabra-a em instantes.',
      );
    }
  }

  async function sendMessage(text: string) {
    const content = text.trim();
    if (!content || loading) return;

    setError(null);
    setMessages((prev) => [...prev, { role: 'user', content }]);
    setInput('');
    setLoading(true);

    try {
      const res = await apiPost<ChatStartResponse>('/ai/chat', {
        conversationId: activeId,
        content,
      });
      if (!activeId) setActiveId(res.conversationId);
      await pollChatResult(res.conversationId, res.userMessageId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao falar com o assistente.');
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  }

  // Carrega a lista de equipamentos na primeira vez que a aba de sugestões abre.
  useEffect(() => {
    if (tab !== 'suggest' || devicesLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await getDevices();
        if (!cancelled) setDevices(list);
      } catch (e) {
        if (!cancelled) {
          setSuggestError(e instanceof Error ? e.message : 'Erro ao carregar equipamentos.');
        }
      } finally {
        if (!cancelled) setDevicesLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab, devicesLoaded]);

  async function runSuggestion() {
    if (!selectedDevice || suggesting) return;
    setSuggesting(true);
    setSuggestError(null);
    setSuggestion(null);
    try {
      const res = await apiPost<SuggestionResponse>('/ai/suggest', {
        deviceId: selectedDevice,
        symptom: symptom.trim() || undefined,
      });
      setSuggestion(res);
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : 'Erro ao gerar sugestões.');
    } finally {
      setSuggesting(false);
    }
  }

  const isEmpty = messages.length === 0;
  const activeConversationTitle =
    conversations.find((conversation) => conversation.id === activeId)?.title ?? 'Nova conversa';
  const conversationStatusLabel = loading
    ? 'Analisando agora'
    : isEmpty
      ? 'Pronta para começar'
      : 'Conversa em andamento';

  function renderHistoryBody(onNavigate?: () => void) {
    return (
      <>
        <div className="border-b border-border bg-background/70 p-3 dark:bg-[#0B1220]/45">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-cyan-700 dark:text-cyan-300">
                Arquivo de conversas
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Continue de onde parou</p>
            </div>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-200 bg-[#EDF3F7] text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-300">
              <MessageSquare className="h-4 w-4" />
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              startNewConversation();
              onNavigate?.();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-3 py-2.5 text-sm font-medium text-white shadow-[0_6px_16px_rgba(8,145,178,0.18)] transition hover:bg-cyan-700 hover:shadow-[0_8px_20px_rgba(8,145,178,0.28)]"
          >
            <MessageSquarePlus className="h-4 w-4" />
            Nova conversa
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {loadingHistory ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Carregando...
            </div>
          ) : conversations.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              Nenhuma conversa ainda.
            </p>
          ) : (
            <ul className="space-y-1">
              {conversations.map((c) => (
                <li key={c.id}>
                  <div
                    className={`group flex items-center gap-1 rounded-md px-2 py-2 text-sm transition ${
                      c.id === activeId
                         ? 'bg-cyan-50 text-cyan-900 dark:bg-cyan-950/70 dark:text-cyan-300'
                        : 'text-foreground hover:bg-muted'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        void openConversation(c.id);
                        onNavigate?.();
                      }}
                      className="flex-1 truncate text-left"
                      title={c.title}
                    >
                      {c.title}
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeConversation(c.id)}
                      className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition hover:bg-red-100 hover:text-red-600 group-hover:opacity-100"
                      title="Excluir conversa"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <section className="relative overflow-hidden rounded-xl border border-cyan-200/80 bg-white px-4 py-3.5 shadow-[0_10px_28px_rgba(15,23,42,0.07)] dark:border-cyan-900/70 dark:bg-[#101B2E] dark:shadow-[0_14px_32px_rgba(0,0,0,0.16)]">
        <div className="surface-comb pointer-events-none absolute inset-0 opacity-70 dark:opacity-80" />
        <div className="pointer-events-none absolute -right-20 -top-24 h-52 w-52 rounded-full bg-cyan-300/15 blur-3xl dark:bg-cyan-400/10" />
        <div className="relative flex items-center gap-3">
          <div className="flex items-start gap-3">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-cyan-400/60 bg-[#EDF3F7] shadow-[0_0_20px_rgba(34,211,238,0.15)] dark:bg-[#16213A]">
              <Image
                src="/bluebee-avatar.png"
                alt=""
                aria-hidden="true"
                width={40}
                height={40}
                className="h-10 w-10 object-contain"
              />
            </span>
            <div className="min-w-0">
              <p className="font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-cyan-700 dark:text-cyan-300">
                Assistente operacional
              </p>
              <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-foreground">BlueBee</h1>
            </div>
          </div>
        </div>
      </section>

      {/* Abas: conversa livre x sugestões por equipamento */}
      <div className="flex border-b border-border">
        <div className="flex gap-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => setTab('chat')}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === 'chat'
                ? 'border-cyan-600 text-cyan-700 dark:border-cyan-300 dark:text-cyan-300'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <MessageSquare className="h-4 w-4" />
            Conversa
          </button>
          <button
            type="button"
            onClick={() => setTab('suggest')}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === 'suggest'
                ? 'border-cyan-600 text-cyan-700 dark:border-cyan-300 dark:text-cyan-300'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Lightbulb className="h-4 w-4" />
            Sugestões por equipamento
          </button>
          <button
            type="button"
            onClick={() => setTab('insights')}
            className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
              tab === 'insights'
                ? 'border-cyan-600 text-cyan-700 dark:border-cyan-300 dark:text-cyan-300'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <FileText className="h-4 w-4" />
            Insights
          </button>
        </div>
      </div>

      {tab === 'insights' && <InsightsPanel />}

      {tab === 'suggest' && (
        <div className="flex flex-col gap-4">
          <div className="space-y-3 rounded-lg border border-border bg-card p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_2fr]">
              <label className="text-sm">
                <span className="mb-1 block font-medium text-foreground">Equipamento</span>
                <select
                  value={selectedDevice}
                  onChange={(e) => setSelectedDevice(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-cyan-400"
                >
                  <option value="">
                    {devicesLoaded ? 'Selecione um equipamento...' : 'Carregando...'}
                  </option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-foreground">
                  Sintoma observado (opcional)
                </span>
                <input
                  value={symptom}
                  onChange={(e) => setSymptom(e.target.value)}
                  placeholder="ex.: alta pressão de condensação, ruído anormal..."
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-cyan-400"
                />
              </label>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void runSuggestion()}
                disabled={!selectedDevice || suggesting}
                className="flex items-center gap-2 rounded-md bg-cyan-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {suggesting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Lightbulb className="h-4 w-4" />
                )}
                Gerar sugestões
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              As sugestões são baseadas nos playbooks aprovados da base de conhecimento e nos
              alarmes recentes do equipamento. São apenas recomendações — a decisão é sempre do
              operador.
            </p>
          </div>

          {suggestError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {suggestError}
            </div>
          )}

          {suggestion && (
            <div className="space-y-4 rounded-lg border border-border bg-card p-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  {suggestion.deviceName}
                </h2>
                {suggestion.alarms.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground">Alarmes recentes:</p>
                    <ul className="space-y-1">
                      {suggestion.alarms.map((a, idx) => (
                        <li key={idx} className="text-xs text-foreground">
                          <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800">
                            {a.severity}
                          </span>{' '}
                          {a.name} — {a.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="whitespace-pre-wrap rounded-md bg-muted px-3 py-3 text-sm text-foreground">
                {suggestion.suggestion}
              </div>

              {suggestion.sources.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                    <BookOpen className="h-3 w-3" />
                    Fontes:
                  </span>
                  {suggestion.sources.map((s) => (
                    <span
                      key={s.docId}
                       className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-xs text-cyan-800 dark:border-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300"
                      title={s.source ?? undefined}
                    >
                      {s.title}
                    </span>
                  ))}
                </div>
              )}

              <SimilarCasesList cases={suggestion.similarCases} />
            </div>
          )}
        </div>
      )}

      {tab === 'chat' && (
      <div className="flex flex-col gap-3">
        {/* Controles de histórico no mobile (a sidebar fica oculta abaixo de sm) */}
        <div className="flex gap-2 sm:hidden">
          <button
            type="button"
            onClick={() => setHistoryOpen(true)}
            className="flex flex-1 items-center justify-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted"
          >
            <MessageSquare className="h-4 w-4" />
            Conversas
          </button>
          <button
            type="button"
            onClick={startNewConversation}
            className="flex flex-1 items-center justify-center gap-2 rounded-md bg-cyan-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-cyan-700"
          >
            <MessageSquarePlus className="h-4 w-4" />
            Nova conversa
          </button>
        </div>

        {/* Drawer de histórico no mobile */}
        {historyOpen && (
          <div className="fixed inset-0 z-50 flex sm:hidden">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setHistoryOpen(false)}
            />
            <aside className="relative flex h-full w-72 max-w-[85%] flex-col overflow-hidden bg-card shadow-xl">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-sm font-medium text-foreground">Conversas</span>
                <button
                  type="button"
                  onClick={() => setHistoryOpen(false)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {renderHistoryBody(() => setHistoryOpen(false))}
            </aside>
          </div>
        )}

        <div className="flex h-[calc(100dvh-250px)] min-h-[320px] max-h-[680px] gap-4">
        {/* Sidebar de histórico de conversas */}
        <aside className="hidden w-64 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[0_10px_28px_rgba(15,23,42,0.05)] dark:shadow-[0_14px_32px_rgba(0,0,0,0.16)] sm:flex">
          {renderHistoryBody()}
        </aside>

        {/* Área de conversa */}
        <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[0_10px_28px_rgba(15,23,42,0.05)] dark:shadow-[0_14px_32px_rgba(0,0,0,0.16)]">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-background/55 px-4 py-3 dark:bg-[#0B1220]/35">
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-cyan-700 dark:text-cyan-300">
                Conversa ativa
              </p>
              <p className="mt-1 truncate text-sm font-medium text-foreground">{activeConversationTitle}</p>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-cyan-200 bg-[#EDF3F7] px-2.5 py-1 text-[11px] font-medium text-cyan-800 dark:border-cyan-800 dark:bg-cyan-950/60 dark:text-cyan-300">
              <Sparkles className="h-3.5 w-3.5" />
              {conversationStatusLabel}
            </span>
          </div>
          <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
            {isEmpty && (
              <div className="flex min-h-full flex-col items-center justify-center gap-4 px-2 py-6 text-center">
                <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-cyan-300/60 bg-[#EDF3F7] shadow-[0_0_28px_rgba(34,211,238,0.16)] dark:border-cyan-700/70 dark:bg-[#16213A]">
                  <img
                    src="/bluebee-avatar.png"
                    alt="Assistente Bluebee"
                    className="h-16 w-16 object-contain"
                  />
                </div>
                <div className="max-w-xl">
                  <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground">
                    Como posso ajudar?
                  </h2>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                    Pergunte sobre sua operação, alarmes e equipamentos.
                  </p>
                </div>
                <div className="grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
                  {QUICK_ACTIONS.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => void sendMessage(prompt)}
                      className="rounded-lg border border-border bg-background/70 px-3 py-2.5 text-left text-sm text-foreground transition hover:border-cyan-400 hover:bg-cyan-50 dark:bg-[#0B1220]/45 dark:hover:bg-cyan-950/60"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div
                key={i}
                className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}
              >
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                    m.role === 'user'
                      ? 'bg-cyan-600 text-white'
                      : 'bg-muted text-foreground'
                  }`}
                >
                  {m.role === 'user' ? (
                    <User className="h-4 w-4" />
                  ) : (
                    <img
                      src="/bluebee-avatar.png"
                      alt="Assistente Bluebee"
                      className="h-7 w-7 object-contain"
                    />
                  )}
                </div>
                <div className="flex max-w-[80%] flex-col gap-1.5">
                  <div
                    className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                      m.role === 'user'
                        ? 'bg-cyan-600 text-white'
                        : 'bg-muted text-foreground'
                    }`}
                  >
                    {m.content}
                  </div>
                  {m.role === 'assistant' && m.sources && m.sources.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                        <BookOpen className="h-3 w-3" />
                        Fontes:
                      </span>
                      {m.sources.map((s) => (
                        <span
                          key={s.docId}
                          className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-xs text-cyan-800 dark:border-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-300"
                          title={s.source ?? undefined}
                        >
                          {s.title}
                        </span>
                      ))}
                    </div>
                  )}
                  {m.role === 'assistant' && (
                    <SimilarCasesList cases={m.similarCases} />
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-foreground">
                  <img
                    src="/bluebee-avatar.png"
                    alt="Assistente Bluebee"
                    className="h-7 w-7 object-contain"
                  />
                </div>
                <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Pensando...
                </div>
              </div>
            )}
          </div>

          {error && (
            <div className="border-t border-border bg-red-50 px-4 py-2 text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="border-t border-border p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                rows={1}
                placeholder="Digite sua mensagem..."
                className="max-h-32 flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-cyan-400"
              />
              <button
                type="button"
                onClick={() => void sendMessage(input)}
                disabled={loading || input.trim().length === 0}
                className="flex h-10 items-center gap-1 rounded-md bg-cyan-600 px-4 text-sm font-medium text-white transition hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                Enviar
              </button>
            </div>
          </div>
        </div>
      </div>
      </div>
      )}
    </div>
  );
}
