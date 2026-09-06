import type {
  AuthUser,
  LoginCredentials,
  LoginOutcome,
  LoginResponse,
  AuthSession,
} from '../types/auth.types';
import { usePreferencesStore, clearCachedPreferences } from '@/modules/preferences/preferences.store';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

// ─── Modo demonstração (mock) ──────────────────────────────────────────────────
// Quando NEXT_PUBLIC_USE_MOCK=true não há backend: a autenticação é resolvida
// localmente com os usuários de demonstração abaixo (qualquer senha é aceita).
const USE_MOCK = process.env.NEXT_PUBLIC_USE_MOCK === 'true';
const MOCK_ROLE_KEY = 'bluebee_mock_role';

const MOCK_USERS: Record<string, AuthUser> = {
  'admin@autobras.com.br':       { id: 'user-admin-001',        supabaseId: 'mock-admin',        email: 'admin@autobras.com.br',       name: 'Admin Autobras',      role: 'ADMIN',        tenantId: null },
  'cco@autobras.com.br':         { id: 'user-cco-001',          supabaseId: 'mock-cco',          email: 'cco@autobras.com.br',         name: 'Carlos CCO',          role: 'CCO',          tenantId: null },
  'supervisora@autobras.com.br': { id: 'user-supervisor-001',   supabaseId: 'mock-supervisor',   email: 'supervisora@autobras.com.br', name: 'Sandra Supervisora',  role: 'SUPERVISOR',   tenantId: null },
  'claucio@empresademo.com.br':  { id: 'user-cliente-001',      supabaseId: 'mock-cliente',      email: 'claucio@empresademo.com.br',  name: 'Claucio Santos',      role: 'CLIENTE',      tenantId: 'tenant-autobras' },
  'maria@empresademo.com.br':    { id: 'user-visualizador-001', supabaseId: 'mock-visualizador', email: 'maria@empresademo.com.br',    name: 'Maria Visualizadora', role: 'VISUALIZADOR', tenantId: 'tenant-autobras' },
};

async function signInMock(credentials: LoginCredentials): Promise<AuthSession> {
  const email = credentials.email.trim().toLowerCase();
  const user = MOCK_USERS[email];
  if (!user) {
    throw new Error('Usuário de demonstração não encontrado. Use, por exemplo, admin@autobras.com.br.');
  }
  // Em modo demonstração qualquer senha é aceita.
  const session: AuthSession = { user };
  saveSession(session);
  // Sem backend não existe cookie HttpOnly: grava um cookie simples só para o
  // middleware do Next liberar as rotas privadas em demonstração.
  if (typeof window !== 'undefined') {
    localStorage.setItem(MOCK_ROLE_KEY, user.role);
    document.cookie = `${SESSION_COOKIE_NAME}=mock; path=/; max-age=${7 * 24 * 60 * 60}; SameSite=Lax`;
  }
  return session;
}

// ─── Sessão local ─────────────────────────────────────────────────────────────
//
// O token de acesso NÃO é mais armazenado no browser: ele vive apenas no cookie
// HttpOnly `bluebee_session` emitido pelo backend no login (inacessível ao JS).
// No localStorage fica somente o usuário (dados não sensíveis) para hidratação
// rápida da UI — a validade real da sessão é confirmada via GET /auth/profile.

/** Nome do cookie de sessão HttpOnly emitido pelo backend (só para referência/mock). */
const SESSION_COOKIE_NAME = 'bluebee_session';

/** Chaves legadas (token acessível por JS) — removidas na transição. */
const LEGACY_TOKEN_KEY = 'bluebee_access_token';

const USER_KEY = 'bluebee_user';

function saveSession(session: AuthSession): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(USER_KEY, JSON.stringify(session.user));
}

/**
 * Atualiza o usuário persistido no localStorage (bluebee_user). Usado após
 * edições de perfil (Ajustes) para que nome/e-mail sobrevivam ao reload — o
 * AuthProvider restaura a sessão do storage antes de validar no backend.
 */
export function updateStoredUser(user: AuthSession['user']): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(USER_KEY);
  // Preferências são por usuário — não devem vazar para o próximo login.
  clearCachedPreferences();
  purgeLegacySession();
  // Cookie do modo demonstração (o cookie real é HttpOnly e só o backend expira).
  document.cookie = `${SESSION_COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`;
  // Limpa o cookie de tema para não vazar preferência para o próximo usuário.
  document.cookie = 'bluebee_theme=; path=/; max-age=0; SameSite=Lax';
}

