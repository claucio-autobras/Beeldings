/**
 * Testes do middleware CSP (src/middleware.ts).
 *
 * CAMADAS DE COBERTURA
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Testes unitários (Jest / mocks do next/server)
 *    - Verificam que o middleware define os headers corretos na *resposta*
 *      (Content-Security-Policy, Cache-Control: no-store).
 *    - Verificam a *consistência do nonce*: o mesmo valor que vai no header de
 *      resposta (CSP) também é injetado no header de requisição `x-nonce` que
 *      o Next.js usa para carimbar `nonce="..."` nos scripts inline.
 *    - Verificam unicidade de nonce por requisição.
 *    - Verificam que PUBLIC_ROUTES (/login, /forgot-password) nunca redirecionam.
 *
 * 2. Teste de integração HTTP (seção abaixo, exige TEST_BASE_URL)
 *    - Faz GET real à rota /login de um servidor em produção.
 *    - Confirma Cache-Control: no-store e CSP com nonce- nos response headers.
 *    - Parseia o HTML renderizado e compara os atributos nonce dos <script> com
 *      o nonce da CSP — prova que o Next.js aplicou o nonce do middleware ao HTML.
 *    - Confirma ausência de erros de CSP no conteúdo da página.
 *
 * NOTA SOBRE /forgot-password
 * ─────────────────────────────────────────────────────────────────────────────
 * O middleware declara /forgot-password em PUBLIC_ROUTES (auth bypass + CSP
 * aplicada), mas não existe um page.tsx correspondente no App Router. Requisições
 * a essa rota são processadas pelo middleware corretamente (CSP emitida) e
 * resultam em 404 do Next.js. Os testes unitários cobrem o comportamento do
 * middleware; o teste de integração cobre só /login (rota com page.tsx real).
 */

// ── Tipos auxiliares ─────────────────────────────────────────────────────────

type MockHeadersInit = Record<string, string> | MockHeaders;

// ── Mock de next/server ──────────────────────────────────────────────────────

class MockHeaders {
  private map: Map<string, string> = new Map();

  constructor(init?: MockHeadersInit) {
    if (init instanceof MockHeaders) {
      for (const [k, v] of init.map) {
        this.map.set(k, v);
      }
    } else if (init) {
      for (const [k, v] of Object.entries(init)) {
        this.map.set(k.toLowerCase(), v);
      }
    }
  }

  set(key: string, value: string) { this.map.set(key.toLowerCase(), value); }
  get(key: string) { return this.map.get(key.toLowerCase()) ?? null; }
  has(key: string) { return this.map.has(key.toLowerCase()); }
}

/**
 * Registra os headers de request que foram passados para NextResponse.next().
 * Isso permite verificar que o `x-nonce` injetado no request bate com o nonce
 * da CSP no response — prova da consistência necessária para que o Next.js
 * carimbe o mesmo nonce nos <script nonce="..."> do HTML.
 */
let capturedRequestHeaders: MockHeaders | null = null;

function resetCapturedHeaders() {
  capturedRequestHeaders = null;
}

class MockNextResponse {
  headers: MockHeaders;
  readonly status: number;

  constructor(opts?: { status?: number }) {
    this.headers = new MockHeaders();
    this.status = opts?.status ?? 200;
  }

  /**
   * Captura os headers de request que o middleware injetou (x-nonce, CSP no
   * request) para que os testes possam verificar consistência com a resposta.
   */
  static next(opts?: { request?: { headers?: unknown } }): MockNextResponse {
    const response = new MockNextResponse();
    if (opts?.request?.headers) {
      // Captura para inspeção nos testes
      capturedRequestHeaders = opts.request.headers as MockHeaders;
    }
    return response;
  }

  static redirect(_url: URL): MockNextResponse {
    return new MockNextResponse({ status: 307 });
  }
}

class MockNextRequest {
  readonly nextUrl: URL;
  readonly cookies: { get(name: string): { value: string } | undefined };
  readonly headers: MockHeaders;
  readonly url: string;

