// Prompt e parse da parte redacional do insight. A IA escreve APENAS a partir
// do payload factual (InsightFacts) — números fora dele são proibidos — e
// responde JSON estrito. Falha de parse conta como falha da IA (o insight é
// salvo só com a parte factual, nunca dá erro).

import type { InsightFacts } from './insight-facts.service.js';

export interface InsightNarrative {
  /** Tema curto do período (contrato do evento beeldings_insight). */
  theme: string;
  /** Resumo executivo (2–4 frases). */
  summary: string;
  highlights: string[];
  recommendations: string[];
}

export const INSIGHT_SYSTEM_PROMPT = `Você é o analista de operações da Beeldings, plataforma de monitoramento predial (BMS, CFTV, incêndio e controle de acesso). Sua tarefa é redigir um resumo executivo periódico para envio ao cliente final.

REGRAS OBRIGATÓRIAS:
- Escreva em português do Brasil, tom executivo, cordial e profissional — o texto será lido pelo cliente da Beeldings, não por um técnico interno.
- Fundamente TUDO exclusivamente nos números do payload factual fornecido. É PROIBIDO inventar números, percentuais, nomes de equipamentos, causas ou eventos que não estejam no payload.
- Se um dado não estiver no payload (ex.: disponibilidade sem cobertura), diga que não houve dados no período — nunca estime.
- Recomendações devem ser práticas, preventivas e não destrutivas (ex.: inspeção, manutenção preventiva, revisão de conectividade). Nunca recomende desligar, apagar ou reconfigurar nada crítico.
- Não use markdown, emojis ou listas numeradas dentro dos textos.

FORMATO DA RESPOSTA — responda APENAS com um JSON válido, sem texto antes ou depois, no formato:
{"theme":"tema curto do período (máx. 80 caracteres)","summary":"resumo executivo em 2 a 4 frases","highlights":["destaque 1","destaque 2"],"recommendations":["recomendação 1"]}
- "highlights": 2 a 5 itens, cada um uma frase curta com o fato mais relevante.
- "recommendations": 1 a 4 itens.`;

function fmtMs(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  if (h === 0) return `${min} min`;
  return `${h} h ${min} min`;
}

/** Bloco factual em texto legível + JSON — o único material que a IA pode usar. */
export function buildInsightUserPrompt(facts: InsightFacts): string {
  const a = facts.alarms;
  const av = facts.availability;
  const lines: string[] = [
    `Cliente: ${facts.tenantName}`,
    `Período: ${facts.period.label}`,
    '',
    `Alarmes no período: ${a.total} (alta: ${a.bySeverity.high}, média: ${a.bySeverity.medium}, baixa: ${a.bySeverity.low})`,
    `Alarmes reconhecidos pela operação: ${a.acknowledged} | Ainda ativos agora: ${a.stillActive}`,
  ];
  if (a.topRules.length > 0) {
    lines.push('Alarmes mais recorrentes:');
    for (const r of a.topRules) lines.push(`- ${r.name} (${r.deviceName}, severidade ${r.severity}): ${r.count}x`);
  }
  if (a.topDevices.length > 0) {
    lines.push('Equipamentos com mais alarmes:');
    for (const d of a.topDevices) lines.push(`- ${d.deviceName}${d.siteName ? ` (${d.siteName})` : ''}: ${d.count} alarmes`);
  }
  lines.push('');
  if (av.withDataCount > 0 && av.avgUptimePct != null) {
    lines.push(
      `Disponibilidade: média de ${av.avgUptimePct}% em ${av.withDataCount} de ${av.entityCount} equipamentos com dados; ${av.totalDrops} quedas; tempo total offline ${fmtMs(av.totalOfflineMs)}.`,
    );
    if (av.worst.length > 0) {
      lines.push('Piores disponibilidades:');
      for (const w of av.worst) lines.push(`- ${w.name}: ${w.uptimePct}%`);
    }
    if (av.longestOffline) {
      lines.push(`Maior queda contínua: ${av.longestOffline.name} (${fmtMs(av.longestOffline.ms)}).`);
    }
  } else {
    lines.push('Disponibilidade: sem dados de cobertura no período.');
  }
  lines.push('');
  lines.push(`Ativos críticos cadastrados: ${facts.criticalAssets.totalCritical}`);
  if (facts.criticalAssets.inFaultDuringPeriod.length > 0) {
    lines.push('Ativos críticos com alarme no período:');
    for (const c of facts.criticalAssets.inFaultDuringPeriod) {
      lines.push(`- ${c.deviceName}: ${c.alarmCount} alarmes (severidade máx. ${c.maxSeverity})`);
    }
  } else {
    lines.push('Nenhum ativo crítico teve alarme no período.');
  }
  lines.push('');
  lines.push('Payload factual (JSON, fonte única de verdade):');
  lines.push(JSON.stringify(facts));
  return lines.join('\n');
}

function cleanList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim())
    .slice(0, max);
}

/** Parse tolerante (remove cercas de código); null = falha da IA. */
export function parseInsightNarrative(raw: string): InsightNarrative | null {
  let text = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fenced) text = fenced[1].trim();
  // Alguns modelos prefixam texto — recorta do primeiro '{' ao último '}'.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const theme = typeof parsed.theme === 'string' ? parsed.theme.trim().slice(0, 120) : '';
    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    if (!theme || !summary) return null;
    return {
      theme,
      summary,
      highlights: cleanList(parsed.highlights, 5),
      recommendations: cleanList(parsed.recommendations, 4),
    };
  } catch {
    return null;
  }
}
