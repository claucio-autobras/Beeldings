"use client";

/**
 * Diagnóstico SNMP guiado para os perfis homologados.
 *
 * Este componente é compartilhado por CFTV (Hikvision) e SCA (Control iD).
 * O diagnóstico técnico continua sendo executado pelo backend, mas a operação
 * vê apenas conexão, perfil, leituras e a ação de ativar/corrigir.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  Activity,
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  CircleX,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import { useT } from "@/lib/i18n";
import type {
  AppliedOidSelection,
  CustomPointSelection,
  DiagMetric,
  MetricConfidence,
  MetricProposal,
  OidProfile,
  SnmpDiagnoseOutcome,
  SnmpDiagnoseProgress,
} from "../services/cftv.service";
import {
  canonicalHealthKey,
  formatHealthValue,
  healthRank,
} from "../utils/snmp-health";

const PROFILE_METRIC_LABELS: Record<string, string> = {
  cpu: "Uso de CPU",
  cpu_usage: "Uso de CPU",
  cpu_temperature: "Temperatura",
  memory: "Memória usada",
  memory_usage: "Memória usada",
  memory_used_percent: "Memória usada",
  memory_total: "Memória total",
  ram_total: "Memória total",
  storage: "Armazenamento usado",
  storage_used_percent: "Armazenamento usado",
  temperature: "Temperatura",
  packet_loss: "Pacotes perdidos",
  ping_loss: "Perda de ping",
  uptime: "Tempo ligado",
};

type MetricState = "working" | "corrected" | "unavailable" | "retry";

interface MetricRow {
  proposal: MetricProposal;
  state: MetricState;
  value: string | null;
  unit: string | null;
  hasReading: boolean;
  selectedOid: string | null;
}

function formatDiagValue(
  metric: string,
  value: number | null | undefined,
  unit?: string | null,
): string | null {
  if (value === null || value === undefined || !Number.isFinite(value))
    return null;
  return formatHealthValue(metric, value, unit);
}

function formatCandidateValue(
  metric: string,
  exampleValue: string | null,
  unit: string | null,
): string | null {
  if (exampleValue === null || exampleValue.trim() === "") return null;
  if (metric === "uptime") return exampleValue;
  const parsed = Number.parseFloat(exampleValue.replace(",", "."));
  if (!Number.isFinite(parsed)) return exampleValue;
  return (
    formatHealthValue(metric, parsed, unit) ??
    (unit ? `${exampleValue} ${unit}` : exampleValue)
  );
}

/**
 * Compatibilidade com respostas de gateways antigos que ainda só retornam
 * `metrics`. Só candidatos que responderam podem virar uma ação operacional.
 */
function deriveProposalsFromLegacy(
  outcome: SnmpDiagnoseOutcome,
): MetricProposal[] {
  return outcome.metrics.map((metric) => {
    const responded = metric.candidates.filter(
      (candidate) => candidate.responded,
    );
    const candidates = responded.map((candidate) => ({
      oid: candidate.oid,
      label:
        PROFILE_METRIC_LABELS[metric.metric] ?? metric.label ?? metric.metric,
      exampleValue:
        candidate.value !== null
          ? (formatDiagValue(
              metric.metric,
              candidate.value *
                (Number.isFinite(candidate.scale) ? candidate.scale : 1),
              candidate.unit,
            ) ?? candidate.raw)
          : candidate.raw,
      unit: candidate.unit || null,
      scale: Number.isFinite(candidate.scale) ? candidate.scale : 1,
      isDefault: candidate.isCurrent || responded[0]?.oid === candidate.oid,
    }));

    if (
      metric.currentOid &&
      metric.currentResponded &&
      !candidates.some((candidate) => candidate.oid === metric.currentOid)
    ) {
      candidates.unshift({
        oid: metric.currentOid,
        label: "Leitura atual",
        exampleValue:
          formatDiagValue(metric.metric, metric.currentValue, null) ??
          metric.currentRaw,
        unit: null,
        scale: 1,
        isDefault: true,
      });
    }

    const defaultCandidate =
      candidates.find((candidate) => candidate.isDefault) ?? candidates[0];
    return {
      metricKey: metric.metric,
      friendlyName:
        PROFILE_METRIC_LABELS[metric.metric] ?? metric.label ?? metric.metric,
      unit: defaultCandidate?.unit ?? null,
      exampleValue: defaultCandidate?.exampleValue ?? null,
      confidence: metric.currentResponded ? "exact" : "inferred",
      candidates,
      selectedOid: defaultCandidate?.oid ?? null,
      activeOid: metric.currentResponded ? metric.currentOid : null,
      suggestedOid: metric.currentResponded
        ? null
        : (defaultCandidate?.oid ?? null),
      state: metric.currentResponded
        ? "active"
        : defaultCandidate
          ? "suggested"
          : "unavailable",
    };
  });
}

