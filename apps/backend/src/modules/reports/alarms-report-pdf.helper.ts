import { jsPDF } from 'jspdf';
import { PDF_FONT, registerPdfFonts } from './pdf-fonts.js';
import {
  PDF_COLOR,
  drawCompactPdfHeader,
  drawFullPdfHeader,
  drawPdfFooters,
  pdfPageGeom,
  setDraw,
  setFill,
  setText,
  type PdfHeaderMeta,
  type Rgb,
} from './pdf-style.js';

/**
 * PDF do Relatório de Alarmes em layout de CARTÕES (um cartão por ocorrência),
 * portrait A4, com paginação MANUAL (cartão nunca quebra no meio da página),
 * rodapé "Página X de N" em todas as páginas e cabeçalho compacto a partir da
 * segunda página. Trends e auditoria usam buildReportPdf(), que compartilha o
 * mesmo visual via pdf-style.ts.
 */

export type AlarmsPdfSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

export interface AlarmsPdfOccurrence {
  severity: AlarmsPdfSeverity;
  severityLabel: string;
  stateLabel: string;
  device: string;
  point: string;
  message: string;
  value: string;
  activatedAt: string;
  normalizedAt: string;
  /** Quantas vezes a ocorrência reativou antes do ACK (0 = nunca). */
  reactivationCount: number;
  /** Horário formatado da última reativação ('' quando não houve). */
  lastReactivatedAt: string;
  acknowledgedAt: string;
  acknowledgedBy: string;
  ackNote: string;
}

export interface AlarmsPdfMeta {
  title: string;
  /** Rótulo do filtro "Conteúdo" (ex.: "Histórico completo"). */
  contentLabel: string;
  /** Rótulo do período (ex.: "02/06/2026 10:00 até 07/07/2026 18:00"). */
  periodLabel: string;
  generatedAt: string;
}

export interface AlarmsPdfSummary {
  total: number;
  high: number;
  medium: number;
  low: number;
}

/** Paleta compartilhada (extraída para pdf-style.ts). */
const COLOR = PDF_COLOR;

interface SeverityTheme {
  bg: Rgb;
  text: Rgb;
  bar: Rgb;
}

const SEVERITY_THEME: Record<AlarmsPdfSeverity, SeverityTheme> = {
  HIGH: { bg: COLOR.highBg, text: COLOR.highText, bar: COLOR.highBar },
  MEDIUM: { bg: COLOR.mediumBg, text: COLOR.mediumText, bar: COLOR.mediumBar },
  LOW: { bg: COLOR.neutralBg, text: COLOR.neutralText, bar: COLOR.neutralText },
};

// ─── Dimensões (pt) — geometria compartilhada (A4 portrait) ──────────────────
const GEOM = pdfPageGeom('portrait');
const PAGE_W = GEOM.pageW;
const MARGIN = GEOM.margin;
const CONTENT_W = GEOM.contentW;
const BOTTOM_LIMIT = GEOM.bottomLimit;

const CARD_PAD = 10;
const CARD_BAR_W = 3;
const CARD_GAP = 10;
/** Largura da coluna direita (datas Ativado/Normalizado). */
const RIGHT_COL_W = 130;
const PILL_H = 14;
const PILL_FONT = 7.5;
const LINE_GAP = 4;

/** Desenha uma pill (fundo claro + texto na cor escura da mesma família). */
function drawPill(doc: jsPDF, x: number, y: number, label: string, theme: { bg: Rgb; text: Rgb }): number {
  doc.setFontSize(PILL_FONT);
  doc.setFont(PDF_FONT, 'medium');
  const textW = doc.getTextWidth(label);
  const w = textW + 12;
  setFill(doc, theme.bg);
  doc.roundedRect(x, y, w, PILL_H, PILL_H / 2, PILL_H / 2, 'F');
  setText(doc, theme.text);
  doc.text(label, x + 6, y + PILL_H / 2 + PILL_FONT / 2 - 1);
  return w;
}

/** Layout calculado de um cartão (altura depende das quebras de linha). */
interface CardLayout {
  height: number;
  context: string;
  messageLines: string[];
  reactivationLine: string | null;
  ackLine: string | null;
  noteLines: string[];
}

