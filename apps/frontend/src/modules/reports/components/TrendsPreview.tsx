'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getTrendDataBatch,
  type TrendBatchResponse,
} from '@/modules/trends/services/trends-api.service';
import { TrendsChart, type ChartSeries } from '@/modules/trends/components/TrendsChart';
import { trendType, buildColorMap } from '@/modules/trends/lib/trends-utils';

interface TrendsPreviewProps {
  /** Trends selecionadas no painel de geração. */
  ids: string[];
  /** Janela escolhida nos parâmetros (vazio = últimas 24h até agora). */
  from?: Date;
  to?: Date;
}

/**
 * Pré-visualização das trends selecionadas antes de exportar o relatório.
 * Reaproveita o mesmo gráfico (e contrato de dados) da aba Trends.
 */
export function TrendsPreview({ ids, from, to }: TrendsPreviewProps) {
  const idsKey = ids.join(',');

  // Mesma lógica de janela/bucket da aba Trends.
  const window = useMemo(() => {
    const end = to ?? new Date();
    const start = from ?? new Date(end.getTime() - 24 * 3600 * 1000);
    const spanH = (end.getTime() - start.getTime()) / 3_600_000;
    const bucket: 'minute' | 'hour' | 'day' = spanH > 24 * 14 ? 'day' : spanH > 48 ? 'hour' : 'minute';
    return { from: start, to: end, bucket };
  }, [from, to]);

  const { data: batch, isLoading } = useQuery<TrendBatchResponse>({
    queryKey: ['reports-trends-preview', idsKey, window.from.toISOString(), window.to.toISOString(), window.bucket],
    queryFn: () => getTrendDataBatch(ids, { from: window.from, to: window.to, bucket: window.bucket }),
    enabled: ids.length > 0,
  });

  const colorById = useMemo(() => buildColorMap(ids), [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const series = useMemo<ChartSeries[]>(() => {
    if (!batch) return [];
    const byId = new Map(batch.trends.map((s) => [s.trend.id, s]));
    return ids.flatMap((id) => {
      const s = byId.get(id);
      if (!s) return [];
      return [
        {
          id,
          name: s.trend.name,
          type: trendType(s.trend),
          unit: s.trend.point?.unit ?? '',
          color: colorById.get(id) ?? '#0e7490',
          points: s.chartPoints.map((p) => ({ t: p.t, value: p.value })),
        },
      ];
    });
  }, [batch, ids, colorById]);

  return (
    <div className="mt-5">
      <p className="mb-2 text-xs font-medium text-foreground">Pré-visualização</p>
      <TrendsChart series={series} isLoading={isLoading} />
    </div>
  );
}