function isGuidedMetric(proposal: MetricProposal): boolean {
  return (
    proposal.metricKey === "reachability" ||
    canonicalHealthKey(proposal.metricKey) !== null ||
    healthRank(proposal.metricKey) !== Number.MAX_SAFE_INTEGER
  );
}

function candidateWithReading(proposal: MetricProposal) {
  return proposal.candidates.find(
    (candidate) =>
      candidate.exampleValue !== null && candidate.exampleValue.trim() !== "",
  );
}

/**
 * Normaliza propostas de gateways recentes e legados para o fluxo guiado.
 * Algumas respostas antigas marcam a fonte ativa no candidato (`isActive`) e
 * não nos campos opcionais da proposta; ela continua sendo uma leitura ativa,
 * jamais uma sugestão a publicar novamente.
 */
export function normalizeGuidedProposals(
  source: MetricProposal[],
): MetricProposal[] {
  return source
    .filter(isGuidedMetric)
    .map((proposal) => {
      const validCandidates = proposal.candidates.filter(
        (candidate) =>
          candidate.exampleValue !== null &&
          candidate.exampleValue.trim() !== "",
      );
      const activeOid =
        proposal.activeOid ??
        proposal.candidates.find((candidate) => candidate.isActive)?.oid ??
        null;
      const state =
        proposal.state ??
        (activeOid
          ? "active"
          : proposal.selectedOid
            ? "suggested"
            : "unavailable");
      const suggestedCandidate = proposal.suggestedOid
        ? (validCandidates.find(
            (candidate) => candidate.oid === proposal.suggestedOid,
          ) ?? null)
        : null;

      return {
        ...proposal,
        activeOid,
        state,
        candidates: validCandidates,
        selectedOid:
          // Um binding quebrado só pode ser corrigido pela substituição
          // homologada que respondeu neste diagnóstico. Nunca republicar
          // o OID antigo como uma "correção".
          state === "broken"
            ? (suggestedCandidate?.oid ?? null)
            : proposal.selectedOid &&
                validCandidates.some(
                  (candidate) => candidate.oid === proposal.selectedOid,
                )
              ? proposal.selectedOid
              : suggestedCandidate
                ? suggestedCandidate.oid
                : activeOid &&
                    validCandidates.some(
                      (candidate) => candidate.oid === activeOid,
                    )
                  ? activeOid
                  : (validCandidates[0]?.oid ?? null),
      };
    })
    .sort((a, b) => {
      const aRank =
        a.metricKey === "reachability" ? -1 : healthRank(a.metricKey);
      const bRank =
        b.metricKey === "reachability" ? -1 : healthRank(b.metricKey);
      return aRank - bRank;
    });
}

/** Fontes a publicar: apenas novas leituras ou substituições homologadas. */
export function automaticGuidedSelections(
  proposals: MetricProposal[],
): Record<string, AppliedOidSelection> {
  const selections: Record<string, AppliedOidSelection> = {};
  for (const proposal of proposals) {
    if (
      (proposal.state !== "suggested" && proposal.state !== "broken") ||
      !proposal.selectedOid
    ) {
      continue;
    }
    const candidate = proposal.candidates.find(
      (item) => item.oid === proposal.selectedOid,
    );
    if (!candidate) continue;
    selections[proposal.metricKey] = {
      oid: candidate.oid,
      scale: candidate.scale,
      unit: candidate.unit ?? "",
      seedValue: candidate.seedValue ?? null,
    };
  }
  return selections;
}

