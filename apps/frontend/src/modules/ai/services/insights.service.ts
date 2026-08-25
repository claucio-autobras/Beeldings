// Serviço do módulo de Insights de IA: configuração por cliente, listagem/
// detalhe dos insights persistidos, geração sob demanda (admin) e download do
// PDF (mesmo padrão de download dos relatórios — cookie de sessão HttpOnly).

import { apiGet, apiPost, apiPut } from '@/lib/api-client';

export type InsightFrequency = 'WEEKLY' | 'MONTHLY';
export type InsightPeriodPreset = 'last_week' | 'last_month' | 'current_week' | 'current_month';

export interface InsightConfig {
  tenantId: string;
  enabled: boolean;
  frequency: InsightFrequency;
}

export interface InsightSummary {
  id: string;
  tenantId: string;
  tenantName: string;
  frequency: InsightFrequency;
  trigger: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  theme: string | null;
  aiFailed: boolean;
  createdAt: string;
}

export interface InsightNarrative {
  theme: string;
  summary: string;
  highlights: string[];
  recommendations: string[];
}

export interface InsightFacts {
  tenantName: string;
  period: { from: string; to: string; label: string };
  hasData: boolean;
  alarms: {
    total: number;
    bySeverity: { high: number; medium: number; low: number };
    acknowledged: number;
    stillActive: number;
    topRules: Array<{ name: string; deviceName: string; severity: string; count: number }>;
    topDevices: Array<{ deviceName: string; siteName: string | null; count: number }>;
  };
  availability: {
    entityCount: number;
    withDataCount: number;
    avgUptimePct: number | null;
    totalDrops: number;
    totalOfflineMs: number;
    worst: Array<{ name: string; uptimePct: number }>;
    longestOffline: { name: string; ms: number } | null;
  };
  criticalAssets: {
    totalCritical: number;
    inFaultDuringPeriod: Array<{ deviceName: string; alarmCount: number; maxSeverity: string }>;
  };
}

export interface InsightDetail extends InsightSummary {
  summary: string | null;
  narrative: InsightNarrative | null;
  facts: InsightFacts;
}

export async function getInsightConfig(tenantId?: string): Promise<InsightConfig> {
  const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
  return apiGet(`/insights/config${qs}`);
}

export async function updateInsightConfig(dto: {
  tenantId?: string;
  enabled?: boolean;
  frequency?: InsightFrequency;
}): Promise<InsightConfig> {
  return apiPut('/insights/config', dto);
}

export async function getInsights(tenantId?: string): Promise<InsightSummary[]> {
  const qs = tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : '';
  return apiGet(`/insights${qs}`);
}

export async function getInsight(id: string): Promise<InsightDetail> {
  return apiGet(`/insights/${id}`);
}

export async function generateInsight(dto: {
  tenantId?: string;
  preset: InsightPeriodPreset;
}): Promise<InsightDetail> {
  return apiPost('/insights/generate', dto);
}

function apiBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
}

/** Baixa o PDF do insight respeitando o filename do Content-Disposition. */
export async function downloadInsightPdf(id: string): Promise<void> {
  const res = await fetch(`${apiBase()}/insights/${id}/pdf`, { credentials: 'include' });
  if (!res.ok) {
    let message = `Falha ao gerar PDF (HTTP ${res.status})`;
    try {
      const data = (await res.json()) as { message?: string };
      if (data?.message) message = data.message;
    } catch {
      /* resposta sem corpo JSON */
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? 'insight.pdf';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Texto completo do insight para o botão "Copiar" (mesma ordem do PDF). */
export function insightToPlainText(insight: InsightDetail): string {
  const f = insight.facts;
  const a = f.alarms;
  const av = f.availability;
  const lines: string[] = [
    `Insight do Período — ${insight.tenantName}`,
    insight.periodLabel,
    '',
  ];
  if (insight.narrative) {
    lines.push(insight.narrative.theme, '', insight.narrative.summary, '');
    if (insight.narrative.highlights.length > 0) {
      lines.push('Destaques:');
      for (const h of insight.narrative.highlights) lines.push(`- ${h}`);
      lines.push('');
    }
    if (insight.narrative.recommendations.length > 0) {
      lines.push('Recomendações:');
      for (const r of insight.narrative.recommendations) lines.push(`- ${r}`);
      lines.push('');
    }
  }
  lines.push('Números do período:');
  lines.push(
    `- Alarmes: ${a.total} (alta: ${a.bySeverity.high}, média: ${a.bySeverity.medium}, baixa: ${a.bySeverity.low}) — ${a.acknowledged} reconhecidos, ${a.stillActive} ainda ativos`,
  );
  if (av.avgUptimePct != null) {
    lines.push(`- Disponibilidade média: ${av.avgUptimePct}% (${av.totalDrops} quedas)`);
  } else {
    lines.push('- Disponibilidade: sem dados no período');
  }
  lines.push(
    `- Ativos críticos: ${f.criticalAssets.totalCritical} cadastrados, ${f.criticalAssets.inFaultDuringPeriod.length} com alarme no período`,
  );
  for (const d of a.topDevices) {
    lines.push(`- ${d.deviceName}${d.siteName ? ` (${d.siteName})` : ''}: ${d.count} alarmes`);
  }
  return lines.join('\n');
}
