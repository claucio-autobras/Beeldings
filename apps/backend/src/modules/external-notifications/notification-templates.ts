/**
 * Templates de mensagens — e-mail HTML e WhatsApp texto — em pt-BR.
 * Datas sempre em America/Sao_Paulo.
 */

const SP_TZ = 'America/Sao_Paulo';

export function formatDateSp(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: SP_TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

// ─── Severidade ───────────────────────────────────────────────────────────────

const SEVERITY_PT: Record<string, string> = {
  HIGH: 'Alta',
  MEDIUM: 'Média',
  LOW: 'Baixa',
};

const SEVERITY_COLOR: Record<string, string> = {
  HIGH: '#dc2626',
  MEDIUM: '#d97706',
  LOW: '#2563eb',
};

// ─── Contexto de alarme ───────────────────────────────────────────────────────

export interface AlarmContext {
  alarmName: string;
  severity: 'HIGH' | 'MEDIUM' | 'LOW' | string;
  deviceName: string;
  pointName: string;
  siteName: string | null;
  valueAtTrigger: number | null;
  activatedAt: Date;
  reactivated: boolean;
}

// ─── Contexto de insight ──────────────────────────────────────────────────────

export interface InsightContext {
  tenantName: string;
  theme: string;
  summary: string;
  periodLabel: string;
  frequency: string;
}

/** Aviso padrão de canal automático (rodapé dos e-mails). */
const NO_REPLY_NOTE =
  'Este é um aviso automático — não responda este e-mail. Para tratar ocorrências, acesse a Plataforma Beeldings.';

/**
 * Resposta automática do WhatsApp quando alguém escreve para o número de alertas.
 */
export function buildWhatsAppAutoReply(): string {
  return [
    '🤖 *Canal automático — Plataforma Beeldings*',
    '',
    'Este número envia apenas alertas automáticos e não é monitorado.',
    'Para tratar o alarme ou falar com a equipe, acesse a plataforma:',
    'https://www.beeldings.com.br',
    '',
    '_Não é necessário responder esta mensagem._',
  ].join('\n');
}

// ─── E-mail: alarme ──────────────────────────────────────────────────────────

export function buildAlarmEmailSubject(ctx: AlarmContext): string {
  const prefix = ctx.reactivated ? '⚠️ Alarme Reativado' : '🚨 Alarme Ativo';
  const sev = SEVERITY_PT[ctx.severity] ?? ctx.severity;
  const site = ctx.siteName ? ` · ${ctx.siteName}` : '';
  return `${prefix} [${sev}] ${ctx.alarmName}${site}`;
}

export function buildAlarmEmailHtml(ctx: AlarmContext, recipientName: string): string {
  const sev = SEVERITY_PT[ctx.severity] ?? ctx.severity;
  const color = SEVERITY_COLOR[ctx.severity] ?? '#6b7280';
  const action = ctx.reactivated ? 'Reativado' : 'Ativado';
  const badge = ctx.reactivated ? '⚠️ REATIVADO' : '🚨 ATIVO';
  const valueRow =
    ctx.valueAtTrigger !== null
      ? `<tr><td style="color:#6b7280;padding:4px 0;">Valor que disparou</td><td style="padding:4px 0;font-weight:600;">${ctx.valueAtTrigger}</td></tr>`
      : '';
  const siteRow = ctx.siteName
    ? `<tr><td style="color:#6b7280;padding:4px 0;">Unidade (site)</td><td style="padding:4px 0;">${esc(ctx.siteName)}</td></tr>`
    : '';

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;">
        <!-- Cabeçalho -->
        <tr><td style="background:#0E7490;padding:24px 32px;">
          <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:.5px;">Beeldings</span>
          <span style="color:#cffafe;font-size:14px;margin-left:12px;">Plataforma IoT</span>
        </td></tr>
        <!-- Alerta -->
        <tr><td style="padding:28px 32px 0;">
          <div style="display:inline-block;background:${color}22;border:1px solid ${color};color:${color};border-radius:4px;padding:4px 12px;font-size:13px;font-weight:700;letter-spacing:.5px;">
            ${badge}
          </div>
          <h1 style="margin:16px 0 8px;font-size:22px;color:#0f172a;">${esc(ctx.alarmName)}</h1>
          <p style="margin:0;color:#64748b;font-size:14px;">Alarme ${action.toLowerCase()} em ${formatDateSp(ctx.activatedAt)}</p>
        </td></tr>
        <!-- Detalhes -->
        <tr><td style="padding:24px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e2e8f0;font-size:14px;">
            <tr><td style="color:#6b7280;padding:12px 0 4px;" colspan="2">Detalhes</td></tr>
            <tr><td style="color:#6b7280;padding:4px 0;">Severidade</td><td style="padding:4px 0;font-weight:600;color:${color};">${esc(sev)}</td></tr>
            <tr><td style="color:#6b7280;padding:4px 0;">Equipamento</td><td style="padding:4px 0;">${esc(ctx.deviceName)}</td></tr>
            <tr><td style="color:#6b7280;padding:4px 0;">Ponto monitorado</td><td style="padding:4px 0;">${esc(ctx.pointName)}</td></tr>
            ${siteRow}
            ${valueRow}
            <tr><td style="color:#6b7280;padding:4px 0;">Horário</td><td style="padding:4px 0;">${formatDateSp(ctx.activatedAt)} (Brasília)</td></tr>
          </table>
        </td></tr>
        <!-- Rodapé -->
        <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 32px;font-size:12px;color:#94a3b8;">
          <p style="margin:0;">Olá, ${esc(recipientName)}. Você recebe este e-mail porque está cadastrado como destinatário de alarmes na Plataforma Beeldings.</p>
          <p style="margin:8px 0 0;">Para ajustar suas notificações, acesse as Configurações da plataforma.</p>
          <p style="margin:8px 0 0;">${NO_REPLY_NOTE}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── WhatsApp: alarme ─────────────────────────────────────────────────────────

export function buildAlarmWhatsAppMessage(ctx: AlarmContext): string {
  const sev = SEVERITY_PT[ctx.severity] ?? ctx.severity;
  const emoji = ctx.severity === 'HIGH' ? '🔴' : ctx.severity === 'MEDIUM' ? '🟡' : '🔵';
  const action = ctx.reactivated ? '⚠️ *ALARME REATIVADO*' : '🚨 *ALARME ATIVO*';
  const lines = [
    action,
    `${emoji} *${ctx.alarmName}*`,
    `Severidade: ${sev}`,
    `Equipamento: ${ctx.deviceName}`,
    `Ponto: ${ctx.pointName}`,
  ];
  if (ctx.siteName) lines.push(`Site: ${ctx.siteName}`);
  if (ctx.valueAtTrigger !== null) lines.push(`Valor: ${ctx.valueAtTrigger}`);
  lines.push(`Horário: ${formatDateSp(ctx.activatedAt)} (Brasília)`);
  lines.push('\n_Plataforma Beeldings_');
  return lines.join('\n');
}

// ─── E-mail: digest de alarmes (anti-tempestade) ──────────────────────────────

export function buildAlarmDigestEmailSubject(items: AlarmContext[]): string {
  const sevs = items.map((i) => i.severity);
  const topSev = sevs.includes('HIGH') ? 'HIGH' : sevs.includes('MEDIUM') ? 'MEDIUM' : 'LOW';
  const sev = SEVERITY_PT[topSev] ?? topSev;
  const sites = [...new Set(items.map((i) => i.siteName).filter(Boolean))];
  const siteStr = sites.length === 1 ? ` · ${sites[0]}` : sites.length > 1 ? ` · ${sites.length} sites` : '';
  return `🚨 ${items.length} alarmes ativos [máx. ${sev}]${siteStr}`;
}

export function buildAlarmDigestEmailHtml(items: AlarmContext[], recipientName: string): string {
  const sevs = items.map((i) => i.severity);
  const topSev = sevs.includes('HIGH') ? 'HIGH' : sevs.includes('MEDIUM') ? 'MEDIUM' : 'LOW';
  const color = SEVERITY_COLOR[topSev] ?? '#6b7280';
  const rows = items
    .map(
      (c) => `<tr>
        <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:13px;">${esc(c.alarmName)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:13px;color:${SEVERITY_COLOR[c.severity] ?? '#6b7280'};">${esc(SEVERITY_PT[c.severity] ?? c.severity)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:13px;">${esc(c.deviceName)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#6b7280;">${c.siteName ? esc(c.siteName) : '—'}</td>
      </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:640px;">
        <tr><td style="background:#0E7490;padding:24px 32px;">
          <span style="color:#ffffff;font-size:20px;font-weight:700;">Beeldings</span>
          <span style="color:#cffafe;font-size:14px;margin-left:12px;">Plataforma IoT</span>
        </td></tr>
        <tr><td style="padding:28px 32px 0;">
          <div style="display:inline-block;background:${color}22;border:1px solid ${color};color:${color};border-radius:4px;padding:4px 12px;font-size:13px;font-weight:700;">🚨 ${items.length} ALARMES ATIVOS</div>
          <h1 style="margin:16px 0 8px;font-size:20px;color:#0f172a;">Resumo de Alarmes</h1>
          <p style="margin:0;color:#64748b;font-size:14px;">Vários alarmes foram ativados em sequência. Abaixo o resumo.</p>
        </td></tr>
        <tr><td style="padding:24px 32px;">
          <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;border-collapse:collapse;">
            <tr style="background:#f8fafc;">
              <th style="padding:8px;text-align:left;color:#64748b;font-weight:600;">Alarme</th>
              <th style="padding:8px;text-align:left;color:#64748b;font-weight:600;">Severidade</th>
              <th style="padding:8px;text-align:left;color:#64748b;font-weight:600;">Equipamento</th>
              <th style="padding:8px;text-align:left;color:#64748b;font-weight:600;">Site</th>
            </tr>
            ${rows}
          </table>
        </td></tr>
        <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 32px;font-size:12px;color:#94a3b8;">
          <p style="margin:0;">Olá, ${esc(recipientName)}. Você recebe este e-mail porque está cadastrado como destinatário de alarmes na Plataforma Beeldings.</p>
          <p style="margin:8px 0 0;">${NO_REPLY_NOTE}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildAlarmDigestWhatsApp(items: AlarmContext[]): string {
  const sevs = items.map((i) => i.severity);
  const topSev = sevs.includes('HIGH') ? 'HIGH' : sevs.includes('MEDIUM') ? 'MEDIUM' : 'LOW';
  const emoji = topSev === 'HIGH' ? '🔴' : topSev === 'MEDIUM' ? '🟡' : '🔵';
  const lines = [`🚨 *${items.length} ALARMES ATIVOS* ${emoji}`];
  for (const c of items) {
    const sev = SEVERITY_PT[c.severity] ?? c.severity;
    const site = c.siteName ? ` (${c.siteName})` : '';
    lines.push(`• ${c.alarmName} [${sev}] — ${c.deviceName}${site}`);
  }
  lines.push('\n_Plataforma Beeldings_');
  return lines.join('\n');
}

// ─── E-mail: insight ──────────────────────────────────────────────────────────

export function buildInsightEmailSubject(ctx: InsightContext): string {
  const freq = ctx.frequency === 'WEEKLY' ? 'Semanal' : 'Mensal';
  return `📊 Insight ${freq} — ${ctx.tenantName}: ${ctx.theme}`;
}

export function buildInsightEmailHtml(ctx: InsightContext, recipientName: string): string {
  const freq = ctx.frequency === 'WEEKLY' ? 'Semanal' : 'Mensal';
  // Quebra parágrafos no summary para HTML.
  const summaryHtml = esc(ctx.summary).replace(/\n/g, '<br>');
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;">
        <tr><td style="background:#0E7490;padding:24px 32px;">
          <span style="color:#ffffff;font-size:20px;font-weight:700;">Beeldings</span>
          <span style="color:#cffafe;font-size:14px;margin-left:12px;">Plataforma IoT</span>
        </td></tr>
        <tr><td style="padding:28px 32px 0;">
          <div style="display:inline-block;background:#0ea5e922;border:1px solid #0ea5e9;color:#0ea5e9;border-radius:4px;padding:4px 12px;font-size:13px;font-weight:700;">📊 INSIGHT ${freq.toUpperCase()}</div>
          <h1 style="margin:16px 0 4px;font-size:22px;color:#0f172a;">${esc(ctx.theme)}</h1>
          <p style="margin:0;color:#64748b;font-size:13px;">${esc(ctx.tenantName)} · ${esc(ctx.periodLabel)}</p>
        </td></tr>
        <tr><td style="padding:24px 32px;">
          <div style="background:#f8fafc;border-left:3px solid #0ea5e9;padding:16px 20px;border-radius:0 4px 4px 0;font-size:14px;color:#334155;line-height:1.6;">
            ${summaryHtml}
          </div>
        </td></tr>
        <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 32px;font-size:12px;color:#94a3b8;">
          <p style="margin:0;">Olá, ${esc(recipientName)}. Você recebe este e-mail porque está cadastrado como destinatário de insights na Plataforma Beeldings.</p>
          <p style="margin:8px 0 0;">Para ver o insight completo, acesse a plataforma na seção Insights.</p>
          <p style="margin:8px 0 0;">${NO_REPLY_NOTE}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildInsightWhatsAppMessage(ctx: InsightContext): string {
  const freq = ctx.frequency === 'WEEKLY' ? 'Semanal' : 'Mensal';
  const lines = [
    `📊 *Insight ${freq} — ${ctx.tenantName}*`,
    `*${ctx.theme}*`,
    `_${ctx.periodLabel}_`,
    '',
    ctx.summary,
    '',
    '_Plataforma Beeldings_',
  ];
  return lines.join('\n');
}

// ─── Mensagem de teste ────────────────────────────────────────────────────────

export function buildTestEmailHtml(recipientName: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;">
        <tr><td style="background:#0E7490;padding:24px 32px;">
          <span style="color:#ffffff;font-size:20px;font-weight:700;">Beeldings</span>
          <span style="color:#cffafe;font-size:14px;margin-left:12px;">Plataforma IoT</span>
        </td></tr>
        <tr><td style="padding:32px;">
          <div style="display:inline-block;background:#16a34a22;border:1px solid #16a34a;color:#16a34a;border-radius:4px;padding:4px 12px;font-size:13px;font-weight:700;">✅ TESTE DE CANAL</div>
          <h1 style="margin:16px 0 8px;font-size:22px;color:#0f172a;">Canal de e-mail funcionando!</h1>
          <p style="color:#64748b;font-size:14px;line-height:1.6;">Olá, ${esc(recipientName)}!<br><br>
          Este é um e-mail de teste da Plataforma Beeldings. Se você recebeu esta mensagem, o canal de e-mail está configurado e funcionando corretamente.<br><br>
          Você está cadastrado como destinatário de notificações e receberá alertas de alarmes e/ou insights conforme sua configuração.</p>
        </td></tr>
        <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 32px;font-size:12px;color:#94a3b8;">
          <p style="margin:0;">Plataforma Beeldings — Notificações externas</p>
          <p style="margin:8px 0 0;">${NO_REPLY_NOTE}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildTestWhatsAppMessage(recipientName: string): string {
  return `✅ *Teste de canal — Plataforma Beeldings*\n\nOlá, ${recipientName}!\n\nO canal de WhatsApp está configurado e funcionando corretamente. Você receberá notificações de alarmes e/ou insights conforme sua configuração.\n\n_Plataforma Beeldings_`;
}

// ─── Utilitário ───────────────────────────────────────────────────────────────

function esc(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