function proposalRows(
  proposals: MetricProposal[],
  selections: Record<string, AppliedOidSelection | null | undefined>,
): MetricRow[] {
  return proposals
    .filter(isGuidedMetric)
    .map((proposal) => {
      const selected = selections[proposal.metricKey];
      const selectedOid =
        selected?.oid ?? proposal.selectedOid ?? proposal.activeOid ?? null;
      const candidate =
        proposal.candidates.find((item) => item.oid === selectedOid) ??
        proposal.candidates.find((item) => item.oid === proposal.activeOid) ??
        candidateWithReading(proposal);
      const value = candidate
        ? formatCandidateValue(
            proposal.metricKey,
            candidate.exampleValue,
            candidate.unit,
          )
        : proposal.exampleValue;
      const hasReading = value !== null;
      const broken =
        proposal.state === "broken" ||
        Boolean(proposal.activeOid && !candidateWithReading(proposal));
      const hasCorrection = Boolean(
        proposal.suggestedOid &&
        proposal.candidates.some(
          (item) =>
            item.oid === proposal.suggestedOid && item.exampleValue !== null,
        ),
      );

      let state: MetricState;
      if (proposal.metricKey === "reachability") state = "working";
      else if (broken) state = hasCorrection ? "corrected" : "retry";
      else if (!hasReading || (!proposal.selectedOid && !proposal.activeOid))
        state = "unavailable";
      else if (proposal.state === "suggested") state = "corrected";
      else state = "working";

      return {
        proposal,
        state,
        value,
        unit: candidate?.unit ?? proposal.unit,
        hasReading,
        selectedOid,
      };
    })
    .sort((a, b) => {
      const aRank =
        a.proposal.metricKey === "reachability"
          ? -1
          : healthRank(a.proposal.metricKey);
      const bRank =
        b.proposal.metricKey === "reachability"
          ? -1
          : healthRank(b.proposal.metricKey);
      return aRank - bRank;
    });
}

export interface SnmpDiagnoseDevice {
  id: string;
  name: string;
  ip: string;
  port: number;
  community: string;
  mibLabel?: string | null;
  mibManufacturer?: string | null;
  mibIsOffline?: boolean;
}

interface Props {
  device: SnmpDiagnoseDevice;
  diagnoseFn: (
    deviceId: string,
    diagnoseId: string,
  ) => Promise<SnmpDiagnoseOutcome>;
  getProgressFn: (diagnoseId: string) => Promise<SnmpDiagnoseProgress | null>;
  applyFn: (
    deviceId: string,
    oids: Partial<Record<DiagMetric, AppliedOidSelection>>,
    customPoints?: CustomPointSelection[],
    metricConfidence?: Partial<Record<string, MetricConfidence>>,
    diagnoseId?: string,
  ) => Promise<unknown>;
  /** Mantido no contrato compartilhado; o fluxo guiado não expõe catálogo. */
  getProfilesFn?: () => Promise<OidProfile[]>;
  /** Mantido no contrato compartilhado; leituras individuais não fazem parte do fluxo. */
  testOidFn?: (deviceId: string, oid: string) => Promise<unknown>;
  onClose: () => void;
  onApplied: () => void;
  deviceLabel?: string;
  existingPointOids?: string[];
}

