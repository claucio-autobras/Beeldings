'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Crown, Database, Loader2, Radio, Server, ServerCog } from 'lucide-react';
import { apiGet } from '@/lib/api-client';

interface ClusterStatus {
  isLeader: boolean;
  instanceId: string;
}

interface InstanceState {
  instanceId: string;
  isLeader: boolean;
  lastSeen: number;
}

interface StorageStatus {
  usedBytes: number;
  quotaBytes: number;
  percent: number;
  environment: 'production' | 'homologacao';
}

interface TableUsage {
  name: string;
  bytes: number;
}

interface BrokerSnapshot {
  configured: boolean;
  available: boolean;
  checkedAt: string | null;
  connections: number | null;
  liveConnections: number | null;
  topics: number | null;
  subscriptions: number | null;
  messageInRate: number | null;
  messageOutRate: number | null;
  droppedTotal: number | null;
  droppedNoSubscribersTotal: number | null;
  queueFullDroppedTotal: number | null;
  droppedDelta: number | null;
  health: 'healthy' | 'abnormal' | 'unknown';
  error: string | null;
}

const ENV_LABEL: Record<StorageStatus['environment'], string> = {
  production: 'Produção',
  homologacao: 'Homologação',
};

const POLL_INTERVAL_MS = 3_000;
const STORAGE_POLL_INTERVAL_MS = 60_000;

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1_000);
  if (s < 2) return 'agora';
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m}min`;
  return `há ${Math.floor(m / 60)}h`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}

export default function ClusterStatusPage() {
  // O balanceador pode rotear cada requisição para uma instância diferente, então
  // acumulamos cada instanceId observado para montar a visão de todo o cluster.
  const [instances, setInstances] = useState<Record<string, InstanceState>>({});
  const [, forceTick] = useState(0);

  const { data, isLoading, error, isFetching } = useQuery<ClusterStatus>({
    queryKey: ['cluster-status'],
    queryFn: () => apiGet('/cluster/status'),
    refetchInterval: POLL_INTERVAL_MS,
  });

  const { data: storage } = useQuery<StorageStatus>({
    queryKey: ['storage-status'],
    queryFn: () => apiGet('/health/storage'),
    refetchInterval: STORAGE_POLL_INTERVAL_MS,
  });

  const { data: broker } = useQuery<BrokerSnapshot>({
    queryKey: ['broker-health'],
    queryFn: () => apiGet('/health/broker'),
    refetchInterval: 15_000,
  });

  const [storageExpanded, setStorageExpanded] = useState(false);
  const { data: tablesData, isLoading: tablesLoading, error: tablesError } = useQuery<{ tables: TableUsage[] }>({
    queryKey: ['storage-tables'],
    queryFn: () => apiGet('/health/storage/tables'),
    enabled: storageExpanded,
    refetchInterval: storageExpanded ? STORAGE_POLL_INTERVAL_MS : false,
  });

  useEffect(() => {
    if (!data) return;
    setInstances((prev) => ({
      ...prev,
      [data.instanceId]: {
        instanceId: data.instanceId,
        isLeader: data.isLeader,
        lastSeen: Date.now(),
      },
    }));
  }, [data]);

  // Mantém os rótulos de "última resposta" atualizados mesmo entre os polls.
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 1_000);
    return () => clearInterval(t);
  }, []);

  const list = Object.values(instances).sort((a, b) => {
    if (a.isLeader !== b.isLeader) return a.isLeader ? -1 : 1;
    return a.instanceId.localeCompare(b.instanceId);
  });

  const leaderCount = list.filter((i) => i.isLeader).length;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {/* Header */}
      <header className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10">
          <ServerCog className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Servidores</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Estado de liderança das instâncias do backend — qual servidor está no comando da ingestão
          </p>
        </div>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        {[
          { label: 'Instâncias vistas', value: list.length, color: 'text-foreground' },
          { label: 'Líder ativo', value: leaderCount, color: leaderCount === 1 ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400' },
          { label: 'Seguidores', value: list.length - leaderCount, color: 'text-muted-foreground' },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-xl border border-border bg-card px-4 py-3 text-center shadow-sm">
            <p className={`text-2xl font-bold ${color}`}>{value}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Uso do banco de dados */}
      {storage && (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow duration-200 hover:shadow-md">
          <button
            type="button"
            onClick={() => setStorageExpanded((v) => !v)}
            className="w-full px-4 py-4 text-left transition-colors hover:bg-muted/20"
            aria-expanded={storageExpanded}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 text-cyan-600" />
                <span className="text-sm font-medium text-foreground">Uso do banco de dados</span>
                <span className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {ENV_LABEL[storage.environment]}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`text-sm font-semibold ${
                    storage.percent >= 90
                      ? 'text-red-600'
                      : storage.percent >= 70
                        ? 'text-amber-600'
                        : 'text-foreground'
                  }`}
                >
                  {storage.percent.toFixed(1)}%
                </span>
                <ChevronDown
                  className={`h-4 w-4 text-muted-foreground transition-transform ${storageExpanded ? 'rotate-180' : ''}`}
                />
              </div>
            </div>
            <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all ${
                  storage.percent >= 90
                    ? 'bg-red-500'
                    : storage.percent >= 70
                      ? 'bg-amber-500'
                      : 'bg-cyan-600'
                }`}
                style={{ width: `${Math.min(100, Math.max(2, storage.percent))}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {formatBytes(storage.usedBytes)} de {formatBytes(storage.quotaBytes)} usados
              {storage.percent >= 70 && (
                <span className={storage.percent >= 90 ? 'text-red-600' : 'text-amber-600'}>
                  {' '}· considere reduzir a retenção das trends ou migrar o banco
                </span>
              )}
              <span className="ml-1 text-muted-foreground/70">· {storageExpanded ? 'ocultar' : 'ver'} tabelas</span>
            </p>
          </button>

          {storageExpanded && (
            <div className="border-t border-border px-4 py-3">
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                Maiores tabelas
              </p>
              {tablesLoading && !tablesData && (
                <div className="space-y-2">
                  {[1, 2, 3, 4].map((i) => <div key={i} className="h-7 rounded bg-muted/40 animate-pulse" />)}
                </div>
              )}
              {tablesError && (
                <p className="text-xs text-red-600">
                  Não foi possível carregar as tabelas: {(tablesError as Error).message}
                </p>
              )}
              {tablesData && tablesData.tables.length > 0 && (
                <ul className="space-y-1.5">
                  {tablesData.tables.map((t) => {
                    const max = tablesData.tables[0]?.bytes || 1;
                    const widthPct = Math.max(2, (t.bytes / max) * 100);
                    const sharePct = storage.usedBytes > 0 ? (t.bytes / storage.usedBytes) * 100 : 0;
                    return (
                      <li key={t.name} className="flex items-center gap-3">
                        <span className="w-24 shrink-0 truncate font-mono text-xs text-foreground sm:w-40" title={t.name}>
                          {t.name}
                        </span>
                        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full bg-cyan-500" style={{ width: `${widthPct}%` }} />
                        </div>
                        <span className="w-24 shrink-0 text-right text-xs text-muted-foreground sm:w-28">
                          {formatBytes(t.bytes)} · {sharePct.toFixed(0)}%
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {tablesData && tablesData.tables.length === 0 && (
                <p className="text-xs text-muted-foreground">Nenhuma tabela encontrada.</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Broker MQTT (EMQX) */}
      {broker && broker.configured && (
        <div className="rounded-xl border border-border bg-card px-4 py-4 shadow-sm transition-shadow duration-200 hover:shadow-md">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Radio className="h-4 w-4 text-cyan-600" />
              <span className="text-sm font-medium text-foreground">Broker MQTT (EMQX)</span>
            </div>
            {broker.available ? (
              broker.health === 'abnormal' ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  Sinal anormal
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:border-green-800 dark:bg-green-950/40 dark:text-green-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  Saudável
                </span>
              )
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
                <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                Sem dados
              </span>
            )}
          </div>

          {broker.available ? (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: 'Conexões', value: broker.liveConnections ?? broker.connections },
                { label: 'Assinaturas', value: broker.subscriptions },
                { label: 'Tópicos', value: broker.topics },
                { label: 'Msgs recebidas/s', value: broker.messageInRate },
                { label: 'Msgs enviadas/s', value: broker.messageOutRate },
                {
                  label: 'Descartadas (total)',
                  value: broker.droppedTotal,
                  highlight: (broker.droppedDelta ?? 0) > 0,
                },
              ].map(({ label, value, highlight }) => (
                <div key={label} className="rounded-md border border-border bg-muted/20 px-3 py-2 text-center">
                  <p className={`text-lg font-semibold ${highlight ? 'text-amber-600' : 'text-foreground'}`}>
                    {value == null ? '—' : value.toLocaleString('pt-BR')}
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              O broker EMQX não respondeu à última consulta
              {broker.error ? ` (${broker.error})` : ''}. Os gateways podem estar sem comunicação.
            </p>
          )}
          {broker.available && (broker.queueFullDroppedTotal ?? 0) > 0 && (
            <p className="mt-2 text-xs text-amber-600">
              {broker.queueFullDroppedTotal!.toLocaleString('pt-BR')} descarte(s) por fila cheia desde o boot do broker.
            </p>
          )}
        </div>
      )}
      {broker && !broker.configured && (
        <div className="rounded-xl border border-border bg-card px-4 py-4 shadow-sm">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium text-foreground">Broker MQTT (EMQX)</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Monitoramento não configurado neste ambiente (defina EMQX_API_URL no backend).
          </p>
        </div>
      )}

      {/* Loading inicial */}
      {isLoading && list.length === 0 && (
        <div className="space-y-3">
          {[1, 2].map((i) => <div key={i} className="h-16 rounded-lg bg-muted/40 animate-pulse" />)}
        </div>
      )}

      {/* Erro */}
      {error && list.length === 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-400">
          Erro ao consultar o estado do cluster: {(error as Error).message}
        </div>
      )}

      {/* Vazio */}
      {!isLoading && !error && list.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-border bg-card px-6 py-16 text-center shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-cyan-500/10">
            <Server className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
          </div>
          <p className="text-sm text-muted-foreground">Nenhuma instância respondeu ainda.</p>
        </div>
      )}

      {/* Lista de instâncias */}
      {list.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-shadow duration-200 hover:shadow-md">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-sm">
            <thead>
              <tr className="bg-muted/30 border-b border-border">
                <th className="text-left px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Instância</th>
                <th className="text-center px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Papel</th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Última resposta</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.map((inst) => (
                <tr key={inst.instanceId} className="transition-colors duration-150 hover:bg-muted/30">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2.5">
                      {inst.isLeader
                        ? <ServerCog className="h-4 w-4 text-green-500 shrink-0" />
                        : <Server className="h-4 w-4 text-muted-foreground/60 shrink-0" />}
                      <span className="font-mono text-xs text-foreground font-medium">{inst.instanceId}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    {inst.isLeader ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-900">
                        <Crown className="h-3 w-3" />
                        Líder
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
                        Seguidor
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-right text-xs text-muted-foreground">
                    {formatRelative(inst.lastSeen)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <div className="border-t border-border bg-muted/20 px-5 py-2.5 text-xs text-muted-foreground">
            {list.length} instância{list.length !== 1 ? 's' : ''} observada{list.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {isFetching && <Loader2 className="h-3 w-3 animate-spin" />}
        Atualiza automaticamente a cada 3 segundos. Painel somente leitura.
      </p>
    </div>
  );
}
