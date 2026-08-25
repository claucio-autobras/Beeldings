'use client';

/**
 * SnmpDiagnoseModal — componente compartilhado entre CFTV e SCA.
 *
 * Visão principal: lista de 8-12 métricas canônicas com nome amigável, valor
 * de exemplo, unidade e nível de confiança (exact | inferred | manual). O
 * operador escolhe um candidato de OID por métrica; a escolha manual muda a
 * confiança para 'manual' e é enviada ao backend.
 *
 * OIDs brutos do walk ficam num bloco "Avançado" recolhido. Entradas sem nome
 * conhecido são rotuladas "OID desconhecido" em vez de expor o OID cru fora
 * do modo avançado. Mantém compatibilidade total com payloads sem `proposals`.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import { useMutation } from '@tanstack/react-query';
import {
  AppWindow,
  ChevronDown,
  ChevronRight,
  Cpu,
  Gauge,
  HardDrive,
  HelpCircle,
  IdCard,
  Loader2,
  Network,
  Settings2,
  Shield,
  X,
  Zap,
} from 'lucide-react';
import type {
  AppliedOidSelection,
  CustomPointSelection,
  DiagMetric,
  DiscoveredSnmpObject,
  LiveOidTestOutcome,
  MetricConfidence,
  MetricProposal,
  OidProfile,
  SnmpDiagnoseOutcome,
  SnmpDiagnoseProgress,
} from '../services/cftv.service';
import { safeSnmpCandidateLabel } from '../utils/snmp-metric-display';
import {
  formatHealthValue,
  healthRank,
  normalizeHealthReading,
} from '../utils/snmp-health';

// ─── Etiquetas de confiança ───────────────────────────────────────────────────

/** Rótulos pt-BR das categorias de classificação da descoberta. */
const DISCOVERY_CATEGORY_LABELS: Record<string, string> = {
  identification: 'Identificação',
  performance: 'Desempenho',
  hardware: 'Hardware',
  system: 'Sistema',
  network: 'Rede',
  storage: 'Armazenamento',
  security: 'Segurança',
  application: 'Aplicação',
  other: 'Outras',
};

/** Ícone por categoria (linguagem visual p/ leigos). */
const CATEGORY_ICONS: Record<string, typeof Cpu> = {
  identification: IdCard,
  performance: Gauge,
  hardware: Cpu,
  system: Settings2,
  network: Network,
  storage: HardDrive,
  security: Shield,
  application: AppWindow,
  other: HelpCircle,
};

/** Rótulos pt-BR das métricas canônicas dos perfis de fabricante (task 968). */
const PROFILE_METRIC_LABELS: Record<string, string> = {
  // legacy / aliases
  cpu: 'Uso de CPU',
  memory: 'Memória',
  memory_usage: 'Memória usada',
  ram_total: 'Memória RAM total',
  storage: 'Armazenamento',
  temperature: 'Temperatura',
  packet_loss: 'Pacotes perdidos',
  ping_loss: 'Perda de ping',
  status: 'Status do dispositivo',
  // canonical keys (task 968)
  reachability: 'Alcançabilidade',
  uptime: 'Tempo ligado',
  cpu_usage: 'Uso de CPU',
  cpu_temperature: 'Temperatura de CPU',
  memory_used_percent: 'Memória usada (%)',
  memory_total: 'Memória total',
  storage_used_percent: 'Armazenamento usado (%)',
  net_in_rate: 'Taxa de entrada de rede',
  net_out_rate: 'Taxa de saída de rede',
  net_error_rate: 'Taxa de erros de rede',
  net_discard_rate: 'Taxa de descartes de rede',
  interface_status: 'Status da interface',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Formata o valor cru de uma métrica de diagnóstico para exibição. */
function formatDiagValue(
  metric: DiagMetric,
  value: number | null | undefined,
  unit?: string,
): string | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  return formatHealthValue(metric, value, unit);
}

/** Formata um número com escala aplicada, sem ruído de casas decimais. */
function formatScaled(value: number, scale: number, unit?: string | null): string {
  const v = value * (scale || 1);
  const u = (unit ?? '').trim();
  return formatHealthValue('', v, u) ?? (u ? `${v} ${u}` : String(v));
}

/**
 * Deriva propostas de métricas a partir da resposta legada (sem `proposals`).
 * Garante compatibilidade com gateways antigos.
 */
function deriveProposalsFromLegacy(outcome: SnmpDiagnoseOutcome): MetricProposal[] {
  const proposals: MetricProposal[] = [];

  for (const m of outcome.metrics) {
    const respondedCandidates = m.candidates.filter((c) => c.responded);
    const currentWorks = m.currentResponded && m.currentOid;
    const label =
      PROFILE_METRIC_LABELS[m.metric] ?? m.label ?? m.metric;

    const candidates = m.candidates
      .filter((c) => c.responded)
      .map((c) => ({
        oid: c.oid,
        label: c.profileLabel || c.oid,
        exampleValue:
          c.value !== null
            ? formatDiagValue(m.metric as DiagMetric, c.value * c.scale, c.unit) ?? c.raw
            : c.raw,
        unit: c.unit || null,
          scale: Number.isFinite(c.scale) ? c.scale : 1,
        isDefault: c.isCurrent
          ? true
          : respondedCandidates[0]?.oid === c.oid && !currentWorks,
      }));

    // Include current OID even if no responded candidates exist
    if (m.currentOid && !candidates.find((c) => c.oid === m.currentOid)) {
      candidates.unshift({
        oid: m.currentOid,
        label: 'OID atual',
        exampleValue:
          m.currentValue !== null
            ? formatDiagValue(m.metric as DiagMetric, m.currentValue) ?? m.currentRaw
            : m.currentRaw,
        unit: null,
        scale: 1,
        isDefault: true,
      });
    }

    const defaultCandidate = candidates.find((c) => c.isDefault) ?? candidates[0] ?? null;

    // Unsupported = no responded candidates and no current working OID.
    // These must stay visible in the list but must NOT be selected (selectedOid = null)
    // and confidence must be 'inferred' (never 'exact' for unsupported metrics).
    const isUnsupported = respondedCandidates.length === 0 && !currentWorks;

    proposals.push({
      metricKey: m.metric,
      friendlyName: label,
      unit: defaultCandidate?.unit ?? null,
      exampleValue: defaultCandidate?.exampleValue ?? null,
      confidence:
        m.currentResponded && m.currentOid
          ? 'exact'
          : isUnsupported
            ? 'inferred'
            : 'inferred',
      candidates,
      // Unsupported metrics get selectedOid=null so they are excluded from apply count
      selectedOid: isUnsupported ? null : (defaultCandidate?.oid ?? m.currentOid),
    });
  }

  return proposals;
}

