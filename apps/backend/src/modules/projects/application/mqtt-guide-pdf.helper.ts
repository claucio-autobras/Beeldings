import { jsPDF } from 'jspdf';
import { registerPdfFonts, PDF_FONT } from '../../reports/pdf-fonts.js';
import {
  PDF_COLOR,
  pdfPageGeom,
  setDraw,
  setFill,
  setText,
  drawPdfFooters,
  drawCompactPdfHeader,
  type PdfPageGeom,
} from '../../reports/pdf-style.js';
import { fmtDateTime } from '../../reports/report-time.js';

/**
 * Guia de Integração MQTT — PDF por gateway.
 *
 * Documento levado a campo pelo integrador: vem preenchido com os valores
 * reais do gateway (broker, credencial de sensores, prefixo de tópicos) e
 * documenta o contrato completo de tópicos/payloads que o modal "Adicionar
 * ponto" espera. A senha NUNCA aparece em texto claro — só mascarada, com
 * nota de onde consultá-la na plataforma.
 */

export interface MqttGuideData {
  projectName: string;
  siteName: string | null;
  tenantId: string;
  gatewayId: string;
  /** Host do broker extraído da URL pública (ex.: mqtt.bluebee.com.br). */
  brokerHost: string;
  /** Porta do broker (ex.: 8883). */
  brokerPort: string;
  /** true quando a URL usa mqtts:// (TLS). */
  brokerTls: boolean;
  /** Usuário MQTT dedicado dos equipamentos (credencial -sensors). */
  mqttUsername: string;
  /** Se a credencial de sensores já foi provisionada (senha existe). */
  credentialProvisioned: boolean;
  generatedAt: Date;
}

const TITLE = 'Guia de Integração MQTT';

/** Cores locais do guia (além da paleta compartilhada). */
const CODE_BG: [number, number, number] = [241, 245, 249]; // ~#F1F5F9
const HEAD_BG: [number, number, number] = [226, 232, 240]; // ~#E2E8F0
const NOTE_BG: [number, number, number] = [250, 238, 218]; // âmbar suave (= mediumBg)

interface Ctx {
  doc: jsPDF;
  g: PdfPageGeom;
  y: number;
  compactRight: string;
}

function ensureSpace(ctx: Ctx, needed: number): void {
  if (ctx.y + needed <= ctx.g.bottomLimit) return;
  ctx.doc.addPage();
  ctx.y = drawCompactPdfHeader(ctx.doc, ctx.g, {
    title: TITLE,
    subtitle: '',
    compactRight: ctx.compactRight,
    generatedAt: '',
  });
}

function sectionTitle(ctx: Ctx, num: string, text: string): void {
  ensureSpace(ctx, 40);
  ctx.y += 8;
  const { doc, g } = ctx;
  doc.setFontSize(12.5);
  doc.setFont(PDF_FONT, 'medium');
  setText(doc, PDF_COLOR.title);
  doc.text(`${num}. ${text}`, g.margin, ctx.y + 10);
  ctx.y += 16;
  setDraw(doc, PDF_COLOR.hairline);
  doc.setLineWidth(0.5);
  doc.line(g.margin, ctx.y, g.pageW - g.margin, ctx.y);
  ctx.y += 10;
}

function paragraph(ctx: Ctx, text: string, opts?: { size?: number; color?: [number, number, number] }): void {
  const { doc, g } = ctx;
  const size = opts?.size ?? 9.5;
  doc.setFontSize(size);
  doc.setFont(PDF_FONT, 'normal');
  setText(doc, opts?.color ?? PDF_COLOR.title);
  const lines = doc.splitTextToSize(text, g.contentW) as string[];
  const lineH = size * 1.35;
  ensureSpace(ctx, lines.length * lineH + 4);
  lines.forEach((line) => {
    doc.text(line, g.margin, ctx.y + size);
    ctx.y += lineH;
  });
  ctx.y += 4;
}

/** Bloco monoespaçado-like (Roboto mesmo, fundo cinza) para exemplos. */
function codeBlock(ctx: Ctx, lines: string[]): void {
  const { doc, g } = ctx;
  const size = 8.5;
  const lineH = 12;
  const padY = 8;
  const innerW = g.contentW - 20;
  doc.setFontSize(size);
  doc.setFont(PDF_FONT, 'normal');
  // Quebra linhas longas (tópicos completos estouram a largura útil).
  const wrapped = lines.flatMap((line) =>
    line === '' ? [''] : (doc.splitTextToSize(line, innerW) as string[]),
  );
  const h = wrapped.length * lineH + padY * 2 - 2;
  ensureSpace(ctx, h + 8);
  setFill(doc, CODE_BG);
  doc.roundedRect(g.margin, ctx.y, g.contentW, h, 3, 3, 'F');
  doc.setFontSize(size);
  doc.setFont(PDF_FONT, 'normal');
  setText(doc, PDF_COLOR.title);
  wrapped.forEach((line, i) => {
    doc.text(line, g.margin + 10, ctx.y + padY + size + i * lineH - 2);
  });
  ctx.y += h + 8;
}

