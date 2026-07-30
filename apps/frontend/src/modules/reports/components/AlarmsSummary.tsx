'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { Loader2 } from 'lucide-react';
import {
  getAlarmEvents,
  type AlarmEventItem,
  type AlarmEventState,
  type AlarmSeverity,
} from '@/modules/alarms/services/alarms-api.service';
import type { AlarmReportStatus } from '../services/reports.service';

interface AlarmsSummaryProps {
  tenantId?: string;
  siteId?: string;
  from?: Date;
  to?: Date;
  /** Filtro "Conteúdo" do relatório — alinha o preview ao que será exportado. */
  status?: AlarmReportStatus;
}

// Mesmos conjuntos de estados usados pelo backend ao gerar o relatório, para
// que a pré-visualização reflita exatamente o recorte exportado.
const STATUS_STATES: Record<Exclude<AlarmReportStatus, 'all'>, AlarmEventState[]> = {
  active: ['ACTIVE', 'ACTIVE_ACK'],
  ack: ['ACTIVE_ACK', 'NORMALIZED_ACK'],
  closed: ['NORMALIZED_UNACK', 'NORMALIZED_ACK'],
};

const SEVERITY_META: { key: AlarmSeverity; label: string; color: string }[] = [
  { key: 'HIGH', label: 'Alta', color: '#dc2626' },
  { key: 'MEDIUM', label: 'Média', color: '#d97706' },
  { key: 'LOW', label: 'Baixa', color: '#059669' },
];

const STATE_META: { key: AlarmEventState; label: string; color: string }[] = [
  { key: 'ACTIVE', label: 'Ativo', color: '#dc2626' },
  { key: 'ACTIVE_ACK', label: 'Ativo (reconhecido)', color: '#d97706' },
  { key: 'NORMALIZED_UNACK', label: 'Encerrado (não reconhecido)', color: '#0284c7' },
  { key: 'NORMALIZED_ACK', label: 'Encerrado (reconhecido)', color: '#64748b' },
];

const SEVERITY_BY_KEY = new Map(SEVERITY_META.map((m) => [m.key, m]));
const STATE_BY_KEY = new Map(STATE_META.map((m) => [m.key, m]));

/** Peso p/ ordenar severidade (Alta primeiro), como no relatório exportado. */
const SEVERITY_ORDER: Record<AlarmSeverity, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };

/** Última atividade da ocorrência (ativação/reativação/normalização), como no relatório. */
function lastActivity(e: AlarmEventItem): number {
  return Math.max(
    new Date(e.activatedAt).getTime() || 0,
    e.normalizedAt ? new Date(e.normalizedAt).getTime() || 0 : 0,
    e.lastReactivatedAt ? new Date(e.lastReactivatedAt).getTime() || 0 : 0,
  );
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Mesmo fuso fixo dos relatórios (PDF/CSV), para prévia e arquivo baterem.
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(d);
}

/**
 * Resumo visual dos alarmes do escopo/período selecionado, mostrado antes de
 * exportar o relatório. Mantém-se enxuto (severidade + situação) para não
 * duplicar a aba de Alarmes.
 */
