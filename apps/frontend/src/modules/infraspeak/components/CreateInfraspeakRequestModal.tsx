'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, TriangleAlert, X } from 'lucide-react';
import { useT } from '@/lib/i18n';
import {
  createInfraspeakRequest,
  getInfraspeakFormOptions,
  type InfraspeakFormOptions,
  type InfraspeakLocalOption,
  type InfraspeakProblemOption,
  type InfraspeakRequestItem,
} from '../services/infraspeak-api.service';

interface Props {
  onClose: () => void;
  /** Chamado criado com sucesso — o chamador refaz a listagem. */
  onCreated: (created: InfraspeakRequestItem) => void;
}

/** Prioridades aceitas pela API (1–4; confirmado no sandbox: 2 = NORMAL). */
const PRIORITY_OPTIONS = [
  { value: 1, label: 'Baixa' },
  { value: 2, label: 'Normal' },
  { value: 3, label: 'Alta' },
  { value: 4, label: 'Urgente' },
];

/**
 * Filtra os problemas visíveis dado o clientId do local selecionado.
 *
 * Regra (confirmada sandbox 05/08/2026):
 *   - allClients=true → visível para qualquer local
 *   - allClients=false → visível apenas quando clientId está em clientIds
 *   - selectedClientId=null → sem filtro (local não selecionado ou clientId indeterminado)
 */
export function filterProblemsByClient(
  problems: InfraspeakProblemOption[],
  selectedClientId: number | null,
): InfraspeakProblemOption[] {
  if (selectedClientId === null) return problems;
  return problems.filter(
    (p) => p.allClients || p.clientIds.includes(selectedClientId),
  );
}

/**
 * Filtra os problemas oferecidos para um LOCAL específico do formulário.
 *
 * Endurecimento (Task de restrição por cliente): quando o local está
 * selecionado mas o seu cliente NÃO pôde ser resolvido (clientId=null — ex.:
 * `root_parent_id` sem prédio correspondente), oferecer a lista completa
 * seria uma "lista errada silenciosa": tipos restritos poderiam ser
 * escolhidos e rejeitados pela Infraspeak (400 validation.has_access_network).
 * Nesse caso oferecemos APENAS os tipos globais (allClients=true) e o
 * chamador exibe um aviso explícito.
 *
 *   - localSelected=false → lista completa (nenhum local escolhido ainda)
 *   - localSelected=true + clientId=null → só allClients=true (modo seguro)
 *   - localSelected=true + clientId → allClients=true OU clientId ∈ clientIds
 */
export function filterProblemsForLocal(
  problems: InfraspeakProblemOption[],
  localSelected: boolean,
  selectedClientId: number | null,
): InfraspeakProblemOption[] {
  if (!localSelected) return problems;
  if (selectedClientId === null) return problems.filter((p) => p.allClients);
  return filterProblemsByClient(problems, selectedClientId);
}

/** Traduz erros do backend/Infraspeak em mensagem acionável. */
export function submitErrorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/rate limit/i.test(message)) {
    return 'A Infraspeak limitou temporariamente as requisições (rate limit). Aguarde alguns instantes e tente novamente.';
  }
  if (/Infraspeak 401|autenticação inválida|token revogado/i.test(message)) {
    return 'A Infraspeak recusou o token de acesso. Verifique o token configurado no servidor.';
  }
  if (/timeout/i.test(message)) {
    return 'A Infraspeak demorou para responder. Confira na lista se o chamado foi criado antes de tentar de novo.';
  }
  // Mensagem específica de incompatibilidade problema × local (400 da Infraspeak).
  if (
    /tipo de problema selecionado não está disponível/i.test(message) ||
    /O tipo de chamado deve existir/i.test(message) ||
    /has_access_network/i.test(message)
  ) {
    return 'O tipo de problema selecionado não está disponível para o local escolhido. Selecione outro tipo de problema.';
  }
  return message;
}

/**
 * Retorna o clientId do local selecionado (ou null quando sem seleção).
 */
function resolveClientId(
  localId: number | '',
  locals: InfraspeakLocalOption[],
): number | null {
  if (localId === '') return null;
  return locals.find((l) => l.id === localId)?.clientId ?? null;
}

