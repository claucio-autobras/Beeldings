import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { PDF_FONT, registerPdfFonts } from './pdf-fonts.js';
import {
  PDF_COLOR,
  drawCompactPdfHeader,
  drawFullPdfHeader,
  drawPdfFooters,
  pdfPageGeom,
  setText,
  type PdfHeaderMeta,
} from './pdf-style.js';
import { fmtDateTime } from './report-time.js';

/**
 * PDF genérico de relatório tabular (Trends e Auditoria) no MESMO visual do
 * PDF de Alarmes: cabeçalho completo com cards de resumo na 1ª página,
 * cabeçalho compacto nas demais, rodapé "Página X de N" e tabela em tons
 * neutros/slate (sem o tema ciano antigo).
 */

export interface PdfMeta {
  title: string;
  /** Linha de contexto sob o título (filtros/período). */
  subtitle: string;
  /** Texto à direita do cabeçalho compacto (ex.: período). */
  compactRight: string;
  /** Cards de resumo (KPIs) no topo da 1ª página, em estilo neutro. */
  kpis: { label: string; value: string }[];
}

export interface PdfTable {
  head: string[];
  body: string[][];
  /** Nota exibida abaixo da tabela (ex.: truncamento). */
  note?: string;
}

function fmtNow(): string {
  return fmtDateTime(new Date());
}

/**
 * Gera um PDF de relatório tabular com o visual compartilhado.
 * Retorna um Buffer pronto para enviar pela resposta HTTP.
 */
export function buildReportPdf(meta: PdfMeta, table: PdfTable, orientation: 'portrait' | 'landscape' = 'landscape'): Buffer {
  const doc = new jsPDF({ orientation, unit: 'pt', format: 'a4' });
  registerPdfFonts(doc);
  const g = pdfPageGeom(orientation);

  const headerMeta: PdfHeaderMeta = {
    title: meta.title,
    subtitle: meta.subtitle,
    compactRight: meta.compactRight,
    generatedAt: fmtNow(),
  };

  const startY = drawFullPdfHeader(
    doc,
    g,
    headerMeta,
    meta.kpis.map((k) => ({ ...k, bg: PDF_COLOR.neutralBg, text: PDF_COLOR.neutralText })),
  );

  // Altura reservada para o cabeçalho compacto nas páginas seguintes
  // (12pt de título + hairline + 12pt de respiro, a partir da margem).
  const compactHeaderH = 24;

  autoTable(doc, {
    startY,
    head: [table.head],
    body: table.body,
    theme: 'plain',
    rowPageBreak: 'avoid',
    margin: { left: g.margin, right: g.margin, top: g.margin + compactHeaderH, bottom: g.margin + g.footerH },
    headStyles: {
      fillColor: PDF_COLOR.neutralBg,
      textColor: PDF_COLOR.title,
      font: PDF_FONT,
      fontStyle: 'bold', // Roboto Medium está registrada também como 'bold'
      fontSize: 8,
      cellPadding: 5,
    },
    styles: {
      font: PDF_FONT,
      fontSize: 8,
      cellPadding: 4,
      textColor: PDF_COLOR.title,
      lineColor: PDF_COLOR.hairline,
      lineWidth: { bottom: 0.5 },
    },
    alternateRowStyles: { fillColor: PDF_COLOR.zebra },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) drawCompactPdfHeader(doc, g, headerMeta);
    },
  });

  if (table.note) {
    // @ts-expect-error lastAutoTable é injetado pelo plugin
    const finalY = (doc.lastAutoTable?.finalY ?? startY) as number;
    let ny = finalY + 14;
    if (ny > g.bottomLimit) {
      doc.addPage();
      ny = drawCompactPdfHeader(doc, g, headerMeta) + 6;
    }
    doc.setFontSize(8);
    doc.setFont(PDF_FONT, 'normal');
    setText(doc, PDF_COLOR.muted);
    doc.text(table.note, g.margin, ny);
  }

  drawPdfFooters(doc, g, meta.title);

  const arrayBuffer = doc.output('arraybuffer') as ArrayBuffer;
  return Buffer.from(arrayBuffer);
}