/** Aviso destacado (fundo âmbar). */
function noteBox(ctx: Ctx, text: string): void {
  const { doc, g } = ctx;
  const size = 8.8;
  doc.setFontSize(size);
  doc.setFont(PDF_FONT, 'normal');
  const innerW = g.contentW - 20;
  const lines = doc.splitTextToSize(text, innerW) as string[];
  const lineH = size * 1.35;
  const h = lines.length * lineH + 14;
  ensureSpace(ctx, h + 8);
  setFill(doc, NOTE_BG);
  doc.roundedRect(g.margin, ctx.y, g.contentW, h, 3, 3, 'F');
  setText(doc, PDF_COLOR.mediumText);
  lines.forEach((line, i) => {
    doc.text(line, g.margin + 10, ctx.y + 10 + size + i * lineH - 2);
  });
  ctx.y += h + 8;
}

/** Tabela chave > valor (dados de conexão). */
function keyValueTable(ctx: Ctx, rows: Array<[string, string, string?]>): void {
  const { doc, g } = ctx;
  const labelW = 150;
  rows.forEach(([label, value, hint], idx) => {
    doc.setFontSize(9);
    const valueLines = doc.splitTextToSize(value, g.contentW - labelW - 24) as string[];
    const hintLines = hint
      ? (doc.splitTextToSize(hint, g.contentW - labelW - 24) as string[])
      : [];
    const rowH = Math.max(20, valueLines.length * 12 + hintLines.length * 10 + 10);
    ensureSpace(ctx, rowH);
    if (idx % 2 === 0) {
      setFill(doc, PDF_COLOR.zebra);
      doc.rect(g.margin, ctx.y, g.contentW, rowH, 'F');
    }
    doc.setFont(PDF_FONT, 'medium');
    setText(doc, PDF_COLOR.muted);
    doc.setFontSize(8.5);
    doc.text(label, g.margin + 8, ctx.y + 14);
    doc.setFont(PDF_FONT, 'normal');
    setText(doc, PDF_COLOR.title);
    doc.setFontSize(9);
    valueLines.forEach((line, i) => {
      doc.text(line, g.margin + labelW, ctx.y + 14 + i * 12);
    });
    if (hintLines.length > 0) {
      doc.setFontSize(7.8);
      setText(doc, PDF_COLOR.muted);
      hintLines.forEach((line, i) => {
        doc.text(line, g.margin + labelW, ctx.y + 14 + valueLines.length * 12 + i * 10);
      });
    }
    ctx.y += rowH;
  });
  ctx.y += 8;
}

interface TableCol {
  header: string;
  width: number; // fração de contentW
}

/** Tabela genérica com quebra de linha por célula e quebra de página. */
function table(ctx: Ctx, cols: TableCol[], rows: string[][]): void {
  const { doc, g } = ctx;
  const widths = cols.map((c) => c.width * g.contentW);
  const pad = 6;
  const size = 8;
  const lineH = 10;

  const drawHeader = (): void => {
    setFill(doc, HEAD_BG);
    doc.rect(g.margin, ctx.y, g.contentW, 18, 'F');
    doc.setFontSize(8);
    doc.setFont(PDF_FONT, 'medium');
    setText(doc, PDF_COLOR.title);
    let x = g.margin;
    cols.forEach((c, i) => {
      doc.text(c.header, x + pad, ctx.y + 12);
      x += widths[i];
    });
    ctx.y += 18;
  };

  ensureSpace(ctx, 60);
  drawHeader();

  rows.forEach((row, rIdx) => {
    doc.setFontSize(size);
    doc.setFont(PDF_FONT, 'normal');
    const cellLines = row.map((cell, i) =>
      doc.splitTextToSize(cell, widths[i] - pad * 2) as string[],
    );
    const rowH = Math.max(...cellLines.map((l) => l.length)) * lineH + pad * 2 - 2;
    if (ctx.y + rowH > ctx.g.bottomLimit) {
      ensureSpace(ctx, rowH + 20);
      drawHeader();
      doc.setFontSize(size);
      doc.setFont(PDF_FONT, 'normal');
    }
    if (rIdx % 2 === 1) {
      setFill(doc, PDF_COLOR.zebra);
      doc.rect(g.margin, ctx.y, g.contentW, rowH, 'F');
    }
    setText(doc, PDF_COLOR.title);
    let x = g.margin;
    cellLines.forEach((lines, i) => {
      lines.forEach((line, li) => {
        doc.text(line, x + pad, ctx.y + pad + size + li * lineH - 2);
      });
      x += widths[i];
    });
    setDraw(doc, PDF_COLOR.hairline);
    doc.setLineWidth(0.4);
    doc.line(g.margin, ctx.y + rowH, g.pageW - g.margin, ctx.y + rowH);
    ctx.y += rowH;
  });
  ctx.y += 10;
}