/**
 * Modal de abertura de chamado na Infraspeak.
 *
 * Fluxo dependente local→problema (decisão de design 01/08/2026):
 *   1. O usuário escolhe o LOCAL primeiro (define o cliente Infraspeak).
 *   2. A lista de TIPOS DE PROBLEMA filtra automaticamente para apenas os
 *      compatíveis com o cliente do local (allClients=true ou clientId na lista).
 *   3. Se o tipo selecionado ficar fora do escopo ao trocar de local, a
 *      seleção é resetada com aviso visível.
 */
export function CreateInfraspeakRequestModal({ onClose, onCreated }: Props) {
  const t = useT();
  const [localId, setLocalId] = useState<number | ''>('');
  const [problemId, setProblemId] = useState<number | ''>('');
  const [problemResetHint, setProblemResetHint] = useState(false);
  const [priority, setPriority] = useState<number>(2);
  const [description, setDescription] = useState('');
  const [created, setCreated] = useState<InfraspeakRequestItem | null>(null);

  const {
    data: options,
    isLoading: loadingOptions,
    error: optionsError,
    refetch: refetchOptions,
  } = useQuery<InfraspeakFormOptions>({
    queryKey: ['infraspeak-form-options'],
    queryFn: getInfraspeakFormOptions,
    staleTime: 5 * 60_000,
    retry: false,
  });

  // clientId do local selecionado — drive da filtragem de problemas.
  const selectedClientId = useMemo(
    () => resolveClientId(localId, options?.locals ?? []),
    [localId, options],
  );

  // Problemas disponíveis dado o local selecionado. Com local escolhido mas
  // cliente indeterminado, entra em modo seguro (só tipos globais) + aviso.
  const availableProblems = useMemo(
    () => filterProblemsForLocal(options?.problems ?? [], localId !== '', selectedClientId),
    [options, localId, selectedClientId],
  );

  // Aviso de cliente indeterminado: só relevante se o modo seguro escondeu algo.
  const clientUnresolvedWarning =
    localId !== '' &&
    selectedClientId === null &&
    (options?.problems ?? []).some((p) => !p.allClients);

  // Agrupa os tipos folha por área para o <optgroup>.
  const problemGroups = useMemo(() => {
    const groups = new Map<string, InfraspeakProblemOption[]>();
    for (const p of availableProblems) {
      const key = p.areaName ?? t('Outros');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, 'pt'));
  }, [availableProblems, t]);

  /** Muda o local e reseta a seleção de problema se ela ficar inválida. */
  const handleLocalChange = (newLocalId: number | '') => {
    setLocalId(newLocalId);
    setProblemResetHint(false);

    if (problemId === '') return;
    // Verifica se o problema atual ainda é válido para o novo local.
    if (newLocalId === '') {
      // Sem local → lista completa, mantém seleção.
      return;
    }
    const newClientId = resolveClientId(newLocalId, options?.locals ?? []);
    const allProblems = options?.problems ?? [];
    const current = allProblems.find((p) => p.id === problemId);
    if (!current) return;
    // Cliente indeterminado → modo seguro: só tipos globais permanecem válidos.
    const stillValid = current.allClients
      ? true
      : newClientId !== null && current.clientIds.includes(newClientId);
    if (!stillValid) {
      setProblemId('');
      setProblemResetHint(true);
    }
  };

  const mutation = useMutation({
    mutationFn: createInfraspeakRequest,
    onSuccess: (item) => {
      setCreated(item);
      onCreated(item);
    },
    onError: (err) => {
      // Se o erro indica combinação inválida, recarrega opções (podem ter mudado).
      const msg = err instanceof Error ? err.message : String(err);
      if (
        /tipo de problema selecionado não está disponível/i.test(msg) ||
        /O tipo de chamado deve existir/i.test(msg) ||
        /has_access_network/i.test(msg)
      ) {
        void refetchOptions();
        setProblemId('');
      }
    },
  });

  const canSubmit =
    localId !== '' &&
    problemId !== '' &&
    description.trim().length > 0 &&
    !mutation.isPending;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    mutation.mutate({
      problemId: Number(problemId),
      localId: Number(localId),
      priority,
      description: description.trim(),
    });
  };

  const inputCls =
    'w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary disabled:opacity-50';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t('Abrir chamado na Infraspeak')}
    >
      <div className="w-full max-w-lg rounded-lg border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">{t('Abrir chamado na Infraspeak')}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted/50"
            aria-label={t('Fechar')}
          >
            <X size={16} />
          </button>
        </div>

        {created ? (
          <div className="space-y-4 p-5">
            <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-500/30 dark:bg-emerald-500/10">
              <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <div>
                <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  {t('Chamado criado com sucesso')}
                </p>
                <p className="mt-0.5 text-sm text-emerald-700/80 dark:text-emerald-400/80">
                  {t('Número do chamado')}: <span className="font-semibold">#{created.id ?? '—'}</span>
                  {created.state ? ` · ${created.state}` : ''}
                </p>
              </div>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                {t('Fechar')}
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 p-5">
            {optionsError ? (
              <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
                <TriangleAlert size={15} className="mt-0.5 shrink-0" />
                <div>
                  {t('Não foi possível carregar os dados do formulário da Infraspeak.')}{' '}
                  <button type="button" className="font-medium underline" onClick={() => void refetchOptions()}>
                    {t('Tentar novamente')}
                  </button>
                </div>
              </div>
            ) : null}

            {/* LOCAL — obrigatório primeiro; define o cliente para filtrar problemas */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {t('Local')} *
              </label>
              <select
                value={localId}
                onChange={(e) =>
                  handleLocalChange(e.target.value === '' ? '' : Number(e.target.value))
                }
                disabled={loadingOptions || !!optionsError}
                required
                className={inputCls}
              >
                <option value="">{loadingOptions ? t('Carregando…') : t('Selecione o local')}</option>
                {(options?.locals ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.fullName}
                  </option>
                ))}
              </select>
            </div>

            {/* TIPO DE PROBLEMA — filtrado pelo cliente do local; requer local */}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {t('Tipo de problema')} *
              </label>
              <select
                value={problemId}
                onChange={(e) => {
                  setProblemResetHint(false);
                  setProblemId(e.target.value === '' ? '' : Number(e.target.value));
                }}
                disabled={loadingOptions || !!optionsError || localId === ''}
                required
                className={inputCls}
              >
                <option value="">
                  {loadingOptions
                    ? t('Carregando…')
                    : localId === ''
                      ? t('Selecione o local primeiro')
                      : t('Selecione o tipo de problema')}
                </option>
                {problemGroups.map(([area, list]) => (
                  <optgroup key={area} label={area}>
                    {list.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              {clientUnresolvedWarning ? (
                <p className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                  <TriangleAlert size={12} className="shrink-0" />
                  {t(
                    'Não foi possível identificar o cliente deste local na Infraspeak. Por segurança, apenas os tipos de problema disponíveis a todos os clientes são exibidos.',
                  )}
                </p>
              ) : null}
              {problemResetHint ? (
                <p className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
                  <TriangleAlert size={12} className="shrink-0" />
                  {t('O tipo de problema anterior não está disponível para este local. Selecione um novo tipo.')}
                </p>
              ) : null}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">{t('Prioridade')}</label>
              <select value={priority} onChange={(e) => setPriority(Number(e.target.value))} className={inputCls}>
                {PRIORITY_OPTIONS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {t(p.label)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                {t('Descrição do problema')} *
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                maxLength={5000}
                required
                placeholder={t('Descreva o problema encontrado…')}
                className={`${inputCls} resize-y`}
              />
            </div>

            {mutation.isError ? (
              <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
                <TriangleAlert size={15} className="mt-0.5 shrink-0" />
                <span>{submitErrorMessage(mutation.error)}</span>
              </div>
            ) : null}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                disabled={mutation.isPending}
                className="rounded-md border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/50 disabled:opacity-50"
              >
                {t('Cancelar')}
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {mutation.isPending ? <Loader2 size={14} className="animate-spin" /> : null}
                {mutation.isPending ? t('Enviando…') : t('Abrir chamado')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
