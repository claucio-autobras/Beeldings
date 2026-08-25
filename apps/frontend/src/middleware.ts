import { type NextRequest, NextResponse } from 'next/server';

const PUBLIC_ROUTES = ['/login', '/forgot-password', '/reset-password'];
// Cookie de sessão HttpOnly emitido pelo backend no login. O middleware só
// verifica presença (a validade é confirmada pelo backend em cada chamada).
// Sessões legadas (cookie antigo `bluebee_access_token`) NÃO casam com este
// nome e caem no login novamente — transição intencional.
const TOKEN_KEY = 'bluebee_session';

// CSP completa só em produção: em desenvolvimento o preview do Replit roda em
// iframe de outra origem e o Next injeta scripts de HMR/eval — qualquer CSP
// estrita quebraria o preview, então dev fica sem o header.
const isProd = process.env.NODE_ENV === 'production';

/**
 * Monta a Content-Security-Policy de produção. Origens externas permitidas:
 * - challenges.cloudflare.com: script + iframe do Turnstile no login.
 * Todo o resto é same-origin: a API é proxied em `/api` (NEXT_PUBLIC_API_URL=/api),
 * o Socket.IO usa window.location.origin (connect-src 'self' cobre wss:), as
 * imagens SCADA/logos chegam via `/api/scada-assets/...` e os frames de câmera
 * são `data:image/jpeg` montados no cliente (img-src data:).
 * `style-src 'unsafe-inline'` é necessário: React usa atributos style em massa
 * (SCADA/gráficos) e o Next injeta <style> inline — sem risco de script.
 */
function buildCsp(nonce: string): string {
  return [
    "default-src 'self'",
    // Nonce cobre os scripts inline do Next (hidratação) e o script de tema do
    // layout; 'self' cobre os chunks /_next/*; Cloudflare = Turnstile.
    `script-src 'self' 'nonce-${nonce}' https://challenges.cloudflare.com`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self' https://challenges.cloudflare.com",
    'frame-src https://challenges.cloudflare.com',
    // Anti-clickjacking (antes vivia sozinho no next.config)
    "frame-ancestors 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "worker-src 'self'",
    "media-src 'self'",
    "manifest-src 'self'",
  ].join('; ');
}

/**
 * NextResponse.next() com CSP + nonce em produção. O nonce vai em dois lugares:
 * - Header da REQUISIÇÃO (`x-nonce` + `content-security-policy`): o Next lê a
 *   CSP da requisição para aplicar o nonce automaticamente nos seus próprios
 *   scripts inline, e o layout lê `x-nonce` via headers() para o script de tema.
 * - Header da RESPOSTA: a política que o navegador de fato aplica.
 *
 * IMPORTANTE — Cache-Control: no-store
 * O nonce é gerado por requisição (UUID aleatório). Se o CDN armazena a
 * resposta com s-maxage alto (padrão das páginas pre-renderizadas do Next),
 * requisições subsequentes recebem a resposta cacheada com o nonce antigo
 * embutido no HTML mas uma CSP diferente (ou ausente), e o browser bloqueia
 * todos os scripts inline → tela em branco. Por isso sobrescrevemos o
 * Cache-Control para proibir cache de downstream sempre que emitimos CSP com
 * nonce. O CDN nunca deve guardar essas respostas.
 */
function nextWithCsp(request: NextRequest): NextResponse {
  if (!isProd) {
    return NextResponse.next();
  }
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  // Impede que o CDN armazene respostas com nonce — o nonce muda a cada
  // requisição e deve ser gerado pelo middleware fresh, nunca servido de cache.
  response.headers.set('Cache-Control', 'no-store');
  return response;
}

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // Proxy do backend (rewrite `/api/*` no next.config) — não é rota de UI e o
  // próprio backend valida o JWT via header Authorization. Deixa passar sempre,
  // senão o login (/api/auth/login) seria redirecionado para /login.
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return nextWithCsp(request);
  }

  // Rotas publicas — passa sempre
  const isPublic = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));
  if (isPublic) {
    return nextWithCsp(request);
  }

  // Verifica token no cookie (persistido pelo auth service)
  // OBS: localStorage não é acessivel no middleware; o token tambem e salvo em cookie
  const token = request.cookies.get(TOKEN_KEY)?.value;

  if (!token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return nextWithCsp(request);
}

export const config = {
  matcher: [
    /*
     * Aplica o middleware em todas as rotas, exceto:
     * - _next/static (arquivos estaticos)
     * - _next/image (otimizacao de imagens)
     * - favicon.ico
     * - arquivos publicos (imagens, etc.)
     * - manifest.webmanifest e sw.js (PWA — precisam ser públicos, senão o
     *   navegador não consegue instalar o app nem registrar o service worker)
     */
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
