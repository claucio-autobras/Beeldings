import type { UserPreferences } from '@/modules/preferences/preferences.types';

export type UserRole = 'ADMIN' | 'CCO' | 'SUPERVISOR' | 'CLIENTE' | 'VISUALIZADOR';

export interface AuthUser {
  id: string;
  supabaseId: string;
  email: string;
  name: string;
  role: UserRole;
  tenantId: string | null;
  tenantName?: string | null;
  /** Preferências pessoais — retornadas pelo backend no login/perfil. */
  preferences?: UserPreferences;
}

export interface LoginCredentials {
  email: string;
  password: string;
  /** Token do widget Cloudflare Turnstile (quando habilitado no servidor). */
  turnstileToken?: string;
}

export interface LoginResponse {
  accessToken: string;
  user: AuthUser;
}

/**
 * Sessão do frontend: apenas o usuário. O token de acesso vive num cookie
 * HttpOnly emitido pelo backend e NUNCA é acessível ao JavaScript.
 */
export interface AuthSession {
  user: AuthUser;
}