// ─── Props ───────────────────────────────────────────────────────────────────

export interface SnmpDiagnoseDevice {
  id: string;
  name: string;
  ip: string;
  port: number;
  community: string;
  /** MIB legada escolhida explicitamente, quando houver. */
  mibLabel?: string | null;
  mibManufacturer?: string | null;
  mibIsOffline?: boolean;
}

interface Props {
  device: SnmpDiagnoseDevice;
  /** Função que dispara o diagnóstico (ex.: diagnoseCameraSnmp ou diagnoseControllerSnmp). */
  diagnoseFn: (deviceId: string, diagnoseId: string) => Promise<SnmpDiagnoseOutcome>;
  /** Polling de progresso (ex.: getDiagnoseProgress da cftv ou sca service). */
  getProgressFn: (diagnoseId: string) => Promise<SnmpDiagnoseProgress | null>;
  /** Aplica os OIDs selecionados ao dispositivo (+ OIDs livres da descoberta). */
  applyFn: (
    deviceId: string,
    oids: Partial<Record<DiagMetric, AppliedOidSelection>>,
    customPoints?: CustomPointSelection[],
    metricConfidence?: Partial<Record<string, MetricConfidence>>,
  ) => Promise<unknown>;
  /** Catálogo de perfis de fabricante (seletor de fabricante na descoberta). */
  getProfilesFn?: () => Promise<OidProfile[]>;
  /** Teste ao vivo de um OID (leitura atual via gateway) antes de aplicar. */
  testOidFn?: (deviceId: string, oid: string) => Promise<LiveOidTestOutcome>;
  onClose: () => void;
  onApplied: () => void;
  /** Rótulo do tipo de dispositivo exibido nos textos ("câmera" | "controladora"). */
  deviceLabel?: string;
  /**
   * OIDs que já são pontos monitorados no equipamento. Marcados com badge
   * "já monitorado" na lista de descoberta — desmarcar não remove, é preciso
   * usar o botão de remoção no card.
   */
  existingPointOids?: string[];
}

// ─── Componente ──────────────────────────────────────────────────────────────

