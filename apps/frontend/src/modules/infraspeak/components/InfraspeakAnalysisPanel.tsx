'use client';

import { useState } from 'react';
import { Loader2, Search, Sparkles, TriangleAlert } from 'lucide-react';
import { useT } from '@/lib/i18n';
import {
  analyzeInfraspeakRequest,
  type AnalyzeInfraspeakInput,
  type InfraspeakAnalysisResult,
} from '../services/infraspeak-api.service';

interface Props {
  /** Entrada da análise: chamado existente (failureId) ou rascunho. */
  input: AnalyzeInfraspeakInput;
  /** Abre o detalhe de um chamado de referência (quando disponível na lista). */
  onOpenReference?: (failureId: number) => void;
}

const CONFIDENCE_LABEL: Record<'high' | 'medium' | 'low', string> = {
  high: 'Alta confiança',
  medium: 'Média confiança',
  low: 'Baixa confiança',
};

const CONFIDENCE_CLASS: Record<'high' | 'medium' | 'low', string> = {
  high: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400',
  low: 'bg-slate-200 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300',
};

function errorMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/rate limit|Too Many Requests|429/i.test(message)) {
    return 'Limite de análises atingido. Aguarde alguns instantes e tente novamente.';
  }
  if (/não configurad/i.test(message)) {
    return 'O serviço de IA não está configurado neste servidor.';
  }
  if (/ainda não sincronizado/i.test(message)) {
    return 'Este chamado ainda não entrou na base local de análise. Aguarde a próxima sincronização e tente de novo.';
  }
  return message;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h4>
      <div className="mt-1 text-sm text-foreground">{children}</div>
    </section>
  );
}

/**
 * Painel "Analisar com IA": recomendação fundamentada no histórico de chamados
 * da Infraspeak, no formato do roteiro — Problema identificado, Casos
 * semelhantes (IDs clicáveis), Ação sugerida, Evidência histórica e Nível de
 * confiança. Estados de carregamento, erro, IA indisponível (contexto factual)
 * e "sem histórico suficiente" (só pontos de investigação).
 */
export function InfraspeakAnalysisPanel({ input, onOpenReference }: Props) {
  const t = useT();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InfraspeakAnalysisResult | null>(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      setResult(await analyzeInfraspeakRequest(input));
    } catch (err) {
      setResult(null);
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const analysis = result?.analysis ?? null;

  return (
    <section className="rounded-lg border border-border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles size={15} className="text-cyan-600 dark:text-cyan-400" />
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('Análise com IA (histórico de chamados)')}
          </h3>
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {loading ? t('Analisando…') : result ? t('Analisar novamente') : t('Analisar com IA')}
        </button>
      </div>

      {!result && !loading && !error && (
        <p className="mt-2 text-xs text-muted-foreground">
          {t(
            'Compara este chamado com o histórico da Infraspeak e sugere ações com base em casos anteriores semelhantes.',
          )}
        </p>
      )}

      {loading && (
        <p className="mt-3 text-sm text-muted-foreground">
          {t('Buscando casos semelhantes no histórico e gerando a recomendação…')}
        </p>
      )}

      {error && !loading && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-500/30 dark:bg-red-500/10">
          <TriangleAlert size={15} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
          <p className="text-sm text-red-700 dark:text-red-400">{t(error)}</p>
        </div>
      )}

      {result && !loading && (
        <div className="mt-3 space-y-4">
          {result.aiError && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
              <TriangleAlert size={15} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-sm text-amber-800 dark:text-amber-400">
                {t(
                  'A IA está indisponível no momento. Abaixo, apenas o contexto factual encontrado no histórico.',
                )}
              </p>
            </div>
          )}

          {analysis?.insufficientHistory && (
            <div className="flex items-start gap-2 rounded-md border border-border bg-card p-3">
              <Search size={15} className="mt-0.5 shrink-0 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {t(
                    'Não foram encontrados casos anteriores com similaridade suficiente para recomendar uma ação com segurança.',
                  )}
                </p>
                {analysis.investigationPoints.length > 0 && (
                  <>
                    <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('Possíveis pontos de investigação (não comprovados pelo histórico)')}
                    </p>
                    <ul className="mt-1 list-disc space-y-1 pl-4 text-sm text-foreground">
                      {analysis.investigationPoints.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          )}

          {analysis && !analysis.insufficientHistory && (
            <>
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${CONFIDENCE_CLASS[analysis.confidence]}`}
                >
                  {t(CONFIDENCE_LABEL[analysis.confidence])}
                </span>
                {result.context.recurrenceSameEquipment > 0 && (
                  <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-400">
                    {t('Recorrente neste equipamento')} ({result.context.recurrenceSameEquipment})
                  </span>
                )}
              </div>

              {analysis.problem && (
                <Section title={t('Problema identificado')}>
                  <p className="whitespace-pre-wrap">{analysis.problem}</p>
                </Section>
              )}

              <Section title={t('Casos semelhantes encontrados')}>
                <ul className="space-y-1.5">
                  {analysis.similarCases.map((c) => (
                    <li key={c.failureId} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <button
                        type="button"
                        onClick={() => onOpenReference?.(c.failureId)}
                        disabled={!onOpenReference}
                        className="font-mono text-xs font-semibold text-cyan-700 underline-offset-2 hover:underline disabled:no-underline dark:text-cyan-400"
                        title={onOpenReference ? t('Ver detalhes do chamado') : undefined}
                      >
                        #{c.failureId}
                      </button>
                      {!c.resolved && (
                        <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:bg-slate-500/15 dark:text-slate-300">
                          {t('sem resolução registrada')}
                        </span>
                      )}
                      <span className="text-sm text-muted-foreground">{c.relation}</span>
                    </li>
                  ))}
                </ul>
              </Section>

              {analysis.actions.length > 0 && (
                <Section title={t('Ação sugerida')}>
                  <ol className="list-decimal space-y-1 pl-4">
                    {analysis.actions.map((a, i) => (
                      <li key={i}>{a}</li>
                    ))}
                  </ol>
                </Section>
              )}

              {analysis.evidence && (
                <Section title={t('Evidência histórica')}>
                  <p className="whitespace-pre-wrap">{analysis.evidence}</p>
                </Section>
              )}
            </>
          )}

          {result.aiError && result.context.candidates.length > 0 && (
            <Section title={t('Casos semelhantes encontrados (contexto factual)')}>
              <ul className="space-y-1">
                {result.context.candidates.map((c) => (
                  <li key={c.failureId} className="text-sm text-muted-foreground">
                    <button
                      type="button"
                      onClick={() => onOpenReference?.(c.failureId)}
                      disabled={!onOpenReference}
                      className="font-mono text-xs font-semibold text-cyan-700 underline-offset-2 hover:underline disabled:no-underline dark:text-cyan-400"
                    >
                      #{c.failureId}
                    </button>{' '}
                    {c.problemName ?? '—'} · {c.localName ?? '—'}{' '}
                    {c.resolved ? t('(resolvido)') : t('(sem resolução)')}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <p className="text-[11px] text-muted-foreground">
            {t(
              'Sugestão de apoio baseada em {n} chamado(s) indexados do histórico — a decisão e a execução são do operador.',
            ).replace('{n}', String(result.context.indexedTotal))}
          </p>
        </div>
      )}
    </section>
  );
}
