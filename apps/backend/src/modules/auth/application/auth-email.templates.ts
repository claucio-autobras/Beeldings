function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char] ?? char);
}

function layout(title: string, body: string): string {
  return `<!doctype html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#0f172a;">
  <table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px;background:#f3f4f6;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#fff;border-radius:10px;overflow:hidden;">
        <tr><td style="padding:24px 32px;background:#0E7490;">
          <strong style="font-size:20px;color:#fff;letter-spacing:.3px;">Beeldings</strong>
          <span style="margin-left:12px;color:#cffafe;font-size:14px;">Plataforma IoT</span>
        </td></tr>
        <tr><td style="padding:30px 32px;">${body}</td></tr>
        <tr><td style="padding:18px 32px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#64748b;font-size:12px;">
          Este é um aviso automático — não responda este e-mail. Para suporte, acesse a Plataforma Beeldings.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildPasswordResetEmail(name: string, resetUrl: string): string {
  return layout(
    'Redefinição de senha',
    `<h1 style="margin:0 0 12px;font-size:22px;">Redefina sua senha</h1>
     <p style="margin:0 0 22px;color:#475569;font-size:14px;line-height:1.55;">Olá, ${escapeHtml(name)}. Recebemos uma solicitação para redefinir a senha da sua conta.</p>
     <p style="margin:0 0 24px;"><a href="${escapeHtml(resetUrl)}" style="display:inline-block;padding:12px 18px;background:#0E7490;color:#fff;text-decoration:none;border-radius:7px;font-size:14px;font-weight:700;">Redefinir minha senha</a></p>
     <p style="margin:0;color:#64748b;font-size:13px;line-height:1.55;">Este link expira em 30 minutos e só pode ser usado uma vez. Se você não solicitou a troca, ignore este e-mail.</p>`,
  );
}

export function buildTwoFactorEmail(name: string, code: string): string {
  return layout(
    'Código de acesso',
    `<h1 style="margin:0 0 12px;font-size:22px;">Confirme seu acesso</h1>
     <p style="margin:0 0 22px;color:#475569;font-size:14px;line-height:1.55;">Olá, ${escapeHtml(name)}. Use o código abaixo para concluir seu login na Plataforma Beeldings.</p>
     <p style="margin:0 0 24px;font-size:30px;font-weight:700;letter-spacing:8px;color:#0E7490;">${escapeHtml(code)}</p>
     <p style="margin:0;color:#64748b;font-size:13px;line-height:1.55;">O código expira em 10 minutos e pode ser usado uma única vez. Não compartilhe este código.</p>`,
  );
}