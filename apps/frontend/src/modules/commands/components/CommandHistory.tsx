'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, History, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { useCommandHistory } from '../hooks/useCommandHistory';
import type {
  CommandHistoryEntry,
  CommandResult,
} from '../services/commands.service';

interface Props {
  /** Tenant em escopo (perfis globais filtram por cliente no topo). */
  tenantId?: string;
}

/** Converte um <input type="date"> (YYYY-MM-DD) num Date local, ou undefined. */
function dayStart(v: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function dayEnd(v: string): Date | undefined {
  if (!v) return undefined;
  const d = new Date(`${v}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(d);
}

const RESULT_BADGE: Record<CommandResult, string> = {
  success: 'bg-green-50 text-green-700 border-green-200',
  error: 'bg-red-50 text-red-700 border-red-200',
  unknown: 'bg-gray-50 text-gray-600 border-gray-200',
};

const RESULT_LABEL: Record<CommandResult, string> = {
  success: 'Sucesso',
  error: 'Falha',
  unknown: '—',
};

export default function CommandHistory({ tenantId }: Props) {
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [gatewayId, setGatewayId] = useState<string>('');
  const [userId, setUserId] = useState<string>('');
  const [result, setResult] = useState<'' | 'success' | 'error'>('');

  const { data: entries = [], isLoading, isError, error, isFetching, refetch } =
    useCommandHistory({
      tenantId,
      from: dayStart(from),
      to: dayEnd(to),
    });

  // Opções de gateway/usuário derivadas do conjunto carregado (estáveis: não
  // dependem das seleções de gateway/usuário/resultado).
  const gatewayOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const e of entries) if (e.gatewayId) ids.add(e.gatewayId);
    return [...ids].sort();
  }, [entries]);

  const userOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entries) {
      const key = e.userId ?? e.userEmail;
      if (!map.has(key)) map.set(key, e.userName || e.userEmail);
    }
    return [...map.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label));
  }, [entries]);

  // Filtros de gateway/usuário/resultado aplicados sobre o conjunto carregado.
  const filtered = useMemo<CommandHistoryEntry[]>(() => {
    return entries.filter((e) => {
      if (gatewayId && e.gatewayId !== gatewayId) return false;
      if (userId && (e.userId ?? e.userEmail) !== userId) return false;
      if (result && e.result !== result) return false;
      return true;
    });
  }, [entries, gatewayId, userId, result]);

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 border border-border rounded-xl bg-card p-4">
        <div className="space-y-1">
          <label htmlFor="hist-from" className="text-xs font-medium text-muted-foreground">De</label>
          <input
            id="hist-from"
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-full h-9 px-2 text-sm rounded-md border border-border bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="hist-to" className="text-xs font-medium text-muted-foreground">Até</label>
          <input
            id="hist-to"
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full h-9 px-2 text-sm rounded-md border border-border bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
          />
        </div>
        <div className="space-y-1">
          <label htmlFor="hist-gateway" className="text-xs font-medium text-muted-foreground">Gateway</label>
          <select
            id="hist-gateway"
            value={gatewayId}
            onChange={(e) => setGatewayId(e.target.value)}
            className="w-full h-9 px-2 text-sm rounded-md border border-border bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
          >
            <option value="">Todos</option>
            {gatewayOptions.map((id) => (
              <option key={id} value={id}>{id}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="hist-user" className="text-xs font-medium text-muted-foreground">Usuário</label>
          <select
            id="hist-user"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="w-full h-9 px-2 text-sm rounded-md border border-border bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
          >
            <option value="">Todos</option>
            {userOptions.map((u) => (
              <option key={u.id} value={u.id}>{u.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="hist-result" className="text-xs font-medium text-muted-foreground">Resultado</label>
          <select
            id="hist-result"
            value={result}
            onChange={(e) => setResult(e.target.value as '' | 'success' | 'error')}
            className="w-full h-9 px-2 text-sm rounded-md border border-border bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-cyan-500/40"
          >
            <option value="">Todos</option>
            <option value="success">Sucesso</option>
            <option value="error">Falha</option>
          </select>
        </div>
      </div>

      {/* Barra de status / refresh */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {isLoading ? 'Carregando…' : `${filtered.length} de ${entries.length} comando(s)`}
        </span>
        <button
          type="button"
          onClick={() => void refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-1.5 h-8 px-3 text-xs rounded-md border border-border bg-card text-foreground hover:bg-muted/50 disabled:opacity-50 transition-colors"
        >
          {isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Atualizar
        </button>
      </div>

      {/* Erro */}
      {isError && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          <XCircle className="h-4 w-4 shrink-0 mt-px" />
          <span>Falha ao carregar o histórico: {(error as Error).message}</span>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-11 rounded-lg bg-muted/40 animate-pulse" />
          ))}
        </div>
      )}

      {/* Vazio */}
      {!isLoading && !isError && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center border border-border rounded-xl bg-card">
          <History className="h-12 w-12 text-muted-foreground/25 mb-3" />
          <p className="text-sm text-muted-foreground">Nenhum comando encontrado para os filtros selecionados.</p>
        </div>
      )}

      {/* Tabela */}
      {!isLoading && !isError && filtered.length > 0 && (
        <div className="overflow-x-auto border border-border rounded-xl bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-3 py-2.5 font-medium">Data/hora</th>
                <th className="px-3 py-2.5 font-medium">Usuário</th>
                <th className="px-3 py-2.5 font-medium">Site</th>
                <th className="px-3 py-2.5 font-medium">Gateway</th>
                <th className="px-3 py-2.5 font-medium">Alvo</th>
                <th className="px-3 py-2.5 font-medium">Valor</th>
                <th className="px-3 py-2.5 font-medium">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-b border-border/60 last:border-0 hover:bg-muted/30">
                  <td className="px-3 py-2.5 whitespace-nowrap text-foreground">{fmtDateTime(e.createdAt)}</td>
                  <td className="px-3 py-2.5">
                    <span className="text-foreground">{e.userName || e.userEmail}</span>
                    {e.userName && (
                      <span className="block text-xs text-muted-foreground">{e.userEmail}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-foreground">{e.siteName ?? '—'}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{e.gatewayId ?? '—'}</td>
                  <td className="px-3 py-2.5 text-foreground">{e.target}</td>
                  <td className="px-3 py-2.5 text-foreground">{e.value || '—'}</td>
                  <td className="px-3 py-2.5">
                    <span
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium border ${RESULT_BADGE[e.result]}`}
                      title={e.error ?? undefined}
                    >
                      {e.result === 'success' ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : e.result === 'error' ? (
                        <XCircle className="h-3 w-3" />
                      ) : null}
                      {RESULT_LABEL[e.result]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
