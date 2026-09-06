---
name: CSP de produção via middleware
description: Como a Content-Security-Policy completa é emitida (nonce por requisição) e o que ela permite
---
- CSP completa só em produção, emitida por requisição no `middleware.ts` do frontend (não em next.config): nonce em `x-nonce` + `content-security-policy` nos headers da REQUISIÇÃO (Next aplica o nonce nos scripts inline dele) e o mesmo CSP no header da RESPOSTA.
- O root layout lê `headers().get('x-nonce')` e aplica no script inline de tema → todas as rotas viram dinâmicas (ƒ), o que é esperado.
- **Why:** dev roda no preview iframe do Replit com HMR/eval — qualquer CSP estrita quebra; por isso dev fica sem header.
- Únicas origens externas: `challenges.cloudflare.com` (Turnstile: script-src, frame-src, connect-src). Todo o resto é same-origin (`NEXT_PUBLIC_API_URL=/api`, Socket.IO em window.location.origin, imagens SCADA via /api/scada-assets). Frames de câmera = `img-src data:`.
- `style-src 'unsafe-inline'` é intencional (atributos style do React em massa no SCADA/gráficos); `X-Frame-Options` segue no next.config como fallback legado.
- **How to apply:** qualquer novo recurso externo (CDN, iframe, websocket externo) exige atualizar `buildCsp()` no middleware, senão quebra silenciosamente só em produção.