export function SnmpDiagnoseModal({
  device,
  diagnoseFn,
  getProgressFn,
  applyFn,
  getProfilesFn,
  testOidFn,
  onClose,
  onApplied,
  deviceLabel = 'dispositivo',
  existingPointOids,
}: Props) {
  const t = useT();
  const [result, setResult] = useState<SnmpDiagnoseOutcome | null>(null);
  const [progress, setProgress] = useState<SnmpDiagnoseProgress | null>(null);

  /**
   * Propostas de métricas canônicas — vem do backend (result.proposals) ou
   * derivado do payload legado (result.metrics).
   */
  const [proposals, setProposals] = useState<MetricProposal[]>([]);

  /**
   * Seleção do operador por metricKey: OID escolhido.
   * undefined = usa o selectedOid da proposta (default).
   * null = explicitamente desmarcado.
   */
  const [proposalSelections, setProposalSelections] = useState<
    Record<string, AppliedOidSelection | null | undefined>
  >({});

  /**
   * Confiança por metricKey: 'manual' quando o operador divergiu do default.
   */
  const [manualConfidence, setManualConfidence] = useState<
    Record<string, MetricConfidence>
  >({});

  const [walkOpen, setWalkOpen] = useState(false);
  const [walkFilter, setWalkFilter] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [unnamedOpen, setUnnamedOpen] = useState(false);
  const [discoveredFilter, setDiscoveredFilter] = useState('');
  /** Modo avançado global: OID numérico, tipo ASN.1 e valor bruto visíveis. */
  const [advanced, setAdvanced] = useState(false);
  /** Expansão persistente por métrica; não fica dentro de uma função de render. */
  const [openSources, setOpenSources] = useState<Record<string, boolean>>({});
  /**
   * Overrides explícitos do operador nos OIDs livres da descoberta.
   * Ausente = não marcado.
   */
  const [customOverrides, setCustomOverrides] = useState<Record<string, boolean>>({});
  const [copiedOid, setCopiedOid] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const diagnoseIdRef = useRef<string | null>(null);

  // Perfis de fabricante (seletor). '' = classificação automática.
  const [profiles, setProfiles] = useState<OidProfile[]>([]);
  const [profileId, setProfileId] = useState('');
  useEffect(() => {
    if (!getProfilesFn) return;
    let alive = true;
    getProfilesFn()
      .then((p) => {
        if (alive) setProfiles(p);
      })
      .catch(() => {
        // best-effort: sem catálogo o seletor simplesmente não aparece
      });
    return () => {
      alive = false;
    };
  }, [getProfilesFn]);

  // Teste ao vivo por OID.
  const [oidTests, setOidTests] = useState<
    Record<string, { loading: boolean; result?: LiveOidTestOutcome; error?: string }>
  >({});
  async function runOidTest(oid: string) {
    if (!testOidFn) return;
    setOidTests((prev) => ({ ...prev, [oid]: { loading: true } }));
    try {
      const r = await testOidFn(device.id, oid);
      setOidTests((prev) => ({ ...prev, [oid]: { loading: false, result: r } }));
    } catch (e) {
      setOidTests((prev) => ({
        ...prev,
        [oid]: { loading: false, error: (e as Error).message },
      }));
    }
  }

  const diagnose = useMutation({
    mutationFn: () => {
      const diagnoseId = crypto.randomUUID();
      diagnoseIdRef.current = diagnoseId;
      setResult(null);
      setProgress(null);
      setProposals([]);
      setProposalSelections({});
      setManualConfidence({});
      return diagnoseFn(device.id, diagnoseId);
    },
    onSuccess: (outcome) => {
      setResult(outcome);
      const derived =
        outcome.proposals && outcome.proposals.length > 0
          ? outcome.proposals
          : deriveProposalsFromLegacy(outcome);
      // A visão principal é operacional e fixa; o walk completo continua
      // disponível abaixo em Avançado. Aliases legados são ordenados pelo
      // mesmo rank e a primeira fonte respondente permanece o default.
      const healthProposals = derived
        .filter((p) => healthRank(p.metricKey) !== Number.MAX_SAFE_INTEGER)
        .map((p) => ({
          ...p,
          // Candidatos sem amostra continuam úteis para o modo avançado, mas
          // não podem ser escolhidos como fonte operacional sem validação.
          candidates: p.candidates.filter((c) => {
            // A source without a current sample is not a healthy mapping.
            // Keep the advanced walk available, but do not offer it here.
            if (c.exampleValue === null) return false;
            const numeric = Number.parseFloat(c.exampleValue.replace(',', '.'));
            // Uptime examples are already humanized (e.g. "2h 4m"); the
            // backend has already validated their source, so keep those.
            if (p.metricKey === 'uptime') return true;
            return Number.isFinite(numeric) &&
              normalizeHealthReading(p.metricKey, numeric, c.unit) !== null;
          }),
        }))
        .map((p) => ({
          ...p,
          selectedOid:
            p.selectedOid && p.candidates.some((c) => c.oid === p.selectedOid)
              ? p.selectedOid
              : null,
        }))
        .sort((a, b) => healthRank(a.metricKey) - healthRank(b.metricKey));
      setProposals(healthProposals);
      setProposalSelections({});
      setManualConfidence({});
      setCustomOverrides({});
    },
    onSettled: () => {
      diagnoseIdRef.current = null;
      setProgress(null);
    },
  });

  // Dispara automaticamente ao abrir.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    diagnose.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Aviso de espera longa quando não há progresso após 6s.
  const [waitingLong, setWaitingLong] = useState(false);
  useEffect(() => {
    if (!diagnose.isPending || progress) {
      setWaitingLong(false);
      return;
    }
    const handle = setTimeout(() => setWaitingLong(true), 6000);
    return () => clearTimeout(handle);
  }, [diagnose.isPending, progress]);

  // Polling do progresso enquanto o diagnóstico roda.
  useEffect(() => {
    if (!diagnose.isPending) return;
    const interval = setInterval(async () => {
      const id = diagnoseIdRef.current;
      if (!id) return;
      try {
        const p = await getProgressFn(id);
        if (p && diagnoseIdRef.current === id) setProgress(p);
      } catch {
        // best-effort
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [diagnose.isPending, getProgressFn]);

  const discovered = useMemo(() => result?.discovered ?? [], [result]);

  // OIDs já monitorados no equipamento (para badge "já monitorado").
  const existingOidSet = useMemo(
    () => new Set(existingPointOids ?? []),
    [existingPointOids],
  );

  // ── Classificação por perfil selecionado (client-side, sem novo walk) ──────
  const activeProfile = profiles.find((p) => p.id === profileId) ?? null;
  const profileByOid = useMemo(() => {
    const map = new Map<string, { metric: string; unit: string; scale: number }>();
    if (activeProfile) {
      for (const [metric, def] of Object.entries(activeProfile.oids)) {
        if (def?.oid) map.set(def.oid, { metric, unit: def.unit, scale: def.scale });
      }
    }
    return map;
  }, [activeProfile]);

  interface Classified {
    d: DiscoveredSnmpObject;
    /** Nome legível apresentado ao operador. */
    label: string;
    category: string;
    unit: string | null;
    scale: number;
    /** Recomendada = destacada e pré-selecionada. */
    recommended: boolean;
    /** Rótulo com plausibilidade reprovada — nunca pré-selecionar. */
    unconfirmed: boolean;
    /** Numérica e com valor → pode virar ponto de monitoramento. */
    monitorable: boolean;
    /** Métrica canônica (perfil ou semântica) — 'uptime' formata como duração. */
    metricKey: string | null;
    /** true = sem nome conhecido nem MIB — exibir como "OID desconhecido". */
    isUnknown: boolean;
  }

  const classified: Classified[] = useMemo(() => {
    return discovered.map((d) => {
      const hit = profileByOid.get(d.oid);
      const known = d.known;
      const unconfirmed = known?.confirmed === false;
      const isTimeTicks = d.type === 'TimeTicks';
      if (hit) {
        return {
          d,
          label: PROFILE_METRIC_LABELS[hit.metric] ?? hit.metric,
          category: known?.category ?? 'performance',
          unit: hit.unit || known?.unit || null,
          scale: isTimeTicks ? 1 : hit.scale || known?.scale || 1,
          metricKey: hit.metric,
          recommended: !unconfirmed && d.value !== null && !existingOidSet.has(d.oid),
          unconfirmed,
          monitorable: d.value !== null,
          isUnknown: false,
        };
      }
      const isUnknown = !known && !d.mibName;
      const recommended =
        !activeProfile &&
        !!known &&
        !unconfirmed &&
        !existingOidSet.has(d.oid) &&
        (known.metricKey !== null || known.importance === 'primary') &&
        d.value !== null;
      return {
        d,
        label: known?.name ?? d.mibName ?? 'OID desconhecido',
        category: known?.category ?? 'other',
        unit: known?.unit ?? null,
        scale: isTimeTicks ? 1 : (known?.scale ?? 1),
        metricKey: known?.metricKey ?? null,
        recommended,
        unconfirmed,
        monitorable: d.value !== null,
        isUnknown,
      };
    });
  }, [discovered, profileByOid, activeProfile, existingOidSet]);

  /**
   * Marcada = override explícito do operador.
   */
  const isChecked = (c: Classified) =>
    existingOidSet.has(c.d.oid) || (customOverrides[c.d.oid] ?? false);

  // OIDs já aplicados via proposals não podem repetir em customSelections.
  const selectedProposalOids = useMemo(() => {
    const s = new Set<string>();
    for (const p of proposals) {
      const selected = proposalSelections[p.metricKey];
      if (selected) s.add(selected.oid);
    }
    return s;
  }, [proposals, proposalSelections]);

  const customSelections: CustomPointSelection[] = classified
    .filter(
      (c) =>
        c.monitorable &&
        isChecked(c) &&
        !existingOidSet.has(c.d.oid) &&
        !selectedProposalOids.has(c.d.oid),
    )
    .map((c) => ({
      oid: c.d.oid,
      name: c.unconfirmed || c.isUnknown ? (c.d.mibName ?? `OID ${c.d.oid}`) : c.label,
      ...(c.unit && !c.unconfirmed ? { unit: c.unit } : {}),
    }));

  // Build the oids map from proposals
  const selectedOidsFromProposals = useMemo(() => {
    const oids: Partial<Record<DiagMetric, AppliedOidSelection>> = {};
    for (const p of proposals) {
      // A proposta ativa/inferida é apenas informação. Só uma ação explícita
      // do operador pode adicionar ou reativar um ponto.
      const selected = proposalSelections[p.metricKey];
      if (selected) {
        const candidate = p.candidates.find((c) => c.oid === selected.oid);
        const seedValue =
          candidate?.seedValue !== undefined
            ? candidate.seedValue
            : candidate?.exampleValue
              ? normalizeHealthReading(
                  p.metricKey,
                  Number.parseFloat(candidate.exampleValue.replace(',', '.')),
                  candidate.unit,
                  1,
                )
              : null;
        oids[p.metricKey as DiagMetric] = {
          oid: selected.oid,
          scale: selected.scale,
          unit: selected.unit ?? '',
          seedValue,
        };
      }
    }
    return oids;
  }, [proposals, proposalSelections]);

  // Build metric confidence map — only include manual overrides
  const metricConfidenceMap = useMemo(() => {
    const map: Partial<Record<string, MetricConfidence>> = {};
    for (const [k, v] of Object.entries(manualConfidence)) {
      map[k] = v;
    }
    return map;
  }, [manualConfidence]);

  const apply = useMutation({
    mutationFn: () =>
      applyFn(
        device.id,
        selectedOidsFromProposals,
        customSelections,
        Object.keys(metricConfidenceMap).length > 0 ? metricConfidenceMap : undefined,
      ),
    onSuccess: () => {
      setApplied(true);
      onApplied();
    },
  });

  // Only count proposals that have a resolved OID (unsupported ones have selectedOid=null
  // and are excluded from application).
  const proposalCount = proposals.filter((p) => {
    const selected = proposalSelections[p.metricKey];
    return selected !== null && selected !== undefined;
  }).length;
  const selectedCount = proposalCount + customSelections.length;

  const filterFn = (c: Classified) => {
    const q = discoveredFilter.trim().toLowerCase();
    if (!q) return true;
    return (
      c.d.oid.toLowerCase().includes(q) ||
      c.d.raw.toLowerCase().includes(q) ||
      c.label.toLowerCase().includes(q)
    );
  };

  // ── Discovered OIDs split: named (known/MIB) vs unnamed (unknown OID) ──────
  const namedDiscovered = classified.filter(
    (c) => !c.isUnknown && filterFn(c),
  );
  const unknownDiscovered = classified.filter(
    (c) => c.isUnknown && filterFn(c),
  );

  // ── Linha de um OID descoberto (seção avançada) ───────────────────────────
  function DiscoveredRow({ c }: { c: Classified }) {
    const Icon = CATEGORY_ICONS[c.category] ?? HelpCircle;
    const test = oidTests[c.d.oid];
    const friendly =
      c.d.value !== null
        ? c.metricKey === 'uptime'
          ? formatDiagValue('uptime', c.d.value * (c.scale || 1))
          : formatScaled(c.d.value, c.scale, c.unit)
        : null;
    return (
      <li
        className={[
          'rounded-md border px-2.5 py-1.5 text-[11px]',
          c.recommended
            ? 'border-primary/40 bg-primary/5'
            : 'border-border',
        ].join(' ')}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <p className="flex flex-wrap items-center gap-1.5">
              <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="font-medium text-foreground">
                {c.isUnknown ? t('OID desconhecido') : t(c.label)}
              </span>
              <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                {t(DISCOVERY_CATEGORY_LABELS[c.category] ?? c.category)}
              </span>
              {c.recommended && (
                <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  {t('Recomendada')}
                </span>
              )}
              {c.unconfirmed && (
                <span
                  className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
                  title={t(
                    'O valor lido não bate com o esperado para este nome — pode ser outra informação neste equipamento/firmware.',
                  )}
                >
                  {t('não confirmada')}
                </span>
              )}
              {existingOidSet.has(c.d.oid) && (
                <span
                  className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400"
                  title={t(
                    'Este OID já é um ponto monitorado neste equipamento. Desmarcar aqui não o remove — use o botão de remoção no card do equipamento.',
                  )}
                >
                  {t('já monitorado')}
                </span>
              )}
              {!c.d.known && c.d.mibName && (
                <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-400">
                  {c.d.mibSource ? `${t('MIB importada')} · ${c.d.mibSource}` : t('MIB padrão/offline')}
                </span>
              )}
            </p>
            <p className="text-muted-foreground">
              {friendly !== null ? (
                <>
                  {t('Valor atual:')}{' '}
                  <span className="font-medium text-foreground">{friendly}</span>
                </>
              ) : c.d.raw !== '' ? (
                <>
                  {t('Informação:')}{' '}
                  <span className="font-medium text-foreground break-all">
                    {c.d.raw}
                  </span>
                </>
              ) : (
                t('sem leitura no momento')
              )}
            </p>
            {/* OID só aparece aqui dentro do Advanced */}
            <p className="break-all font-mono text-[10px] text-muted-foreground">
              {c.d.oid} · {c.d.type}
              {c.d.index !== null && ` · ${t('índice')} ${c.d.index}`}
            </p>
            {test && (
              <p className="text-[10px]">
                {test.loading ? (
                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> {t('lendo agora…')}
                  </span>
                ) : test.error ? (
                  <span className="text-red-600 dark:text-red-400">{test.error}</span>
                ) : test.result && test.result.responded ? (
                  <span className="text-emerald-700 dark:text-emerald-400">
                    {t('Leu agora:')}{' '}
                    <span className="font-medium">
                      {test.result.normalized !== null
                        ? formatScaled(test.result.normalized, 1, c.unit)
                        : test.result.raw}
                    </span>
                  </span>
                ) : (
                  <span className="text-amber-600 dark:text-amber-400">
                    {test.result?.reachable
                      ? t('O equipamento respondeu, mas este OID não retornou valor.')
                      : t('O equipamento não respondeu agora.')}
                  </span>
                )}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            {!c.monitorable && (
              <span
                className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
                title={t(
                  'Textos não viram gráfico: ficam salvos como informação do equipamento e aparecem no card.',
                )}
              >
                {t('vira informação no card')}
              </span>
            )}
            {c.monitorable && (
              <label
                className={[
                  'flex items-center gap-1.5 text-[11px] text-muted-foreground',
                  existingOidSet.has(c.d.oid) ? 'cursor-not-allowed opacity-70' : 'cursor-pointer',
                ].join(' ')}
              >
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 accent-primary"
                  checked={isChecked(c)}
                  disabled={existingOidSet.has(c.d.oid)}
                  onChange={(e) =>
                    setCustomOverrides((prev) => ({
                      ...prev,
                      [c.d.oid]: e.target.checked,
                    }))
                  }
                />
                {t('Monitorar')}
              </label>
            )}
            {testOidFn && (
              <button
                type="button"
                onClick={() => void runOidTest(c.d.oid)}
                disabled={test?.loading}
                className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted disabled:opacity-50"
                title={t('Ler o valor atual deste OID no equipamento, via gateway')}
              >
                <Zap className="h-3 w-3" />
                {t('Testar agora')}
              </button>
            )}
          </div>
        </div>
      </li>
    );
  }

  // ── Linha de uma proposta de métrica canônica ─────────────────────────────
  function MetricProposalRow({ proposal }: { proposal: MetricProposal }) {
    const selected = proposalSelections[proposal.metricKey] ?? null;
    const displayedOid = selected?.oid ?? proposal.activeOid ?? null;
    const hasOid = !!displayedOid;
    const hasCandidates = proposal.candidates.length > 0;
    const isBroken = proposal.state === 'broken';
    const isSuggested = proposal.state === 'suggested';
    // Truly unsupported = no candidates AND no selectedOid (derived from legacy as null)
    const isSynthetic = proposal.metricKey === 'reachability';
    const isUnsupported = !isSynthetic && !hasCandidates && proposal.selectedOid === null;
    const open = openSources[proposal.metricKey] === true;

    return (
      <div
        className={[
          'rounded-lg border p-3 space-y-2',
          isUnsupported
            ? 'border-border/40 opacity-50'
            : isBroken
              ? 'border-amber-300 bg-amber-50/40 dark:border-amber-500/40 dark:bg-amber-500/5'
            : hasOid
              ? 'border-border'
              : 'border-border/50 opacity-60',
        ].join(' ')}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <p className="text-sm font-medium text-foreground">
                {t(proposal.friendlyName)}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              {isUnsupported
                ? t('não suportada pelo equipamento')
                : isBroken
                  ? t('Fonte atual sem resposta')
                   : proposal.activeOid
                     ? t('Funcionando — fonte atual')
                  : isSuggested
                    ? t('Encontrada no diagnóstico — ainda não aplicada')
                    : hasOid
                      ? t('Funcionando')
                      : t('Sem fonte selecionada')}
              {!isUnsupported && proposal.exampleValue !== null && (
                <>
                  {' · '}
                  <span className="font-medium text-foreground">
                    {proposal.exampleValue}
                    {proposal.unit && !proposal.exampleValue.includes(proposal.unit)
                      ? ` ${proposal.unit}`
                      : ''}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>
        {isBroken && (
          <p className="text-[11px] text-amber-700 dark:text-amber-300">
            {t('A fonte atual precisa ser revisada. Escolha explicitamente uma fonte válida para reativá-la.')}
            {proposal.suggestedOid && ` ${t('Selecione uma fonte com valor de exemplo e aplique para corrigir.')}`}
          </p>
        )}
        {isSuggested && (
          <p className="text-[11px] text-sky-700 dark:text-sky-300">
            {t('Esta fonte foi encontrada no diagnóstico, mas ainda não está ativa até ser aplicada.')}
          </p>
        )}

        {/* Candidate picker — shown when multiple candidates exist and metric is supported */}
        {!isUnsupported && hasCandidates && proposal.candidates.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() =>
                setOpenSources((prev) => ({
                  ...prev,
                  [proposal.metricKey]: !prev[proposal.metricKey],
                }))
              }
              className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            >
              {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {t('Escolher fonte')} ({proposal.candidates.length})
            </button>
            {open && (
              <div className="mt-1.5 space-y-1">
                {proposal.candidates.map((c) => {
                  // O identificador numérico só existe no bloco Avançado.
                  const candidateLabel = safeSnmpCandidateLabel(c.label);
                  return (
                    <label
                      key={c.oid}
                      className={[
                        'flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs cursor-pointer hover:bg-muted/50',
                        displayedOid === c.oid
                          ? 'border-primary/50 bg-primary/5'
                          : 'border-border',
                      ].join(' ')}
                    >
                      <input
                        type="radio"
                        name={`metric-${proposal.metricKey}`}
                        className="mt-0.5 h-3.5 w-3.5 accent-primary shrink-0"
                        checked={displayedOid === c.oid}
                        disabled={c.isActive}
                        onChange={() => {
                          if (c.isActive) return;
                          const isDefault = c.isDefault;
                          setProposalSelections((prev) => ({
                            ...prev,
                            [proposal.metricKey]: {
                              oid: c.oid,
                              scale: c.scale,
                              unit: c.unit ?? '',
                            },
                          }));
                          if (!isDefault) {
                            setManualConfidence((prev) => ({
                              ...prev,
                              [proposal.metricKey]: 'manual',
                            }));
                          } else {
                            setManualConfidence((prev) => {
                              const next = { ...prev };
                              delete next[proposal.metricKey];
                              return next;
                            });
                          }
                        }}
                      />
                      <span className="min-w-0 space-y-0.5">
                        <span className="block font-medium text-foreground">
                          {candidateLabel}
                          {c.isActive && (
                            <span className="ml-1.5 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-400">
                              {t('atual')}
                            </span>
                          )}
                        </span>
                        {c.exampleValue !== null && (
                          <span className="block text-muted-foreground">
                            {t('Exemplo:')}{' '}
                            <span className="font-medium text-foreground">
                              {c.exampleValue}
                              {c.unit && !c.exampleValue.includes(c.unit)
                                ? ` ${c.unit}`
                                : ''}
                            </span>
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
       <div className="w-full max-w-2xl rounded-2xl border border-border bg-card p-5 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
           <h3 className="text-base font-semibold text-foreground">
             {t('Diagnóstico SNMP —')} {device.name}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
         <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
           <p>
             <span className="font-medium text-foreground">{t('Enriquecimento do diagnóstico')}</span>{' — '}
             {t('MIBs apenas dão nomes e descrições aos OIDs encontrados; não ativam pontos, coleta, trends ou alarmes.')}
           </p>
           <p className="mt-1">
             {device.mibLabel ? (
               <>{t('MIB selecionada')}: <span className="font-medium text-foreground">{device.mibLabel}</span>
                 {device.mibManufacturer ? ` · ${device.mibManufacturer}` : ''}
                 {device.mibIsOffline ? ` · ${t('padrão/offline')}` : ` · ${t('importada')}`}
               </>
             ) : (
               <>{t('MIB selecionada')}: <span className="font-medium text-foreground">{t('Nenhuma — nomes padrão/offline')}</span></>
             )}
           </p>
         </div>

        <p className="text-xs text-muted-foreground">
           {t('Verifique as métricas que este')} {deviceLabel}{' '}
           {t('responde e escolha as fontes que deseja monitorar.')}
        </p>

        {diagnose.isPending && !result && (
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm text-muted-foreground space-y-2">
            <p className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {progress
                ? progress.phase === 'walk'
                  ? `${t('Descobrindo o que o equipamento informa…')} (${progress.tested}/${progress.total})`
                  : `${t('Testando leituras…')} ${progress.tested}/${progress.total}`
                : waitingLong
                  ? t('Ainda aguardando o gateway responder… ele pode estar ocupado ou lento.')
                  : t('Iniciando a descoberta no gateway…')}
            </p>
            {progress && progress.total > 0 && (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${Math.round((progress.tested / progress.total) * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        {diagnose.error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400 space-y-2">
            <p>
              {/em andamento/i.test((diagnose.error as Error).message)
                ? `O gateway está ocupado com outra descoberta SNMP. Aguarde e tente novamente.`
                : (diagnose.error as Error).message}
            </p>
            <button
              type="button"
              onClick={() => diagnose.mutate()}
              className="rounded-md border border-red-300 px-2.5 py-1 font-medium hover:bg-red-100 dark:border-red-500/40 dark:hover:bg-red-500/20"
            >
              {t('Tentar novamente')}
            </button>
          </div>
        )}

        {result && !result.reachable && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400 space-y-1">
            {result.cause === 'community' ? (
              <>
                <p className="font-medium">{t('A senha de comunidade parece estar incorreta.')}</p>
                <p>
                  {t('O')} {deviceLabel} {t('respondeu com a community padrão')}{' '}
                  <span className="font-mono">public</span>, {t('mas não com a configurada')} (<span className="font-mono">{device.community || '—'}</span>).{' '}
                  {t('Corrija a community no cadastro.')}
                </p>
              </>
            ) : (
              <>
                <p className="font-medium">{t('O equipamento não respondeu.')}</p>
                <p>
                  {t('Verifique se o SNMP está habilitado no')} {deviceLabel}, {t('a porta')} ({device.port}) {t('e a conectividade de rede a partir do gateway.')}
                </p>
              </>
            )}
          </div>
        )}

        {result && result.reachable && (
          <>
            {advanced && result.sysDescr && (
              <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground font-mono break-all">
                {result.sysDescr}
              </p>
            )}

            {/* Seletor de fabricante — reclassifica sem novo walk */}
            {profiles.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2">
                <label className="text-xs font-medium text-foreground">
                  {t('Fabricante:')}
                </label>
                <select
                  value={profileId}
                  onChange={(e) => setProfileId(e.target.value)}
                  className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="">{t('Detecção automática')}</option>
                  {profiles.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
                <span className="text-[11px] text-muted-foreground">
                  {t('Escolher o fabricante destaca as métricas recomendadas por ele — sem repetir a descoberta.')}
                </span>
              </div>
            )}

            {/* brokenBindings continua no payload para suporte técnico, mas não
                é exibido como alerta operacional genérico. */}

            {/* O que mudou desde a última descoberta */}
            {result.discovery?.diff &&
              (result.discovery.diff.counts.appeared > 0 ||
                result.discovery.diff.counts.disappeared > 0 ||
                result.discovery.diff.counts.typeChanged > 0) && (
                <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground">
                  <p>
                    {t('Desde a última descoberta:')}{' '}
                    <span className="font-medium text-foreground">
                      {result.discovery.diff.counts.appeared}
                    </span>{' '}
                    {t('itens novos')} ·{' '}
                    <span className="font-medium text-foreground">
                      {result.discovery.diff.counts.disappeared}
                    </span>{' '}
                    {t('sumiram')} ·{' '}
                    <span className="font-medium text-foreground">
                      {result.discovery.diff.counts.typeChanged}
                    </span>{' '}
                    {t('mudaram de tipo')}
                  </p>
                </div>
              )}

            {/* Resumo em linguagem simples */}
            {result.walkStats && (
              <div className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground space-y-1">
                <p>
                  {t('O equipamento informou')}{' '}
                  <span className="font-medium text-foreground">{result.walkStats.totalFound}</span>{' '}
                  {t('itens em')} {(result.walkStats.walkDurationMs / 1000).toFixed(1)}s.
                </p>
                {result.walkStats.errors.length > 0 && (
                  <p className="text-amber-600 dark:text-amber-400">
                    {t('Parte da descoberta falhou:')}{' '}
                    {result.walkStats.errors
                      .map((e) =>
                        e.error === 'timeout'
                          ? t('sem resposta (tempo esgotado)')
                          : e.error === 'auth'
                            ? t('senha de comunidade incorreta')
                            : e.error === 'no_permission'
                              ? t('sem permissão no equipamento')
                              : t('erro do equipamento'),
                      )
                      .filter((v, i, a) => a.indexOf(v) === i)
                      .join('; ')}
                  </p>
                )}
              </div>
            )}

            {/* ── Métricas canônicas (visão principal) ─────────────────────── */}
            {proposals.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-foreground">
                    {t('Saúde do equipamento')}
                  </p>
                </div>
                <div className="space-y-2">
                  {proposals.map((p) => (
                    <MetricProposalRow key={p.metricKey} proposal={p} />
                  ))}
                </div>
              </div>
            )}

            {/* ── Avançado: OIDs brutos descobertos ─────────────────────────── */}
            <div className="rounded-lg border border-border">
              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/50"
              >
                {advancedOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                {t('Avançado — OIDs descobertos')}
                {discovered.length > 0 && (
                  <span className="ml-auto text-[11px] font-normal text-muted-foreground">
                    {discovered.length} OIDs
                  </span>
                )}
              </button>
              {advancedOpen && (
                <div className="border-t border-border px-3 py-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-primary"
                        checked={advanced}
                        onChange={(e) => setAdvanced(e.target.checked)}
                      />
                      {t('Mostrar detalhes técnicos (OID numérico, tipo ASN.1, valor bruto)')}
                    </label>
                  </div>

                  {discovered.length > 0 && (
                    <>
                      <input
                        value={discoveredFilter}
                        onChange={(e) => setDiscoveredFilter(e.target.value)}
                        placeholder={t('Buscar por nome ou valor…')}
                        className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <p className="text-[11px] text-muted-foreground">
                        {t('OIDs brutos descobertos no walk — marque os que quiser monitorar adicionalmente às métricas acima.')}
                      </p>

                      {namedDiscovered.length > 0 && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                              {t('Nomeados')} ({namedDiscovered.length})
                            </p>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  const next: Record<string, boolean> = { ...customOverrides };
                                  for (const c of namedDiscovered) {
                                    if (c.monitorable && c.recommended) next[c.d.oid] = true;
                                  }
                                  setCustomOverrides(next);
                                }}
                                className="text-[11px] text-primary hover:underline"
                              >
                                {t('Marcar recomendadas')}
                              </button>
                              <span className="text-[11px] text-muted-foreground">·</span>
                              <button
                                type="button"
                                onClick={() => {
                                  const next: Record<string, boolean> = { ...customOverrides };
                                  for (const c of namedDiscovered) {
                                    next[c.d.oid] = false;
                                  }
                                  setCustomOverrides(next);
                                }}
                                className="text-[11px] text-muted-foreground hover:underline"
                              >
                                {t('Limpar')}
                              </button>
                            </div>
                          </div>
                          <ul className="max-h-72 space-y-1 overflow-y-auto">
                            {namedDiscovered.map((c) => (
                              <DiscoveredRow key={c.d.oid} c={c} />
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* OIDs sem nome: subgrupo "Unknown OID" recolhido */}
                      {unknownDiscovered.length > 0 && (
                        <div className="rounded-md border border-border">
                          <button
                            type="button"
                            onClick={() => setUnnamedOpen((v) => !v)}
                            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-muted/50"
                          >
                            {unnamedOpen ? (
                              <ChevronDown className="h-3 w-3 shrink-0" />
                            ) : (
                              <ChevronRight className="h-3 w-3 shrink-0" />
                            )}
                            {t('OIDs desconhecidos')} ({unknownDiscovered.length})
                            {!unnamedOpen && (
                              <span className="ml-auto text-[10px] font-normal text-muted-foreground/70">
                                {t('ocultos por padrão')}
                              </span>
                            )}
                          </button>
                          {unnamedOpen && (
                            <div className="border-t border-border px-2.5 py-2">
                              <ul className="max-h-56 space-y-1 overflow-y-auto">
                                {unknownDiscovered.map((c) => (
                                  <DiscoveredRow key={c.d.oid} c={c} />
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}

                      {namedDiscovered.length === 0 && unknownDiscovered.length === 0 && (
                        <p className="text-[11px] text-muted-foreground py-1">
                          {t('Nenhum resultado para o filtro aplicado.')}
                        </p>
                      )}
                    </>
                  )}

                  {/* Walk resumido */}
                  <div className="rounded-lg border border-border">
                    <button
                      type="button"
                      onClick={() => setWalkOpen((v) => !v)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-xs font-medium text-foreground hover:bg-muted/50"
                    >
                      {walkOpen ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                      {t('Walk SNMP bruto')} {deviceLabel}
                    </button>
                    {walkOpen && (
                      <div className="border-t border-border px-3 py-2 space-y-3">
                        {result.walk.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            {t('Nenhuma subárvore respondeu.')}
                          </p>
                        ) : (
                          <input
                            value={walkFilter}
                            onChange={(e) => setWalkFilter(e.target.value)}
                            placeholder={t('Buscar por OID ou valor…')}
                            className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                          />
                        )}
                        <div className="space-y-3 max-h-72 overflow-y-auto">
                          {result.walk.map((section) => {
                            const q = walkFilter.trim().toLowerCase();
                            const entries = q
                              ? section.entries.filter(
                                  (e) =>
                                    e.oid.toLowerCase().includes(q) ||
                                    e.value.toLowerCase().includes(q),
                                )
                              : section.entries;
                            if (q && entries.length === 0) return null;
                            return (
                              <div key={section.root} className="space-y-1">
                                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                                  {section.label}
                                  {section.truncated ? ` ${t('(parcial)')}` : ''} — {entries.length}
                                  {q ? ` de ${section.entries.length}` : ''} OID
                                  {entries.length !== 1 ? 's' : ''}
                                </p>
                                {entries.length > 0 && (
                                  <ul className="space-y-0.5 font-mono text-[11px] text-muted-foreground">
                                    {entries.map((e) => (
                                      <li
                                        key={e.oid}
                                        className="group flex items-start gap-1.5 break-all"
                                      >
                                        <span className="min-w-0">
                                          {e.oid} = {e.value}
                                        </span>
                                        <button
                                          type="button"
                                          title={t('Copiar OID')}
                                          onClick={() => {
                                            void navigator.clipboard?.writeText(e.oid);
                                            setCopiedOid(e.oid);
                                            setTimeout(
                                              () =>
                                                setCopiedOid((c) => (c === e.oid ? null : c)),
                                              1500,
                                            );
                                          }}
                                          className="shrink-0 rounded border border-border px-1 text-[10px] text-muted-foreground opacity-0 transition-opacity hover:bg-muted group-hover:opacity-100"
                                        >
                                          {copiedOid === e.oid ? t('copiado') : t('copiar')}
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {apply.error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
            {(apply.error as Error).message}
          </p>
        )}
        {applied && (
          <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-400">
            {t('Pronto — o gateway já recebeu a nova configuração de monitoramento.')}
          </p>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-foreground hover:bg-muted"
          >
            {t('Fechar')}
          </button>
          {result?.reachable && (
            <button
              type="button"
              disabled={selectedCount === 0 || apply.isPending}
              onClick={() => {
                setApplied(false);
                apply.mutate();
              }}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {apply.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t('Monitorar selecionadas')}
              {selectedCount > 0 ? ` (${selectedCount})` : ''}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
