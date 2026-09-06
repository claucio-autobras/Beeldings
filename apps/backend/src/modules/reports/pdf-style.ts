import { jsPDF } from 'jspdf';
import { PDF_FONT } from './pdf-fonts.js';

/**
 * Visual compartilhado dos PDFs de relatório (paleta, cabeçalhos, KPIs e
 * rodapé), extraído do layout aprovado do Relatório de Alarmes. Os três
 * relatórios (Alarmes, Trends, Auditoria) usam estes utilitários para manter
 * a mesma identidade visual.
 */

export type Rgb = [number, number, number];

/** Paleta (tokens do mockup aprovado). */
export const PDF_COLOR = {
  title: [15, 23, 42] as Rgb, // ~#0F172A
  muted: [100, 116, 139] as Rgb, // ~#64748B
  hairline: [226, 232, 240] as Rgb, // ~#E2E8F0
  highBg: [252, 235, 235] as Rgb, // ~#FCEBEB
  highText: [163, 45, 45] as Rgb, // ~#A32D2D
  highBar: [226, 75, 74] as Rgb, // ~#E24B4A
  mediumBg: [250, 238, 218] as Rgb, // ~#FAEEDA
  mediumText: [133, 79, 11] as Rgb, // ~#854F0B
  mediumBar: [239, 159, 39] as Rgb, // ~#EF9F27
  neutralBg: [241, 239, 232] as Rgb, // ~#F1EFE8
  neutralText: [95, 94, 90] as Rgb, // ~#5F5E5A
  zebra: [248, 250, 252] as Rgb, // ~#F8FAFC
  white: [255, 255, 255] as Rgb,
} as const;

export function setFill(doc: jsPDF, c: Rgb): void {
  doc.setFillColor(c[0], c[1], c[2]);
}
export function setText(doc: jsPDF, c: Rgb): void {
  doc.setTextColor(c[0], c[1], c[2]);
}
export function setDraw(doc: jsPDF, c: Rgb): void {
  doc.setDrawColor(c[0], c[1], c[2]);
}

/** Geometria da página (A4, margens e limite inferior por causa do rodapé). */
export interface PdfPageGeom {
  pageW: number;
  pageH: number;
  margin: number;
  contentW: number;
  footerH: number;
  bottomLimit: number;
}

const A4_PORTRAIT = { w: 595.28, h: 841.89 };
export const PDF_MARGIN = 40;
export const PDF_FOOTER_H = 28;

export function pdfPageGeom(orientation: 'portrait' | 'landscape'): PdfPageGeom {
  const pageW = orientation === 'portrait' ? A4_PORTRAIT.w : A4_PORTRAIT.h;
  const pageH = orientation === 'portrait' ? A4_PORTRAIT.h : A4_PORTRAIT.w;
  return {
    pageW,
    pageH,
    margin: PDF_MARGIN,
    contentW: pageW - PDF_MARGIN * 2,
    footerH: PDF_FOOTER_H,
    bottomLimit: pageH - PDF_MARGIN - PDF_FOOTER_H,
  };
}

/** Metadados exibidos nos cabeçalhos. */
export interface PdfHeaderMeta {
  title: string;
  /** Linha de contexto sob o título (filtros/período). Pode quebrar em linhas. */
  subtitle: string;
  /** Texto exibido à direita no cabeçalho compacto (ex.: período). */
  compactRight: string;
  generatedAt: string;
}

/** Cartão de resumo (KPI) no topo da primeira página. */
export interface PdfKpi {
  label: string;
  value: string;
  bg: Rgb;
  text: Rgb;
}

/**
 * Cabeçalho completo (primeira página): título, "Gerado em", linha de
 * contexto e cartões de KPI. Devolve o Y após o cabeçalho.
 */
export function drawFullPdfHeader(doc: jsPDF, g: PdfPageGeom, meta: PdfHeaderMeta, kpis: PdfKpi[]): number {
  let y = g.margin + 6;

  doc.setFontSize(22);
  doc.setFont(PDF_FONT, 'medium');
  setText(doc, PDF_COLOR.title);
  doc.text(meta.title, g.margin, y + 8);

  // "Gerado em" à direita.
  doc.setFontSize(8.5);
  doc.setFont(PDF_FONT, 'normal');
  setText(doc, PDF_COLOR.muted);
  const gen = `Gerado em ${meta.generatedAt}`;
  doc.text(gen, g.pageW - g.margin - doc.getTextWidth(gen), y + 8);

  y += 24;
  doc.setFontSize(10);
  setText(doc, PDF_COLOR.muted);
  const subtitleLines = doc.splitTextToSize(meta.subtitle, g.contentW) as string[];
  subtitleLines.forEach((line, i) => {
    doc.text(line, g.margin, y + i * 13);
  });
  y += 18 + Math.max(0, subtitleLines.length - 1) * 13;

  if (kpis.length > 0) {
    const kpiGap = 10;
    const kpiW = (g.contentW - kpiGap * (kpis.length - 1)) / kpis.length;
    const kpiH = 58;
    kpis.forEach((kpi, i) => {
      const x = g.margin + i * (kpiW + kpiGap);
      setFill(doc, kpi.bg);
      doc.roundedRect(x, y, kpiW, kpiH, 4, 4, 'F');
      doc.setFontSize(8);
      doc.setFont(PDF_FONT, 'normal');
      setText(doc, kpi.text);
      doc.text(kpi.label, x + 12, y + 18);
      doc.setFontSize(24);
      doc.setFont(PDF_FONT, 'medium');
      doc.text(kpi.value, x + 12, y + 45);
    });
    y += kpiH + 18;
  }

  return y;
}

/** Cabeçalho compacto (páginas seguintes). Devolve o Y após o cabeçalho. */
export function drawCompactPdfHeader(doc: jsPDF, g: PdfPageGeom, meta: PdfHeaderMeta): number {
  let y = g.margin;
  doc.setFontSize(11);
  doc.setFont(PDF_FONT, 'medium');
  setText(doc, PDF_COLOR.title);
  doc.text(meta.title, g.margin, y + 4);
  doc.setFontSize(8);
  doc.setFont(PDF_FONT, 'normal');
  setText(doc, PDF_COLOR.muted);
  const right = meta.compactRight;
  doc.text(right, g.pageW - g.margin - doc.getTextWidth(right), y + 4);
  y += 12;
  setDraw(doc, PDF_COLOR.hairline);
  doc.setLineWidth(0.5);
  doc.line(g.margin, y, g.pageW - g.margin, y);
  return y + 12;
}

/** Rodapé em todas as páginas ("Página X de N" — 2ª passada, após saber N). */
export function drawPdfFooters(doc: jsPDF, g: PdfPageGeom, title: string): void {
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p++) {
    doc.setPage(p);
    const y = g.pageH - g.margin + 10;
    doc.setFontSize(8);
    doc.setFont(PDF_FONT, 'normal');
    setText(doc, PDF_COLOR.muted);
    doc.text(`Beeldings · ${title}`, g.margin, y);
    const page = `Página ${p} de ${total}`;
    doc.text(page, g.pageW - g.margin - doc.getTextWidth(page), y);
  }
}