export function AlarmsSummary({ tenantId, siteId, from, to, status = 'all' }: AlarmsSummaryProps) {
  const { data: allEvents = [], isLoading } = useQuery<AlarmEventItem[]>({
    queryKey: [
      'reports-alarms-summary',
      tenantId ?? '',
      siteId ?? '',
      from?.toISOString() ?? '',
      to?.toISOString() ?? '',
    ],
    queryFn: () => getAlarmEvents({ tenantId, siteId, from, to }),
  });

  // Aplica o mesmo recorte de "Conteúdo" do relatório exportado.
  const events = useMemo(() => {
    if (status === 'all') return allEvents;
    const allowed = new Set(STATUS_STATES[status]);
    return allEvents.filter((e) => allowed.has(e.state));
  }, [allEvents, status]);

  const { bySeverity, byState, total } = useMemo(() => {
    const sev = new Map<AlarmSeverity, number>();
    const st = new Map<AlarmEventState, number>();
    for (const e of events) {
      sev.set(e.severity, (sev.get(e.severity) ?? 0) + 1);
      st.set(e.state, (st.get(e.state) ?? 0) + 1);
    }
    return {
      total: events.length,
      bySeverity: SEVERITY_META.map((m) => ({ name: m.label, value: sev.get(m.key) ?? 0, color: m.color })).filter(
        (d) => d.value > 0,
      ),
      byState: STATE_META.map((m) => ({ ...m, value: st.get(m.key) ?? 0 })),
    };
  }, [events]);

  // Mesma ordenação do relatório exportado: severidade (Alta primeiro) e,
  // dentro dela, atividade mais recente primeiro.
  const sortedEvents = useMemo(
    () =>
      [...events].sort(
        (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || lastActivity(b) - lastActivity(a),
      ),
    [events],
  );

  if (isLoading) {
    return (
      <div className="mt-5 flex items-center justify-center gap-2 rounded-lg border border-border bg-card py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Carregando resumo…
      </div>
    );
  }

  return (
    <div className="mt-5">
      <p className="mb-2 text-xs font-medium text-foreground">
        Resumo <span className="text-muted-foreground">({total} ocorrência(s) no período)</span>
      </p>
      {total === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/10 px-3 py-8 text-center text-xs text-muted-foreground">
          Nenhuma ocorrência de alarme no período/escopo selecionado.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="mb-2 text-xs font-medium text-foreground">Por severidade</p>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={bySeverity} dataKey="value" nameKey="name" innerRadius={48} outerRadius={78} paddingAngle={2}>
                  {bySeverity.map((d) => (
                    <Cell key={d.name} fill={d.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <p className="mb-3 text-xs font-medium text-foreground">Por situação</p>
            <ul className="space-y-2.5">
              {byState.map((s) => {
                const pct = total > 0 ? Math.round((s.value / total) * 100) : 0;
                return (
                  <li key={s.key}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5 text-foreground">
                        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                        {s.label}
                      </span>
                      <span className="font-tabular text-muted-foreground">
                        {s.value} · {pct}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: s.color }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {total > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-medium text-foreground">
            Prévia <span className="text-muted-foreground">({total} ocorrência(s) no período)</span>
          </p>
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <div className="max-h-[28rem] overflow-y-auto">
              <table className="w-full min-w-[880px] text-left text-xs">
                <thead className="sticky top-0 bg-muted/40 backdrop-blur">
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="whitespace-nowrap px-3 py-2 font-medium">Severidade</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">Situação</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">Equipamento</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">Ponto</th>
                    <th className="px-3 py-2 font-medium">Mensagem</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">Valor</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">Ativado em</th>
                    <th className="whitespace-nowrap px-3 py-2 font-medium">Normalizado em</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {sortedEvents.map((e) => {
                    const sev = SEVERITY_BY_KEY.get(e.severity);
                    const st = STATE_BY_KEY.get(e.state);
                    const value =
                      e.valueAtTrigger != null ? `${e.valueAtTrigger}${e.unit ? ` ${e.unit}` : ''}` : '—';
                    return (
                      <tr key={e.id} className="hover:bg-muted/30">
                        <td className="whitespace-nowrap px-3 py-2 font-medium" style={{ color: sev?.color }}>
                          {sev?.label ?? e.severity}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <span className="flex items-center gap-1.5 text-foreground">
                            <span
                              className="inline-block h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: st?.color }}
                            />
                            {st?.label ?? e.state}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-foreground">{e.deviceName}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                          {e.objectName || e.tag}
                        </td>
                        <td className="px-3 py-2 text-foreground">{e.message}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-tabular text-muted-foreground">{value}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                          {fmtDateTime(e.activatedAt)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                          {fmtDateTime(e.normalizedAt)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