export function SnmpDiagnoseModal({
  device,
  diagnoseFn,
  getProgressFn,
  applyFn,
  onClose,
  onApplied,
  deviceLabel = "dispositivo",
}: Props) {
  const t = useT();
  const [result, setResult] = useState<SnmpDiagnoseOutcome | null>(null);
  const [progress, setProgress] = useState<SnmpDiagnoseProgress | null>(null);
  const [proposals, setProposals] = useState<MetricProposal[]>([]);
  const [proposalSelections, setProposalSelections] = useState<
    Record<string, AppliedOidSelection | null | undefined>
  >({});
  const [applied, setApplied] = useState(false);
  const [diagnosedAt, setDiagnosedAt] = useState<Date | null>(null);
  const [diagnoseId, setDiagnoseId] = useState<string | null>(null);
  const diagnoseIdRef = useRef<string | null>(null);

  const diagnose = useMutation({
    mutationFn: () => {
      const diagnoseId = crypto.randomUUID();
      diagnoseIdRef.current = diagnoseId;
      setDiagnoseId(diagnoseId);
      setResult(null);
      setProgress(null);
      setProposals([]);
      setProposalSelections({});
      setApplied(false);
      return diagnoseFn(device.id, diagnoseId);
    },
    onSuccess: (outcome) => {
      setResult(outcome);
      setDiagnosedAt(new Date());
      const source =
        outcome.proposals && outcome.proposals.length > 0
          ? outcome.proposals
          : outcome.metricProposals && outcome.metricProposals.length > 0
            ? outcome.metricProposals
            : deriveProposalsFromLegacy(outcome);
      const guided = normalizeGuidedProposals(source);
      setProposals(guided);

      // Só entram na ação as fontes novas ou as correções de bindings quebrados.
      // Leituras que já estão funcionando permanecem visíveis, mas não são
      // republicadas sem necessidade.
      setProposalSelections(automaticGuidedSelections(guided));
    },
    onSettled: () => {
      diagnoseIdRef.current = null;
      setProgress(null);
    },
  });

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    diagnose.mutate();
    // O diagnóstico deve começar uma única vez ao abrir o modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!diagnose.isPending) return;
    const interval = setInterval(async () => {
      const diagnoseId = diagnoseIdRef.current;
      if (!diagnoseId) return;
      try {
        const next = await getProgressFn(diagnoseId);
        if (next && diagnoseIdRef.current === diagnoseId) setProgress(next);
      } catch {
        // A busca principal continua sendo a fonte de verdade.
      }
    }, 1500);
    return () => clearInterval(interval);
  }, [diagnose.isPending, getProgressFn]);

  const rows = useMemo(
    () => proposalRows(proposals, proposalSelections),
    [proposals, proposalSelections],
  );

  const selectedOids = useMemo(() => {
    const oids: Partial<Record<DiagMetric, AppliedOidSelection>> = {};
    for (const [metric, selection] of Object.entries(proposalSelections)) {
      if (selection) oids[metric as DiagMetric] = selection;
    }
    return oids;
  }, [proposalSelections]);

  const selectedCount = Object.keys(selectedOids).length;
  const apply = useMutation({
    mutationFn: () =>
      applyFn(
        device.id,
        selectedOids,
        undefined,
        undefined,
        diagnoseId ?? undefined,
      ),
    onSuccess: () => {
      setApplied(true);
      onApplied();
    },
  });

  const errorMessage =
    diagnose.error instanceof Error ? diagnose.error.message : "";
  const gatewayFailure = /gateway|ocupado|conexão|conectar|offline/i.test(
    errorMessage,
  );
  const profileFound = rows.some(
    (row) =>
      row.proposal.metricKey !== "reachability" &&
      row.proposal.candidates.length > 0,
  );
  const readingTime = diagnosedAt
    ? diagnosedAt.toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  const statusCopy: Record<
    MetricState,
    { label: string; description: string }
  > = {
    working: {
      label: "Funcionando",
      description: "Leitura confirmada e já pronta para o monitoramento.",
    },
    corrected: {
      label: "Corrigida",
      description:
        "Uma fonte homologada respondeu e está pronta para ser ativada.",
    },
    unavailable: {
      label: "Não disponível",
      description:
        "Esta informação não existe ou não foi encontrada neste equipamento.",
    },
    retry: {
      label: "Precisa de nova tentativa",
      description:
        "O equipamento respondeu, mas esta leitura não respondeu agora.",
    },
  };

  function MetricRow({ row }: { row: MetricRow }) {
    const copy = statusCopy[row.state];
    const Icon =
      row.state === "working"
        ? CheckCircle2
        : row.state === "corrected"
          ? RefreshCw
          : row.state === "retry"
            ? CircleAlert
            : CircleX;
    const color =
      row.state === "working"
        ? "text-emerald-600 dark:text-emerald-400"
        : row.state === "corrected"
          ? "text-sky-600 dark:text-sky-400"
          : row.state === "retry"
            ? "text-amber-600 dark:text-amber-400"
            : "text-muted-foreground";

    return (
      <li className="rounded-xl border border-border bg-card px-3 py-3 sm:px-4">
        <div className="flex items-start gap-3">
          <Icon
            className={`mt-0.5 h-5 w-5 shrink-0 ${color}`}
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="font-medium text-foreground">
                {t(row.proposal.friendlyName)}
              </p>
              <span className={`text-xs font-semibold ${color}`}>
                {t(copy.label)}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="text-lg font-semibold tracking-tight text-foreground">
                {row.value ?? "—"}
              </span>
              {row.unit && row.value && !row.value.includes(row.unit) && (
                <span className="text-xs text-muted-foreground">
                  {row.unit}
                </span>
              )}
              {readingTime && (
                <span className="text-xs text-muted-foreground">
                  {t("lida às")} {readingTime}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {t(copy.description)}
            </p>
          </div>
        </div>
      </li>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-0 sm:items-center sm:p-4"
      role="presentation"
    >
      <div
        className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-border bg-background shadow-2xl sm:max-h-[90vh] sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="snmp-diagnose-title"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-6">
          <div className="min-w-0">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[0.12em] text-primary">
              {t("Diagnóstico guiado")}
            </p>
            <h3
              id="snmp-diagnose-title"
              className="text-lg font-semibold text-foreground"
            >
              {t("Verificar monitoramento")} · {device.name}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("Buscando as leituras homologadas para esta")} {deviceLabel}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Fechar")}
            className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <main className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          {diagnose.isPending && !result && (
            <section className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-5">
              <div className="flex items-start gap-3">
                <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">
                    {progress?.phase === "walk"
                      ? t("Encontrando as fontes homologadas…")
                      : t("Testando a comunicação…")}
                  </p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {progress && progress.total > 0
                      ? `${progress.tested} de ${progress.total} ${t("leituras verificadas")}`
                      : t(
                          "O gateway está verificando o equipamento. Isso pode levar até cerca de 2 minutos.",
                        )}
                  </p>
                  {progress && progress.total > 0 && (
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-primary/15">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{
                          width: `${Math.min(100, Math.round((progress.tested / progress.total) * 100))}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            </section>
          )}

          {diagnose.error && (
            <section className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-500/30 dark:bg-red-500/10">
              <div className="flex items-start gap-3">
                <CircleX className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-red-700 dark:text-red-300">
                    {gatewayFailure
                      ? t("Gateway não respondeu")
                      : t("Não foi possível concluir a busca")}
                  </p>
                  <p className="mt-1 text-sm leading-5 text-red-700/90 dark:text-red-300/90">
                    {gatewayFailure
                      ? t(
                          "O gateway não respondeu ao diagnóstico. Verifique se ele está online e tente novamente.",
                        )
                      : t("A busca falhou antes de confirmar as leituras.")}
                  </p>
                  <button
                    type="button"
                    onClick={() => diagnose.mutate()}
                    className="mt-3 inline-flex items-center gap-2 rounded-lg border border-red-300 bg-background px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 dark:border-red-500/40 dark:text-red-300 dark:hover:bg-red-500/20"
                  >
                    <RefreshCw className="h-4 w-4" />
                    {t("Tentar novamente")}
                  </button>
                </div>
              </div>
            </section>
          )}

          {result && (
            <>
              <section
                className="grid gap-2 sm:grid-cols-3"
                aria-label={t("Resumo da conexão")}
              >
                <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/30 px-3 py-3">
                  <Activity className="mt-0.5 h-4 w-4 text-emerald-600" />
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {t("Gateway")}
                    </p>
                    <p className="text-sm font-semibold text-foreground">
                      {t("Respondeu ao diagnóstico")}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/30 px-3 py-3">
                  {result.reachable ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                  ) : (
                    <CircleDashed className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {t("Equipamento")}
                    </p>
                    <p className="text-sm font-semibold text-foreground">
                      {result.reachable
                        ? t("Respondeu ao SNMP")
                        : t("Não respondeu")}
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-2.5 rounded-xl border border-border bg-muted/30 px-3 py-3">
                  {profileFound ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                  ) : (
                    <CircleAlert className="mt-0.5 h-4 w-4 text-amber-600" />
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground">
                      {t("Perfil homologado")}
                    </p>
                    <p className="text-sm font-semibold text-foreground">
                      {profileFound ? t("Encontrado") : t("Não identificado")}
                    </p>
                  </div>
                </div>
              </section>

              {!result.reachable && (
                <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-500/30 dark:bg-amber-500/10">
                  <p className="font-semibold text-amber-800 dark:text-amber-300">
                    {result.cause === "community"
                      ? t(
                          "O equipamento respondeu, mas a credencial SNMP não confere",
                        )
                      : t("O equipamento não respondeu ao SNMP")}
                  </p>
                  <p className="mt-1 text-sm leading-5 text-amber-800/90 dark:text-amber-200/90">
                    {result.cause === "community"
                      ? t(
                          "Confira a community cadastrada e faça uma nova tentativa.",
                        )
                      : t(
                          "Isso não significa valor zero ou falta de uma métrica. Verifique se o SNMP está habilitado e tente novamente.",
                        )}
                  </p>
                </section>
              )}

              {result.reachable && (
                <section className="space-y-3">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <h4 className="text-base font-semibold text-foreground">
                        {t("Leituras encontradas")}
                      </h4>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {t(
                          "Estas são as informações que serão monitoradas no equipamento.",
                        )}
                      </p>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {rows.filter((row) => row.hasReading).length}{" "}
                      {t("com leitura")}
                    </span>
                  </div>

                  {rows.length > 0 ? (
                    <ul className="space-y-2">
                      {rows.map((row) => (
                        <MetricRow key={row.proposal.metricKey} row={row} />
                      ))}
                    </ul>
                  ) : (
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                      {t(
                        "Nenhuma leitura homologada foi encontrada neste equipamento.",
                      )}
                    </div>
                  )}
                </section>
              )}

              {result.reachable && selectedCount > 0 && !applied && (
                <section className="rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 dark:border-sky-500/30 dark:bg-sky-500/10">
                  <p className="font-medium text-sky-900 dark:text-sky-200">
                    {selectedCount}{" "}
                    {selectedCount === 1
                      ? t("leitura pronta para ativar")
                      : t("leituras prontas para ativar ou corrigir")}
                  </p>
                  <p className="mt-1 text-sm text-sky-800/85 dark:text-sky-200/85">
                    {t(
                      "A ação abaixo usa somente fontes homologadas que responderam agora.",
                    )}
                  </p>
                </section>
              )}

              {result.reachable &&
                selectedCount === 0 &&
                rows.length > 0 &&
                !applied && (
                  <p className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
                    {t(
                      "As leituras que já funcionam continuam ativas. Não há nenhuma correção nova para aplicar.",
                    )}
                  </p>
                )}
            </>
          )}

          {apply.error && (
            <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              {t("Não foi possível aplicar as leituras.")}
            </p>
          )}
          {applied && (
            <section className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <div>
                  <p className="font-semibold text-emerald-800 dark:text-emerald-300">
                    {t("Monitoramento concluído")}
                  </p>
                  <p className="mt-1 text-sm text-emerald-800/85 dark:text-emerald-200/85">
                    {t(
                      "As leituras homologadas foram enviadas ao gateway e já podem ser acompanhadas.",
                    )}
                  </p>
                </div>
              </div>
            </section>
          )}
        </main>

        <footer className="flex shrink-0 flex-col-reverse gap-2 border-t border-border bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted"
          >
            {t("Fechar")}
          </button>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            {result && (
              <button
                type="button"
                onClick={() => diagnose.mutate()}
                disabled={diagnose.isPending}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
              >
                {diagnose.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                {t("Nova tentativa")}
              </button>
            )}
            {result?.reachable && selectedCount > 0 && !applied && (
              <button
                type="button"
                disabled={apply.isPending}
                onClick={() => apply.mutate()}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm hover:bg-primary/90 disabled:opacity-50"
              >
                {apply.isPending && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                {t("Ativar e corrigir leituras")}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}
