import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PDF_FONT, registerPdfFonts } from '../reports/pdf-fonts.js';
import {
  PDF_COLOR,
  drawCompactPdfHeader,
  drawFullPdfHeader,
  drawPdfFooters,
  pdfPageGeom,
  setText,
  type PdfHeaderMeta,
  type PdfPageGeom,
} from '../reports/pdf-style.js';
import { fmtDateTime } from '../reports/report-time.js';
import type { InsightFacts } from './insight-facts.service.js';
import type { InsightNarrative } from './insight-narrative.util.js';

// PDF do insight com o MESMO acabamento dos relatórios existentes (fontes
// Roboto, cabeçalho completo com KPIs na 1ª página, compacto nas demais,
// rodapé "Página X de N"), porém orientado a texto: resumo executivo,
// destaques, recomendações e o bloco factual em tabelas.

export interface InsightPdfInput {
  tenantName: string;
  periodLabel: string;
  facts: InsightFacts;
  narrative: InsightNarrative | null;
  aiFailed: boolean;
  createdAt: Date;
}

const SEVERITY_LABEL: Record<string, string> = { HIGH: 'Alta', MEDIUM: 'Média', LOW: 'Baixa' };

function fmtMs(ms: number): string {
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return h === 0 ? `${min} min` : `${h} h ${min} min`;
}

class TextCursor {
  y: number;
  constructor(
    private readonly doc: jsPDF,
    private readonly g: PdfPageGeom,
    private readonly headerMeta: PdfHeaderMeta,
    startY: number,
  ) {
    this.y = startY;
  }

  ensure(height: number): void {
    if (this.y + height <= this.g.bottomLimit) return;
    this.doc.addPage();
    this.y = drawCompactPdfHeader(this.doc, this.g, this.headerMeta) + 10;
  }

  sectionTitle(title: string): void {
    this.ensure(34);
    this.y += 12;
    this.doc.setFontSize(12);
    this.doc.setFont(PDF_FONT, 'medium');
    setText(this.doc, PDF_COLOR.title);
    this.doc.text(title, this.g.margin, this.y);
    this.y += 14;
  }

  paragraph(text: string, opts: { muted?: boolean; bullet?: boolean } = {}): void {
    this.doc.setFontSize(9.5);
    this.doc.setFont(PDF_FONT, 'normal');
    setText(this.doc, opts.muted ? PDF_COLOR.muted : PDF_COLOR.title);
    const indent = opts.bullet ? 12 : 0;
    const lines = this.doc.splitTextToSize(text, this.g.contentW - indent) as string[];
    const lineH = 13;
    for (let i = 0; i < lines.length; i++) {
      this.ensure(lineH);
      if (opts.bullet && i === 0) {
        this.doc.text('•', this.g.margin + 2, this.y);
      }
      this.doc.text(lines[i], this.g.margin + indent, this.y);
      this.y += lineH;
    }
    this.y += opts.bullet ? 2 : 6;
  }
}