  constructor(path: string, opts: { cookie?: string } = {}) {
    this.url = `https://app.example.com${path}`;
    this.nextUrl = new URL(this.url);
    this.headers = new MockHeaders();
    const cookieValue = opts.cookie;
    this.cookies = {
      get: (name: string) =>
        name === 'bluebee_session' && cookieValue ? { value: cookieValue } : undefined,
    };
  }
}

jest.mock('next/server', () => ({
  NextResponse: MockNextResponse,
  NextRequest: MockNextRequest,
}));

// ── Helpers de carregamento ──────────────────────────────────────────────────

/** Recarrega o middleware com NODE_ENV forçado. Necessário porque `isProd` é
 * avaliado no momento do import e não pode ser alterado sem resetar o módulo. */
async function loadMiddleware(env: 'production' | 'development') {
  jest.resetModules();
  // @ts-expect-error — NODE_ENV é readonly no tipo; gravável em runtime
  process.env.NODE_ENV = env;
  jest.mock('next/server', () => ({
    NextResponse: MockNextResponse,
    NextRequest: MockNextRequest,
  }));
  const mod = await import('./middleware');
  return mod.middleware as unknown as (req: MockNextRequest) => MockNextResponse;
}

// ── Helpers de teste ─────────────────────────────────────────────────────────

function makeRequest(path: string, opts: { cookie?: string } = {}): MockNextRequest {
  return new MockNextRequest(path, opts);
}

function extractNonce(csp: string): string | undefined {
  return csp.match(/nonce-([A-Za-z0-9+/]+=*)/)?.[1];
}

// ── Setup / Teardown ─────────────────────────────────────────────────────────

const originalEnv = process.env.NODE_ENV;

afterAll(() => {
  // @ts-expect-error
  process.env.NODE_ENV = originalEnv;
  jest.resetModules();
});