/**
 * Transição: sessões antigas guardavam o JWT no localStorage e num cookie
 * legível por JS. Remove ambos — quem só tinha o token antigo cai no login
 * novamente (o middleware exige o novo cookie HttpOnly).
 */
export function purgeLegacySession(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(LEGACY_TOKEN_KEY);
  document.cookie = `${LEGACY_TOKEN_KEY}=; path=/; max-age=0; SameSite=Lax`;
}

// ─── signIn ───────────────────────────────────────────────────────────────────

export async function signIn(credentials: LoginCredentials): Promise<AuthSession | LoginOutcome> {
  if (USE_MOCK) {
    return signInMock(credentials);
  }

  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include', // recebe o cookie de sessão HttpOnly
    body: JSON.stringify(credentials),
  });

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? 'Falha ao realizar login');
  }

  // O accessToken do corpo é IGNORADO de propósito: a sessão do browser é o
  // cookie HttpOnly setado pelo backend nesta resposta.
  const data = (await res.json()) as LoginOutcome;
  if ('requiresTwoFactor' in data) return data;
  const session: AuthSession = { user: data.user };

  saveSession(session);
  purgeLegacySession();
  // Preferências chegam junto com o login: aplica tema/idioma/sino na hora.
  if (data.user.preferences) {
    usePreferencesStore.getState().setPreferences(data.user.preferences);
  }
  return session;
}

export async function verifyEmailTwoFactor(challengeId: string, code: string): Promise<AuthSession> {
  const res = await fetch(`${API_URL}/auth/two-factor/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ challengeId, code }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? 'Não foi possível confirmar o código');
  }
  const data = (await res.json()) as LoginResponse;
  const session: AuthSession = { user: data.user };
  saveSession(session);
  purgeLegacySession();
  if (data.user.preferences) usePreferencesStore.getState().setPreferences(data.user.preferences);
  return session;
}

export async function resendEmailTwoFactor(
  challengeId: string,
): Promise<{ resent: boolean; retryAfterSeconds?: number }> {
  const res = await fetch(`${API_URL}/auth/two-factor/resend`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ challengeId }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? 'Não foi possível reenviar o código');
  }
  return (await res.json()) as { resent: boolean; retryAfterSeconds?: number };
}

// ─── signOut ──────────────────────────────────────────────────────────────────

export async function signOut(): Promise<void> {
  if (USE_MOCK) {
    clearSession();
    return;
  }

  // Expira o cookie HttpOnly no servidor — sem guard, funciona mesmo com o
  // token já expirado. Erros de rede não impedem a limpeza local.
  await fetch(`${API_URL}/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  }).catch(() => {
    // Ignora erros de rede no logout — limpa sessão local de qualquer forma
  });

  clearSession();
}

// ─── getSession ───────────────────────────────────────────────────────────────

/**
 * Sessão persistida localmente (apenas o usuário — o token vive no cookie
 * HttpOnly). É uma hidratação otimista: a validade real deve ser confirmada
 * com `refreshProfile()` (feito pelo AuthProvider no mount).
 */
export function getSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;

  const userRaw = localStorage.getItem(USER_KEY);
  if (!userRaw) return null;

  try {
    const user = JSON.parse(userRaw) as AuthUser;
    return { user };
  } catch {
    clearSession();
    return null;
  }
}

// ─── getCurrentUser ───────────────────────────────────────────────────────────

export function getCurrentUser(): AuthUser | null {
  return getSession()?.user ?? null;
}

// ─── refreshProfile ───────────────────────────────────────────────────────────

/**
 * Valida a sessão no backend (cookie HttpOnly) e devolve o perfil atualizado.
 * Retorna null quando a sessão é inválida/expirada — o storage local é limpo.
 */
export async function refreshProfile(): Promise<AuthUser | null> {
  if (USE_MOCK) {
    return getCurrentUser();
  }

  const res = await fetch(`${API_URL}/auth/profile`, {
    credentials: 'include',
  }).catch(() => null);

  // Falha de rede: mantém a sessão local (pode ser instabilidade temporária).
  if (!res) return getCurrentUser();

  if (!res.ok) {
    clearSession();
    return null;
  }

  const user = (await res.json()) as AuthUser;
  saveSession({ user });
  return user;
}
