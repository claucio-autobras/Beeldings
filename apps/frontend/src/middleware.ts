import { type NextRequest, NextResponse } from 'next/server';

const PUBLIC_ROUTES = ['/login', '/forgot-password'];
// Cookie de sessão HttpOnly emitido pelo backend no login. O middleware só
// verifica presença (a validade é confirmada pelo backend em cada chamada).
// Sessões legadas (cookie antigo `bluebee_access_token`) NÃO casam com este
// nome e caem no login novamente — transição intencional.
const TOKEN_KEY = 'bluebee_session';

export function middleware(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  // Proxy do backend (rewrite `/api/*` no next.config) — não é rota de UI e o
  // próprio backend valida o JWT via header Authorization. Deixa passar sempre,
  // senão o login (/api/auth/login) seria redirecionado para /login.
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return NextResponse.next();
  }

  // Rotas publicas — passa sempre
  const isPublic = PUBLIC_ROUTES.some((route) => pathname.startsWith(route));
  if (isPublic) {
    return NextResponse.next();
  }

  // Verifica token no cookie (persistido pelo auth service)
  // OBS: localStorage não é acessivel no middleware; o token tambem e salvo em cookie
  const token = request.cookies.get(TOKEN_KEY)?.value;

  if (!token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
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