function layoutCard(doc: jsPDF, occ: AlarmsPdfOccurrence): CardLayout {
  const leftW = CONTENT_W - CARD_BAR_W - CARD_PAD * 2 - RIGHT_COL_W - 8;

  const context = `${occ.device} · ${occ.point}${occ.value !== '—' ? ` · ${occ.value}` : ''}`;

  doc.setFontSize(9.5);
  doc.setFont(PDF_FONT, 'medium');
  const messageLines = doc.splitTextToSize(occ.message || '—', leftW) as string[];

  const reactivationLine =
    occ.reactivationCount > 0
      ? `Reativado ${occ.reactivationCount}x${occ.lastReactivatedAt ? ` · última em ${occ.lastReactivatedAt}` : ''}`
      : null;

  const ackLine = occ.acknowledgedBy
    ? `Reconhecido por ${occ.acknowledgedBy}${occ.acknowledgedAt ? ` em ${occ.acknowledgedAt}` : ''}`
    : null;

  doc.setFontSize(8);
  doc.setFont(PDF_FONT, 'normal');
  const noteLines = occ.ackNote ? (doc.splitTextToSize(`Motivo: ${occ.ackNote}`, leftW) as string[]) : [];

  // Altura: pills + mensagem + linhas extras, respeitando o mínimo da coluna direita.
  let leftH = CARD_PAD + PILL_H + 6;
  leftH += messageLines.length * 12 + LINE_GAP;
  if (reactivationLine) leftH += 11;
  if (ackLine) leftH += 11;
  if (noteLines.length > 0) leftH += noteLines.length * 10;
  leftH += CARD_PAD;

  // Coluna direita: dois blocos rótulo+valor (Ativado / Normalizado).
  const rightH = CARD_PAD + 2 * (9 + 11) + 6 + CARD_PAD;

  return { height: Math.max(leftH, rightH), context, messageLines, reactivationLine, ackLine, noteLines };
}

function drawCard(doc: jsPDF, y: number, occ: AlarmsPdfOccurrence, layout: CardLayout): void {
  const theme = SEVERITY_THEME[occ.severity];
  const h = layout.height;

  // Borda hairline + barra lateral de severidade.
  setDraw(doc, COLOR.hairline);
  doc.setLineWidth(0.5);
  setFill(doc, COLOR.white);
  doc.roundedRect(MARGIN, y, CONTENT_W, h, 3, 3, 'FD');
  setFill(doc, theme.bar);
  doc.rect(MARGIN, y + 2, CARD_BAR_W, h - 4, 'F');

  const xLeft = MARGIN + CARD_BAR_W + CARD_PAD;
  let cy = y + CARD_PAD;

  // Linha superior: pills + contexto "equipamento · ponto".
  let px = xLeft;
  px += drawPill(doc, px, cy, occ.severityLabel, theme) + 5;
  const stateTheme = occ.stateLabel.startsWith('Ativo')
    ? theme
    : { bg: COLOR.neutralBg, text: COLOR.neutralText };
  px += drawPill(doc, px, cy, occ.stateLabel, stateTheme) + 8;

  // Contexto "equipamento · ponto" ao lado das pills (trunca no espaço restante).
  doc.setFontSize(8);
  doc.setFont(PDF_FONT, 'normal');
  setText(doc, COLOR.muted);
  const contextMaxW = MARGIN + CARD_BAR_W + CONTENT_W - RIGHT_COL_W - 8 - px;
  if (contextMaxW > 30) {
    const line = (doc.splitTextToSize(layout.context, contextMaxW) as string[])[0] ?? '';
    doc.text(line, px, cy + PILL_H / 2 + 2.5);
  }
  cy += PILL_H + 6;

  // Mensagem em destaque.
  doc.setFontSize(9.5);
  doc.setFont(PDF_FONT, 'medium');
  setText(doc, COLOR.title);
  for (const line of layout.messageLines) {
    doc.text(line, xLeft, cy + 8);
    cy += 12;
  }
  cy += LINE_GAP;

  // Reativações antes do ACK (opcional) — destaca oscilação do alarme.
  if (layout.reactivationLine) {
    doc.setFontSize(8);
    doc.setFont(PDF_FONT, 'medium');
    setText(doc, COLOR.mediumText);
    doc.text(layout.reactivationLine, xLeft, cy + 6);
    cy += 11;
  }

  // Reconhecido por (opcional).
  if (layout.ackLine) {
    doc.setFontSize(8);
    doc.setFont(PDF_FONT, 'normal');
    setText(doc, COLOR.muted);
    doc.text(layout.ackLine, xLeft, cy + 6);
    cy += 11;
  }

  // Motivo/nota do reconhecimento (opcional).
  if (layout.noteLines.length > 0) {
    doc.setFontSize(8);
    doc.setFont(PDF_FONT, 'normal');
    setText(doc, COLOR.muted);
    for (const line of layout.noteLines) {
      doc.text(line, xLeft, cy + 6);
      cy += 10;
    }
  }

  // Coluna direita: Ativado / Normalizado.
  const xRight = MARGIN + CONTENT_W - RIGHT_COL_W - CARD_PAD + 8;
  let ry = y + CARD_PAD;
  const rightBlocks: Array<{ label: string; value: string }> = [
    { label: 'Ativado', value: occ.activatedAt || '—' },
    { label: 'Normalizado', value: occ.normalizedAt || '—' },
  ];
  for (const block of rightBlocks) {
    doc.setFontSize(7);
    doc.setFont(PDF_FONT, 'normal');
    setText(doc, COLOR.muted);
    doc.text(block.label.toUpperCase(), xRight, ry + 7);
    doc.setFontSize(8.5);
    doc.setFont(PDF_FONT, 'medium');
    setText(doc, COLOR.title);
    doc.text(block.value, xRight, ry + 18);
    ry += 26;
  }
}