export function buildInsightPdf(input: InsightPdfInput): Buffer {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  registerPdfFonts(doc);
  const g = pdfPageGeom('portrait');

  const facts = input.facts;
  const a = facts.alarms;
  const av = facts.availability;

  const headerMeta: PdfHeaderMeta = {
    title: 'Insight do Período',
    subtitle: `Cliente: ${input.tenantName} — ${input.periodLabel}`,
    compactRight: input.periodLabel,
    generatedAt: fmtDateTime(input.createdAt),
  };

  const startY = drawFullPdfHeader(doc, g, headerMeta, [
    { label: 'Alarmes no período', value: String(a.total), bg: PDF_COLOR.neutralBg, text: PDF_COLOR.title },
    { label: 'Alta severidade', value: String(a.bySeverity.high), bg: PDF_COLOR.highBg, text: PDF_COLOR.highText },
    {
      label: 'Disponibilidade média',
      value: av.avgUptimePct == null ? 'Sem dados' : `${av.avgUptimePct}%`,
      bg: PDF_COLOR.neutralBg,
      text: PDF_COLOR.title,
    },
    { label: 'Quedas', value: String(av.totalDrops), bg: PDF_COLOR.neutralBg, text: PDF_COLOR.title },
  ]);

  const cur = new TextCursor(doc, g, headerMeta, startY + 8);

  // ── Parte redacional (IA) ──
  if (input.narrative) {
    if (input.narrative.theme) {
      cur.sectionTitle(input.narrative.theme);
    } else {
      cur.sectionTitle('Resumo executivo');
    }
    cur.paragraph(input.narrative.summary);
    if (input.narrative.highlights.length > 0) {
      cur.sectionTitle('Destaques');
      for (const h of input.narrative.highlights) cur.paragraph(h, { bullet: true });
    }
    if (input.narrative.recommendations.length > 0) {
      cur.sectionTitle('Recomendações');
      for (const r of input.narrative.recommendations) cur.paragraph(r, { bullet: true });
    }
  } else {
    cur.sectionTitle('Resumo do período');
    cur.paragraph(
      'O texto executivo da IA não está disponível para este insight — os números abaixo refletem integralmente o período.',
      { muted: true },
    );
  }

  // ── Bloco factual ──
  cur.sectionTitle('Números do período');
  cur.paragraph(
    `Alarmes: ${a.total} (alta: ${a.bySeverity.high}, média: ${a.bySeverity.medium}, baixa: ${a.bySeverity.low}) — ${a.acknowledged} reconhecidos, ${a.stillActive} ainda ativos.`,
  );
  if (av.withDataCount > 0 && av.avgUptimePct != null) {
    cur.paragraph(
      `Disponibilidade média de ${av.avgUptimePct}% (${av.withDataCount} de ${av.entityCount} equipamentos com dados), ${av.totalDrops} quedas e ${fmtMs(av.totalOfflineMs)} de tempo offline acumulado.` +
        (av.longestOffline ? ` Maior queda contínua: ${av.longestOffline.name} (${fmtMs(av.longestOffline.ms)}).` : ''),
    );
  } else {
    cur.paragraph('Disponibilidade: sem dados de cobertura no período.', { muted: true });
  }
  cur.paragraph(
    `Ativos críticos cadastrados: ${facts.criticalAssets.totalCritical} — ${facts.criticalAssets.inFaultDuringPeriod.length} com alarme no período.`,
  );

  const tableStyle = {
    styles: { font: PDF_FONT, fontSize: 8.5, textColor: PDF_COLOR.title, cellPadding: 5 },
    // Roboto Medium está registrada também como 'bold' (mesmo truque do report-pdf).
    headStyles: { font: PDF_FONT, fontStyle: 'bold' as const, fillColor: PDF_COLOR.neutralBg, textColor: PDF_COLOR.title },
    margin: { left: g.margin, right: g.margin, bottom: g.footerH + g.margin },
    theme: 'plain' as const,
  };

  const drawTable = (title: string, head: string[], body: string[][]) => {
    if (body.length === 0) return;
    cur.ensure(60);
    cur.sectionTitle(title);
    autoTable(doc, {
      ...tableStyle,
      head: [head],
      body,
      startY: cur.y - 4,
      didDrawPage: () => undefined,
    });
    const lastY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY;
    if (typeof lastY === 'number') cur.y = lastY + 10;
  };

  drawTable(
    'Alarmes mais recorrentes',
    ['Alarme', 'Equipamento', 'Severidade', 'Ocorrências'],
    a.topRules.map((r) => [r.name, r.deviceName, SEVERITY_LABEL[r.severity] ?? r.severity, String(r.count)]),
  );
  drawTable(
    'Equipamentos com mais alarmes',
    ['Equipamento', 'Unidade', 'Alarmes'],
    a.topDevices.map((d) => [d.deviceName, d.siteName ?? '—', String(d.count)]),
  );
  drawTable(
    'Piores disponibilidades',
    ['Equipamento', 'Disponibilidade'],
    av.worst.map((w) => [w.name, `${w.uptimePct}%`]),
  );
  drawTable(
    'Ativos críticos com alarme',
    ['Ativo', 'Alarmes', 'Severidade máx.'],
    facts.criticalAssets.inFaultDuringPeriod.map((c) => [
      c.deviceName,
      String(c.alarmCount),
      SEVERITY_LABEL[c.maxSeverity] ?? c.maxSeverity,
    ]),
  );

  drawPdfFooters(doc, g, 'Insight do Período — Beeldings');
  return Buffer.from(doc.output('arraybuffer'));
}