/** Checklist com caixas vazias para marcar em campo. */
function checklist(ctx: Ctx, items: string[]): void {
  const { doc, g } = ctx;
  const size = 9;
  items.forEach((item) => {
    doc.setFontSize(size);
    doc.setFont(PDF_FONT, 'normal');
    const lines = doc.splitTextToSize(item, g.contentW - 26) as string[];
    const h = lines.length * (size * 1.35) + 6;
    ensureSpace(ctx, h);
    setDraw(doc, PDF_COLOR.muted);
    doc.setLineWidth(0.8);
    doc.rect(g.margin + 2, ctx.y + 2, 8, 8);
    setText(doc, PDF_COLOR.title);
    lines.forEach((line, i) => {
      doc.text(line, g.margin + 18, ctx.y + size + i * size * 1.35);
    });
    ctx.y += h;
  });
  ctx.y += 4;
}

export function buildMqttIntegrationGuidePdf(data: MqttGuideData): Buffer {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
  registerPdfFonts(doc);
  const g = pdfPageGeom('portrait');
  const generatedAt = fmtDateTime(data.generatedAt);
  const ctx: Ctx = { doc, g, y: g.margin, compactRight: `Gateway ${data.gatewayId}` };

  const base = `bluebee/${data.tenantId}/gateway/${data.gatewayId}/sensors/`;

  // ── Cabeçalho da 1ª página ────────────────────────────────────────────────
  doc.setFontSize(20);
  doc.setFont(PDF_FONT, 'medium');
  setText(doc, PDF_COLOR.title);
  doc.text(TITLE, g.margin, ctx.y + 14);
  doc.setFontSize(8.5);
  doc.setFont(PDF_FONT, 'normal');
  setText(doc, PDF_COLOR.muted);
  const gen = `Gerado em ${generatedAt}`;
  doc.text(gen, g.pageW - g.margin - doc.getTextWidth(gen), ctx.y + 14);
  ctx.y += 30;
  doc.setFontSize(10);
  setText(doc, PDF_COLOR.muted);
  const sub = [
    `Nome: ${data.projectName}`,
    data.siteName ? `Site: ${data.siteName}` : null,
    `ID do gateway: ${data.gatewayId}`,
  ]
    .filter(Boolean)
    .join('  ·  ');
  doc.text(doc.splitTextToSize(sub, g.contentW) as string[], g.margin, ctx.y + 6);
  ctx.y += 20;

  paragraph(
    ctx,
    'Este guia contém os valores reais deste gateway para configurar qualquer equipamento ' +
      'MQTT (ESP32, Shelly, CLPs, etc.) e cadastrar os pontos correspondentes na plataforma ' +
      'BlueBee pelo modal "Adicionar ponto". Configure o equipamento com os dados da Seção 1 ' +
      'e preencha o modal seguindo a tabela da Seção 4 — os dois lados precisam usar ' +
      'exatamente o mesmo tópico e formato de payload.',
    { color: PDF_COLOR.muted },
  );

  // ── 1. Dados de conexão ───────────────────────────────────────────────────
  sectionTitle(ctx, '1', 'Dados de conexão com o broker');
  keyValueTable(ctx, [
    ['Broker (host)', data.brokerHost],
    [
      'Porta',
      `${data.brokerPort}${data.brokerTls ? ' (TLS)' : ''}`,
      data.brokerTls
        ? 'Conexão TLS — habilite SSL/TLS no cliente MQTT do equipamento.'
        : undefined,
    ],
    [
      'Usuário MQTT',
      data.mqttUsername,
      'Credencial dedicada dos equipamentos deste gateway (sufixo -sensors).',
    ],
    [
      'Senha MQTT',
      '••••••••••••••••',
      data.credentialProvisioned
        ? 'Por segurança a senha não é impressa. Consulte na plataforma: Dispositivos > Adicionar equipamento MQTT > credencial do broker (ou peça a um administrador).'
        : 'Credencial ainda não provisionada. Abra na plataforma: Dispositivos > Adicionar equipamento MQTT com este gateway — a credencial é gerada na hora e exibida uma única vez por sessão.',
    ],
    ['TENANT_ID', data.tenantId],
    ['GATEWAY_ID', data.gatewayId],
    ['Prefixo base dos tópicos', base],
  ]);
  noteBox(
    ctx,
    `ACL da credencial "${data.mqttUsername}": publica somente dentro de ${base}# e assina apenas os sub-tópicos de comando (…/command/#) e de confirmação (…/rpc). Ela não acessa telemetria, configuração nem comandos do gateway — se o equipamento tentar publicar fora desse prefixo, o broker descarta em silêncio.`,
  );

  // ── 2. Padrão de tópicos ──────────────────────────────────────────────────
  sectionTitle(ctx, '2', 'Padrão de tópicos');
  paragraph(
    ctx,
    'Todos os tópicos do equipamento vivem sob o prefixo base. Organize por área e ' +
      'equipamento para manter a instalação legível:',
  );
  codeBlock(ctx, [
    `Telemetria (equipamento > plataforma):`,
    `  ${base}<area>/<equipamento>`,
    `  ex.: ${base}sala/ar-condicionado`,
    ``,
    `Comando (plataforma > equipamento) — o sub-tópico DEVE terminar em /command:`,
    `  ${base}<area>/<equipamento>/command`,
    `  ex.: ${base}sala/ar-condicionado/command`,
    ``,
    `Confirmação (equipamento > plataforma):`,
    `  ${base}<area>/<equipamento>/rpc`,
    `  ex.: ${base}sala/ar-condicionado/rpc`,
  ]);
  paragraph(
    ctx,
    'O equipamento publica telemetria no tópico base, assina o sub-tópico /command para ' +
      'receber comandos e publica a confirmação no sub-tópico /rpc. A ACL da Seção 1 só ' +
      'permite assinar sub-tópicos que sigam esse padrão — comandos publicados fora de ' +
      '…/command nunca chegam ao equipamento.',
  );

  // ── 3. Formato dos payloads ───────────────────────────────────────────────
  sectionTitle(ctx, '3', 'Formato dos payloads');
  paragraph(ctx, 'Telemetria — JSON plano, um objeto por mensagem. Exemplo:');
  codeBlock(ctx, [
    `Tópico: ${base}sala/ar-condicionado`,
    `{"temp": 23.5, "setpoint": 22, "ligado": 1}`,
  ]);
  paragraph(
    ctx,
    'Cada campo do JSON vira um ponto na plataforma via jsonPath (ex.: jsonPath "temp" lê ' +
      '23.5). Valores booleanos podem ser enviados como true/false ou 1/0 — a plataforma ' +
      'converte para 1/0. Publique sempre que o valor mudar ou em intervalo fixo (ex.: 10 s).',
  );
  paragraph(ctx, 'Comando — a plataforma publica no sub-tópico …/command:');
  codeBlock(ctx, [
    `Tópico: ${base}sala/ar-condicionado/command`,
    `{"id": 17, "tag": "LIGADO", "value": 1}`,
  ]);
  paragraph(ctx, 'Confirmação — o equipamento aplica o comando e devolve o MESMO id em …/rpc:');
  codeBlock(ctx, [
    `Tópico: ${base}sala/ar-condicionado/rpc`,
    `{"id": 17, "result": {"ok": true}}`,
  ]);
  paragraph(
    ctx,
    'O campo "id" é gerado pela plataforma a cada comando e serve para casar a confirmação ' +
      'com o comando enviado. Se a confirmação não chegar em 10 segundos, o comando é marcado ' +
      'como falho por timeout. Após confirmar, publique também a telemetria com o novo valor.',
  );

  // ── 4. Preenchimento do modal "Adicionar ponto" ───────────────────────────
  sectionTitle(ctx, '4', 'Preenchimento do modal "Adicionar ponto"');
  paragraph(
    ctx,
    'Na plataforma (Dispositivos > equipamento MQTT > Adicionar ponto), preencha os campos ' +
      'assim. Os sub-tópicos são sempre relativos ao prefixo base (…/sensors/) — nunca digite ' +
      'o prefixo completo. Exemplos para o equipamento "sala/ar-condicionado":',
  );
  table(
    ctx,
    [
      { header: 'Campo do modal', width: 0.2 },
      { header: 'Regra', width: 0.46 },
      { header: 'Exemplo', width: 0.34 },
    ],
    [
      [
        'Sub-tópico',
        'Caminho da telemetria sob …/sensors/, igual ao tópico onde o equipamento publica o JSON.',
        'sala/ar-condicionado',
      ],
      [
        'jsonPath',
        'Nome do campo dentro do JSON de telemetria. Vazio = payload cru (quando o equipamento publica só o número).',
        'temp',
      ],
      [
        'Sub-tópico de comando',
        'Só para ponto comandável. Caminho sob …/sensors/ onde o equipamento escuta comandos — deve terminar em /command.',
        'sala/ar-condicionado/command',
      ],
      [
        'Payload do comando',
        'Só para ponto comandável. Modelo JSON com os placeholders {{id}} (id RPC) e {{value}} (valor enviado) — obrigatório conter {{value}}.',
        '{"id": {{id}}, "tag": "LIGADO", "value": {{value}}}',
      ],
      [
        'Sub-tópico de confirmação',
        'Opcional (recomendado). Caminho sob …/sensors/ onde o equipamento devolve a confirmação com o mesmo id. Sem ele, o comando é reportado apenas como "enviado", sem confirmação.',
        'sala/ar-condicionado/rpc',
      ],
    ],
  );
  paragraph(
    ctx,
    'Ponto SÓ-LEITURA (sensor): preencha apenas Sub-tópico e jsonPath — deixe a escrita ' +
      'desabilitada. Ponto COMANDÁVEL (relé, setpoint): habilite a escrita e preencha também ' +
      'o sub-tópico de comando, o payload do comando e, de preferência, o sub-tópico de ' +
      'confirmação.',
  );

  // ── 5. Checklist de teste ponta a ponta ───────────────────────────────────
  sectionTitle(ctx, '5', 'Checklist de teste ponta a ponta');
  checklist(ctx, [
    `Equipamento conecta no broker ${data.brokerHost}:${data.brokerPort}${data.brokerTls ? ' com TLS' : ''} usando o usuário ${data.mqttUsername} (sem erro de autenticação).`,
    `Equipamento publica telemetria no tópico ${base}<area>/<equipamento> e o JSON aparece na captura de amostra do modal "Adicionar ponto" (botão de capturar amostra).`,
    'Ponto cadastrado mostra o valor ao vivo na plataforma (Dispositivos > pontos do equipamento) e o valor bate com o publicado.',
    'Para ponto comandável: enviar um comando pela plataforma faz o equipamento receber o JSON em …/command e atuar.',
    'O equipamento devolve a confirmação em …/rpc com o mesmo id e a plataforma marca o comando como confirmado (sem timeout).',
    'Após o comando, a telemetria publicada reflete o novo valor e a plataforma atualiza o ponto.',
  ]);

  // ── 6. Troubleshooting ────────────────────────────────────────────────────
  sectionTitle(ctx, '6', 'Troubleshooting');
  table(
    ctx,
    [
      { header: 'Sintoma', width: 0.24 },
      { header: 'Causa provável', width: 0.38 },
      { header: 'O que verificar', width: 0.38 },
    ],
    [
      [
        'Telemetria não chega',
        'Tópico fora do prefixo base (a ACL descarta em silêncio) ou credencial errada.',
        `O tópico começa exatamente com ${base}? Usuário é ${data.mqttUsername}? Teste com a captura de amostra do modal.`,
      ],
      [
        'Comando não chega no equipamento',
        'Equipamento não assinou o sub-tópico /command, ou o sub-tópico não termina em /command (a ACL só permite assinar …/command/# e …/rpc).',
        'Confira o subscribe no firmware e se o campo "Sub-tópico de comando" do modal é idêntico ao tópico assinado.',
      ],
      [
        'Comando nunca confirma (timeout)',
        'Equipamento não publica em …/rpc, publica em outro tópico, ou devolve um id diferente do recebido.',
        'A confirmação deve ir para o sub-tópico de confirmação cadastrado, com o MESMO "id" do comando, em até 10 s.',
      ],
      [
        'Valor null na plataforma',
        'jsonPath não existe no payload publicado, ou o tipo do valor não é numérico/booleano conversível.',
        'Compare o jsonPath do ponto com o JSON real (captura de amostra). Booleanos: use true/false ou 1/0.',
      ],
    ],
  );

  drawPdfFooters(doc, g, `${TITLE} · ${data.projectName}`);
  return Buffer.from(doc.output('arraybuffer'));
}
