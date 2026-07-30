'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bell,
  BellOff,
  Clock,
  Loader2,
  Terminal,
} from 'lucide-react';
import {
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts';
import { getDeviceTimeline, type TimelineEvent } from '../services/devices.service';

interface Props {
  deviceId: string;
}

type RangeKey = '24h' | '7d' | '30d' | 'custom';

const RANGE_LABELS: Record<Exclude<RangeKey, 'custom'>, string> = {
  '24h': 'Últimas 24h',
  '7d': '7 dias',
  '30d': '30 dias',
};

const severityStyles: Record<string, string> = {
  HIGH: 'text-red-600 dark:text-red-400',
  MEDIUM: 'text-amber-600 dark:text-amber-400',
  LOW: 'text-blue-600 dark:text-blue-400',
};

function eventIcon(e: TimelineEvent) {
  if (e.type === 'command') return <Terminal className="h-3.5 w-3.5 text-cyan-600 dark:text-cyan-400" />;
  if (e.type === 'alarm_normalized') return <BellOff className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />;
  return <Bell className={`h-3.5 w-3.5 ${severityStyles[e.severity ?? ''] ?? 'text-amber-600'}`} />;
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/**
 * Aba "Linha do tempo" do equipamento: telemetria (curva da trend) + alarmes +
 * comandos alinhados no MESMO eixo de tempo — o operador vê "o que aconteceu
 * antes/depois" sem cruzar telas. Janelas: 24h / 7d / 30d / personalizada.
 */
export function DeviceTimelineTab({ deviceId }: Props) {
  const [range, setRange] = useState<RangeKey>('24h');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [pointId, setPointId] = useState<string | undefined>(undefined);
  // Evento selecionado no feed: destaca a marca correspondente no gráfico.
  const [selectedTs, setSelectedTs] = useState<number | null>(null);

  const { from, to } = useMemo(() => {
    const now = new Date();
    if (range === 'custom') {
      // datetime-local é interpretado no fuso do navegador (padrão do projeto).
      const f = customFrom ? new Date(customFrom) : null;
      const t = customTo ? new Date(customTo) : null;
      if (f && t && f < t) {
        // Fim inclusivo até o último milissegundo do minuto escolhido.
        const tEnd = new Date(t.getTime() + 59_999);
        return { from: f.toISOString(), to: tEnd.toISOString() };
      }
      return { from: undefined, to: undefined };
    }
    const hours = range === '24h' ? 24 : range === '7d' ? 7 * 24 : 30 * 24;
    return { from: new Date(now.getTime() - hours * 3600 * 1000).toISOString(), to: now.toISOString() };
  }, [range, customFrom, customTo]);

  const enabled = range !== 'custom' || (Boolean(from) && Boolean(to));

  const { data, isLoading, isError } = useQuery({
    queryKey: ['device-timeline', deviceId, from, to, pointId],
    queryFn: () => getDeviceTimeline(deviceId, { from, to, pointId }),
    enabled,
    refetchInterval: 60_000,
  });

  const chartData = useMemo(
    () =>
      (data?.chartPoints ?? []).map((p) => ({
        ts: new Date(p.t).getTime(),
        value: p.value,
        min: p.min,
        max: p.max,
      })),
    [data],
  );

  // Marcas verticais dos eventos que caem dentro da janela do gráfico.
  const eventMarks = useMemo(() => {
    if (!data) return [] as { ts: number; type: TimelineEvent['type'] }[];
    return data.events.map((e) => ({ ts: new Date(e.at).getTime(), type: e.type }));
  }, [data]);

  const unit = data?.point?.unit ?? '';

  return (
    <div className="space-y-4">
      {/* ── Controles: período + ponto ── */}
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(RANGE_LABELS) as Array<Exclude<RangeKey, 'custom'>>).map((k) => (
          <button
            key={k}
            onClick={() => setRange(k)}
            className={`h-8 px-3 text-xs rounded-md border transition-colors ${
              range === k
                ? 'bg-cyan-600 text-white border-cyan-600'
                : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/40'
            }`}
          >
            {RANGE_LABELS[k]}
          </button>
        ))}
        <button
          onClick={() => setRange('custom')}
          className={`h-8 px-3 text-xs rounded-md border transition-colors ${
            range === 'custom'
              ? 'bg-cyan-600 text-white border-cyan-600'
              : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/40'
          }`}
        >
          Personalizado
        </button>

        {data && data.trendedPoints.length > 0 && (
          <select
            value={pointId ?? data.point?.id ?? ''}
            onChange={(e) => setPointId(e.target.value || undefined)}
            className="ml-auto h-8 px-2 text-xs rounded-md border border-border bg-card text-foreground"
            aria-label="Ponto do gráfico"
          >
            {data.trendedPoints.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || p.tag}
              </option>
            ))}
          </select>
        )}
      </div>

      {range === 'custom' && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <label className="flex items-center gap-1.5 text-muted-foreground">
            De
            <input
              type="datetime-local"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-8 px-2 rounded-md border border-border bg-card text-foreground"
            />
          </label>
          <label className="flex items-center gap-1.5 text-muted-foreground">
            Até
            <input
              type="datetime-local"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-8 px-2 rounded-md border border-border bg-card text-foreground"
            />
          </label>
          {!enabled && (
            <span className="text-amber-600 dark:text-amber-400">Informe um período válido (início antes do fim).</span>
          )}
        </div>
      )}

      {isLoading && enabled && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando linha do tempo…
        </div>
      )}

      {isError && (
        <div className="flex items-start gap-2 border border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-800 text-amber-800 dark:text-amber-300 rounded-lg px-4 py-2 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          Não foi possível carregar a linha do tempo. Tente novamente.
        </div>
      )}

      {data && !isLoading && (
        <div className="grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-4 items-start">
          {/* ── Gráfico da telemetria com marcas de eventos ── */}
          <div id="timeline-chart" className="bg-card border border-border rounded-lg p-4">
            <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
              <h3 className="text-sm font-medium text-foreground">
                {data.point ? (data.point.name || data.point.tag) : 'Telemetria'}
                {unit ? <span className="text-muted-foreground font-normal"> ({unit})</span> : null}
              </h3>
              <span className="text-xs text-muted-foreground">
                {fmtDateTime(data.from)} — {fmtDateTime(data.to)}
              </span>
            </div>
            {chartData.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">
                {data.trendedPoints.length === 0
                  ? 'Nenhum ponto deste equipamento tem histórico (trend) habilitado.'
                  : 'Sem registros de telemetria no período.'}
              </p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                    <XAxis
                      dataKey="ts"
                      type="number"
                      domain={['dataMin', 'dataMax']}
                      tickFormatter={(v: number) => fmtDateTime(new Date(v).toISOString())}
                      tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }}
                      minTickGap={60}
                    />
                    <YAxis tick={{ fontSize: 10, fill: 'var(--color-muted-foreground)' }} width={44} />
                    <Tooltip
                      labelFormatter={(v) => fmtDateTime(new Date(Number(v)).toISOString())}
                      formatter={(value, name) => [
                        typeof value === 'number' ? `${value.toFixed(2)}${unit ? ` ${unit}` : ''}` : String(value ?? '—'),
                        name === 'value' ? 'Média' : name === 'min' ? 'Mín' : 'Máx',
                      ]}
                      contentStyle={{
                        backgroundColor: 'var(--color-card)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 6,
                        color: 'var(--color-foreground)',
                        fontSize: 12,
                      }}
                    />
                    {/* Faixa mín–máx do bucket */}
                    <Area dataKey="max" stroke="none" fill="#0891b2" fillOpacity={0.12} />
                    <Area dataKey="min" stroke="none" fill="var(--color-card)" fillOpacity={1} />
                    <Line dataKey="value" stroke="#0891b2" strokeWidth={2} dot={false} />
                    {eventMarks.map((m, i) => {
                      const selected = selectedTs !== null && Math.abs(m.ts - selectedTs) < 1000;
                      return (
                        <ReferenceLine
                          key={i}
                          x={m.ts}
                          stroke={m.type === 'command' ? '#0891b2' : m.type === 'alarm_normalized' ? '#059669' : '#dc2626'}
                          strokeDasharray={selected ? undefined : '4 3'}
                          strokeWidth={selected ? 2.5 : 1}
                          strokeOpacity={selected ? 1 : 0.6}
                        />
                      );
                    })}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* ── Feed de eventos ── */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-medium text-foreground">Eventos no período</h3>
              <span className="text-xs text-muted-foreground border border-border rounded px-1.5 py-0.5">
                {data.events.length}
              </span>
            </div>
            {data.events.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Nenhum alarme ou comando no período.
              </p>
            ) : (
              <ul className="divide-y divide-border max-h-80 overflow-y-auto">
                {data.events.map((e) => {
                  const ts = new Date(e.at).getTime();
                  const selected = selectedTs !== null && Math.abs(ts - selectedTs) < 1000;
                  return (
                    <li key={e.id}>
                      <button
                        onClick={() => {
                          // Destaca a marca do evento no gráfico e o traz à vista.
                          setSelectedTs(ts);
                          document.getElementById('timeline-chart')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                        }}
                        className={`w-full text-left px-4 py-2.5 flex items-start gap-2.5 text-sm transition-colors hover:bg-muted/40 ${
                          selected ? 'bg-cyan-50 dark:bg-cyan-950/30' : ''
                        }`}
                      >
                        <span className="mt-0.5 shrink-0">{eventIcon(e)}</span>
                        <div className="min-w-0 flex-1">
                          <p className="text-foreground break-words">{e.title}</p>
                          {e.detail && <p className="text-xs text-muted-foreground break-words">{e.detail}</p>}
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                          {fmtDateTime(e.at)}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