/** Converte os metadados de alarmes para o contrato do cabeçalho compartilhado. */
function headerMeta(meta: AlarmsPdfMeta): PdfHeaderMeta {
  return {
    title: meta.title,
    subtitle: `${meta.contentLabel} · ${meta.periodLabel}`,
    compactRight: meta.periodLabel,
    generatedAt: meta.generatedAt,
  };
}

/** Cabeçalho completo (primeira página). Devolve o Y após o cabeçalho. */
function drawFullHeader(doc: jsPDF, meta: AlarmsPdfMeta, summary: AlarmsPdfSummary): number {
  return drawFullPdfHeader(doc, GEOM, headerMeta(meta), [
    { label: 'Total de ocorrências', value: String(summary.total), bg: COLOR.neutralBg, text: COLOR.neutralText },
    { label: 'Severidade alta', value: String(summary.high), bg: COLOR.highBg, text: COLOR.highText },
    { label: 'Severidade média', value: String(summary.medium), bg: COLOR.mediumBg, text: COLOR.mediumText },
  ]);
}

/** Cabeçalho compacto (páginas seguintes). Devolve o Y após o cabeçalho. */
function drawCompactHeader(doc: jsPDF, meta: AlarmsPdfMeta): number {
  return drawCompactPdfHeader(doc, GEOM, headerMeta(meta));
}

export interface AlarmsPdfInput {
  meta: AlarmsPdfMeta;
  summary: AlarmsPdfSummary;
  occurrences: AlarmsPdfOccurrence[];
  /** Nota de truncamento (MAX_PDF_ROWS), exibida após o último cartão. */
  truncationNote?: string;
}

/** Gera o PDF de alarmes em layout de cartões. */
export function buildAlarmsReportPdf(input: AlarmsPdfInput): Buffer {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  registerPdfFonts(doc);

  let y = drawFullHeader(doc, input.meta, input.summary);

  if (input.occurrences.length === 0) {
    doc.setFontSize(10);
    doc.setFont(PDF_FONT, 'normal');
    setText(doc, COLOR.muted);
    doc.text('Nenhuma ocorrência de alarme no período/escopo selecionado.', MARGIN, y + 10);
  }

  for (const occ of input.occurrences) {
    const layout = layoutCard(doc, occ);
    if (y + layout.height > BOTTOM_LIMIT) {
      doc.addPage();
      y = drawCompactHeader(doc, input.meta);
    }
    drawCard(doc, y, occ, layout);
    y += layout.height + CARD_GAP;
  }

  if (input.truncationNote) {
    if (y + 16 > BOTTOM_LIMIT) {
      doc.addPage();
      y = drawCompactHeader(doc, input.meta);
    }
    doc.setFontSize(8);
    doc.setFont(PDF_FONT, 'normal');
    setText(doc, COLOR.muted);
    doc.text(input.truncationNote, MARGIN, y + 6);
  }

  drawPdfFooters(doc, GEOM, input.meta.title);

  const arrayBuffer = doc.output('arraybuffer') as ArrayBuffer;
  return Buffer.from(arrayBuffer);
}
