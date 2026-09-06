'use client';

import { useEffect, useMemo, useState } from 'react';
import { getTrends, getTrendDataBatch, type TrendItem } from '@/modules/trends/services/trends-api.service';

/**
 * Histórico curto por ponto (deviceId+tag) para sparklines e gráficos do SCADA.
 * Resolve a trend do ponto via GET /trends?deviceId= (cache por device) e busca
 * as séries agregadas via POST /trends/data/batch. Ponto sem trend configurada
 * = série null → o widget mostra "sem dados" (nunca 0 fake).
 */

export interface PointRef { deviceId: string; tag: string }

export interface PointSeries {
  /** `${deviceId}|${tag}` */
  key: string;
  unit: string | null;
  points: { t: number; value: number }[];
}

export function pointKey(p: PointRef): string { return `${p.deviceId}|${p.tag}`; }

// Cache de trends por device (60s) — evita refazer o lookup a cada widget/poll.
const trendCache = new Map<string, { at: number; trends: TrendItem[] }>();
const TREND_CACHE_MS = 60_000;

async function trendsForDevice(deviceId: string): Promise<TrendItem[]> {
  const hit = trendCache.get(deviceId);
  if (hit && Date.now() - hit.at < TREND_CACHE_MS) return hit.trends;
  const trends = await getTrends({ deviceId });
  trendCache.set(deviceId, { at: Date.now(), trends });
  return trends;
}

const POLL_MS = 60_000;

/**
 * @param refs pontos (deviceId+tag); entradas sem deviceId/tag são ignoradas.
 * @param periodHours janela de histórico.
 * @param enabled false = não busca nada (ex.: render estático do editor).
 */
export function usePointHistory(refs: PointRef[], periodHours: number, enabled: boolean): {
  series: Record<string, PointSeries | null>;
  loading: boolean;
} {
  const [series, setSeries] = useState<Record<string, PointSeries | null>>({});
  const [loading, setLoading] = useState(false);
  // Chave estável — evita refetch por identidade de array; o efeito reconstrói
  // os refs a partir da chave (sem ler props via ref durante o render).
  const refsKey = useMemo(
    () => refs.filter((r) => r.deviceId && r.tag).map(pointKey).sort().join(','),
    [refs],
  );

  useEffect(() => {
    if (!enabled || !refsKey) return;
    let alive = true;
    const valid: PointRef[] = refsKey.split(',').map((k) => {
      const i = k.indexOf('|');
      return { deviceId: k.slice(0, i), tag: k.slice(i + 1) };
    });

    async function fetchAll() {
      try {
        setLoading(true);
        // 1) resolve trendId por ponto
        const deviceIds = Array.from(new Set(valid.map((r) => r.deviceId)));
        const byDevice = new Map<string, TrendItem[]>();
        await Promise.all(deviceIds.map(async (id) => {
          try { byDevice.set(id, await trendsForDevice(id)); } catch { byDevice.set(id, []); }
        }));
        const trendByKey = new Map<string, TrendItem>();
        for (const r of valid) {
          const t = (byDevice.get(r.deviceId) ?? []).find((tr) => tr.point?.tag === r.tag && tr.enabled !== false)
            ?? (byDevice.get(r.deviceId) ?? []).find((tr) => tr.point?.tag === r.tag);
          if (t) trendByKey.set(pointKey(r), t);
        }
        const ids = Array.from(new Set(Array.from(trendByKey.values()).map((t) => t.id)));
        // 2) séries agregadas em lote (rollup horário acima de 3 dias)
        const data: Record<string, PointSeries | null> = {};
        if (ids.length > 0) {
          const from = new Date(Date.now() - periodHours * 3600_000);
          const bucket = periodHours <= 6 ? 'minute' : 'hour';
          const res = await getTrendDataBatch(ids, { from, bucket });
          const byTrendId = new Map(res.trends.map((s) => [s.trend.id, s]));
          for (const [key, trend] of trendByKey) {
            const s = byTrendId.get(trend.id);
            data[key] = s && s.chartPoints.length > 0
              ? { key, unit: trend.point?.unit ?? null, points: s.chartPoints.map((p) => ({ t: new Date(p.t).getTime(), value: p.value })) }
              : null;
          }
        }
        for (const r of valid) { const k = pointKey(r); if (!(k in data)) data[k] = null; }
        if (alive) setSeries(data);
      } catch {
        // Falha de rede: mantém o que tinha (ou "sem dados"); nunca inventa valor.
        if (alive) setSeries((prev) => (Object.keys(prev).length ? prev : {}));
      } finally {
        if (alive) setLoading(false);
      }
    }

    void fetchAll();
    const timer = setInterval(fetchAll, POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [refsKey, periodHours, enabled]);

  // Desabilitado/sem refs válidos: sempre vazio (estado interno antigo é mascarado).
  return { series: enabled && refsKey ? series : EMPTY_SERIES, loading };
}

const EMPTY_SERIES: Record<string, PointSeries | null> = {};
