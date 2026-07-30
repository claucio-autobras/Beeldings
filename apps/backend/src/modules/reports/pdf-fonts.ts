import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { jsPDF } from 'jspdf';

/**
 * Fonte Unicode embutida nos PDFs (Roboto Regular + Medium). A fonte padrão do
 * jsPDF (Helvetica/WinAnsi) corrompe acentos e caracteres especiais
 * ("Sýýntese", "Poÿýo") — o Roboto TTF resolve isso em TODOS os relatórios.
 *
 * Os .ttf vivem em src/modules/reports/assets/fonts e são copiados para o
 * build via `assets` do nest-cli. O carregamento tenta múltiplos caminhos para
 * funcionar tanto em dev (dist/src/...) quanto em produção.
 */

const FONT_FILES = {
  regular: 'Roboto-Regular.ttf',
  medium: 'Roboto-Medium.ttf',
} as const;

type FontVariant = keyof typeof FONT_FILES;

/** Diretórios candidatos onde os .ttf podem estar em runtime. */
function candidateDirs(): string[] {
  return [
    // Compilado: dist/src/modules/reports + assets copiados ao lado
    join(__dirname, 'assets', 'fonts'),
    // Compilado com assets copiados sem o prefixo src (nest assets)
    join(__dirname, '..', '..', '..', 'modules', 'reports', 'assets', 'fonts'),
    // Fonte original relativa ao cwd (apps/backend em dev, raiz em prod)
    join(process.cwd(), 'src', 'modules', 'reports', 'assets', 'fonts'),
    join(process.cwd(), 'apps', 'backend', 'src', 'modules', 'reports', 'assets', 'fonts'),
  ];
}

const fontCache = new Map<FontVariant, string>();

/** Lê o TTF e devolve o conteúdo em base64 (cacheado no processo). */
function loadFontBase64(variant: FontVariant): string {
  const cached = fontCache.get(variant);
  if (cached) return cached;
  const file = FONT_FILES[variant];
  for (const dir of candidateDirs()) {
    const full = join(dir, file);
    if (existsSync(full)) {
      const b64 = readFileSync(full).toString('base64');
      fontCache.set(variant, b64);
      return b64;
    }
  }
  throw new Error(
    `Fonte ${file} não encontrada para geração de PDF (procurado em: ${candidateDirs().join(', ')})`,
  );
}

/** Nome da família registrada no jsPDF. */
export const PDF_FONT = 'Roboto';

/**
 * Registra a família Roboto (normal + medium/bold) no documento jsPDF.
 * Deve ser chamada logo após criar o documento, antes de qualquer texto.
 */
export function registerPdfFonts(doc: jsPDF): void {
  const regular = loadFontBase64('regular');
  const medium = loadFontBase64('medium');
  doc.addFileToVFS('Roboto-Regular.ttf', regular);
  doc.addFont('Roboto-Regular.ttf', PDF_FONT, 'normal');
  doc.addFileToVFS('Roboto-Medium.ttf', medium);
  // Medium serve tanto como 'medium' quanto como 'bold' (destaques).
  doc.addFont('Roboto-Medium.ttf', PDF_FONT, 'medium');
  doc.addFont('Roboto-Medium.ttf', PDF_FONT, 'bold');
  doc.setFont(PDF_FONT, 'normal');
}