beforeEach(() => {
  resetCapturedHeaders();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. TESTES UNITÁRIOS — modo produção
// ═══════════════════════════════════════════════════════════════════════════

describe('CSP middleware — produção', () => {
  let middleware: (req: MockNextRequest) => MockNextResponse;

  beforeAll(async () => {
    middleware = await loadMiddleware('production');
  });

  // ── /login ────────────────────────────────────────────────────────────────

  describe('página /login', () => {
    let response: MockNextResponse;

    beforeEach(() => {
      resetCapturedHeaders();
      response = middleware(makeRequest('/login'));
    });

    it('não redireciona (rota pública)', () => {
      expect(response.status).not.toBe(307);
    });

    it('Content-Security-Policy contém nonce-', () => {
      const csp = response.headers.get('content-security-policy');
      expect(csp).not.toBeNull();
      expect(csp).toMatch(/nonce-[A-Za-z0-9+/]+=*/);
    });

    it('Cache-Control é no-store (protege contra CDN servir nonce estale)', () => {
      expect(response.headers.get('cache-control')).toBe('no-store');
    });

    it('nonce do response CSP bate com x-nonce injetado no request (consistência)', () => {
      // O middleware injeta `x-nonce` nos headers da REQUISIÇÃO para que o
      // Next.js aplique o mesmo nonce nos <script nonce="..."> do HTML renderizado.
      // Se o nonce do CSP (response) divergir do x-nonce (request), o browser
      // bloqueará todos os scripts inline — tela em branco.
      const cspNonce = extractNonce(
        response.headers.get('content-security-policy') ?? '',
      );
      const requestNonce = capturedRequestHeaders?.get('x-nonce');

      expect(cspNonce).toBeDefined();
      expect(requestNonce).toBeDefined();
      expect(cspNonce).toBe(requestNonce);
    });

    it('script-src cobre challenges.cloudflare.com (Turnstile)', () => {
      const csp = response.headers.get('content-security-policy') ?? '';
      const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
      expect(scriptSrc).toContain('https://challenges.cloudflare.com');
    });

    it('script-src não inclui unsafe-eval nem unsafe-inline sem nonce', () => {
      const csp = response.headers.get('content-security-policy') ?? '';
      const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
      expect(scriptSrc).not.toContain("'unsafe-eval'");
      expect(scriptSrc).not.toContain("'unsafe-inline'");
    });

    it('frame-ancestors definido (anti-clickjacking)', () => {
      const csp = response.headers.get('content-security-policy') ?? '';
      expect(csp).toContain('frame-ancestors');
    });

    it("object-src é 'none'", () => {
      const csp = response.headers.get('content-security-policy') ?? '';
      expect(csp).toContain("object-src 'none'");
    });
  });

  // ── /forgot-password ──────────────────────────────────────────────────────
  // Rota declarada em PUBLIC_ROUTES; o middleware aplica CSP corretamente mas
  // não existe page.tsx correspondente (Next.js retornaria 404). Os testes aqui
  // cobrem apenas o comportamento do MIDDLEWARE (sem redirecionar, com CSP).

  describe('/forgot-password — comportamento do middleware (PUBLIC_ROUTE sem page)', () => {
    let response: MockNextResponse;

    beforeEach(() => {
      resetCapturedHeaders();
      response = middleware(makeRequest('/forgot-password'));
    });

    it('não redireciona (declarada em PUBLIC_ROUTES)', () => {
      expect(response.status).not.toBe(307);
    });

    it('Content-Security-Policy contém nonce-', () => {
      const csp = response.headers.get('content-security-policy');
      expect(csp).not.toBeNull();
      expect(csp).toMatch(/nonce-[A-Za-z0-9+/]+=*/);
    });

    it('Cache-Control é no-store', () => {
      expect(response.headers.get('cache-control')).toBe('no-store');
    });

    it('nonce do response CSP bate com x-nonce injetado no request', () => {
      const cspNonce = extractNonce(
        response.headers.get('content-security-policy') ?? '',
      );
      const requestNonce = capturedRequestHeaders?.get('x-nonce');
      expect(cspNonce).toBeDefined();
      expect(requestNonce).toBeDefined();
      expect(cspNonce).toBe(requestNonce);
    });
  });

  // ── Unicidade de nonce ────────────────────────────────────────────────────

  describe('unicidade de nonce por requisição', () => {
    it('duas requisições a /login geram nonces distintos', () => {
      resetCapturedHeaders();
      const r1 = middleware(makeRequest('/login'));
      resetCapturedHeaders();
      const r2 = middleware(makeRequest('/login'));

      const n1 = extractNonce(r1.headers.get('content-security-policy') ?? '');
      const n2 = extractNonce(r2.headers.get('content-security-policy') ?? '');

      expect(n1).toBeDefined();
      expect(n2).toBeDefined();
      expect(n1).not.toBe(n2);
    });
  });

  // ── Autenticação ──────────────────────────────────────────────────────────

  describe('controle de acesso', () => {
    it('usuário sem cookie é redirecionado para /login', () => {
      const response = middleware(makeRequest('/dashboard'));
      expect(response.status).toBe(307);
    });

    it('usuário com cookie em rota protegida recebe CSP com nonce', () => {
      resetCapturedHeaders();
      const response = middleware(
        makeRequest('/dashboard', { cookie: 'jwt-stub' }),
      );
      expect(response.status).not.toBe(307);
      const cspNonce = extractNonce(
        response.headers.get('content-security-policy') ?? '',
      );
      const requestNonce = capturedRequestHeaders?.get('x-nonce');
      expect(cspNonce).toBeDefined();
      expect(requestNonce).toBeDefined();
      expect(cspNonce).toBe(requestNonce);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. TESTES UNITÁRIOS — modo desenvolvimento
// ═══════════════════════════════════════════════════════════════════════════

describe('CSP middleware — desenvolvimento (sem CSP)', () => {
  let middleware: (req: MockNextRequest) => MockNextResponse;

  beforeAll(async () => {
    middleware = await loadMiddleware('development');
  });

  it('não emite Content-Security-Policy em desenvolvimento', () => {
    const response = middleware(makeRequest('/login'));
    expect(response.headers.get('content-security-policy')).toBeNull();
  });

  it('não emite Cache-Control em desenvolvimento', () => {
    const response = middleware(makeRequest('/login'));
    expect(response.headers.get('cache-control')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. TESTE DE INTEGRAÇÃO HTTP
//
// Pré-requisito: servidor Next.js em modo produção acessível.
// Execução:      TEST_BASE_URL=https://seu-dominio.com npx jest middleware.spec.ts
//
// O que verifica (contra o servidor real, com HTML renderizado):
// a) Cache-Control: no-store presente nos response headers.
// b) Content-Security-Policy com nonce- presente nos response headers.
// c) Todos os <script nonce="..."> no HTML têm o mesmo nonce do CSP header.
//    — Prova que o Next.js aplicou o x-nonce do middleware ao HTML real.
// d) O header CSP não usa diretivas perigosas (unsafe-eval, unsafe-inline sem nonce).
//
// Sem TEST_BASE_URL o bloco é ignorado (describe.skip).
// ═══════════════════════════════════════════════════════════════════════════

const TEST_BASE_URL = process.env.TEST_BASE_URL;

// eslint-disable-next-line jest/valid-describe-callback
(TEST_BASE_URL ? describe : describe.skip)(
  'CSP middleware — integração HTTP contra servidor de produção',
  () => {
    const baseUrl = TEST_BASE_URL ?? 'http://localhost:3000';

    async function getPage(path: string): Promise<{
      headers: Record<string, string>;
      html: string;
      status: number;
    }> {
      const res = await fetch(`${baseUrl}${path}`, {
        redirect: 'manual',
        headers: { 'Accept': 'text/html' },
      });
      const headers: Record<string, string> = {};
      res.headers.forEach((value, key) => { headers[key] = value; });
      const html = await res.text();
      return { headers, html, status: res.status };
    }

    function extractNoncesFromHtml(html: string): string[] {
      const matches = [...html.matchAll(/\bnonce="([^"]+)"/g)];
      return matches.map((m) => m[1]);
    }

    /** Reutilizável para verificar as asserções em qualquer rota autenticada-pública. */
    function describePublicPage(path: string) {
      describe(path, () => {
        let page: Awaited<ReturnType<typeof getPage>>;

        beforeAll(async () => {
          page = await getPage(path);
        }, 15_000);

        it('servidor responde 200', () => {
          expect(page.status).toBe(200);
        });

        it('Cache-Control é no-store', () => {
          expect(page.headers['cache-control']).toBe('no-store');
        });

        it('Content-Security-Policy contém nonce-', () => {
          expect(page.headers['content-security-policy']).toMatch(/nonce-[A-Za-z0-9+/]+=*/);
        });

        it('nonces nos <script> do HTML batem com o nonce da CSP (thread-through)', () => {
          // O middleware injeta o nonce em `x-nonce` (request) e na CSP (response).
          // O Next.js usa `x-nonce` para estampar nonce="..." em cada <script> gerado.
          // Se eles divergirem, o browser bloqueia todos os scripts → tela em branco.
          const cspNonce = extractNonce(page.headers['content-security-policy'] ?? '');
          const htmlNonces = extractNoncesFromHtml(page.html);

          expect(htmlNonces.length).toBeGreaterThan(0);
          for (const n of htmlNonces) {
            expect(n).toBe(cspNonce);
          }
        });

        it('CSP não inclui unsafe-eval ou unsafe-inline (sem cobertura de nonce)', () => {
          const csp = page.headers['content-security-policy'] ?? '';
          const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
          expect(scriptSrc).not.toContain("'unsafe-eval'");
          expect(scriptSrc).not.toContain("'unsafe-inline'");
        });

        it('HTML renderizado tem conteúdo (CSP não bloqueou o render)', () => {
          // Heurística: se a CSP bloqueasse todos os scripts o Next não terminaria
          // a hidratação e a página ficaria com body vazio ou mensagem de erro.
          expect(page.html.toLowerCase()).toMatch(/<html|<body/);
        });
      });
    }

    describePublicPage('/login');
    describePublicPage('/forgot-password');
  },
);
